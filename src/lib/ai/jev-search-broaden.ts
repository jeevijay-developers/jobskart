export type SearchFilters = {
  query: string;
  cities: string[];
  minExp: number | "";
};

export type BroadenDim = "skills" | "location" | "experience";

export const EXP_LADDER = [5, 3, 1, 0] as const;

export function remainingBroadenDims(filters: SearchFilters): BroadenDim[] {
  const dims: BroadenDim[] = [];
  if (filters.query.trim()) dims.push("skills");
  if (filters.cities.length > 0) dims.push("location");
  if (filters.minExp !== "") dims.push("experience");
  return dims;
}

/** When Jev is off or fails: drop location first, then experience, keep the typed query longest. */
export function fallbackNextDim(remaining: BroadenDim[]): BroadenDim | null {
  if (remaining.includes("location")) return "location";
  if (remaining.includes("experience")) return "experience";
  if (remaining.includes("skills")) return "skills";
  return null;
}

export function stepDownExperience(minExp: number | ""): number | "" {
  if (minExp === "") return "";
  const i = EXP_LADDER.indexOf(minExp as (typeof EXP_LADDER)[number]);
  if (i === -1) {
    const lower = EXP_LADDER.find((n) => n < minExp);
    return lower === undefined ? "" : lower;
  }
  if (i === EXP_LADDER.length - 1) return "";
  return EXP_LADDER[i + 1];
}

export function applyBroaden(filters: SearchFilters, dim: BroadenDim): SearchFilters {
  if (dim === "skills") return { ...filters, query: "" };
  if (dim === "location") return { ...filters, cities: [] };
  return { ...filters, minExp: stepDownExperience(filters.minExp) };
}

export function broadenLabel(dim: BroadenDim, before: SearchFilters): string {
  if (dim === "skills") {
    const q = before.query.trim();
    return q
      ? `Showing similar profiles — we dropped the role/skill search (“${q}”) because too few matches.`
      : "Showing similar profiles — we dropped the role/skill search because too few matches.";
  }
  if (dim === "location") {
    const cities = before.cities.join(", ");
    return cities
      ? `Showing similar profiles — we relaxed location (${cities}).`
      : "Showing similar profiles — we relaxed location.";
  }
  const next = stepDownExperience(before.minExp);
  if (next === "") return "Showing similar profiles — we removed the experience minimum.";
  if (next === 0) return "Showing similar profiles — we lowered experience to fresher (0+).";
  return `Showing similar profiles — we lowered experience to ${next}+ years.`;
}

export function buildBroadenChoiceQuestion(remaining: BroadenDim[]) {
  const criteria: Record<string, string> = {};
  if (remaining.includes("skills")) {
    criteria.skills = "The role/skill query is excluding otherwise-plausible candidates. Drop it next.";
  }
  if (remaining.includes("location")) {
    criteria.location = "The city filter is excluding otherwise-plausible candidates. Drop cities next.";
  }
  if (remaining.includes("experience")) {
    criteria.experience =
      "The minimum years filter is excluding otherwise-plausible candidates. Step it down one band next.";
  }
  return {
    next: {
      type: "choice" as const,
      instructions:
        "This recruiter search returned too few candidates. Which single filter should we relax next? Pick only an option that is still constrained. Do not invent extra people.",
      criteria,
    },
  };
}

export function parseBroadenChoice(raw: object | null | undefined, remaining: BroadenDim[]): BroadenDim | null {
  const rec = raw as Record<string, unknown> | null | undefined;
  const ans = rec?.next;
  if (!ans || typeof ans !== "object") return null;
  const choice = (ans as { choice?: unknown }).choice;
  if (typeof choice !== "string") return null;
  if ((remaining as string[]).includes(choice)) return choice as BroadenDim;
  return null;
}
