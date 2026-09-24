import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { inferJobDraft, mapTitleToCategory, type CompanyHistoryJob } from "./job-draft-infer.ts";

const salesHistory: CompanyHistoryJob = {
  title: "Sales Executive",
  category: "Sales",
  industry: "Retail",
  job_type: "full_time",
  work_mode: "onsite",
  city: "Pune",
  pay_type: "fixed",
  min_salary: 15000,
  max_salary: 20000,
  avg_incentive_monthly: null,
  experience_bucket: "experienced",
  min_experience_years: 1,
  max_experience_years: 3,
  skills: ["CRM", "Pitching"],
  perks: ["PF"],
  shift: "day",
  working_days: 6,
  english_level: "good",
};

describe("mapTitleToCategory", () => {
  test("delivery title maps to Delivery", () => {
    assert.equal(mapTitleToCategory("Delivery Executive"), "Delivery");
  });
  test("healthcare industry maps to Nursing when title has no keyword", () => {
    assert.equal(mapTitleToCategory("Ward Assistant", "Healthcare"), "Nursing");
  });
  test("short alias with no shared substring still resolves (exact tier)", () => {
    assert.equal(mapTitleToCategory("BDE"), "Sales");
    assert.equal(mapTitleToCategory("Rider"), "Delivery");
  });
  test("alias family resolves before the loose keyword scan", () => {
    assert.equal(mapTitleToCategory("Front Desk Executive"), "Customer Support");
  });
  test("keyword substring still resolves for titles not in the alias table", () => {
    assert.equal(mapTitleToCategory("Senior Telecaller Team Lead"), "Telecaller");
  });
});

describe("inferJobDraft", () => {
  test("same-title history wins over later jobs and library", () => {
    const r = inferJobDraft({
      title: "Sales Executive",
      history: [salesHistory],
      dirty: new Set(),
    });
    assert.equal(r.patch.city, "Pune");
    assert.deepEqual(r.patch.skills, ["CRM", "Pitching"]);
    assert.equal(r.sources.city, "company_history");
    assert.equal(r.matchedHistoryTitle, "Sales Executive");
  });

  test("dirty city is omitted from the patch", () => {
    const r = inferJobDraft({
      title: "Sales Executive",
      history: [salesHistory],
      dirty: new Set(["city"]),
    });
    assert.equal(r.patch.city, undefined);
    assert.equal(r.patch.skills?.[0], "CRM");
  });

  test("unknown title still applies defaults", () => {
    const r = inferJobDraft({
      title: "Zzxqy 99",
      history: [],
      dirty: new Set(),
    });
    assert.equal(r.patch.job_type, "full_time");
    assert.equal(r.patch.work_mode, "onsite");
    assert.equal(r.patch.gender_pref, "any");
    assert.equal(r.patch.interview_type, "in_person");
    assert.equal(r.patch.joining_fee_required, false);
    assert.equal(r.patch.pay_type, "fixed");
    assert.deepEqual(r.patch.skills ?? [], []);
    assert.equal(r.libraryTitle, null);
    assert.equal(r.sources.job_type, "default");
  });

  test("library fills skills when history has none", () => {
    const r = inferJobDraft({
      title: "HR Recruiter",
      history: [],
      dirty: new Set(),
    });
    assert.ok((r.patch.skills?.length ?? 0) > 0);
    assert.equal(r.sources.skills, "jd_library");
    assert.equal(r.libraryTitle, "HR Recruiter");
  });
});
