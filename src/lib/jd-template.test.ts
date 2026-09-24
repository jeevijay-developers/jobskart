import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { buildJd, type JdInput } from "./jd-template.ts";

const base: JdInput = {
  title: "Sales Executive",
  companyName: "Acme Retail",
  payType: "fixed_incentive",
  minSalary: 15000,
  maxSalary: 20000,
  avgIncentive: 5000,
  experienceBucket: "any",
  skills: ["Lead Generation", "Cold Calling"],
};

describe("buildJd style presets", () => {
  test("default (no style) matches explicit standard", () => {
    const a = buildJd(base);
    const b = buildJd({ ...base, style: "standard" });
    assert.equal(a.markdown, b.markdown);
  });

  test("quick_read is shorter than standard for the same input", () => {
    const standard = buildJd({ ...base, style: "standard" });
    const quick = buildJd({ ...base, style: "quick_read" });
    assert.ok(quick.markdown.length < standard.markdown.length);
  });

  test("detailed includes a company-intro line standard does not", () => {
    const standard = buildJd({ ...base, style: "standard" });
    const detailed = buildJd({ ...base, style: "detailed" });
    assert.ok(detailed.markdown.includes("Acme Retail"));
    assert.ok(detailed.markdown.length >= standard.markdown.length);
  });

  test("every style still renders the salary and all responsibility bullets", () => {
    for (const style of ["standard", "quick_read", "detailed"] as const) {
      const { markdown } = buildJd({ ...base, style });
      assert.match(markdown, /15,000|15000/);
      assert.match(markdown, /Lead Generation|Cold Calling/i);
    }
  });
});
