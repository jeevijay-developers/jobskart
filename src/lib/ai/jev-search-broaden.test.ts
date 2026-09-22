import { describe, expect, test } from "bun:test";
import {
  applyBroaden,
  broadenLabel,
  fallbackNextDim,
  parseBroadenChoice,
  remainingBroadenDims,
  stepDownExperience,
  type SearchFilters,
} from "./jev-search-broaden";

const tight: SearchFilters = { query: "forklift", cities: ["Pune"], minExp: 5 };

describe("remainingBroadenDims", () => {
  test("lists only constrained filters", () => {
    expect(remainingBroadenDims(tight).sort()).toEqual(["experience", "location", "skills"]);
    expect(remainingBroadenDims({ query: "", cities: [], minExp: "" })).toEqual([]);
  });
});

describe("fallbackNextDim", () => {
  test("drops location before experience before skills", () => {
    expect(fallbackNextDim(["skills", "location", "experience"])).toBe("location");
    expect(fallbackNextDim(["skills", "experience"])).toBe("experience");
    expect(fallbackNextDim(["skills"])).toBe("skills");
    expect(fallbackNextDim([])).toBe(null);
  });
});

describe("applyBroaden", () => {
  test("clears query and cities, steps experience 5→3→1→0→any", () => {
    expect(applyBroaden(tight, "skills").query).toBe("");
    expect(applyBroaden(tight, "location").cities).toEqual([]);
    expect(stepDownExperience(5)).toBe(3);
    expect(stepDownExperience(3)).toBe(1);
    expect(stepDownExperience(1)).toBe(0);
    expect(stepDownExperience(0)).toBe("");
    expect(applyBroaden({ ...tight, minExp: 5 }, "experience").minExp).toBe(3);
  });
});

describe("broadenLabel", () => {
  test("names the relaxed dimension without claiming fake matches", () => {
    expect(broadenLabel("location", tight)).toContain("Pune");
    expect(broadenLabel("skills", tight)).toContain("forklift");
    expect(broadenLabel("experience", tight)).toContain("3+");
  });
});

describe("parseBroadenChoice", () => {
  test("accepts a remaining key and ignores unknown", () => {
    expect(parseBroadenChoice({ next: { type: "choice", choice: "skills" } }, ["skills", "location"])).toBe(
      "skills",
    );
    expect(parseBroadenChoice({ next: { type: "choice", choice: "skills" } }, ["location"])).toBe(null);
    expect(parseBroadenChoice({}, ["location"])).toBe(null);
  });
});
