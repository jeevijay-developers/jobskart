import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EMBED_CHARS,
  buildCandidateEmbeddingText,
  buildCandidateRoleEmbeddingText,
  buildCandidateSkillsEmbeddingText,
  buildJobEmbeddingText,
  buildJobRoleEmbeddingText,
  buildJobSkillsEmbeddingText,
  embeddingInputHash,
} from "./embedding-text.ts";

describe("buildCandidateEmbeddingText (characterizes today's output)", () => {
  it("joins every present field EXCEPT the candidate's name, in the existing order with '. '", () => {
    const text = buildCandidateEmbeddingText({
      headline: "Delivery Executive",
      lastRole: "Rider",
      yearsExperience: 3,
      skills: ["Two-wheeler", "Navigation"],
      city: "Pune",
      bio: "Reliable and punctual.",
    });
    assert.equal(
      text,
      "Delivery Executive. Most recent role: Rider. 3 years of experience. Skills: Two-wheeler, Navigation. Based in Pune. Reliable and punctual.",
    );
  });

  it("skips missing fields but keeps 0 years of experience", () => {
    const text = buildCandidateEmbeddingText({ yearsExperience: 0, skills: [], headline: null });
    assert.equal(text, "0 years of experience");
  });

  it("returns an empty string when nothing is present", () => {
    assert.equal(buildCandidateEmbeddingText({}), "");
  });
});

describe("buildJobEmbeddingText (characterizes today's output)", () => {
  it("joins title, category, skills, city and description", () => {
    const text = buildJobEmbeddingText({
      title: "Delivery Boy",
      category: "Delivery",
      skills: ["Bike", "Maps"],
      city: "Jaipur",
      description: "Deliver parcels daily.",
    });
    assert.equal(
      text,
      "Delivery Boy. Category: Delivery. Skills: Bike, Maps. Location: Jaipur. Deliver parcels daily.",
    );
  });
});

describe("length cap", () => {
  it("caps very long text at MAX_EMBED_CHARS and keeps the leading (title/skills) part", () => {
    const text = buildJobEmbeddingText({
      title: "Driver",
      description: "x".repeat(MAX_EMBED_CHARS * 3),
    });
    assert.equal(text.length, MAX_EMBED_CHARS);
    assert.ok(text.startsWith("Driver. "));
  });
});

describe("surrogate-pair safety of the length cap", () => {
  const hasLoneSurrogate = (s: string) =>
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

  it("never splits an astral character at the cap boundary", () => {
    const text = buildJobEmbeddingText({
      description: "x".repeat(MAX_EMBED_CHARS - 1) + "\u{1F600}" + "tail",
    });
    assert.ok(text.length <= MAX_EMBED_CHARS);
    assert.equal(hasLoneSurrogate(text), false);
  });

  it("keeps a whole astral character that fits exactly under the cap", () => {
    const text = buildJobEmbeddingText({
      description: "x".repeat(MAX_EMBED_CHARS - 2) + "\u{1F600}" + "tail",
    });
    assert.equal(text.length, MAX_EMBED_CHARS);
    assert.ok(text.endsWith("\u{1F600}"));
  });

  it("applies to candidate text too", () => {
    const text = buildCandidateEmbeddingText({
      bio: "x".repeat(MAX_EMBED_CHARS - 1) + "\u{1F600}",
    });
    assert.ok(text.length <= MAX_EMBED_CHARS);
    assert.equal(hasLoneSurrogate(text), false);
  });
});

describe("Devanagari text", () => {
  const headline = "ड्राइवर";
  const skill = "गाड़ी चलाना";

  it("passes through the builders unchanged", () => {
    assert.equal(
      buildCandidateEmbeddingText({ headline, skills: [skill] }),
      `${headline}. Skills: ${skill}`,
    );
    assert.equal(
      buildJobEmbeddingText({ title: headline, skills: [skill] }),
      `${headline}. Skills: ${skill}`,
    );
  });

  it("hashes identical Hindi inputs identically and differs by a single combining mark", async () => {
    const a = await embeddingInputHash("m", "गाड़ी");
    const b = await embeddingInputHash("m", "गाड़ी");
    const c = await embeddingInputHash("m", "गाड़ी".replace("़", "")); // nukta removed
    assert.notEqual("गाड़ी", "गाड़ी".replace("़", ""));
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe("whitespace-only fields (documents current behavior)", () => {
  it("a whitespace-only headline is truthy and is included untrimmed", () => {
    assert.equal(
      buildCandidateEmbeddingText({ headline: "   ", city: "Pune" }),
      "   . Based in Pune",
    );
  });

  it("a whitespace-only description is included untrimmed", () => {
    assert.equal(buildJobEmbeddingText({ title: "Driver", description: "  " }), "Driver.   ");
  });
});

describe("embeddingInputHash", () => {
  it("is a 64-char lowercase hex string and is deterministic", async () => {
    const a = await embeddingInputHash("gemini-embedding-001/1536", "hello");
    const b = await embeddingInputHash("gemini-embedding-001/1536", "hello");
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, b);
  });

  it("changes when the text changes", async () => {
    const a = await embeddingInputHash("m", "hello");
    const b = await embeddingInputHash("m", "hello!");
    assert.notEqual(a, b);
  });

  it("changes when the model changes (so a provider switch invalidates every hash)", async () => {
    const a = await embeddingInputHash("gemini-embedding-001/1536", "hello");
    const b = await embeddingInputHash("openai/text-embedding-3-small", "hello");
    assert.notEqual(a, b);
  });
});

describe("buildCandidateSkillsEmbeddingText", () => {
  it("joins skills as a comma list", () => {
    assert.equal(
      buildCandidateSkillsEmbeddingText(["Two-wheeler", "Navigation", "Customer handling"]),
      "Two-wheeler, Navigation, Customer handling",
    );
  });
  it("returns empty string for no skills", () => {
    assert.equal(buildCandidateSkillsEmbeddingText([]), "");
    assert.equal(buildCandidateSkillsEmbeddingText(null), "");
    assert.equal(buildCandidateSkillsEmbeddingText(undefined), "");
  });
});

describe("buildCandidateRoleEmbeddingText", () => {
  it("joins headline, last role, and interested roles", () => {
    assert.equal(
      buildCandidateRoleEmbeddingText({
        headline: "Delivery Executive",
        lastRole: "Rider",
        interestedRoles: ["Driver", "Warehouse"],
      }),
      "Delivery Executive. Most recent role: Rider. Interested in: Driver, Warehouse.",
    );
  });
  it("omits missing parts", () => {
    assert.equal(buildCandidateRoleEmbeddingText({ headline: "Rider" }), "Rider.");
  });
  it("returns empty string when nothing is present", () => {
    assert.equal(buildCandidateRoleEmbeddingText({}), "");
  });
});

describe("buildJobSkillsEmbeddingText", () => {
  it("joins job skills as a comma list", () => {
    assert.equal(buildJobSkillsEmbeddingText(["Bike", "Maps"]), "Bike, Maps");
  });
  it("returns empty string for no skills", () => {
    assert.equal(buildJobSkillsEmbeddingText([]), "");
  });
});

describe("buildJobRoleEmbeddingText", () => {
  it("joins title and category", () => {
    assert.equal(
      buildJobRoleEmbeddingText({ title: "Delivery Boy", category: "Delivery" }),
      "Delivery Boy. Category: Delivery.",
    );
  });
  it("omits missing category", () => {
    assert.equal(buildJobRoleEmbeddingText({ title: "Delivery Boy" }), "Delivery Boy.");
  });
});
