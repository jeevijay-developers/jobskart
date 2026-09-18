// Deno-side mirror of src/lib/interview-token.server.ts's mint half. Edge
// Functions run on Deno and can't import Node/TanStack server code, so this
// independently re-implements the same wire format (base64url(payload) + "."
// + base64url(HMAC-SHA256(payload_b64))) using Web Crypto instead of Node's
// `crypto` module. Both sides must be configured with the SAME
// INTERVIEW_HMAC_SECRET value (Node app env var vs. Supabase project secret —
// two separate places, kept in sync manually) or minted tokens won't verify.

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function mintInterviewJoinToken(
  payload: { interviewId: string; candidateId: string; exp: number },
  secret: string,
): Promise<string> {
  const enc = new TextEncoder();
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sig = base64url(new Uint8Array(sigBuf));
  return `${payloadB64}.${sig}`;
}
