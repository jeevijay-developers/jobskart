// Unit tests for backfillEmbeddings() against a FAKE db (no network, no real Supabase).
// Verifies: missing vs refresh row selection, limit, empty-text skip without calling embed,
// per-row embed failures not aborting the batch, remaining coming from a fresh count query
// (not total - processed arithmetic), and the unsupported-model short-circuit.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  backfillEmbeddings,
  type BackfillSupabase,
  type BackfillQuery,
} from "./embeddings-backfill.server.ts";

type Row = Record<string, unknown>;

type SelectCall = { table: string; columns: string; opts?: { count?: "exact"; head?: boolean } };

/** A small in-memory stand-in for the PostgREST query builder, enough to exercise the
 * filter/limit/update shape backfillEmbeddings() actually uses. `.or()` only understands
 * the `col.is.null` / `col.neq."value"` clauses this module generates. */
function makeFakeDb(tables: Record<string, Row[]>, calls: SelectCall[]): BackfillSupabase {
  return {
    from(table: string) {
      return {
        select(columns: string, opts?: { count?: "exact"; head?: boolean }) {
          calls.push({ table, columns, opts });
          const preds: Array<(r: Row) => boolean> = [];
          let limitN: number | null = null;

          const parseOrClause = (clause: string) => {
            const m = clause.match(/^([a-zA-Z0-9_]+)\.(is|neq)\.(.*)$/);
            if (!m) return () => false;
            const [, col, op, rawVal] = m;
            if (op === "is") return (r: Row) => (r[col] ?? null) === null;
            const val = rawVal.replace(/^"|"$/g, "");
            return (r: Row) => r[col] !== val;
          };

          const builder: BackfillQuery = {
            eq(col, val) {
              preds.push((r) => r[col] === val);
              return builder;
            },
            is(col, val) {
              preds.push((r) => (r[col] ?? null) === val);
              return builder;
            },
            or(filters) {
              const clausePreds = filters.split(",").map(parseOrClause);
              preds.push((r) => clausePreds.some((p) => p(r)));
              return builder;
            },
            in(col, vals) {
              preds.push((r) => vals.includes(r[col] as string));
              return builder;
            },
            order() {
              return builder;
            },
            limit(n) {
              limitN = n;
              return builder;
            },
            then(onFulfilled, onRejected) {
              const rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
              const result = opts?.head
                ? { data: null, count: rows.length, error: null }
                : {
                    data: limitN != null ? rows.slice(0, limitN) : rows,
                    count: opts?.count === "exact" ? rows.length : null,
                    error: null,
                  };
              return Promise.resolve(result).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
        update(values: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              for (const r of tables[table] ?? []) {
                if (r[col] === val) Object.assign(r, values);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

const MODEL = "test-model/1536";
const stubEmbed = async () => Array.from({ length: 4 }, () => 0.1);

function baseTables() {
  return {
    candidate_profiles: [] as Row[],
    profiles: [] as Row[],
    jobs: [] as Row[],
  };
}

describe("backfillEmbeddings", () => {
  it("missing mode only selects rows lacking an embedding", async () => {
    const tables = baseTables();
    tables.candidate_profiles = [
      { user_id: "c1", onboarding_completed: true, profile_embedding: null, headline: "A" },
      {
        user_id: "c2",
        onboarding_completed: true,
        profile_embedding: [1],
        profile_embedding_hash: "h",
        profile_embedding_model: MODEL,
        headline: "B",
      },
      {
        user_id: "c3",
        onboarding_completed: true,
        profile_embedding: [1],
        profile_embedding_hash: null, // stale, but NOT missing
        profile_embedding_model: MODEL,
        headline: "C",
      },
    ];
    const calls: SelectCall[] = [];
    const db = makeFakeDb(tables, calls);

    const result = await backfillEmbeddings({
      mode: "missing",
      limit: 25,
      db,
      embed: stubEmbed,
      modelId: () => MODEL,
    });

    assert.equal(
      result.candidates.processed,
      1,
      "only c1 (the one missing an embedding) processed",
    );
    assert.equal(result.candidates.failed, 0);
    assert.equal(result.candidates.remaining, 0);
  });

  it("refresh mode also selects stale (null hash / different model) rows", async () => {
    const tables = baseTables();
    tables.candidate_profiles = [
      { user_id: "c1", onboarding_completed: true, profile_embedding: null, headline: "A" },
      {
        user_id: "c2",
        onboarding_completed: true,
        profile_embedding: [1],
        profile_embedding_hash: "h",
        profile_embedding_model: MODEL,
        headline: "B", // current, must be excluded
      },
      {
        user_id: "c3",
        onboarding_completed: true,
        profile_embedding: [1],
        profile_embedding_hash: null,
        profile_embedding_model: MODEL,
        headline: "C", // stale hash
      },
      {
        user_id: "c4",
        onboarding_completed: true,
        profile_embedding: [1],
        profile_embedding_hash: "h",
        profile_embedding_model: "old-model/999",
        headline: "D", // stale model
      },
    ];
    const db = makeFakeDb(tables, []);

    const result = await backfillEmbeddings({
      mode: "refresh",
      limit: 25,
      db,
      embed: stubEmbed,
      modelId: () => MODEL,
    });

    assert.equal(
      result.candidates.processed,
      3,
      "c1 (missing) + c3 (stale hash) + c4 (stale model)",
    );
    assert.equal(result.candidates.remaining, 0);
  });

  it("limit is honored and remaining reflects a fresh count, not total - processed arithmetic", async () => {
    const tables = baseTables();
    tables.candidate_profiles = Array.from({ length: 5 }, (_, i) => ({
      user_id: `c${i}`,
      onboarding_completed: true,
      profile_embedding: null,
      headline: `H${i}`,
    }));
    const calls: SelectCall[] = [];
    const db = makeFakeDb(tables, calls);

    // One of the 3 fetched rows (c1) fails to embed; the other two succeed.
    const embed = async (text: string) => {
      if (text.includes("H1")) throw new Error("boom");
      return [0.1];
    };

    const result = await backfillEmbeddings({
      mode: "missing",
      limit: 3,
      db,
      embed,
      modelId: () => MODEL,
    });

    assert.equal(result.candidates.processed, 2, "2 of the 3 fetched rows succeeded");
    assert.equal(result.candidates.failed, 1, "c1's embed throw counted as failed");
    // Correct remaining = 5 initial - 2 actually written = 3 (the failed row + the 2 never fetched),
    // NOT "fetched(3) - processed(2) = 1" and NOT "initial(5) - limit(3) = 2" — both of which a
    // naive arithmetic shortcut could produce instead of re-querying actual DB state.
    assert.equal(result.candidates.remaining, 3);

    // Prove the count came from a genuinely separate, head-only query (not reused from the
    // initial select's `count`): the candidate_profiles table was queried twice, and the final
    // one is a head/count-only query.
    const candidateCalls = calls.filter((c) => c.table === "candidate_profiles");
    assert.equal(candidateCalls.length, 2);
    assert.equal(candidateCalls[1].opts?.head, true);
  });

  it("a row with empty embedding text is failed without calling embed", async () => {
    const tables = baseTables();
    tables.candidate_profiles = [
      {
        user_id: "c1",
        onboarding_completed: true,
        profile_embedding: null,
        headline: null,
        bio: null,
      },
    ];
    const db = makeFakeDb(tables, []);
    let embedCalls = 0;
    const embed = async () => {
      embedCalls++;
      return [0.1];
    };

    const result = await backfillEmbeddings({
      mode: "missing",
      limit: 25,
      db,
      embed,
      modelId: () => MODEL,
    });

    assert.equal(embedCalls, 0, "embed must never be called for empty text");
    assert.equal(result.candidates.failed, 1);
    assert.equal(result.candidates.processed, 0);
  });

  it("a per-row embed throw increments failed and does not abort the batch", async () => {
    const tables = baseTables();
    tables.candidate_profiles = [
      { user_id: "c1", onboarding_completed: true, profile_embedding: null, headline: "A" },
      { user_id: "c2", onboarding_completed: true, profile_embedding: null, headline: "B" },
      { user_id: "c3", onboarding_completed: true, profile_embedding: null, headline: "C" },
    ];
    const db = makeFakeDb(tables, []);
    const embed = async (text: string) => {
      if (text.includes("B")) throw new Error("provider down");
      return [0.1];
    };

    const result = await backfillEmbeddings({
      mode: "missing",
      limit: 25,
      db,
      embed,
      modelId: () => MODEL,
    });

    assert.equal(result.candidates.processed, 2, "c1 and c3 still processed despite c2 throwing");
    assert.equal(result.candidates.failed, 1);
  });

  it("jobs are selected and written the same way as candidates", async () => {
    const tables = baseTables();
    tables.jobs = [
      {
        id: "j1",
        status: "active",
        description_embedding: null,
        title: "Driver",
        description: "Deliver",
      },
      {
        id: "j2",
        status: "draft",
        description_embedding: null,
        title: "Ignored",
        description: "x",
      },
    ];
    const db = makeFakeDb(tables, []);

    const result = await backfillEmbeddings({
      mode: "missing",
      limit: 25,
      db,
      embed: stubEmbed,
      modelId: () => MODEL,
    });

    assert.equal(result.jobs.processed, 1, "only the active job is eligible");
    assert.equal(result.jobs.remaining, 0);
    assert.equal(tables.jobs[0].description_embedding_model, MODEL);
    assert.equal(tables.jobs[1].description_embedding, null, "draft job untouched");
  });

  it("modelId() returning 'unsupported' throws before any embed call", async () => {
    const tables = baseTables();
    tables.candidate_profiles = [
      { user_id: "c1", onboarding_completed: true, profile_embedding: null },
    ];
    const db = makeFakeDb(tables, []);
    let embedCalls = 0;
    const embed = async () => {
      embedCalls++;
      return [0.1];
    };

    await assert.rejects(
      () =>
        backfillEmbeddings({ mode: "missing", limit: 25, db, embed, modelId: () => "unsupported" }),
      /not configured/i,
    );
    assert.equal(embedCalls, 0);
  });
});
