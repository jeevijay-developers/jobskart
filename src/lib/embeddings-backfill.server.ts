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
  buildCandidateRoleEmbeddingText,
  buildCandidateSkillsEmbeddingText,
  buildJobEmbeddingText,
  buildJobRoleEmbeddingText,
  buildJobSkillsEmbeddingText,
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

/**
 * One embedding facet of a row. Candidates and jobs each have three: the whole-document vector
 * (`profile_*` / `description_*`) plus the skills-only and role-only vectors (`skills_*`, `role_*`).
 */
type Facet = {
  vecCol: string;
  hashCol: string;
  modelCol: string;
  atCol: string;
  text: string;
};

type FacetCols = Pick<Facet, "vecCol" | "hashCol" | "modelCol" | "atCol">;

const facetCols = (prefix: string, atPrefix = prefix): FacetCols => ({
  vecCol: `${prefix}_embedding`,
  hashCol: `${prefix}_embedding_hash`,
  modelCol: `${prefix}_embedding_model`,
  atCol: `${atPrefix}_embedded_at`,
});

const CANDIDATE_FACETS = {
  main: facetCols("profile"),
  skills: facetCols("skills"),
  role: facetCols("role"),
};
const JOB_FACETS = {
  main: facetCols("description"),
  skills: facetCols("skills"),
  role: facetCols("role"),
};

const facetColumnList = (f: Record<string, FacetCols>): string =>
  Object.values(f)
    .flatMap((c) => [c.vecCol, c.hashCol, c.modelCol])
    .join(", ");

/**
 * Applies the shared "missing" / "refresh" filter to a `select` already scoped to one table. A
 * row needs work when ANY of its three facets does. The skills facet is only considered for rows
 * that actually have skills: an empty skills array yields empty embedding text, which can never
 * be fixed by re-running, so such a row would otherwise be re-selected forever and starve the
 * batch.
 */
function withNeedingWorkFilter(
  query: BackfillQuery,
  mode: BackfillMode,
  model: string,
  facets: { main: FacetCols; skills: FacetCols; role: FacetCols },
): BackfillQuery {
  const clause = (c: FacetCols): string =>
    mode === "missing"
      ? `${c.vecCol}.is.null`
      : `${c.vecCol}.is.null,${c.hashCol}.is.null,${c.modelCol}.is.null,${c.modelCol}.neq."${model}"`;
  const skillsClause =
    mode === "missing"
      ? `and(skills.neq.{},${clause(facets.skills)})`
      : `and(skills.neq.{},or(${clause(facets.skills)}))`;
  return query.or([clause(facets.main), skillsClause, clause(facets.role)].join(","));
}

/**
 * Embeds and writes the facets of one row that are not already current, independently: each
 * facet is hash-checked against what is stored (so an unchanged facet is never re-embedded), and
 * a failure in one facet does not stop the others. Writes go straight to the table (service role;
 * see the header comment for why not the RPCs).
 *
 * `missing` mode only fills facets whose vector is absent; `refresh` also redoes stale ones.
 * Returns whether the row counts as processed: at least one facet written, or nothing left to do
 * and nothing failed. A row where nothing could be written (empty text, or every attempt threw)
 * is failed.
 */
async function backfillRowFacets(args: {
  db: BackfillSupabase;
  table: string;
  keyCol: string;
  keyVal: unknown;
  row: BackfillRow;
  facets: Facet[];
  embedFn: (text: string) => Promise<number[]>;
  model: string;
  mode: BackfillMode;
}): Promise<boolean> {
  let written = 0;
  let current = 0;
  let errors = 0;
  for (const f of args.facets) {
    try {
      if (!f.text.trim()) {
        // Nothing to embed for this facet. Only the main facet's emptiness is a failure signal
        // for the row (skills/role are legitimately empty for many rows).
        if (f === args.facets[0]) errors++;
        continue;
      }
      const hash = await embeddingInputHash(args.model, f.text);
      const hasVector = args.row[f.vecCol] != null;
      const isCurrent =
        hasVector && args.row[f.hashCol] === hash && args.row[f.modelCol] === args.model;
      if (args.mode === "missing" ? hasVector : isCurrent) {
        current++;
        continue;
      }
      const vector = await args.embedFn(f.text);
      const { error } = await args.db
        .from(args.table)
        .update({
          [f.vecCol]: vector,
          [f.hashCol]: hash,
          [f.modelCol]: args.model,
          [f.atCol]: new Date().toISOString(),
        })
        .eq(args.keyCol, args.keyVal);
      if (error) throw new Error(error.message);
      written++;
    } catch {
      errors++;
    }
  }
  return written > 0 || (errors === 0 && current > 0);
}

type CandidateRow = {
  user_id: string;
  headline: string | null;
  bio: string | null;
  skills: string[] | null;
  years_experience: number | null;
  last_role: string | null;
  interested_roles: string[] | null;
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
      .select(
        `user_id, headline, bio, skills, years_experience, last_role, interested_roles, ${facetColumnList(CANDIDATE_FACETS)}`,
      )
      .eq("onboarding_completed", true),
    mode,
    model,
    CANDIDATE_FACETS,
  );
  const { data, error } = await selectQuery.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<CandidateRow & BackfillRow>;

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
      const ok = await backfillRowFacets({
        db,
        table: "candidate_profiles",
        keyCol: "user_id",
        keyVal: r.user_id,
        row: r,
        embedFn,
        model,
        mode,
        facets: [
          {
            ...CANDIDATE_FACETS.main,
            text: buildCandidateEmbeddingText({
              headline: r.headline,
              lastRole: r.last_role,
              yearsExperience: r.years_experience,
              skills: r.skills,
              city: p?.city ?? null,
              bio: r.bio,
            }),
          },
          { ...CANDIDATE_FACETS.skills, text: buildCandidateSkillsEmbeddingText(r.skills) },
          {
            ...CANDIDATE_FACETS.role,
            text: buildCandidateRoleEmbeddingText({
              headline: r.headline,
              lastRole: r.last_role,
              interestedRoles: r.interested_roles,
            }),
          },
        ],
      });
      if (ok) processed++;
      else failed++;
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
    CANDIDATE_FACETS,
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
    db
      .from("jobs")
      .select(`id, title, category, skills, city, description, ${facetColumnList(JOB_FACETS)}`)
      .eq("status", "active"),
    mode,
    model,
    JOB_FACETS,
  );
  const { data, error } = await selectQuery.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<JobRow & BackfillRow>;

  let processed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const ok = await backfillRowFacets({
        db,
        table: "jobs",
        keyCol: "id",
        keyVal: r.id,
        row: r,
        embedFn,
        model,
        mode,
        facets: [
          {
            ...JOB_FACETS.main,
            text: buildJobEmbeddingText({
              title: r.title,
              category: r.category,
              skills: r.skills,
              city: r.city,
              description: r.description,
            }),
          },
          { ...JOB_FACETS.skills, text: buildJobSkillsEmbeddingText(r.skills) },
          {
            ...JOB_FACETS.role,
            text: buildJobRoleEmbeddingText({ title: r.title, category: r.category }),
          },
        ],
      });
      if (ok) processed++;
      else failed++;
    } catch {
      failed++;
    }
  }

  const remainingQuery = withNeedingWorkFilter(
    db.from("jobs").select("id", { count: "exact", head: true }).eq("status", "active"),
    mode,
    model,
    JOB_FACETS,
  );
  const { count, error: countErr } = await remainingQuery;
  if (countErr) throw new Error(countErr.message);
  return { processed, failed, remaining: count ?? 0 };
}
