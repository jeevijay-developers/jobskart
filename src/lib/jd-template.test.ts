import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { buildJd, markdownToHtml, type JdInput } from "./jd-template.ts";

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

describe("buildJd canonical template", () => {
  test("opens with the template sentence including pay and growth", () => {
    const { markdown } = buildJd(base);
    const first = markdown.split("\n")[0];
    assert.match(first, /^We are looking for a Sales Executive to join Acme Retail\./);
    assert.match(first, /15,000/);
    assert.match(first, /incentives up to ₹5,000\/month and opportunities for growth\.$/);
  });

  test("sections follow the docx order", () => {
    const { markdown } = buildJd({ ...base, perks: ["PF", "Insurance"], joiningFeeRequired: true });
    const order = ["Key Responsibilities", "Job Requirements", "Perks", "Notes"].map((h) =>
      markdown.indexOf(`**${h}:**`),
    );
    assert.ok(order.every((i) => i >= 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  test("Perks and Notes are omitted when there is no data", () => {
    const { markdown, html } = buildJd(base);
    assert.doesNotMatch(markdown, /Perks|Notes/);
    assert.doesNotMatch(html, /Perks|Notes/);
  });

  test("remote work mode appears as a note, not in the opening", () => {
    const { markdown } = buildJd({ ...base, workMode: "remote" });
    assert.match(markdown, /- Work Mode: Remote/);
    assert.doesNotMatch(markdown.split("\n")[0], /Remote/);
  });
});

describe("markdownToHtml", () => {
  test("a lone **Heading:** line becomes an h4, like buildJd's html", () => {
    assert.equal(markdownToHtml("**Perks:**\nPF · Insurance"), "<h4>Perks</h4><p>PF · Insurance</p>");
  });
});
