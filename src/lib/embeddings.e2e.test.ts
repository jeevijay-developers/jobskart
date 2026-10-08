// Opt-in end-to-end test against the LOCAL Supabase stack only.
// Run with:
//   LOCAL_SUPABASE_E2E=1 LOCAL_SUPABASE_URL=http://127.0.0.1:54321 \
//   LOCAL_SUPABASE_ANON_KEY=<anon> LOCAL_JWT_SECRET=<jwt secret> bun test src/lib/embeddings.e2e.test.ts
// (values from `supabase status`; requires the fixtures in supabase/tests/fixtures/seed_local.sql).
// Proves the whole chain: TS arg names <-> PostgREST <-> SQL RPCs <-> invalidation triggers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { embedCandidateProfileCore, embedJobDescriptionCore } from "./embeddings.core.ts";

const ENABLED = process.env.LOCAL_SUPABASE_E2E === "1";
const URL = process.env.LOCAL_SUPABASE_URL ?? "";
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY ?? "";
const SECRET = process.env.LOCAL_JWT_SECRET ?? "";

const CANDIDATE_ID = "00000000-0000-4000-8000-00000000c001";
const EMPLOYER_ID = "00000000-0000-4000-8000-00000000e001";
const COMPANY_ID = "00000000-0000-4000-8000-00000000d001";
const MODEL = "e2e-test-model/1536";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signJwt(sub: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub,
      role: "authenticated",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function clientFor(sub: string) {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${signJwt(sub)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Deterministic 1536-length stub vector. */
const stubEmbed = async (text: string): Promise<number[]> => {
  const seed = text.length % 7;
  return Array.from({ length: 1536 }, (_, i) => ((i + seed) % 10) / 10);
};
const deps = { embed: stubEmbed, modelId: () => MODEL };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("embedding freshness e2e (local stack)", { skip: !ENABLED }, () => {
  it("candidate: embeds, skips unchanged, re-embeds after a skills change", async () => {
    assert.match(URL, /^http:\/\/(127\.0\.0\.1|localhost):/, "must target the local stack");
    const sb = clientFor(CANDIDATE_ID);
    const read = async () => {
      const { data, error } = await sb
        .from("candidate_profiles")
        .select(
          "skills, profile_embedding, profile_embedding_hash, profile_embedding_model, profile_embedded_at",
        )
        .eq("user_id", CANDIDATE_ID)
        .single();
      assert.ifError(error);
      return data!;
    };
    const snapshot = await read();
    const original = snapshot.skills as string[];
    try {
      const first = await embedCandidateProfileCore({
        supabase: sb as never,
        userId: CANDIDATE_ID,
        deps,
      });
      assert.equal(first.ok, true);
      assert.equal((first as { skipped: boolean }).skipped, false);
      const r1 = await read();
      assert.ok(r1.profile_embedding, "embedding stored");
      assert.match(r1.profile_embedding_hash as string, /^[0-9a-f]{64}$/);
      assert.equal(r1.profile_embedding_model, MODEL);
      assert.ok(r1.profile_embedded_at);

      await sleep(20);
      const second = await embedCandidateProfileCore({
        supabase: sb as never,
        userId: CANDIDATE_ID,
        deps,
      });
      assert.deepEqual(second, { ok: true, skipped: true });
      const r2 = await read();
      assert.equal(r2.profile_embedded_at, r1.profile_embedded_at, "timestamp unchanged on skip");
      assert.equal(r2.profile_embedding_hash, r1.profile_embedding_hash);

      const { error: upErr } = await sb
        .from("candidate_profiles")
        .update({ skills: [...original, "e2e-extra-skill"] })
        .eq("user_id", CANDIDATE_ID);
      assert.ifError(upErr);
      const stale = await read();
      assert.equal(stale.profile_embedding_hash, null, "trigger invalidated the hash");

      await sleep(20);
      const third = await embedCandidateProfileCore({
        supabase: sb as never,
        userId: CANDIDATE_ID,
        deps,
      });
      assert.deepEqual(third, { ok: true, skipped: false });
      const r3 = await read();
      assert.notEqual(r3.profile_embedding_hash, r1.profile_embedding_hash);
      assert.ok(
        new Date(r3.profile_embedded_at as string).getTime() >
          new Date(r1.profile_embedded_at as string).getTime(),
        "timestamp advanced",
      );
    } finally {
      // Leave the shared local fixtures exactly as found. Order matters: restoring `skills` fires
      // the invalidation trigger (clears the hash), so restore the embedding columns AFTER it.
      const skillsBack = await sb
        .from("candidate_profiles")
        .update({ skills: original })
        .eq("user_id", CANDIDATE_ID);
      assert.ifError(skillsBack.error);
      const embeddingBack = await sb
        .from("candidate_profiles")
        .update({
          profile_embedding: snapshot.profile_embedding,
          profile_embedding_hash: snapshot.profile_embedding_hash,
          profile_embedding_model: snapshot.profile_embedding_model,
          profile_embedded_at: snapshot.profile_embedded_at,
        })
        .eq("user_id", CANDIDATE_ID);
      assert.ifError(embeddingBack.error);
    }
  });

  it("job: embeds, skips unchanged, re-embeds after a skills change (employer e001)", async () => {
    assert.match(URL, /^http:\/\/(127\.0\.0\.1|localhost):/, "must target the local stack");
    const sb = clientFor(EMPLOYER_ID);
    const { data: jobRow, error: jErr } = await sb
      .from("jobs")
      .select("id, skills")
      .eq("company_id", COMPANY_ID)
      .limit(1)
      .single();
    assert.ifError(jErr);
    const jobId = jobRow!.id as string;
    const original = (jobRow!.skills ?? []) as string[];
    const read = async () => {
      const { data, error } = await sb
        .from("jobs")
        .select(
          "description_embedding, description_embedding_hash, description_embedding_model, description_embedded_at",
        )
        .eq("id", jobId)
        .single();
      assert.ifError(error);
      return data!;
    };
    const snapshot = await read();
    try {
      const first = await embedJobDescriptionCore({ supabase: sb as never, jobId, deps });
      assert.deepEqual(first, { ok: true, skipped: false });
      const r1 = await read();
      assert.ok(r1.description_embedding);
      assert.match(r1.description_embedding_hash as string, /^[0-9a-f]{64}$/);
      assert.equal(r1.description_embedding_model, MODEL);
      assert.ok(r1.description_embedded_at);

      await sleep(20);
      const second = await embedJobDescriptionCore({ supabase: sb as never, jobId, deps });
      assert.deepEqual(second, { ok: true, skipped: true });
      const r2 = await read();
      assert.equal(r2.description_embedded_at, r1.description_embedded_at);

      const { error: upErr } = await sb
        .from("jobs")
        .update({ skills: [...original, "e2e-extra-skill"] })
        .eq("id", jobId);
      assert.ifError(upErr);
      assert.equal((await read()).description_embedding_hash, null, "trigger invalidated the hash");

      await sleep(20);
      const third = await embedJobDescriptionCore({ supabase: sb as never, jobId, deps });
      assert.deepEqual(third, { ok: true, skipped: false });
      const r3 = await read();
      assert.notEqual(r3.description_embedding_hash, r1.description_embedding_hash);
      assert.ok(
        new Date(r3.description_embedded_at as string).getTime() >
          new Date(r1.description_embedded_at as string).getTime(),
      );
    } finally {
      // Same ordering rule as the candidate test: skills first (fires the invalidation trigger),
      // then put the original embedding columns back.
      const skillsBack = await sb.from("jobs").update({ skills: original }).eq("id", jobId);
      assert.ifError(skillsBack.error);
      const embeddingBack = await sb
        .from("jobs")
        .update({
          description_embedding: snapshot.description_embedding,
          description_embedding_hash: snapshot.description_embedding_hash,
          description_embedding_model: snapshot.description_embedding_model,
          description_embedded_at: snapshot.description_embedded_at,
        })
        .eq("id", jobId);
      assert.ifError(embeddingBack.error);
    }
  });
});
