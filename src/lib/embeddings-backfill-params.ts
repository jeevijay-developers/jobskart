// Pure helpers for the embeddings-backfill route: query parsing and the shared-secret check.
// No I/O and no Vite-only imports so they are unit-testable with bun/node:test.
import { createHash, timingSafeEqual } from "node:crypto";

export type BackfillMode = "missing" | "refresh";

export function parseBackfillParams(search: URLSearchParams): { mode: BackfillMode; limit: number } {
  const mode: BackfillMode = search.get("mode") === "refresh" ? "refresh" : "missing";
  const n = Number.parseInt(search.get("limit") ?? "", 10);
  const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), 50) : 25;
  return { mode, limit };
}

export type BackfillAuth = "ok" | "unconfigured" | "forbidden";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Shared-secret check for the public backfill endpoint.
 *  - secret unset OR empty  => "unconfigured" (route answers 503; an empty secret must never
 *    authenticate, otherwise `"" === ""` would let an empty/missing header through).
 *  - header missing/empty/wrong (any length, any encoding) => "forbidden".
 * Both sides are hashed to fixed-length digests first, so timingSafeEqual never throws on
 * unequal lengths and comparison time does not depend on the secret's or header's length.
 */
export function checkBackfillAuth(
  headerValue: string | null,
  secretFromEnv: string | undefined,
): BackfillAuth {
  if (secretFromEnv === undefined || secretFromEnv === "") return "unconfigured";
  if (headerValue === null || headerValue === "") return "forbidden";
  return timingSafeEqual(digest(headerValue), digest(secretFromEnv)) ? "ok" : "forbidden";
}
