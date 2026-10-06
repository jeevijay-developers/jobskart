import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { inferJobDraft, mapTitleToCategory, type CompanyHistoryJob } from "./job-draft-infer.ts";
import { suggestedSkillsFor } from "./jd-library.ts";

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
  working_weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
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
    // City is intentionally not inferred from history (removed in c0a273b),
    // so the same-title job only contributes the other fields.
    assert.equal(r.patch.city, undefined);
    assert.deepEqual(r.patch.skills, []); // skills are suggested in the UI, never pre-filled
    assert.equal(r.patch.min_salary, "15000");
    assert.equal(r.matchedHistoryTitle, "Sales Executive");
  });

  test("history infers the weekday pattern, not a bare day count", () => {
    const r = inferJobDraft({
      title: "Sales Executive",
      history: [salesHistory],
      dirty: new Set(),
    });
    assert.deepEqual(r.patch.working_weekdays, salesHistory.working_weekdays);
    assert.equal((r.patch as Record<string, unknown>).working_days, undefined);
  });

  test("dirty working_weekdays is omitted from the patch", () => {
    const r = inferJobDraft({
      title: "Sales Executive",
      history: [salesHistory],
      dirty: new Set(["working_weekdays"]),
    });
    assert.equal(r.patch.working_weekdays, undefined);
  });

  test("dirty city is omitted from the patch", () => {
    const r = inferJobDraft({
      title: "Sales Executive",
      history: [salesHistory],
      dirty: new Set(["city"]),
    });
    assert.equal(r.patch.city, undefined);
    assert.equal(r.patch.min_salary, "15000");
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

  test("skills start empty; the library role is matched for suggestions", () => {
    const r = inferJobDraft({
      title: "HR Manager",
      history: [],
      dirty: new Set(),
    });
    assert.deepEqual(r.patch.skills, []);
    assert.equal(r.libraryTitle, "HR Manager");
    assert.ok(suggestedSkillsFor("HR Manager").length > 0);
  });
});
