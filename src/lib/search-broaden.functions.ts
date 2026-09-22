import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decide, isJevEnabled } from "@/lib/ai/provider";
import {
  applyBroaden,
  broadenLabel,
  buildBroadenChoiceQuestion,
  fallbackNextDim,
  parseBroadenChoice,
  remainingBroadenDims,
  type BroadenDim,
  type SearchFilters,
} from "@/lib/ai/jev-search-broaden";

const filtersSchema = z.object({
  query: z.string(),
  cities: z.array(z.string()),
  minExp: z.union([z.number().int().min(0), z.literal("")]),
  resultCount: z.number().int().min(0),
});

export type NextBroadening = {
  dim: BroadenDim | null;
  filters: SearchFilters;
  label: string | null;
};

export const pickNextSearchBroadening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }): Promise<NextBroadening> => {
    const filters: SearchFilters = {
      query: data.query,
      cities: data.cities,
      minExp: data.minExp,
    };
    const remaining = remainingBroadenDims(filters);
    if (!remaining.length) return { dim: null, filters, label: null };

    let dim: BroadenDim | null = remaining.length === 1 ? remaining[0]! : fallbackNextDim(remaining);

    if (isJevEnabled() && remaining.length > 1) {
      try {
        const result = await decide({
          state: {
            query: filters.query,
            cities: filters.cities,
            minExp: filters.minExp === "" ? null : filters.minExp,
            resultCount: data.resultCount,
            stillConstrained: remaining,
          },
          questions: buildBroadenChoiceQuestion(remaining),
        });
        dim = parseBroadenChoice(result.answers, remaining) ?? dim;
      } catch {
        // Jev down → deterministic ladder. Never block search.
      }
    }

    if (!dim) return { dim: null, filters, label: null };
    const next = applyBroaden(filters, dim);
    return { dim, filters: next, label: broadenLabel(dim, filters) };
  });
