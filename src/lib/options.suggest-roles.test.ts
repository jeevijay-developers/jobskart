import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { suggestRelatedRoles } from "./options.ts";

describe("suggestRelatedRoles", () => {
  it("shows the starter list only when the candidate has told us nothing yet", () => {
    const out = suggestRelatedRoles([], "");
    assert.equal(out[0], "Sales Executive");
    assert.ok(out.includes("Telecaller"));
  });

  it("offers software roles, not blue-collar ones, for a developer", () => {
    const out = suggestRelatedRoles([], "developer");
    assert.ok(out.includes("Software Developer"));
    assert.ok(!out.includes("Telecaller"));
    assert.ok(!out.includes("Sales Executive"));
  });

  it("uses the headline / past job titles as seeds when no role is typed yet", () => {
    const out = suggestRelatedRoles([], "", ["Software Engineer"]);
    assert.ok(out.includes("QA Engineer"));
    assert.ok(!out.includes("Telecaller"));
  });

  it("recognises python as a software signal (was falling back to the starter list)", () => {
    const out = suggestRelatedRoles([], "Python Programming Trainee");
    assert.ok(out.includes("Python Developer"));
    assert.ok(!out.includes("Beautician"));
  });

  it("offers only the candidate's own role, not the blue-collar starter list, when it matches no keyword", () => {
    assert.deepEqual(suggestRelatedRoles([], "Astronaut"), ["Astronaut"]);
    assert.deepEqual(suggestRelatedRoles(["Astronaut"], ""), []);
  });

  it("never re-suggests a role that is already selected", () => {
    const out = suggestRelatedRoles(["Software Developer"], "developer");
    assert.ok(!out.includes("Software Developer"));
    assert.ok(out.includes("Backend Developer"));
  });

  it("still serves blue-collar roles for blue-collar seeds", () => {
    const out = suggestRelatedRoles([], "Truck Driver");
    assert.ok(out.includes("Heavy Vehicle Driver"));
  });
});
