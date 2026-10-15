import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import {
  groupPermissions,
  hasPermission,
  isMemberCreditShortfall,
  mapTeamError,
  missingForGrant,
  creditSpendMessage,
  parseQuantity,
  toCsv,
  whatsappShareUrl,
  spendableBalance,
  type SummaryBenefit,
  type SummaryLike,
  permissionDiff,
  subtreeIds,
  type PermissionDef,
} from "./team-permissions.ts";

const def = (key: string, grp: string, sort_order: number): PermissionDef => ({
  key,
  grp,
  label: key,
  description: "",
  is_sensitive: false,
  sort_order,
});

describe("groupPermissions", () => {
  test("groups by section in sort order", () => {
    const groups = groupPermissions([
      def("b.2", "B", 30),
      def("a.1", "A", 10),
      def("a.2", "A", 20),
    ]);
    assert.deepEqual(
      groups.map((g) => g.group),
      ["A", "B"],
    );
    assert.deepEqual(
      groups[0].items.map((i) => i.key),
      ["a.1", "a.2"],
    );
  });
});

describe("hasPermission", () => {
  test("uses the loaded list when present", () => {
    assert.equal(hasPermission(["jobs.view"], "jobs.view", "recruiter"), true);
    assert.equal(hasPermission(["jobs.view"], "jobs.create", "super_admin"), false);
  });
  test("falls back to the legacy role map while loading", () => {
    assert.equal(hasPermission(null, "roles.manage", "super_admin"), true);
    assert.equal(hasPermission(null, "roles.manage", "hr_admin"), false);
    assert.equal(hasPermission(null, "credits.purchase", "recruiter"), true);
    assert.equal(hasPermission(null, "team.invite", "recruiter"), false);
    assert.equal(hasPermission(null, "team.invite", null), false);
  });
});

describe("missingForGrant / permissionDiff", () => {
  test("owners can grant anything, others only what they hold", () => {
    assert.deepEqual(missingForGrant([], ["a", "b"], true), []);
    assert.deepEqual(missingForGrant(["a"], ["a", "b"], false), ["b"]);
  });
  test("diff reports added and removed", () => {
    assert.deepEqual(permissionDiff(["a", "b"], ["b", "c"]), { added: ["c"], removed: ["a"] });
  });
});

describe("subtreeIds", () => {
  const members = [
    { user_id: "o", reports_to: null },
    { user_id: "m", reports_to: "o" },
    { user_id: "r1", reports_to: "m" },
    { user_id: "r2", reports_to: "r1" },
    { user_id: "x", reports_to: null },
  ];
  test("is transitive and excludes the root", () => {
    assert.deepEqual([...subtreeIds(members, "m")].sort(), ["r1", "r2"]);
    assert.equal(subtreeIds(members, "m").has("m"), false);
    assert.equal(subtreeIds(members, "x").size, 0);
  });
  test("terminates on corrupted cycles", () => {
    const cyc = [
      { user_id: "a", reports_to: "b" },
      { user_id: "b", reports_to: "a" },
    ];
    assert.deepEqual([...subtreeIds(cyc, "a")], ["b"]);
  });
});

describe("mapTeamError", () => {
  test("maps stable error codes inside Postgres messages", () => {
    assert.match(mapTeamError("P0001: member_balance_insufficient"), /allocated to you/);
    assert.match(mapTeamError("cannot_escalate"), /hold yourself/);
    assert.match(mapTeamError("plan_requires_upgrade"), /paid plans/);
  });
  test("passes unknown messages through and handles empty", () => {
    assert.equal(mapTeamError("boom"), "boom");
    assert.match(mapTeamError(""), /went wrong/);
  });
  test("detects the credit shortfall code", () => {
    assert.equal(isMemberCreditShortfall("xx member_balance_insufficient xx"), true);
    assert.equal(isMemberCreditShortfall("no_credits"), false);
  });
});

describe("creditSpendMessage", () => {
  test("keeps the legacy out-of-credits copy", () => {
    assert.equal(
      creditSpendMessage("no_credits", "unlock"),
      "Out of credits. Buy a pack to unlock.",
    );
    assert.equal(
      creditSpendMessage("no_credits", "invite"),
      "Out of credits. Buy a pack to invite.",
    );
  });
  test("explains per-member shortfalls and passes unknown errors through", () => {
    assert.match(creditSpendMessage("member_balance_insufficient", "unlock"), /Request more/);
    assert.match(creditSpendMessage("pool_insufficient", "unlock"), /pool/);
    assert.equal(creditSpendMessage("weird", "invite"), "weird");
  });
});

describe("parseQuantity", () => {
  test("accepts whole numbers in range only", () => {
    assert.equal(parseQuantity("12"), 12);
    assert.equal(parseQuantity(" 5 "), 5);
    assert.equal(parseQuantity("0"), null);
    assert.equal(parseQuantity("-3"), null);
    assert.equal(parseQuantity("1.5"), null);
    assert.equal(parseQuantity("abc"), null);
    assert.equal(parseQuantity("100001"), null);
  });
});

describe("spendableBalance", () => {
  const mk = (
    over: Partial<SummaryLike>,
    contact: SummaryBenefit = { wallet: 40, reserved: 10, pool: 30, mine: 4 },
  ): SummaryLike => ({
    mode: "pooled",
    can_pool_spend: false,
    benefits: {
      job_post: { wallet: 0, reserved: 0, pool: 0, mine: 0 },
      contact,
      boost: { wallet: 0, reserved: 0, pool: 0, mine: 0 },
    },
    ...over,
  });
  test("pooled mode spends the shared balance", () => {
    assert.equal(spendableBalance(mk({}), "contact"), 40);
    assert.equal(
      spendableBalance(mk({}, { wallet: null, reserved: null, pool: null, mine: 0 }), "contact"),
      0,
    );
  });
  test("allocated mode: members spend only their own reservation", () => {
    assert.equal(spendableBalance(mk({ mode: "allocated" }), "contact"), 4);
  });
  test("allocated mode: pool spenders add the pool to their own balance", () => {
    assert.equal(spendableBalance(mk({ mode: "allocated", can_pool_spend: true }), "contact"), 34);
  });
});

describe("toCsv", () => {
  test("quotes commas, quotes and newlines", () => {
    assert.equal(
      toCsv(
        ["a", "b"],
        [
          ["x,y", 'he said "hi"'],
          ["line\nbreak", 3],
        ],
      ),
      'a,b\r\n"x,y","he said ""hi"""\r\n"line\nbreak",3',
    );
  });
  test("neutralises spreadsheet formulas and handles empties", () => {
    assert.equal(
      toCsv(["n"], [["=SUM(A1)"], ["+1"], ["-2"], ["@cmd"], [null], [undefined]]),
      "n\r\n'=SUM(A1)\r\n'+1\r\n'-2\r\n'@cmd\r\n\r\n",
    );
  });
});

describe("whatsappShareUrl", () => {
  test("encodes the invite message and link", () => {
    const url = whatsappShareUrl("Acme & Co", "https://x.test/invite/abc");
    assert.ok(url.startsWith("https://wa.me/?text="));
    assert.ok(decodeURIComponent(url.split("text=")[1]).includes("Acme & Co"));
    assert.ok(decodeURIComponent(url.split("text=")[1]).includes("https://x.test/invite/abc"));
  });
});
