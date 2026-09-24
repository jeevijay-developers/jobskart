import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { computeJobQuality, getMissingJobImprovements, jobQualityLabel, type JobQualityInput } from "./jobQuality.ts";

const empty: JobQualityInput = {};

const complete: JobQualityInput = {
  title: "Delivery Executive",
  category: "Logistics",
  industry: "E-commerce",
  city: "Pune",
  locality: "Hinjewadi",
  job_type: "full_time",
  work_mode: "onsite",
  openings: 3,
  pay_type: "fixed_incentive",
  min_salary: 15000,
  max_salary: 20000,
  avg_incentive_monthly: 3000,
  experience_bucket: "fresher",
  skills: ["Two-wheeler", "Navigation", "Customer handling"],
  education: "12th Pass",
  certifications: [],
  preferred_languages: ["Hindi"],
  description:
    "Deliver packages on time across the assigned zone using a two-wheeler, following the daily route plan shared each morning. The position offers ₹15,000 – ₹20,000/month + incentives up to ₹3,000/month, along with fuel allowance and health insurance. Great perks and a supportive team culture make this a rewarding role for anyone starting their career in logistics.",
  description_html: "<p>...</p>",
  perks: ["Health insurance", "Fuel allowance"],
  interview_type: "in_person",
  shift: "day",
  working_days: 6,
  pincode: "411057",
};

describe("computeJobQuality", () => {
  test("empty job scores 0", () => {
    assert.equal(computeJobQuality(empty), 0);
  });

  test("fully filled job scores 100", () => {
    assert.equal(computeJobQuality(complete), 100);
  });

  test("incentive_only pay counts as full compensation credit", () => {
    const score = computeJobQuality({ ...empty, pay_type: "incentive_only", avg_incentive_monthly: 8000 });
    assert.ok(score >= 15);
  });

  test("one-sided salary earns partial compensation credit, not full", () => {
    const half = computeJobQuality({ ...empty, pay_type: "fixed", min_salary: 15000 });
    const full = computeJobQuality({ ...empty, pay_type: "fixed", min_salary: 15000, max_salary: 20000 });
    assert.ok(half < full);
  });
});

describe("jobQualityLabel", () => {
  test("buckets match the rubric thresholds", () => {
    assert.equal(jobQualityLabel(85).label, "Excellent");
    assert.equal(jobQualityLabel(65).label, "Good");
    assert.equal(jobQualityLabel(45).label, "Fair");
    assert.equal(jobQualityLabel(10).label, "Needs work");
  });
});

describe("getMissingJobImprovements", () => {
  test("empty job reports every check, sorted by points descending", () => {
    const gaps = getMissingJobImprovements(empty);
    assert.ok(gaps.length > 0);
    for (let i = 1; i < gaps.length; i += 1) {
      assert.ok(gaps[i - 1].points >= gaps[i].points);
    }
    assert.ok(gaps.some((g) => g.key === "title"));
  });

  test("complete job reports no gaps", () => {
    assert.deepEqual(getMissingJobImprovements(complete), []);
  });

  test("gap steps point at the wizard step that fixes them", () => {
    const gaps = getMissingJobImprovements(empty);
    const title = gaps.find((g) => g.key === "title");
    const city = gaps.find((g) => g.key === "city");
    const skills = gaps.find((g) => g.key === "skills");
    const desc = gaps.find((g) => g.key === "description_length");
    assert.equal(title?.step, 0);
    assert.equal(city?.step, 1);
    assert.equal(skills?.step, 2);
    assert.equal(desc?.step, 3);
  });
});
