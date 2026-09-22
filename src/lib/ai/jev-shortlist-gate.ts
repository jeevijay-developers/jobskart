export type GateRoute = "keep" | "drop" | "gemini";

export type NoulAnswer = { type: "noul"; noul: number };

export type GateAnswers = {
  skills_ok?: NoulAnswer;
  location_ok?: NoulAnswer;
  experience_ok?: NoulAnswer;
};

export function parseGateAnswers(raw: object | null | undefined): GateAnswers {
  const rec = raw as Record<string, unknown> | null | undefined;
  const pick = (key: string): NoulAnswer | undefined => {
    const v = rec?.[key];
    if (!v || typeof v !== "object") return undefined;
    const n = (v as { noul?: unknown }).noul;
    if (typeof n === "number" && !Number.isNaN(n)) return { type: "noul", noul: n };
    return undefined;
  };
  return {
    skills_ok: pick("skills_ok"),
    location_ok: pick("location_ok"),
    experience_ok: pick("experience_ok"),
  };
}

export type GateScore = {
  route: GateRoute;
  score: number;
  reasons: string[];
  summary: string;
};

export const GATE_HONESTY_REASON = "Scored without full AI review";

const SKILLS_KEEP = 0.85;
const EXP_KEEP = 0.85;
const LOC_KEEP = 0.7;
const SKILLS_DROP = 0.15;
const EXP_DROP = 0.15;

export type ShortlistQuestion = {
  type: "noul";
  instructions: string;
};

export function buildShortlistQuestions(jobHasCity: boolean): Record<string, ShortlistQuestion> {
  const questions: Record<string, ShortlistQuestion> = {
    skills_ok: {
      type: "noul",
      instructions:
        "Does this candidate's profile list the job's must-have skills, or close equivalents?",
    },
    experience_ok: {
      type: "noul",
      instructions:
        "Is the candidate's years of experience in range for the job's minimum experience requirement?",
    },
  };
  if (jobHasCity) {
    questions.location_ok = {
      type: "noul",
      instructions: "Is the candidate's city plausible for this job's city?",
    };
  }
  return questions;
}

function noulOf(answer: NoulAnswer | undefined): number | null {
  if (!answer || answer.type !== "noul" || typeof answer.noul !== "number" || Number.isNaN(answer.noul)) {
    return null;
  }
  return answer.noul;
}

export function routeFromAnswers(
  answers: GateAnswers,
  opts: { locationSkipped: boolean },
): GateRoute {
  const skills = noulOf(answers.skills_ok);
  const experience = noulOf(answers.experience_ok);
  if (skills === null || experience === null) return "gemini";

  const location = opts.locationSkipped ? 1 : noulOf(answers.location_ok);
  if (!opts.locationSkipped && location === null) return "gemini";

  if (skills <= SKILLS_DROP || experience <= EXP_DROP) return "drop";

  const locationPass = opts.locationSkipped || (location as number) >= LOC_KEEP;
  if (skills >= SKILLS_KEEP && experience >= EXP_KEEP && locationPass) return "keep";

  return "gemini";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function scoreFromGate(route: GateRoute, answers: GateAnswers): number {
  const skills = noulOf(answers.skills_ok) ?? 0;
  const experience = noulOf(answers.experience_ok) ?? 0;
  if (route === "keep") {
    return clamp(80 + Math.round(10 * Math.min(skills, experience)), 80, 92);
  }
  if (route === "drop") {
    return clamp(Math.round(8 + 25 * skills), 5, 35);
  }
  return 0;
}

export function reasonsFromGate(
  route: Exclude<GateRoute, "gemini">,
  answers: GateAnswers,
  opts: { locationSkipped: boolean },
): string[] {
  const skills = noulOf(answers.skills_ok) ?? 0;
  const experience = noulOf(answers.experience_ok) ?? 0;
  const location = opts.locationSkipped ? 1 : (noulOf(answers.location_ok) ?? 0);
  const reasons: string[] = [];

  if (route === "keep") {
    reasons.push(
      skills >= 0.95
        ? "Profile covers the required skills"
        : "Profile covers most of the required skills",
    );
    reasons.push(
      experience >= 0.95
        ? "Experience meets the job minimum"
        : "Experience is close enough to the job minimum",
    );
    if (!opts.locationSkipped) {
      reasons.push("Location looks plausible for this job");
    }
  } else {
    if (skills <= SKILLS_DROP) {
      reasons.push("Required skills do not show on the profile");
    }
    if (experience <= EXP_DROP) {
      reasons.push("Experience is below the job minimum");
    }
    if (!opts.locationSkipped && location < LOC_KEEP && reasons.length < 2) {
      reasons.push("Location does not look like a match");
    }
    if (!reasons.length) {
      reasons.push("Not a clear match for this job");
    }
  }

  reasons.push(GATE_HONESTY_REASON);
  return reasons.slice(0, 5);
}

export function scoreRowFromGate(
  answers: GateAnswers,
  opts: { locationSkipped: boolean },
): GateScore {
  const route = routeFromAnswers(answers, opts);
  if (route === "gemini") {
    return { route, score: 0, reasons: [], summary: "" };
  }
  const reasons = reasonsFromGate(route, answers, opts);
  const score = scoreFromGate(route, answers);
  const summary =
    route === "keep"
      ? "Strong fit on skills and experience"
      : "Clear mismatch — skipped full AI review";
  return { route, score, reasons, summary };
}
