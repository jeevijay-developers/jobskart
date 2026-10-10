import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { embedCandidateProfileCore, embedJobDescriptionCore } from "./embeddings.core.ts";
import {
  buildCandidateEmbeddingText,
  buildCandidateRoleEmbeddingText,
  buildCandidateSkillsEmbeddingText,
  buildJobEmbeddingText,
  buildJobRoleEmbeddingText,
  buildJobSkillsEmbeddingText,
  embeddingInputHash,
} from "./embedding-text.ts";

const MODEL = "test-model/3";
const VEC = [0.1, 0.2, 0.3];

type Rpc = { name: string; args: Record<string, unknown> };

/** Hand-written fake: rows keyed by table, rpc results keyed by function name. */
function makeFake(opts: {
  rows: Record<string, Record<string, unknown> | null>;
  rpcResults?: Record<string, { data?: unknown; error?: { message: string } | null }>;
}) {
  const calls: Rpc[] = [];
  return {
    calls,
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.rows[table] ?? null }),
          }),
        }),
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const r = opts.rpcResults?.[name] ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
}

function makeEmbed(impl?: () => Promise<number[]>) {
  const state = { count: 0, texts: [] as string[] };
  const fn = async (t: string) => {
    state.count++;
    state.texts.push(t);
    return impl ? impl() : VEC;
  };
  return { fn, state };
}

const candRows = {
  profiles: { city: "Pune" },
  candidate_profiles: {
    headline: "Driver",
    bio: "Reliable",
    skills: ["driving", "navigation"],
    years_experience: 4,
    last_role: "Cab driver",
    interested_roles: ["Delivery"],
  },
};
const candSkillsText = buildCandidateSkillsEmbeddingText(["driving", "navigation"]);
const candRoleText = buildCandidateRoleEmbeddingText({
  headline: "Driver",
  lastRole: "Cab driver",
  interestedRoles: ["Delivery"],
});
const candText = buildCandidateEmbeddingText({
  headline: "Driver",
  lastRole: "Cab driver",
  yearsExperience: 4,
  skills: ["driving", "navigation"],
  city: "Pune",
  bio: "Reliable",
});

const JOB_ID = "00000000-0000-4000-8000-0000000000b1";
const jobRows = {
  jobs: {
    title: "Driver",
    description: "Drive",
    skills: ["driving"],
    city: "Pune",
    category: "Logistics",
  },
};
const jobSkillsText = buildJobSkillsEmbeddingText(["driving"]);
const jobRoleText = buildJobRoleEmbeddingText({ title: "Driver", category: "Logistics" });
const jobText = buildJobEmbeddingText({
  title: "Driver",
  category: "Logistics",
  skills: ["driving"],
  city: "Pune",
  description: "Drive",
});

const deps = (e: ReturnType<typeof makeEmbed>, modelId = MODEL) => ({
  embed: e.fn,
  modelId: () => modelId,
});

describe("embedCandidateProfileCore", () => {
  it("embeds and records hash + model when not current", async () => {
    const fake = makeFake({
      rows: candRows,
      rpcResults: { candidate_embedding_is_current: { data: false } },
    });
    const e = makeEmbed();
    const hash = await embeddingInputHash(MODEL, candText);
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: false });
    assert.equal(e.state.texts[0], candText);
    assert.equal(fake.calls[0].name, "candidate_embedding_is_current");
    assert.deepEqual(fake.calls[0].args, { _hash: hash });
    assert.equal(fake.calls[1].name, "update_candidate_profile_embedding");
    assert.deepEqual(fake.calls[1].args, { _embedding: VEC, _input_hash: hash, _model: MODEL });
  });

  it("skips (no embed, no write) when the hash is current", async () => {
    const fake = makeFake({
      rows: candRows,
      rpcResults: {
        candidate_embedding_is_current: { data: true },
        candidate_skills_embedding_is_current: { data: true },
        candidate_role_embedding_is_current: { data: true },
      },
    });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: true });
    assert.equal(e.state.count, 0);
    assert.equal(fake.calls.length, 3, "three is_current checks, no writes");
    assert.ok(fake.calls.every((c) => c.name.endsWith("_is_current")));
  });

  it("returns ok:false for an unsupported model without embedding", async () => {
    const fake = makeFake({ rows: candRows });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({
      supabase: fake,
      userId: "u1",
      deps: deps(e, "unsupported"),
    });
    assert.deepEqual(res, { ok: false });
    assert.equal(e.state.count, 0);
  });

  it("does not throw when embed throws", async () => {
    const fake = makeFake({
      rows: candRows,
      rpcResults: { candidate_embedding_is_current: { data: false } },
    });
    const e = makeEmbed(async () => {
      throw new Error("provider down");
    });
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: false });
  });

  it("returns ok:false when the write RPC errors", async () => {
    const fake = makeFake({
      rows: candRows,
      rpcResults: {
        candidate_embedding_is_current: { data: false },
        update_candidate_profile_embedding: { error: { message: "boom" } },
      },
    });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: false });
  });

  it("returns ok:false for an empty profile without embedding", async () => {
    const fake = makeFake({
      rows: {
        profiles: { city: null },
        candidate_profiles: {
          headline: null,
          bio: null,
          skills: [],
          years_experience: null,
          last_role: null,
          interested_roles: [],
        },
      },
    });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: false });
    assert.equal(e.state.count, 0);
  });

  it("returns ok:false when the candidate row is missing", async () => {
    const fake = makeFake({ rows: { profiles: { city: null } } });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: false });
    assert.equal(e.state.count, 0);
  });
});

describe("embedJobDescriptionCore", () => {
  it("embeds and records hash + model, passing _job_id", async () => {
    const fake = makeFake({
      rows: jobRows,
      rpcResults: { job_embedding_is_current: { data: false } },
    });
    const e = makeEmbed();
    const hash = await embeddingInputHash(MODEL, jobText);
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: false });
    assert.deepEqual(fake.calls[0], {
      name: "job_embedding_is_current",
      args: { _job_id: JOB_ID, _hash: hash },
    });
    assert.equal(fake.calls[1].name, "update_job_description_embedding");
    assert.deepEqual(fake.calls[1].args, {
      _job_id: JOB_ID,
      _embedding: VEC,
      _input_hash: hash,
      _model: MODEL,
    });
  });

  it("skips when current", async () => {
    const fake = makeFake({
      rows: jobRows,
      rpcResults: {
        job_embedding_is_current: { data: true },
        job_skills_embedding_is_current: { data: true },
        job_role_embedding_is_current: { data: true },
      },
    });
    const e = makeEmbed();
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: true });
    assert.equal(e.state.count, 0);
    assert.equal(fake.calls.length, 3, "three is_current checks, no writes");
    assert.ok(fake.calls.every((c) => c.name.endsWith("_is_current")));
  });

  it("unsupported model => ok:false, embed never called", async () => {
    const fake = makeFake({ rows: jobRows });
    const e = makeEmbed();
    const res = await embedJobDescriptionCore({
      supabase: fake,
      jobId: JOB_ID,
      deps: deps(e, "unsupported"),
    });
    assert.deepEqual(res, { ok: false });
    assert.equal(e.state.count, 0);
  });

  it("embed throws => ok:false, no throw", async () => {
    const fake = makeFake({
      rows: jobRows,
      rpcResults: { job_embedding_is_current: { data: false } },
    });
    const e = makeEmbed(async () => {
      throw new Error("x");
    });
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: false });
  });

  it("write RPC error => ok:false", async () => {
    const fake = makeFake({
      rows: jobRows,
      rpcResults: {
        job_embedding_is_current: { data: false },
        update_job_description_embedding: { error: { message: "nope" } },
      },
    });
    const e = makeEmbed();
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: false });
  });

  it("empty job text => ok:false without embedding", async () => {
    const fake = makeFake({
      rows: { jobs: { title: null, description: null, skills: [], city: null, category: null } },
    });
    const e = makeEmbed();
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: false });
    assert.equal(e.state.count, 0);
  });

  it("missing job row => ok:false", async () => {
    const fake = makeFake({ rows: {} });
    const e = makeEmbed();
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: false });
    assert.equal(e.state.count, 0);
  });
});

describe("faceted embeddings (skills + role)", () => {
  const written = (fake: ReturnType<typeof makeFake>, name: string) =>
    fake.calls.filter((c) => c.name === name);

  it("candidate: embeds and writes all three facets with their own text and hash", async () => {
    const fake = makeFake({ rows: candRows });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: false });
    assert.deepEqual([...e.state.texts].sort(), [candText, candRoleText, candSkillsText].sort());
    const sh = await embeddingInputHash(MODEL, candSkillsText);
    const rh = await embeddingInputHash(MODEL, candRoleText);
    assert.deepEqual(written(fake, "update_candidate_skills_embedding")[0].args, {
      _embedding: VEC,
      _input_hash: sh,
      _model: MODEL,
    });
    assert.deepEqual(written(fake, "update_candidate_role_embedding")[0].args, {
      _embedding: VEC,
      _input_hash: rh,
      _model: MODEL,
    });
    assert.deepEqual(written(fake, "candidate_skills_embedding_is_current")[0].args, {
      _hash: sh,
    });
  });

  it("candidate: only the stale facet is re-embedded", async () => {
    const fake = makeFake({
      rows: candRows,
      rpcResults: {
        candidate_embedding_is_current: { data: true },
        candidate_skills_embedding_is_current: { data: true },
        candidate_role_embedding_is_current: { data: false },
      },
    });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: true });
    assert.deepEqual(e.state.texts, [candRoleText]);
    assert.equal(written(fake, "update_candidate_role_embedding").length, 1);
    assert.equal(written(fake, "update_candidate_skills_embedding").length, 0);
  });

  it("candidate: a failing facet write never fails the main embedding; other facet still written", async () => {
    const fake = makeFake({
      rows: candRows,
      rpcResults: { update_candidate_skills_embedding: { error: { message: "boom" } } },
    });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: false });
    assert.equal(written(fake, "update_candidate_profile_embedding").length, 1);
    assert.equal(written(fake, "update_candidate_role_embedding").length, 1);
  });

  it("candidate: a facet embed that throws is swallowed", async () => {
    const fake = makeFake({ rows: candRows });
    const e = makeEmbed();
    const flaky = async (t: string) => {
      if (t === candSkillsText) throw new Error("provider hiccup");
      return e.fn(t);
    };
    const res = await embedCandidateProfileCore({
      supabase: fake,
      userId: "u1",
      deps: { embed: flaky, modelId: () => MODEL },
    });
    assert.deepEqual(res, { ok: true, skipped: false });
    assert.equal(written(fake, "update_candidate_role_embedding").length, 1);
  });

  it("candidate: main failure does not prevent facets; result stays ok:false", async () => {
    const fake = makeFake({
      rows: candRows,
      rpcResults: { update_candidate_profile_embedding: { error: { message: "nope" } } },
    });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: false });
    assert.equal(written(fake, "update_candidate_skills_embedding").length, 1);
  });

  it("candidate: empty facet text (no skills) skips that facet without embed or RPC", async () => {
    const fake = makeFake({
      rows: {
        profiles: { city: "Pune" },
        candidate_profiles: { ...candRows.candidate_profiles, skills: [] },
      },
    });
    const e = makeEmbed();
    const res = await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: false });
    assert.equal(fake.calls.filter((c) => c.name.includes("skills")).length, 0);
  });

  it("candidate: unsupported model touches no facet", async () => {
    const fake = makeFake({ rows: candRows });
    const e = makeEmbed();
    await embedCandidateProfileCore({ supabase: fake, userId: "u1", deps: deps(e, "unsupported") });
    assert.equal(fake.calls.length, 0);
    assert.equal(e.state.count, 0);
  });

  it("job: embeds and writes all three facets passing _job_id", async () => {
    const fake = makeFake({ rows: jobRows });
    const e = makeEmbed();
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: false });
    assert.deepEqual([...e.state.texts].sort(), [jobText, jobRoleText, jobSkillsText].sort());
    const sh = await embeddingInputHash(MODEL, jobSkillsText);
    const rh = await embeddingInputHash(MODEL, jobRoleText);
    assert.deepEqual(written(fake, "update_job_skills_embedding")[0].args, {
      _job_id: JOB_ID,
      _embedding: VEC,
      _input_hash: sh,
      _model: MODEL,
    });
    assert.deepEqual(written(fake, "update_job_role_embedding")[0].args, {
      _job_id: JOB_ID,
      _embedding: VEC,
      _input_hash: rh,
      _model: MODEL,
    });
    assert.deepEqual(written(fake, "job_role_embedding_is_current")[0].args, {
      _job_id: JOB_ID,
      _hash: rh,
    });
  });

  it("job: only the stale facet is re-embedded; a facet write failure never fails main", async () => {
    const fake = makeFake({
      rows: jobRows,
      rpcResults: {
        job_embedding_is_current: { data: true },
        job_skills_embedding_is_current: { data: false },
        job_role_embedding_is_current: { data: true },
        update_job_skills_embedding: { error: { message: "denied" } },
      },
    });
    const e = makeEmbed();
    const res = await embedJobDescriptionCore({ supabase: fake, jobId: JOB_ID, deps: deps(e) });
    assert.deepEqual(res, { ok: true, skipped: true });
    assert.deepEqual(e.state.texts, [jobSkillsText]);
  });
});
