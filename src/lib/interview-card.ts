// Pure logic for the Interview Card — no I/O, safe on client and server.
// Unlike interview practice (private, audio never stored), a card is something the candidate
// deliberately records, curates (one card, their choice of answers) and attaches per application.
import type { Band } from "@/lib/interview-prep";

export const CARD_CONSENT_VERSION = 1;
export const CARD_MAX_SECONDS = 90;
export const CARD_MAX_TAKES = 2; // first take + one retake
export const CARD_MIN_INCLUDED = 3;

export const CARD_CONSENT_POINTS = [
  "Your Interview Card is separate from practice. It is saved, so you can share it with employers.",
  "Your recorded voice answers and their text are stored securely. Only employers you attach the card to can listen to the answers you choose to include.",
  "You pick which answers to include, you pick which applications to attach the card to, and you can remove it from any application at any time.",
  "You can keep only one card. Recording a new one replaces the old one, and the old recordings are deleted.",
  "Employers see how clearly each answer was structured, not your accent, tone or emotions. It is not a hiring decision, and having no card never counts against you.",
  "You can withdraw this consent at any time. Your card and recordings are then deleted.",
];

export const SUMMARY_BAND_LABELS: Record<Band, string> = {
  needs_work: "Needs work",
  developing: "Developing",
  strong: "Strong",
};

const EXT_BY_MIME: Array<[string, string]> = [
  ["webm", "webm"],
  ["ogg", "ogg"],
  ["mp4", "m4a"],
  ["m4a", "m4a"],
  ["mpeg", "mp3"],
  ["wav", "wav"],
];

export const audioExtension = (mime: string) =>
  EXT_BY_MIME.find(([k]) => mime.toLowerCase().includes(k))?.[1] ?? "webm";

/** Storage object path. The leading candidate id keeps every candidate's files in their own folder. */
export const cardAudioPath = (
  candidateId: string,
  cardId: string,
  position: number,
  mime: string,
) => `${candidateId}/${cardId}/q${position}.${audioExtension(mime)}`;

export type CardFeedbackCriterion = {
  key: string;
  band: Band;
  evidence: string;
  tip?: string;
};

export type CandidateCardItem = {
  id: string;
  position: number;
  category: string;
  question_text: string;
  state: "pending" | "answered";
  takes: number;
  include: boolean;
  duration_sec: number | null;
  transcript: string | null;
  feedback: {
    criteria: CardFeedbackCriterion[];
    strengths: string[];
    improvements: string[];
    outline: string[];
  } | null;
  /** Short-lived signed URL so the candidate can replay their own recording. */
  audioUrl: string | null;
};

export type CandidateCard = {
  id: string;
  role_title: string;
  language: "en" | "hi";
  status: "in_progress" | "published";
  summary_band: Band | null;
  published_at: string | null;
  items: CandidateCardItem[];
};

/** What an employer receives: only included answers; coaching tips are stripped server-side. */
export type EmployerCardItem = {
  position: number;
  category: string;
  question: string;
  transcript: string | null;
  duration_sec: number | null;
  voice_metrics: { wpm?: number } | null;
  feedback: { criteria: CardFeedbackCriterion[]; strengths: string[] } | null;
  audioUrl: string | null;
};

export type EmployerCard = {
  language: "en" | "hi";
  role_title: string;
  summary_band: Band | null;
  published_at: string | null;
  items: EmployerCardItem[];
};

export type CardBadge = {
  application_id: string;
  summary_band: Band | null;
  answered_count: number;
};

/** Can this card be published right now? (also enforced by publish_interview_card()) */
export function canPublish(items: Pick<CandidateCardItem, "state" | "include">[]): boolean {
  return items.filter((i) => i.state === "answered" && i.include).length >= CARD_MIN_INCLUDED;
}

export function takesLeft(takes: number): number {
  return Math.max(0, CARD_MAX_TAKES - takes);
}
