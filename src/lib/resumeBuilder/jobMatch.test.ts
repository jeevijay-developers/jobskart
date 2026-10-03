import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { computeJobMatch, type MatchJob } from "./jobMatch.ts";
import { extractSkills } from "./jdKeywords.ts";
import type { ResumeSchema } from "./schema.ts";

const resumeWith = (
  text: string,
  opts: { targetJobRole?: string; summaryTitle?: string; skillsList?: string[] } = {},
): ResumeSchema =>
  ({
    targetJobRole: opts.targetJobRole ?? "",
    sections: [
      {
        id: "summary",
        type: "summary",
        title: opts.summaryTitle ?? "Summary",
        content: { kind: "text", value: text },
      },
      ...(opts.skillsList
        ? [
            {
              id: "skills",
              type: "skills",
              title: "Skills",
              content: { kind: "list", items: opts.skillsList },
            },
          ]
        : []),
    ],
  }) as unknown as ResumeSchema;

const job = (
  skills: string[],
  preferred: string[] = [],
  extra: Partial<MatchJob> = {},
): MatchJob => ({
  id: "1",
  title: "Engineer",
  skills,
  preferred_skills: preferred,
  certifications: [],
  ...extra,
});

describe("required vs nice-to-have scoring", () => {
  test("required skills count double and nice-to-have count once", () => {
    // required A,B  preferred C. Resume has A and C -> (2*1 + 1) / (2*2 + 1) = 3/5.
    const r = computeJobMatch(
      resumeWith("I know alpha and gamma."),
      job(["alpha", "beta"], ["gamma"]),
    );
    assert.equal(r.score, 60);
  });

  test("a job with no nice-to-have skills scores exactly as before", () => {
    const r = computeJobMatch(resumeWith("I know alpha."), job(["alpha", "beta"]));
    assert.equal(r.score, 50);
  });

  test("a missing nice-to-have skill costs less than a missing required one", () => {
    const missingRequired = computeJobMatch(
      resumeWith("alpha gamma"),
      job(["alpha", "beta"], ["gamma"]),
    );
    const missingPreferred = computeJobMatch(
      resumeWith("alpha beta"),
      job(["alpha", "beta"], ["gamma"]),
    );
    assert.ok(missingPreferred.score > missingRequired.score);
  });

  test("matched and missing skills are labelled required or preferred", () => {
    const r = computeJobMatch(
      resumeWith("alpha gamma"),
      job(["alpha", "beta"], ["gamma", "delta"]),
    );
    const kinds = (list: { skill: string; kind: string }[]) =>
      Object.fromEntries(list.map((s) => [s.skill, s.kind]));
    assert.deepEqual(kinds(r.matched), { alpha: "required", gamma: "preferred" });
    assert.deepEqual(kinds(r.missing), { beta: "required", delta: "preferred" });
  });

  test("a skill listed as both required and nice-to-have counts once, as required", () => {
    const r = computeJobMatch(resumeWith("alpha"), job(["alpha"], ["alpha"]));
    assert.equal(r.matched.length, 1);
    assert.equal(r.matched[0].kind, "required");
    assert.equal(r.score, 100);
  });

  test("a job with only nice-to-have skills is scored on those", () => {
    const r = computeJobMatch(resumeWith("gamma"), job([], ["gamma", "delta"]));
    assert.equal(r.score, 50);
  });

  test("a missing nice-to-have skill still gets a wording suggestion", () => {
    const r = computeJobMatch(resumeWith("nothing"), job([], ["Kubernetes"]));
    assert.match(r.missing[0].suggestion, /^Used Kubernetes to/);
  });

  test("nice-to-have skills match through synonyms too", () => {
    const r = computeJobMatch(resumeWith("Deployed to k8s."), job(["alpha"], ["Kubernetes"]));
    const k = r.matched.find((m) => m.skill === "Kubernetes");
    assert.equal(k?.via, "k8s");
    assert.equal(k?.kind, "preferred");
  });

  test("a job row without the preferred_skills column still works", () => {
    const legacy = { id: "1", title: "Engineer", skills: ["alpha"], certifications: [] };
    assert.equal(computeJobMatch(resumeWith("alpha"), legacy).score, 100);
  });
});

describe("skill matching", () => {
  test("scores matched skills over total", () => {
    const r = computeJobMatch(
      resumeWith("Built APIs in TypeScript. Ran PostgreSQL.", { skillsList: ["Docker"] }),
      job(["TypeScript", "Java", "PostgreSQL", "Kubernetes"], [], {
        certifications: ["AWS Certified Developer"],
      }),
    );
    assert.equal(r.score, 40);
  });

  test("reports which sections a skill was found in", () => {
    const r = computeJobMatch(
      resumeWith("Built APIs in TypeScript.", { skillsList: ["TypeScript"] }),
      job(["TypeScript"]),
    );
    assert.deepEqual(r.matched[0].sections, ["Summary", "Skills"]);
  });

  test("java does not match javascript", () => {
    const r = computeJobMatch(resumeWith("Wrote Javascript."), job(["Java"]));
    assert.equal(r.missing.length, 1);
  });

  test("machine learning matches ML in both directions and reports the alias", () => {
    const a = computeJobMatch(resumeWith("Applied machine learning."), job(["ML"]));
    assert.equal(a.matched[0].via, "machine learning");
    const b = computeJobMatch(resumeWith("Built ML pipelines."), job(["Machine Learning"]));
    assert.equal(b.matched[0].via, "ml");
  });

  test("no alias is reported when the skill's own name is present", () => {
    const r = computeJobMatch(
      resumeWith("Used ML and machine learning."),
      job(["Machine learning"]),
    );
    assert.equal(r.matched[0].via, null);
  });

  test("a bare 'node' word does not count as Node.js", () => {
    const r = computeJobMatch(resumeWith("the node of a graph"), job(["Node.js"]));
    assert.equal(r.matched.length, 0);
  });

  test("missing certifications get a completion suggestion", () => {
    const r = computeJobMatch(
      resumeWith("nothing"),
      job([], [], { certifications: ["AWS Certified Developer"] }),
    );
    assert.match(r.missing[0].suggestion, /^Completed AWS Certified Developer/);
  });
});

describe("job title hint", () => {
  const titled = job(["TypeScript"], [], { title: "Backend Engineer" });

  test("title in the summary counts as headline", () => {
    assert.equal(
      computeJobMatch(resumeWith("Backend engineer building APIs."), titled).titleInHeadline,
      true,
    );
  });

  test("title in the target role counts as headline", () => {
    assert.equal(
      computeJobMatch(resumeWith("Built services.", { targetJobRole: "Backend Engineer" }), titled)
        .titleInHeadline,
      true,
    );
  });

  test("renaming the summary section still counts as headline", () => {
    const r = computeJobMatch(
      resumeWith("Backend engineer.", { summaryTitle: "Profile Overview" }),
      titled,
    );
    assert.equal(r.titleInHeadline, true);
  });

  test("engineer does not match inside engineering", () => {
    const r = computeJobMatch(resumeWith("Built a backend engineering team."), titled);
    assert.equal(r.titleInHeadline, false);
  });

  test("the headline hint never changes the skill score", () => {
    const without = computeJobMatch(resumeWith("TypeScript."), titled);
    const withTitle = computeJobMatch(
      resumeWith("TypeScript.", { targetJobRole: "Backend Engineer" }),
      titled,
    );
    assert.equal(without.score, withTitle.score);
  });
});

describe("extracting skills from a pasted job description", () => {
  test("finds tech skills and resolves aliases", () => {
    const found = extractSkills(
      "Need TypeScript and Node.js. Docker, Kubernetes (k8s) and ML are a plus.",
    );
    for (const s of ["TypeScript", "Node.js", "Docker", "Kubernetes", "Machine Learning"]) {
      assert.ok(found.includes(s), `expected ${s}`);
    }
  });

  test("finds trade skills", () => {
    const found = extractSkills(
      "Delivery driver. Two-Wheeler Driving, cash handling, packing and forklift.",
    );
    for (const s of ["Two-Wheeler Driving", "Cash Handling", "Packing", "Forklift"]) {
      assert.ok(found.includes(s), `expected ${s}`);
    }
  });

  test("does not invent Java from JavaScript", () => {
    assert.ok(!extractSkills("We use JavaScript.").includes("Java"));
  });

  test("empty text yields nothing, and results have no duplicates", () => {
    assert.deepEqual(extractSkills(""), []);
    const found = extractSkills("Docker docker DOCKER");
    assert.equal(new Set(found).size, found.length);
  });
});
