import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { getRoleBenchmarks } from "./salary-benchmarks.ts";

describe("getRoleBenchmarks", () => {
  test("tier-1 city pays more than tier-3 for the same role", () => {
    const mumbai = getRoleBenchmarks("Sales Executive", "Sales", "Mumbai");
    const other = getRoleBenchmarks("Sales Executive", "Sales", "Siliguri");
    assert.ok(mumbai.minSalary > other.minSalary);
    assert.ok(mumbai.maxSalary > other.maxSalary);
  });

  test("delivery role defaults to fresher bucket", () => {
    const r = getRoleBenchmarks("Delivery Executive", "Delivery", "Pune");
    assert.equal(r.experienceBucket, "fresher");
    assert.equal(r.minExp, 0);
  });

  test("unknown city falls back to tier-2 baseline, still returns a valid range", () => {
    const r = getRoleBenchmarks("Security Guard", "Security");
    assert.ok(r.maxSalary >= r.minSalary);
    assert.ok(r.minSalary > 0);
  });

  test("unknown category falls back to a generic benchmark", () => {
    const r = getRoleBenchmarks("Something Unusual", "Other", "Mumbai");
    assert.ok(r.minSalary > 0 && r.maxSalary >= r.minSalary);
  });
});
