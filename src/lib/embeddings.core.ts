// Core logic for generating semantic-matching embeddings, split out of
// embeddings.functions.ts so it can run (and be tested) outside TanStack Start:
// no TanStack imports, no auth middleware, no Vite-only modules.
//
// Never blocks the caller's primary flow (job posting / profile save) — every
// function swallows its own errors and reports { ok: false } instead of
// throwing, per the "no third-party failure blocks a core flow" rule.
//
// Unchanged text is never re-embedded: the hash of (model + input text) is
// stored with the vector and compared first. DB triggers clear the hash when
// embedding-relevant columns change, so a stale vector is detectable even if
// the UI path that edited the data never called these functions.
import { embed as providerEmbed, embeddingModelId } from "./ai/provider.ts";
import {
  buildCandidateEmbeddingText,
  buildCandidateRoleEmbeddingText,
  buildCandidateSkillsEmbeddingText,
  buildJobEmbeddingText,
  buildJobRoleEmbeddingText,
  buildJobSkillsEmbeddingText,
  embeddingInputHash,
} from "./embedding-text.ts";

type Row = Record<string, unknown>;

/** The minimal slice of a Supabase client these functions use (a fake satisfies it in tests). */
export type EmbeddingSupabase = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: Row | null }>;
      };
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type EmbeddingDeps = {
  embed?: (text: string) => Promise<number[]>;
  modelId?: () => string;
};

export type EmbedResult = { ok: true; skipped: boolean } | { ok: false };

const FAILED = { ok: false } as const;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArr = (v: unknown): string[] | null => (Array.isArray(v) ? (v as string[]) : null);

/** Shared tail: hash → is_current → skip, or embed → write. Throws on failure; callers catch. */
async function hashCheckAndWrite(args: {
  supabase: EmbeddingSupabase;
  text: string;
  modelId: string;
  embed: (text: string) => Promise<number[]>;
  currentRpc: { name: string; extra: Record<string, unknown> };
  writeRpc: { name: string; extra: Record<string, unknown> };
}): Promise<EmbedResult> {
  const hash = await embeddingInputHash(args.modelId, args.text);
  const current = await args.supabase.rpc(args.currentRpc.name, {
    ...args.currentRpc.extra,
    _hash: hash,
  });
  if (current.data === true) return { ok: true, skipped: true };

  const vector = await args.embed(args.text);
  const { error } = await args.supabase.rpc(args.writeRpc.name, {
    ...args.writeRpc.extra,
    _embedding: vector,
    _input_hash: hash,
    _model: args.modelId,
  });
  if (error) throw new Error(error.message);
  return { ok: true, skipped: false };
}

type FacetSpec = {
  text: string;
  currentRpc: string;
  writeRpc: string;
  extra: Record<string, unknown>;
};

/**
 * Skills-only and role-only facets, each independently hash-checked so an edit to one does not
 * re-embed the other. Best-effort by design: a facet failure (embed, RPC, or an empty text) is
 * swallowed and never affects the main embedding's result or the caller's flow.
 */
async function embedFacets(args: {
  supabase: EmbeddingSupabase;
  modelId: string;
  embed: (text: string) => Promise<number[]>;
  facets: FacetSpec[];
}): Promise<void> {
  await Promise.all(
    args.facets.map(async (f) => {
      if (!f.text.trim()) return;
      try {
        await hashCheckAndWrite({
          supabase: args.supabase,
          text: f.text,
          modelId: args.modelId,
          embed: args.embed,
          currentRpc: { name: f.currentRpc, extra: f.extra },
          writeRpc: { name: f.writeRpc, extra: f.extra },
        });
      } catch {
        // Facet is best-effort; the backfill worker retries missing/stale facets.
      }
    }),
  );
}

export async function embedCandidateProfileCore(args: {
  supabase: EmbeddingSupabase;
  userId: string;
  deps?: EmbeddingDeps;
}): Promise<EmbedResult> {
  const { supabase, userId } = args;
  try {
    const modelId = (args.deps?.modelId ?? embeddingModelId)();
    if (modelId === "unsupported") return FAILED;

    const [{ data: profile }, { data: cprof }] = await Promise.all([
      supabase.from("profiles").select("city").eq("id", userId).maybeSingle(),
      supabase
        .from("candidate_profiles")
        .select("headline, bio, skills, years_experience, last_role, interested_roles")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (!cprof) return FAILED;

    const text = buildCandidateEmbeddingText({
      headline: str(cprof.headline),
      lastRole: str(cprof.last_role),
      yearsExperience: typeof cprof.years_experience === "number" ? cprof.years_experience : null,
      skills: strArr(cprof.skills),
      city: str(profile?.city),
      bio: str(cprof.bio),
    });
    const embed = args.deps?.embed ?? providerEmbed;

    // Main (whole-document) facet first; its outcome is the function's result. A thrown error here
    // must not skip the narrower facets, so it is caught locally.
    let main: EmbedResult = FAILED;
    if (text.trim()) {
      try {
        main = await hashCheckAndWrite({
          supabase,
          text,
          modelId,
          embed,
          currentRpc: { name: "candidate_embedding_is_current", extra: {} },
          writeRpc: { name: "update_candidate_profile_embedding", extra: {} },
        });
      } catch {
        main = FAILED;
      }
    }

    await embedFacets({
      supabase,
      modelId,
      embed,
      facets: [
        {
          text: buildCandidateSkillsEmbeddingText(strArr(cprof.skills)),
          currentRpc: "candidate_skills_embedding_is_current",
          writeRpc: "update_candidate_skills_embedding",
          extra: {},
        },
        {
          text: buildCandidateRoleEmbeddingText({
            headline: str(cprof.headline),
            lastRole: str(cprof.last_role),
            interestedRoles: strArr(cprof.interested_roles),
          }),
          currentRpc: "candidate_role_embedding_is_current",
          writeRpc: "update_candidate_role_embedding",
          extra: {},
        },
      ],
    });
    return main;
  } catch {
    return FAILED;
  }
}

export async function embedJobDescriptionCore(args: {
  supabase: EmbeddingSupabase;
  jobId: string;
  deps?: EmbeddingDeps;
}): Promise<EmbedResult> {
  const { supabase, jobId } = args;
  try {
    const modelId = (args.deps?.modelId ?? embeddingModelId)();
    if (modelId === "unsupported") return FAILED;

    const { data: job } = await supabase
      .from("jobs")
      .select("title, description, skills, city, category")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return FAILED;

    const text = buildJobEmbeddingText({
      title: str(job.title),
      category: str(job.category),
      skills: strArr(job.skills),
      city: str(job.city),
      description: str(job.description),
    });
    const embed = args.deps?.embed ?? providerEmbed;
    const extra = { _job_id: jobId };

    let main: EmbedResult = FAILED;
    if (text.trim()) {
      try {
        main = await hashCheckAndWrite({
          supabase,
          text,
          modelId,
          embed,
          currentRpc: { name: "job_embedding_is_current", extra },
          writeRpc: { name: "update_job_description_embedding", extra },
        });
      } catch {
        main = FAILED;
      }
    }

    await embedFacets({
      supabase,
      modelId,
      embed,
      facets: [
        {
          text: buildJobSkillsEmbeddingText(strArr(job.skills)),
          currentRpc: "job_skills_embedding_is_current",
          writeRpc: "update_job_skills_embedding",
          extra,
        },
        {
          text: buildJobRoleEmbeddingText({ title: str(job.title), category: str(job.category) }),
          currentRpc: "job_role_embedding_is_current",
          writeRpc: "update_job_role_embedding",
          extra,
        },
      ],
    });
    return main;
  } catch {
    return FAILED;
  }
}
