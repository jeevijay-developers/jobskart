// Server-only. Signs/verifies the magic link sent in the T-30 reminder email
// so a candidate who isn't logged in (or forgot their password right before
// an interview) can still reach the join screen without a login wall.
// Mirrors the raw-crypto HMAC pattern already used for Razorpay webhook
// verification in credits.functions.ts — no JWT library needed.
import { createHmac, timingSafeEqual } from "crypto";

export type InterviewJoinTokenPayload = {
  interviewId: string;
  candidateId: string;
  exp: number; // unix seconds
};

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function getInterviewTokenSecret(): string {
  const secret = process.env.INTERVIEW_HMAC_SECRET;
  if (!secret) {
    throw new Error(
      "Interview join links aren't configured yet. Ask the admin to add INTERVIEW_HMAC_SECRET.",
    );
  }
  return secret;
}

export function mintInterviewJoinToken(payload: InterviewJoinTokenPayload): string {
  const secret = getInterviewTokenSecret();
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(createHmac("sha256", secret).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

export type VerifyInterviewJoinTokenResult =
  | { ok: true; payload: InterviewJoinTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyInterviewJoinToken(token: string): VerifyInterviewJoinTokenResult {
  const secret = getInterviewTokenSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sig] = parts;

  const expectedSig = base64url(createHmac("sha256", secret).update(payloadB64).digest());
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: InterviewJoinTokenPayload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
