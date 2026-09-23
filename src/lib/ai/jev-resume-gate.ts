export type ResumeGateQuestion = {
  type: "noul";
  instructions: string;
};

export type ResumeGateAnswers = {
  is_resume?: { type: "noul"; noul: number };
};

export const RESUME_NON_RESUME_MESSAGE =
  "Uploaded document does not appear to be a resume. Please upload a valid resume.";

export const RESUME_REJECT_THRESHOLD = 0.2;

export function buildResumeGateQuestion(): Record<string, ResumeGateQuestion> {
  return {
    is_resume: {
      type: "noul",
      instructions:
        "Does this text contain career details, work history, education, or skills typical of a curriculum vitae or resume?",
    },
  };
}

export function parseResumeGateAnswers(raw: object | null | undefined): ResumeGateAnswers {
  const rec = raw as Record<string, unknown> | null | undefined;
  const v = rec?.is_resume;
  if (!v || typeof v !== "object") return {};
  const n = (v as { noul?: unknown }).noul;
  if (typeof n === "number" && !Number.isNaN(n)) {
    return { is_resume: { type: "noul", noul: n } };
  }
  return {};
}

export function isLikelyResume(answers: ResumeGateAnswers): boolean {
  const noul = answers.is_resume?.noul;
  // If Jev was unable to determine or answer is missing, fail-open (true) so we don't block legitimate users
  if (typeof noul !== "number" || Number.isNaN(noul)) {
    return true;
  }
  // If confidence is strictly below 0.20, it's confident it's not a resume (e.g. invoice, manual, photo caption, homework)
  return noul >= RESUME_REJECT_THRESHOLD;
}
