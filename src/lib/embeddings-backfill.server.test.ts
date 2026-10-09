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

          // Recursive PostgREST logic-tree parser: top-level comma list (OR), nested
          // `and(...)` / `or(...)`, and leaves `col.is.null` / `col.neq."v"` / `col.neq.{}`
          // (the last = "array is non-empty", which is how the real server reads it).
          const splitTop = (str: string): string[] => {
            const out: string[] = [];
            let depth = 0;
            let cur = "";
            for (const ch of str) {
              if (ch === "(") depth++;
              if (ch === ")") depth--;
              if (ch === "," && depth === 0) {
                out.push(cur);
                cur = "";
              } else cur += ch;
            }
            if (cur) out.push(cur);
            return out;
          };
          const parseNode = (node: string): ((r: Row) => boolean) => {
            const g = node.match(/^(and|or)\((.*)\)$/);
            if (g) {
              const kids = splitTop(g[2]).map(parseNode);
              return g[1] === "and"
                ? (r) => kids.every((k) => k(r))
                : (r) => kids.some((k) => k(r));
            }
            const m = node.match(/^([a-zA-Z0-9_]+)\.(is|neq)\.(.*)$/);
            if (!m) throw new Error(`fake db cannot parse: ${node}`);
            const [, col, op, rawVal] = m;
            if (op === "is") return (r) => (r[col] ?? null) === null;
            if (rawVal === "{}")
              return (r) => Array.isArray(r[col]) && (r[col] as unknown[]).length > 0;
            const val = rawVal.replace(/^"|"$/g, "");
            return (r) => r[col] !== val;
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
              const clausePreds = splitTop(filters).map(parseNode);
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
        role_embedding: [1],
        role_embedding_hash: "h",
        role_embedding_model: MODEL,
        profile_embedding_model: MODEL,
        headline: "B",
      },
      {
        user_id: "c3",
        onboarding_completed: true,
        profile_embedding: [1],
        profile_embedding_hash: null, // stale, but NOT missing
        role_embedding: [1],
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
        role_embedding: [1],
        role_embedding_hash: "h",
        role_embedding_model: MODEL,
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
        role_embedding: [1],
        role_embedding_hash: "h",
        role_embedding_model: MODEL,
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

  describe("faceted (skills / role) embeddings", () => {
    const hashOf = async (text: string) => {
      const { embeddingInputHash } = await import("./embedding-text.ts");
      return embeddingInputHash(MODEL, text);
    };

    it("a candidate missing only the skills/role facets is picked up; only missing facets are embedded in missing mode", async () => {
      const tables = baseTables();
      tables.candidate_profiles = [
        {
          user_id: "c1",
          onboarding_completed: true,
          headline: "Driver",
          skills: ["driving"],
          interested_roles: ["Delivery"],
          profile_embedding: [1],
          profile_embedding_hash: "stale-but-present",
          profile_embedding_model: MODEL,
          skills_embedding: null,
          role_embedding: null,
        },
      ];
      const embedded: string[] = [];
      const embed = async (t: string) => {
        embedded.push(t);
        return [0.5];
      };
      const result = await backfillEmbeddings({
        mode: "missing",
        limit: 25,
        db: makeFakeDb(tables, []),
        embed,
        modelId: () => MODEL,
      });
      const row = tables.candidate_profiles[0];
      assert.equal(result.candidates.processed, 1);
      assert.equal(result.candidates.remaining, 0);
      assert.deepEqual(row.skills_embedding, [0.5]);
      assert.deepEqual(row.role_embedding, [0.5]);
      assert.equal(row.skills_embedding_model, MODEL);
      assert.equal(row.role_embedding_model, MODEL);
      assert.ok(row.skills_embedding_hash && row.role_embedding_hash);
      assert.equal(embedded.length, 2, "missing mode must not re-embed the present main vector");
      assert.deepEqual(row.profile_embedding, [1], "present main facet untouched in missing mode");
    });

    it("refresh mode does not re-embed a facet whose stored hash already matches", async () => {
      const { buildCandidateSkillsEmbeddingText } = await import("./embedding-text.ts");
      const skillsText = buildCandidateSkillsEmbeddingText(["driving"]);
      const tables = baseTables();
      tables.candidate_profiles = [
        {
          user_id: "c1",
          onboarding_completed: true,
          headline: "Driver",
          skills: ["driving"],
          interested_roles: null,
          profile_embedding: [1],
          profile_embedding_hash: null, // stale -> row selected, main re-embedded
          profile_embedding_model: MODEL,
          skills_embedding: [9],
          skills_embedding_hash: await hashOf(skillsText), // current -> must be skipped
          skills_embedding_model: MODEL,
          role_embedding: [9],
          role_embedding_hash: "x",
          role_embedding_model: MODEL,
        },
      ];
      const embedded: string[] = [];
      const embed = async (t: string) => {
        embedded.push(t);
        return [0.5];
      };
      await backfillEmbeddings({
        mode: "refresh",
        limit: 25,
        db: makeFakeDb(tables, []),
        embed,
        modelId: () => MODEL,
      });
      const row = tables.candidate_profiles[0];
      assert.ok(!embedded.includes(skillsText), "current skills facet must not be re-embedded");
      assert.deepEqual(row.skills_embedding, [9]);
      assert.deepEqual(row.profile_embedding, [0.5]);
    });

    it("one facet failing does not abort the row or the batch; the row still counts processed", async () => {
      const tables = baseTables();
      tables.candidate_profiles = [
        {
          user_id: "c1",
          onboarding_completed: true,
          headline: "Driver",
          skills: ["boom-skill"],
          profile_embedding: null,
        },
        {
          user_id: "c2",
          onboarding_completed: true,
          headline: "Cook",
          skills: ["cooking"],
          profile_embedding: null,
        },
      ];
      const embed = async (t: string) => {
        if (t === "boom-skill") throw new Error("skills provider failure");
        return [0.5];
      };
      const result = await backfillEmbeddings({
        mode: "missing",
        limit: 25,
        db: makeFakeDb(tables, []),
        embed,
        modelId: () => MODEL,
      });
      assert.equal(result.candidates.processed, 2);
      assert.equal(result.candidates.failed, 0);
      assert.deepEqual(tables.candidate_profiles[0].profile_embedding, [0.5]);
      assert.equal(tables.candidate_profiles[0].skills_embedding ?? null, null);
      assert.deepEqual(tables.candidate_profiles[1].skills_embedding, [0.5]);
      assert.equal(result.candidates.remaining, 1, "c1 still lacks its skills facet");
    });

    it("a row is failed only when every attempted facet fails", async () => {
      const tables = baseTables();
      tables.candidate_profiles = [
        {
          user_id: "c1",
          onboarding_completed: true,
          headline: "Driver",
          skills: ["a"],
          profile_embedding: null,
        },
        {
          user_id: "c2",
          onboarding_completed: true,
          headline: "Cook",
          skills: ["b"],
          profile_embedding: null,
        },
      ];
      const embed = async (t: string) => {
        if (t.includes("Driver") || t === "a") throw new Error("down");
        return [0.5];
      };
      const result = await backfillEmbeddings({
        mode: "missing",
        limit: 25,
        db: makeFakeDb(tables, []),
        embed,
        modelId: () => MODEL,
      });
      assert.equal(result.candidates.failed, 1, "c1: all facets threw");
      assert.equal(result.candidates.processed, 1, "c2 succeeded");
    });

    it("candidates with no skills are not selected for the skills facet (no perpetual re-selection)", async () => {
      const tables = baseTables();
      tables.candidate_profiles = [
        {
          user_id: "c1",
          onboarding_completed: true,
          headline: "Driver",
          skills: [],
          profile_embedding: [1],
          profile_embedding_hash: "h",
          profile_embedding_model: MODEL,
          role_embedding: [1],
          role_embedding_hash: "h",
          role_embedding_model: MODEL,
          skills_embedding: null,
        },
      ];
      let calls = 0;
      const result = await backfillEmbeddings({
        mode: "refresh",
        limit: 25,
        db: makeFakeDb(tables, []),
        embed: async () => {
          calls++;
          return [0.5];
        },
        modelId: () => MODEL,
      });
      assert.equal(calls, 0);
      assert.equal(result.candidates.processed, 0);
      assert.equal(result.candidates.remaining, 0);
    });

    it("jobs: a job missing only the facets is selected and both facets are written", async () => {
      const tables = baseTables();
      tables.jobs = [
        {
          id: "j1",
          status: "active",
          title: "Driver",
          category: "Logistics",
          skills: ["driving"],
          description: "Deliver",
          description_embedding: [1],
          description_embedding_hash: "x",
          description_embedding_model: MODEL,
          skills_embedding: null,
          role_embedding: null,
        },
      ];
      const result = await backfillEmbeddings({
        mode: "missing",
        limit: 25,
        db: makeFakeDb(tables, []),
        embed: stubEmbed,
        modelId: () => MODEL,
      });
      assert.equal(result.jobs.processed, 1);
      assert.equal(result.jobs.remaining, 0);
      assert.ok(tables.jobs[0].skills_embedding);
      assert.ok(tables.jobs[0].role_embedding);
      assert.equal(tables.jobs[0].role_embedding_model, MODEL);
    });
  });
});
