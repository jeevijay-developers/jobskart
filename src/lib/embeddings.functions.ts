// Server-function wrappers for semantic-matching embeddings, used by
// recommend_jobs_for_candidate()'s semantic_score component. All logic lives in
// embeddings.core.ts (no TanStack imports, so it is unit/e2e-testable); these
// wrappers only add auth and input validation. Callers fire-and-forget them.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  embedCandidateProfileCore,
  embedJobDescriptionCore,
  type EmbeddingSupabase,
} from "@/lib/embeddings.core";

export const embedCandidateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return embedCandidateProfileCore({
      supabase: context.supabase as unknown as EmbeddingSupabase,
      userId: context.userId,
    });
  });

const EmbedJobInput = z.object({ jobId: z.string().uuid() });

export const embedJobDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => EmbedJobInput.parse(input))
  .handler(async ({ data, context }) => {
    return embedJobDescriptionCore({
      supabase: context.supabase as unknown as EmbeddingSupabase,
      jobId: data.jobId,
    });
  });
