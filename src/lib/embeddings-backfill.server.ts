// Service-role batch worker that creates / refreshes embeddings for candidates and jobs
// that are missing one or whose stored hash/model is stale. Server-only (uses the service
// role key, bypasses RLS) and deliberately sequential: small batches, provider rate limits,
// simple failure accounting (one bad row must never abort the batch).
//
// IMPORTANT: this writes the embedding columns directly via `.update()`, not through the
// `update_candidate_profile_embedding` / `update_job_description_embedding` RPCs that the
// user-facing path (embeddings.core.ts) uses. Those RPCs are `SECURITY DEFINER` functions that
// require `auth.uid()` to resolve a row (`WHERE user_id = auth.uid()` / membership check via
// `auth.uid()`); a service-role call has no JWT, so `auth.uid()` is NULL and the RPC raises
// `not_authenticated` (verified directly against the local DB: `set role service_role; select
// auth.uid();` returns NULL). A service-role-authenticated batch job therefore has no choice but
// to update the row directly — RLS is bypassed anyway, and the invalidation triggers only watch
// the content columns (headline/bio/skills/.../title/description/...), not the embedding columns,
// so writing the embedding columns directly does not re-trigger invalidation.
//
// Kept import-safe for unit tests: only pure modules (`ai/provider.ts`, `embedding-text.ts`,
// `embeddings-backfill-params.ts`) are imported at the top level. The real `supabaseAdmin` client
// (which throws if `SUPABASE_SERVICE_ROLE_KEY` is unset) is imported lazily, inside the function
// body, and only when the caller does not inject a `db` — so this file is importable, and its
// exported function callable with a fake `db`, with no service-role key present at all.
import { embed as providerEmbed, embeddingModelId as providerModelId } from "./ai/provider.ts";
import {
  buildCandidateEmbeddingText,
  buildJobEmbeddingText,
  embeddingInputHash,
} from "./embedding-text.ts";
import type { BackfillMode } from "./embeddings-backfill-params.ts";

export type Counts = { processed: number; failed: number; remaining: number };

export type BackfillRow = Record<string, unknown>;

type QueryResult = {
  data: BackfillRow[] | null;
  count: number | null;
  error: { message: string } | null;
};

/**
 * The minimal slice of a (PostgREST-style) Supabase query builder this module needs. Each
 * method mutates and returns the builder (matching supabase-js), and the builder itself is
 * awaitable, resolving to `{ data, count, error }`. The real `SupabaseClient` satisfies this
 * structurally; tests implement a small in-memory fake instead.
 */
export type BackfillQuery = PromiseLike<QueryResult> & {
  eq(column: string, value: unknown): BackfillQuery;
  is(column: string, value: null): BackfillQuery;
  or(filters: string): BackfillQuery;
  in(column: string, values: readonly string[]): BackfillQuery;
  order(column: string, opts: { ascending: boolean }): BackfillQuery;
  limit(n: number): BackfillQuery;
};

export type BackfillSupabase = {
  from(table: string): {
    select(columns: string, opts?: { count?: "exact"; head?: boolean }): BackfillQuery;
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export type BackfillDeps = {
  db?: BackfillSupabase;
  embed?: (text: string) => Promise<number[]>;
  modelId?: () => string;
};

export type BackfillOpts = { mode: BackfillMode; limit: number } & BackfillDeps;

export type BackfillResult = { model: string; candidates: Counts; jobs: Counts };

async function defaultDb(): Promise<BackfillSupabase> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as BackfillSupabase;
}

export async function backfillEmbeddings(opts: BackfillOpts): Promise<BackfillResult> {
  const modelId = (opts.modelId ?? providerModelId)();
  if (modelId === "unsupported") {
    throw new Error("Embeddings are not configured for this AI_PROVIDER.");
  }

  const db = opts.db ?? (await defaultDb());
  const embedFn = opts.embed ?? providerEmbed;

  const candidates = await backfillCandidates(db, embedFn, modelId, opts.mode, opts.limit);
  const jobs = await backfillJobs(db, embedFn, modelId, opts.mode, opts.limit);
  return { model: modelId, candidates, jobs };
}

/** Applies the shared "missing" / "refresh" filter to a `select` already scoped to one table. */
function withNeedingWorkFilter(
  query: BackfillQuery,
  mode: BackfillMode,
  model: string,
  embeddingCol: string,
  hashCol: string,
  modelCol: string,
): BackfillQuery {
  return mode === "missing"
    ? query.is(embeddingCol, null)
    : query.or(
        `${embeddingCol}.is.null,${hashCol}.is.null,${modelCol}.is.null,${modelCol}.neq."${model}"`,
      );
}

type CandidateRow = {
  user_id: string;
  headline: string | null;
  bio: string | null;
  skills: string[] | null;
  years_experience: number | null;
  last_role: string | null;
};

type ProfileRow = { id: string; full_name: string | null; city: string | null };

async function backfillCandidates(
  db: BackfillSupabase,
  embedFn: (text: string) => Promise<number[]>,
  model: string,
  mode: BackfillMode,
  limit: number,
): Promise<Counts> {
  const selectQuery = withNeedingWorkFilter(
    db
      .from("candidate_profiles")
      .select("user_id, headline, bio, skills, years_experience, last_role")
      .eq("onboarding_completed", true),
    mode,
    model,
    "profile_embedding",
    "profile_embedding_hash",
    "profile_embedding_model",
  );
  const { data, error } = await selectQuery.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as CandidateRow[];

  const ids = rows.map((r) => r.user_id);
  let profiles: ProfileRow[] = [];
  if (ids.length) {
    const { data: profs, error: profErr } = await db
      .from("profiles")
      .select("id, full_name, city")
      .in("id", ids);
    if (profErr) throw new Error(profErr.message);
    profiles = (profs ?? []) as unknown as ProfileRow[];
  }
  const profById = new Map(profiles.map((p) => [p.id, p]));

  let processed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const p = profById.get(r.user_id);
      const text = buildCandidateEmbeddingText({
        headline: r.headline,
        fullName: p?.full_name ?? null,
        lastRole: r.last_role,
        yearsExperience: r.years_experience,
        skills: r.skills,
        city: p?.city ?? null,
        bio: r.bio,
      });
      if (!text.trim()) throw new Error("empty embedding text");

      const vector = await embedFn(text);
      const hash = await embeddingInputHash(model, text);
      const { error: upErr } = await db
        .from("candidate_profiles")
        .update({
          profile_embedding: vector,
          profile_embedding_hash: hash,
          profile_embedding_model: model,
          profile_embedded_at: new Date().toISOString(),
        })
        .eq("user_id", r.user_id);
      if (upErr) throw new Error(upErr.message);
      processed++;
    } catch {
      failed++;
    }
  }

  const remainingQuery = withNeedingWorkFilter(
    db
      .from("candidate_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("onboarding_completed", true),
    mode,
    model,
    "profile_embedding",
    "profile_embedding_hash",
    "profile_embedding_model",
  );
  const { count, error: countErr } = await remainingQuery;
  if (countErr) throw new Error(countErr.message);
  return { processed, failed, remaining: count ?? 0 };
}

type JobRow = {
  id: string;
  title: string | null;
  category: string | null;
  skills: string[] | null;
  city: string | null;
  description: string | null;
};

async function backfillJobs(
  db: BackfillSupabase,
  embedFn: (text: string) => Promise<number[]>,
  model: string,
  mode: BackfillMode,
  limit: number,
): Promise<Counts> {
  const selectQuery = withNeedingWorkFilter(
    db.from("jobs").select("id, title, category, skills, city, description").eq("status", "active"),
    mode,
    model,
    "description_embedding",
    "description_embedding_hash",
    "description_embedding_model",
  );
  const { data, error } = await selectQuery.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as JobRow[];

  let processed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const text = buildJobEmbeddingText({
        title: r.title,
        category: r.category,
        skills: r.skills,
        city: r.city,
        description: r.description,
      });
      if (!text.trim()) throw new Error("empty embedding text");

      const vector = await embedFn(text);
      const hash = await embeddingInputHash(model, text);
      const { error: upErr } = await db
        .from("jobs")
        .update({
          description_embedding: vector,
          description_embedding_hash: hash,
          description_embedding_model: model,
          description_embedded_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      if (upErr) throw new Error(upErr.message);
      processed++;
    } catch {
      failed++;
    }
  }

  const remainingQuery = withNeedingWorkFilter(
    db.from("jobs").select("id", { count: "exact", head: true }).eq("status", "active"),
    mode,
    model,
    "description_embedding",
    "description_embedding_hash",
    "description_embedding_model",
  );
  const { count, error: countErr } = await remainingQuery;
  if (countErr) throw new Error(countErr.message);
  return { processed, failed, remaining: count ?? 0 };
}
