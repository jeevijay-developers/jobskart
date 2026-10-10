// Opt-in end-to-end test against the LOCAL Supabase stack only. Follows the exact pattern of
// embeddings.e2e.test.ts (same env var names where it already defines one), but this module
// runs with the SERVICE ROLE key because backfillEmbeddings() is a service-role batch worker
// (it writes embedding columns directly, bypassing RLS — see the comment at the top of
// embeddings-backfill.server.ts for why it cannot use the user-facing RPCs).
//
// Run with:
//   LOCAL_SUPABASE_E2E=1 LOCAL_SUPABASE_URL=http://127.0.0.1:54321 \
//   LOCAL_SERVICE_ROLE_KEY=<service_role key from `supabase status`> \
//   bun test src/lib/embeddings-backfill.e2e.test.ts
//
// CRITICAL (EXECUTION-RULES rule 8): snapshots every candidate_profiles/jobs row's
// embedding-related columns before running, restores them all in `finally`, and proves it with
// an md5 fingerprint of both tables' embedding columns before vs. after.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { backfillEmbeddings, type BackfillSupabase } from "./embeddings-backfill.server.ts";

const ENABLED = process.env.LOCAL_SUPABASE_E2E === "1";
const URL = process.env.LOCAL_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const MODEL = "e2e-backfill-test-model/1536";

// Every facet (whole-document, skills, role) of both tables: snapshotted, restored and fingerprinted.
const FACET_SUFFIXES = ["embedding", "embedding_hash", "embedding_model", "embedded_at"] as const;
const facetCols = (prefixes: string[]): string[] =>
  prefixes.flatMap((p) =>
    FACET_SUFFIXES.map((s) => (s === "embedded_at" ? `${p}_embedded_at` : `${p}_${s}`)),
  );
const CAND_FACET_COLS = facetCols(["profile", "skills", "role"]);
const JOB_FACET_COLS = facetCols(["description", "skills", "role"]);
const CAND_COLS = ["user_id", ...CAND_FACET_COLS].join(", ");
const JOB_COLS = ["id", ...JOB_FACET_COLS].join(", ");
type Row = Record<string, unknown>;
const pick = (row: Record<string, unknown>, cols: string[]) =>
  Object.fromEntries(cols.map((c) => [c, row[c]]));

/** Deterministic stub vector so the test never calls a real AI provider. */
const stubEmbed = async (text: string): Promise<number[]> => {
  const seed = text.length % 7;
  return Array.from({ length: 1536 }, (_, i) => ((i + seed) % 10) / 10);
};

function fingerprint(rows: Array<Record<string, unknown>>): string {
  // Order-independent: sort by primary key before hashing so row order never matters.
  const sorted = [...rows].sort((a, b) =>
    String(a.user_id ?? a.id).localeCompare(String(b.user_id ?? b.id)),
  );
  return createHash("md5").update(JSON.stringify(sorted)).digest("hex");
}

describe("embeddings backfill e2e (local stack)", { skip: !ENABLED }, () => {
  it("backfills missing embeddings, leaves fixtures byte-identical afterward, and converges remaining on a second call", async () => {
    assert.match(URL, /^http:\/\/(127\.0\.0\.1|localhost):/, "must target the local stack");
    assert.ok(SERVICE_ROLE_KEY, "LOCAL_SERVICE_ROLE_KEY must be set");

    const admin = createClient(URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const db = admin as unknown as BackfillSupabase;

    const { data: candBeforeRaw, error: candErr } = await admin
      .from("candidate_profiles")
      .select(CAND_COLS);
    assert.ifError(candErr);
    const { data: jobsBeforeRaw, error: jobsErr } = await admin.from("jobs").select(JOB_COLS);
    assert.ifError(jobsErr);
    const candBefore = candBeforeRaw as unknown as Row[];
    const jobsBefore = jobsBeforeRaw as unknown as Row[];

    const fpCandBefore = fingerprint(candBefore);
    const fpJobsBefore = fingerprint(jobsBefore);

    // Baseline: how many rows actually need embedding right now, queried directly (not guessed).
    const { count: missingCandBefore } = await admin
      .from("candidate_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("onboarding_completed", true)
      .is("profile_embedding", null);
    const { count: missingJobsBefore } = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("description_embedding", null);

    const countNull = async (
      table: string,
      pkCol: string,
      col: string,
      filter: [string, unknown],
    ) => {
      const { count, error } = await admin
        .from(table)
        .select(pkCol, { count: "exact", head: true })
        .eq(filter[0], filter[1])
        .is(col, null);
      assert.ifError(error);
      return count ?? 0;
    };
    const facetMissingBefore = {
      candSkills: await countNull("candidate_profiles", "user_id", "skills_embedding", [
        "onboarding_completed",
        true,
      ]),
      candRole: await countNull("candidate_profiles", "user_id", "role_embedding", [
        "onboarding_completed",
        true,
      ]),
      jobSkills: await countNull("jobs", "id", "skills_embedding", ["status", "active"]),
      jobRole: await countNull("jobs", "id", "role_embedding", ["status", "active"]),
    };

    try {
      const first = await backfillEmbeddings({
        mode: "missing",
        limit: 2,
        db,
        embed: stubEmbed,
        modelId: () => MODEL,
      });

      console.log("[e2e] first backfillEmbeddings() result:", JSON.stringify(first));
      console.log(
        "[e2e] baseline missing before run: candidates=%d jobs=%d",
        missingCandBefore,
        missingJobsBefore,
      );

      // Report honestly rather than assume a fixed fixture state: only assert "processed > 0"
      // when we know there was something to process.
      if ((missingCandBefore ?? 0) > 0) {
        assert.ok(first.candidates.processed > 0, "expected at least one candidate embedded");
      } else {
        assert.equal(first.candidates.processed, 0);
      }
      if ((missingJobsBefore ?? 0) > 0) {
        assert.ok(first.jobs.processed > 0, "expected at least one job embedded");
      } else {
        assert.equal(first.jobs.processed, 0);
      }

      // Facets: the skills/role vectors must be written alongside the main one. Compare the
      // number of rows that still lack each facet before vs. after the first pass.
      const facetMissingAfter = {
        candSkills: await countNull("candidate_profiles", "user_id", "skills_embedding", [
          "onboarding_completed",
          true,
        ]),
        candRole: await countNull("candidate_profiles", "user_id", "role_embedding", [
          "onboarding_completed",
          true,
        ]),
        jobSkills: await countNull("jobs", "id", "skills_embedding", ["status", "active"]),
        jobRole: await countNull("jobs", "id", "role_embedding", ["status", "active"]),
      };
      console.log(
        "[e2e] facet missing before/after:",
        JSON.stringify({ facetMissingBefore, facetMissingAfter }),
      );
      if (first.candidates.processed > 0) {
        assert.ok(
          facetMissingAfter.candRole < facetMissingBefore.candRole,
          "candidate role facet must be backfilled",
        );
        assert.ok(
          facetMissingAfter.candSkills <= facetMissingBefore.candSkills,
          "candidate skills facet must not regress",
        );
      }
      if (first.jobs.processed > 0) {
        assert.ok(
          facetMissingAfter.jobRole < facetMissingBefore.jobRole,
          "job role facet must be backfilled",
        );
        assert.ok(
          facetMissingAfter.jobSkills <= facetMissingBefore.jobSkills,
          "job skills facet must not regress",
        );
      }

      const second = await backfillEmbeddings({
        mode: "missing",
        limit: 2,
        db,
        embed: stubEmbed,
        modelId: () => MODEL,
      });
      console.log("[e2e] second backfillEmbeddings() result:", JSON.stringify(second));

      if ((missingCandBefore ?? 0) > 0) {
        assert.ok(
          second.candidates.remaining <= first.candidates.remaining,
          "remaining candidates must not increase on a second missing-mode pass",
        );
      }
      if ((missingJobsBefore ?? 0) > 0) {
        assert.ok(
          second.jobs.remaining <= first.jobs.remaining,
          "remaining jobs must not increase on a second missing-mode pass",
        );
      }
    } finally {
      // Restore every row's embedding columns to exactly what was snapshotted, regardless of
      // how many this run touched.
      for (const row of candBefore) {
        const { error } = await admin
          .from("candidate_profiles")
          .update(pick(row, CAND_FACET_COLS))
          .eq("user_id", row.user_id as string);
        assert.ifError(error);
      }
      for (const row of jobsBefore) {
        const { error } = await admin
          .from("jobs")
          .update(pick(row, JOB_FACET_COLS))
          .eq("id", row.id as string);
        assert.ifError(error);
      }

      const { data: candAfterRaw, error: candAfterErr } = await admin
        .from("candidate_profiles")
        .select(CAND_COLS);
      assert.ifError(candAfterErr);
      const { data: jobsAfterRaw, error: jobsAfterErr } = await admin.from("jobs").select(JOB_COLS);
      assert.ifError(jobsAfterErr);
      const candAfter = candAfterRaw as unknown as Row[];
      const jobsAfter = jobsAfterRaw as unknown as Row[];

      const fpCandAfter = fingerprint(candAfter);
      const fpJobsAfter = fingerprint(jobsAfter);
      console.log(
        "[e2e] fingerprint candidate_profiles before=%s after=%s",
        fpCandBefore,
        fpCandAfter,
      );
      console.log("[e2e] fingerprint jobs before=%s after=%s", fpJobsBefore, fpJobsAfter);

      assert.equal(
        fpCandAfter,
        fpCandBefore,
        "candidate_profiles embedding columns must be restored exactly",
      );
      assert.equal(fpJobsAfter, fpJobsBefore, "jobs embedding columns must be restored exactly");
    }
  });
});
