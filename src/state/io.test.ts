import { describe, expect, it } from "vitest";
import v3Nasty from "../../fixtures/migration/v3-nasty.json";
import v4Expected from "../../fixtures/migration/v4-expected.json";
import v3OutOfRange from "../../fixtures/migration/v3-out-of-range.json";
import v3MalformedRows from "../../fixtures/migration/v3-malformed-rows.json";
import v3MalformedAssignments from "../../fixtures/migration/v3-malformed-assignments.json";
import {
  NODE_IDS,
  UNCATEGORIZED_CATEGORY_ID,
  centsFromDollars,
  emptyNodeState,
  makeInitialState,
} from "./schema";
import { exportJson, importJson, migrate } from "./io";
import { accountBalance, bookIntegrity, snapshot } from "../budget/ledger";
import { deriveStatus } from "../graph/derive";

const NOW = new Date(2026, 5, 10); // 2026-06-10 local

/**
 * Pre-v4 documents are DOLLARS; the live schema is integer CENTS. Every v1/v2
 * fixture below is therefore written in dollars, and every v4 golden is the
 * number the v1 -> v2 migration always produced, times 100.
 */
function m(value: number): { value: number; source: "manual" } {
  return { value, source: "manual" };
}

/** A version-1 document (no `budget`), as written by pre-v2 builds. */
function makeV1(): any {
  const v1 = JSON.parse(JSON.stringify(makeInitialState()));
  delete v1.budget;
  v1.version = 1;
  // v1 settings are dollars, not the cents `makeInitialState` now emits.
  v1.settings = { iraAnnualLimit: 7000, hsaSelfLimit: 4300, hsaFamilyLimit: 8550 };
  return v1;
}

function makeRichV1(): any {
  const v1 = makeV1();
  v1.settings.monthlyExpenses = 4000;
  v1.nodes.Start.completed = true;
  v1.nodes.Rent.notes = "due on the 1st";
  v1.nodes.Rent.monthlyChecks = { "2026-05": true };
  v1.nodes.Rent.data = {
    target: m(1800),
    funded: m(1800),
    items: [{ id: "r1", name: "Apartment", target: m(1800), funded: m(1800) }],
  };
  v1.nodes.Food.data = { target: m(600), funded: m(450) };
  v1.nodes.BigEF.data = {
    targetMonths: 6,
    balance: m(0),
    items: [
      { id: "b1", name: "Medical", target: 3000, balance: m(1200) },
      { id: "b2", name: "Car", target: 2000, balance: m(800) },
    ],
  };
  v1.nodes.SmallEF.data = { balance: m(1000) };
  v1.nodes.SavePurchase.data = {
    goalName: "House",
    target: 20000,
    saved: m(5000),
    items: [{ id: "p1", name: "House", target: 20000, saved: m(5000), byDate: "2027-01-01" }],
  };
  v1.nodes.Goals.data = {
    items: [{ id: "gl1", name: "Vacation", target: 3000, saved: 500, horizonYears: 2 }],
  };
  v1.nodes.HighDebt.data = {
    debts: [{ id: "d1", name: "Visa", balance: 4200, apr: 24.99, minPayment: 50, paid: false }],
  };
  v1.nodes.IRA.data = { type: "roth", ytdContribution: m(2500), annualLimit: 7000 };
  v1.nodes.College.data = { monthlyContribution: 100, balance: m(2500) };
  return v1;
}

/** A version-2 document: budget present, payloads still wide. */
function makeV2(budget: any = null): any {
  const v2 = makeV1();
  v2.version = 2;
  v2.budget = budget ?? {
    accounts: [],
    transactions: [],
    groups: [],
    categories: [],
    assignments: {},
  };
  return v2;
}

describe("migrate", () => {
  it("passes a version-4 document through", () => {
    const s = makeInitialState();
    expect(migrate(s)).toEqual(s);
  });

  it("throws on a newer version instead of silently resetting", () => {
    const s = { ...makeInitialState(), version: 5 };
    expect(() => migrate(s)).toThrow(/version/i);
  });

  it("throws on non-object input", () => {
    expect(() => migrate("nope")).toThrow();
    expect(() => migrate(null)).toThrow();
  });

  // F10: a current-version tag alone must not be enough to reach the cast —
  // see wave1-review.md cases A and B, reproduced directly against migrate().
  // v3 and v4 are structurally identical (only the units differ), so the same
  // shallow validation guards both.
  describe("structural validation of a claimed v4 document (F10)", () => {
    it("case A: rejects a bare {version:4} with nothing else", () => {
      expect(() => migrate({ version: 4 })).toThrow(/settings|budget/i);
    });

    it("case A': rejects a bare {version:3} before it is walked", () => {
      expect(() => migrate({ version: 3 })).toThrow(/settings|budget/i);
    });

    it("case B: rejects a v4 document missing budget.assignments", () => {
      const s = makeInitialState() as any;
      delete s.budget.assignments;
      expect(() => migrate(s)).toThrow(/assignments/i);
    });

    it("rejects a v4 document whose budget.transactions isn't an array", () => {
      const s = makeInitialState() as any;
      s.budget.transactions = "not-an-array";
      expect(() => migrate(s)).toThrow(/transactions/i);
    });

    it("rejects a v4 document missing settings/decisions/nodes", () => {
      const base = makeInitialState() as any;
      const noSettings = { ...base };
      delete noSettings.settings;
      expect(() => migrate(noSettings)).toThrow(/settings/i);

      const noDecisions = { ...base };
      delete noDecisions.decisions;
      expect(() => migrate(noDecisions)).toThrow(/decisions/i);

      const noNodes = { ...base };
      delete noNodes.nodes;
      expect(() => migrate(noNodes)).toThrow(/nodes/i);
    });

    it("still lets a well-formed v4 document through unmodified", () => {
      const s = makeInitialState();
      expect(migrate(s)).toEqual(s);
    });
  });
});

describe("v1 -> v4 chain", () => {
  it("books match the old v1->v2 goldens (times 100) and payloads are stripped", () => {
    const out = migrate(makeRichV1(), NOW);
    expect(out.version).toBe(4);

    // Ledger goldens (same numbers the v1->v2 migration always produced).
    expect(out.budget.categories.map((c) => c.id)).toEqual([
      "Rent:r1",
      "Food",
      "BigEF:b1",
      "BigEF:b2",
      "SavePurchase:p1",
      "Goals:gl1",
    ]);
    expect(out.budget.assignments).toEqual({
      "2026-06": {
        "Rent:r1": 180_000,
        Food: 45_000,
        "BigEF:b1": 120_000,
        "BigEF:b2": 80_000,
        "SavePurchase:p1": 500_000,
        "Goals:gl1": 50_000,
      },
    });
    const inflow = out.budget.transactions.find((t) => t.categoryId === "rta");
    expect(inflow).toMatchObject({ accountId: "acct:cash", amount: 975_000 });
    const june = snapshot(out.budget, "2026-06");
    expect(june.readyToAssign).toBe(0);
    expect(june.categories["BigEF:b1"].available).toBe(120_000);

    // v3 additions: account backlinks and horizon -> target date. APR is a
    // rate, not money (D8) — it must NOT be scaled.
    const debt = out.budget.accounts.find((a) => a.id === "debt:d1");
    expect(debt).toMatchObject({ nodeId: "HighDebt", apr: 24.99, minPayment: 5_000 });
    expect(accountBalance(out.budget, "debt:d1")).toBe(-420_000);
    expect(out.budget.accounts.find((a) => a.id === "acct:college")?.nodeId).toBe("College");
    expect(out.budget.categories.find((c) => c.id === "Goals:gl1")?.targetDate).toBe("2028-06-10");

    // Payloads: ledger-owned ones gone, node-only ones kept or slimmed.
    expect(out.nodes.Rent.data).toBeUndefined();
    expect(out.nodes.SmallEF.data).toBeUndefined();
    expect(out.nodes.SavePurchase.data).toBeUndefined();
    expect(out.nodes.Goals.data).toBeUndefined();
    expect(out.nodes.HighDebt.data).toBeUndefined();
    expect(out.nodes.BigEF.data).toEqual({ targetMonths: 6 });
    expect(out.nodes.College.data).toEqual({ monthlyContribution: 10_000 });
    expect(out.nodes.IRA.data).toEqual({
      type: "roth",
      ytdContribution: m(250_000),
      annualLimit: 700_000,
    });

    // Non-financial node state is preserved.
    expect(out.nodes.Start.completed).toBe(true);
    expect(out.nodes.Rent.notes).toBe("due on the 1st");
    expect(out.nodes.Rent.monthlyChecks).toEqual({ "2026-05": true });
    expect(out.decisions).toEqual(makeRichV1().decisions);

    // The whole point: the book balances to the cent, with nothing left
    // outside the envelope system.
    const integrity = bookIntegrity(out.budget, "2026-06");
    expect(integrity.drift).toBe(0);
    expect(integrity.unbudgetedSpending).toBe(0);
  });

  // Bug 1: supersession ("SmallEF grows into BigEF; one real-world fund") is a
  // DOMAIN rule, so it has to survive the v2 leg of the chain too. Before the
  // fix, migrateV1 seeded only BigEF's bucket but left both payloads intact,
  // and migrateV2's unionExists branch then resurrected SmallEF's bucket with
  // a SECOND starting inflow — $2,200 of cash for a $1,200 fund.
  it("supersedes SmallEF even when BOTH emergency-fund nodes carry items", () => {
    const v1 = makeV1();
    v1.settings.monthlyExpenses = 4000;
    v1.nodes.BigEF.data = {
      targetMonths: 6,
      balance: m(0),
      items: [{ id: "b1", name: "Medical", target: 3000, balance: m(1200) }],
    };
    v1.nodes.SmallEF.data = {
      balance: m(1000),
      items: [{ id: "s1", name: "Starter", target: 1000, balance: m(1000) }],
    };

    const out = migrate(v1, NOW);
    expect(out.budget.categories.map((c) => c.id)).toEqual(["BigEF:b1"]);
    expect(out.budget.assignments).toEqual({ "2026-06": { "BigEF:b1": 120_000 } });

    const inflows = out.budget.transactions.filter((t) => t.categoryId === "rta");
    expect(inflows).toHaveLength(1);
    expect(inflows[0]).toMatchObject({ accountId: "acct:cash", amount: 120_000 });
    expect(accountBalance(out.budget, "acct:cash")).toBe(120_000);

    const june = snapshot(out.budget, "2026-06");
    expect(june.readyToAssign).toBe(0);
    expect(june.categories["BigEF:b1"].available).toBe(120_000);
    expect(bookIntegrity(out.budget, "2026-06").drift).toBe(0);
  });
});

describe("v2 -> v3 reconcile", () => {
  it("ledger wins where payload and book describe the same envelope", () => {
    const v2 = makeV2({
      accounts: [{ id: "acct:cash", name: "Cash", kind: "cash", source: "manual" }],
      transactions: [
        {
          id: "txn:start:acct:cash",
          accountId: "acct:cash",
          date: "2026-06-01",
          payee: "Starting balance",
          amount: 500,
          categoryId: "rta",
          source: "manual",
        },
      ],
      groups: [{ id: "g:bills", name: "Bills", order: 0 }],
      categories: [
        { id: "Rent:r1", groupId: "g:bills", name: "Apartment", order: 0, monthlyTarget: 1900, nodeId: "Rent" },
      ],
      assignments: { "2026-06": { "Rent:r1": 500 } },
    });
    // Payload diverged after the budget UI edited the ledger.
    v2.nodes.Rent.data = {
      target: m(1800),
      funded: m(450),
      items: [{ id: "r1", name: "Apartment", target: m(1800), funded: m(450) }],
    };

    const out = migrate(v2, NOW);
    const cat = out.budget.categories.find((c) => c.id === "Rent:r1");
    expect(cat?.monthlyTarget).toBe(190_000);
    expect(out.budget.assignments["2026-06"]).toEqual({ "Rent:r1": 50_000 });
    expect(out.budget.transactions).toHaveLength(1);
    expect(out.budget.categories).toHaveLength(1);
    expect(out.nodes.Rent.data).toBeUndefined();
  });

  it("creates payload-only items without moving Ready-to-Assign", () => {
    const v2 = makeV2();
    v2.nodes.Food.data = { target: m(600), funded: m(450) };

    const out = migrate(v2, NOW);
    expect(out.budget.categories.map((c) => c.id)).toEqual(["Food"]);
    expect(out.budget.assignments["2026-06"]).toEqual({ Food: 45_000 });
    const june = snapshot(out.budget, "2026-06");
    expect(june.readyToAssign).toBe(0);
    expect(june.categories.Food.available).toBe(45_000);
  });

  it("is idempotent: migrating the migrated document changes nothing", () => {
    const out = migrate(makeRichV1(), NOW);
    expect(migrate(JSON.parse(JSON.stringify(out)), NOW)).toEqual(out);
  });

  it("honors an explicit paid flag the ledger couldn't represent", () => {
    const v2 = makeV2({
      accounts: [
        { id: "debt:d1", name: "Visa", kind: "loan", apr: 24.99, minPayment: 50, source: "manual" },
      ],
      transactions: [
        {
          id: "txn:start:debt:d1",
          accountId: "debt:d1",
          date: "2026-01-05",
          payee: "Starting balance",
          amount: -4200,
          source: "manual",
        },
      ],
      groups: [],
      categories: [],
      assignments: {},
    });
    v2.nodes.HighDebt.data = {
      debts: [{ id: "d1", name: "Visa", balance: 4200, apr: 24.99, minPayment: 50, paid: true }],
    };

    const out = migrate(v2, NOW);
    expect(out.budget.accounts.find((a) => a.id === "debt:d1")?.nodeId).toBe("HighDebt");
    const adjust = out.budget.transactions.find((t) => t.id === "txn:adjust:v3:debt:d1");
    expect(adjust).toMatchObject({ amount: 420_000, memo: "Marked paid" });
    expect(accountBalance(out.budget, "debt:d1")).toBe(0);
  });

  it("never resurrects the EF scalar mirror once the union is ledger-managed", () => {
    const v2 = makeV2({
      accounts: [],
      transactions: [],
      groups: [{ id: "g:ef", name: "Emergency Fund", order: 0 }],
      categories: [
        { id: "BigEF:b1", groupId: "g:ef", name: "Medical", order: 0, balanceTarget: 3000, nodeId: "BigEF" },
      ],
      assignments: {},
    });
    // Stale scalar mirror left over from normalized() days.
    v2.nodes.BigEF.data = { targetMonths: 6, balance: m(9999) };
    v2.nodes.SmallEF.data = { balance: m(1000) };

    const out = migrate(v2, NOW);
    expect(out.budget.categories.map((c) => c.id)).toEqual(["BigEF:b1"]);
    expect(out.nodes.BigEF.data).toEqual({ targetMonths: 6 });
  });

  it("drops categoryMap", () => {
    const v2 = makeV2();
    v2.categoryMap = { Rent: "some-ynab-id" };
    const out = migrate(v2, NOW);
    expect("categoryMap" in out).toBe(false);
  });
});

describe("export/import", () => {
  it("is identity for a version-4 state", () => {
    const s = makeInitialState();
    s.nodes.Start.completed = true;
    s.budget.accounts.push({ id: "a1", name: "Checking", kind: "checking", source: "manual" });
    s.budget.assignments["2026-06"] = { groceries: 1234 };
    expect(importJson(exportJson(s))).toEqual(s);
  });

  it("migrates a v1 export on import", () => {
    const imported = importJson(JSON.stringify(makeRichV1()));
    expect(imported.version).toBe(4);
    expect(imported.budget.categories.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// v3 -> v4: integer cents on the wire.

/** A structurally minimal v3 document (DOLLARS) with one on-budget account. */
function makeV3(budget: Partial<any> = {}): any {
  return {
    version: 3,
    settings: { iraAnnualLimit: 7000, hsaSelfLimit: 4300, hsaFamilyLimit: 8550 },
    decisions: {},
    nodes: {},
    budget: {
      accounts: [{ id: "checking", name: "Checking", kind: "checking", source: "manual" }],
      transactions: [],
      groups: [],
      categories: [],
      assignments: {},
      ...budget,
    },
  };
}

describe("v3 -> v4: integer cents on the wire", () => {
  it("applies the §4 rule: floor(d * 100 + 0.5) in IEEE-754 double", () => {
    // Each of these is a case the two platforms have to agree on exactly.
    const cases: [number, number][] = [
      [0.1, 10],
      [0.2, 20],
      [33.333, 3333],
      // The nearest double to 33.335 sits fractionally ABOVE the decimal value,
      // so d * 100 lands on exactly 3333.5 and the half rounds up.
      [33.335, 3334],
      // Exactly-representable halves, positive and negative: the rule takes
      // both toward +infinity, so -0.125 is -12 and NOT -13.
      [0.125, 13],
      [-0.125, -12],
      [-12.345, -1234],
      [-1234.5, -123_450],
      [1234567.89, 123_456_789],
      [0.004, 0],
      [-0.004, 0],
      [0, 0],
    ];
    for (const [dollars, cents] of cases) {
      const out = migrate(
        makeV3({
          transactions: [
            { id: "t", accountId: "checking", date: "2026-06-01", amount: dollars, source: "manual", categoryId: "x" },
          ],
        }),
      );
      expect(out.budget.transactions[0].amount, String(dollars)).toBe(cents);
    }
  });

  it("converts every money field and leaves rates, counts and ages alone", () => {
    const v3 = makeV3({
      accounts: [
        { id: "debt", name: "Visa", kind: "loan", apr: 24.99, minPayment: 50.005, source: "manual" },
      ],
      transactions: [{ id: "t1", accountId: "debt", date: "2026-06-01", amount: 12.34, source: "manual" }],
      categories: [
        { id: "food", groupId: "g", name: "Food", order: 0, monthlyTarget: 33.333, balanceTarget: 0 },
      ],
      assignments: { "2026-06": { food: 1800.005 } },
    });
    v3.settings = {
      monthlyExpenses: 4000,
      preTaxIncome: 120000,
      iraAnnualLimit: 7000,
      hsaSelfLimit: 4300,
      hsaFamilyLimit: 8550,
    };
    v3.nodes = {
      College: { completed: false, notes: "", data: { monthlyContribution: 100.005, targetAge: 18 } },
      Match: { completed: false, notes: "", data: { matchPct: 4.5, currentContribPct: 3.25 } },
      Increase401k: { completed: false, notes: "", data: { currentPct: 6.5, targetPct: 15 } },
      BigEF: { completed: false, notes: "", data: { targetMonths: 6 } },
      IRA: {
        completed: false,
        notes: "",
        data: { type: "roth", ytdContribution: m(2500.555), annualLimit: 7000 },
      },
    };

    const out = migrate(v3);

    // Money.
    expect(out.budget.transactions[0].amount).toBe(1234);
    expect(out.budget.categories[0].monthlyTarget).toBe(3333);
    expect(out.budget.categories[0].balanceTarget).toBe(0);
    expect(out.budget.assignments["2026-06"].food).toBe(180_001);
    expect(out.budget.accounts[0].minPayment).toBe(5001);
    expect(out.settings).toEqual({
      monthlyExpenses: 400_000,
      preTaxIncome: 12_000_000,
      iraAnnualLimit: 700_000,
      hsaSelfLimit: 430_000,
      hsaFamilyLimit: 855_000,
    });
    expect(out.nodes.College.data).toEqual({ monthlyContribution: 10_001, targetAge: 18 });
    expect(out.nodes.IRA.data).toEqual({
      type: "roth",
      ytdContribution: m(250_055),   // 2500.555 * 100 = 250055.4999… in double
      annualLimit: 700_000,
    });

    // NOT money: rates, percentages, counts, ages ride through untouched.
    expect(out.budget.accounts[0].apr).toBe(24.99);
    expect(out.nodes.Match.data).toEqual({ matchPct: 4.5, currentContribPct: 3.25 });
    expect(out.nodes.Increase401k.data).toEqual({ currentPct: 6.5, targetPct: 15 });
    expect(out.nodes.BigEF.data).toEqual({ targetMonths: 6 });
  });

  // The one extra rewrite v4 rides along with. w1-bug3 made an uncategorized
  // on-budget outflow unreachable from the UI, but deliberately did not rewrite
  // history; v4 is the one document rewrite where that gets fixed.
  it("back-fills uncategorized on-budget spending onto cat:uncategorized", () => {
    const out = migrate(
      makeV3({
        transactions: [
          { id: "in", accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: "rta", source: "manual" },
          { id: "out", accountId: "checking", date: "2026-06-02", amount: -49.99, source: "manual" },
        ],
      }),
    );

    const row = out.budget.transactions.find((t) => t.id === "out");
    expect(row?.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
    expect(row?.amount).toBe(-4999);
    expect(out.budget.groups.some((g) => g.id === "g:system")).toBe(true);
    expect(out.budget.categories.some((c) => c.id === UNCATEGORIZED_CATEGORY_ID)).toBe(true);

    // The point of the exercise: the residual term is gone for good.
    const integrity = bookIntegrity(out.budget, "2026-06");
    expect(integrity.unbudgetedSpending).toBe(0);
    expect(integrity.drift).toBe(0);
  });

  it("back-fills the on-budget leg of a transfer OUT of the budget, but never an on-budget pair", () => {
    const out = migrate(
      makeV3({
        accounts: [
          { id: "checking", name: "Checking", kind: "checking", source: "manual" },
          { id: "card", name: "Card", kind: "credit", source: "manual" },
          { id: "loan", name: "Loan", kind: "loan", source: "manual" },
        ],
        transactions: [
          // on-budget -> off-budget: the money really leaves.
          { id: "outOff", accountId: "checking", date: "2026-06-01", amount: -100, transferAccountId: "loan", source: "manual" },
          { id: "inOff", accountId: "loan", date: "2026-06-01", amount: 100, transferAccountId: "checking", source: "manual" },
          // on-budget -> on-budget: cancels in the cash total, so giving it an
          // envelope would invent activity that never happened.
          { id: "outOn", accountId: "checking", date: "2026-06-02", amount: -25, transferAccountId: "card", source: "manual" },
          { id: "inOn", accountId: "card", date: "2026-06-02", amount: 25, transferAccountId: "checking", source: "manual" },
        ],
      }),
    );
    const categoryOf = (id: string) => out.budget.transactions.find((t) => t.id === id)?.categoryId;
    expect(categoryOf("outOff")).toBe(UNCATEGORIZED_CATEGORY_ID);
    expect(categoryOf("inOff")).toBeUndefined(); // off-budget account: not ours to categorize
    expect(categoryOf("outOn")).toBeUndefined();
    expect(categoryOf("inOn")).toBeUndefined();
    expect(bookIntegrity(out.budget, "2026-06").unbudgetedSpending).toBe(0);
  });

  it("a clean book gains no rows the user never asked for", () => {
    const out = migrate(
      makeV3({
        transactions: [
          { id: "in", accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: "rta", source: "manual" },
        ],
      }),
    );
    expect(out.budget.categories.some((c) => c.id === UNCATEGORIZED_CATEGORY_ID)).toBe(false);
    expect(out.budget.groups.some((g) => g.id === "g:system")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The cross-platform determinism test (money-migration-v4.md §7) — the keystone
// deliverable of the v4 migration.
//
// `fixtures/migration/v3-nasty.json` is a v3 document salted with every case
// the two platforms could plausibly disagree on. `v4-expected.json` is its
// exact v4 image, generated once here and verified by hand against §4. THIS
// PAIR IS THE CONTRACT: the identical assertion runs in
// `ios/.../SharedMigrationFixtureTests.swift`. If both platforms migrate the
// same committed bytes to the same result, divergence between them is
// impossible by construction.

describe("cross-platform migration fixture (money-migration-v4.md §7)", () => {
  // Cloned per use so no test can mutate the shared import out from under
  // another, and so `migrate` always sees the committed bytes.
  const read = (fixture: unknown) => JSON.parse(JSON.stringify(fixture));

  it("migrating v3-nasty.json reproduces v4-expected.json exactly", () => {
    const migrated = migrate(read(v3Nasty));
    expect(migrated.version).toBe(4);
    // Deep equality both ways: no field converted wrong, and no field left over.
    expect(migrated).toEqual(read(v4Expected));
  });

  it("pins the hostile rounding cases the fixture was built around", () => {
    const out = migrate(read(v3Nasty));
    const amount = (id: string) => out.budget.transactions.find((t) => t.id === id)?.amount;

    expect(amount("t-tenth")).toBe(10); // 0.1
    expect(amount("t-fifth")).toBe(20); // 0.2
    expect(amount("t-third")).toBe(3333); // 33.333
    // 33.335: the nearest double is fractionally ABOVE the decimal value, so
    // d * 100 is exactly 3333.5 and the half goes to +infinity.
    expect(amount("t-half-below")).toBe(3334);
    // Exactly representable halves: both round toward +infinity, so the
    // negative one is -12, NOT -13 (that would be round-half-away-from-zero).
    expect(amount("t-pos-exact-half")).toBe(13); // 0.125
    expect(amount("t-neg-exact-half")).toBe(-12); // -0.125
    expect(amount("t-neg-third")).toBe(-1234); // -12.345
    expect(amount("t-neg-big-half")).toBe(-123_450); // -1234.5
    expect(amount("t-inflow")).toBe(123_456_789); // 1234567.89
    expect(amount("t-zero")).toBe(0);

    // A sub-cent assignment becomes one cent, and can never be written again.
    expect(out.budget.assignments["2026-05"].food).toBe(1);
    expect(out.budget.assignments["2026-06"].rent).toBe(180_001);

    // Rates and counts are not money (D8) and ride through unscaled.
    expect(out.budget.accounts.find((a) => a.id === "debt:visa")?.apr).toBe(24.99);
    expect((out.nodes.College.data as { targetAge: number }).targetAge).toBe(18);
    expect((out.nodes.Match.data as { matchPct: number }).matchPct).toBe(4.5);
  });

  it("leaves the migrated fixture with zero unbudgeted spending and zero drift", () => {
    const out = migrate(read(v3Nasty));
    for (const month of ["2026-05", "2026-06", "2026-07"]) {
      const integrity = bookIntegrity(out.budget, month);
      expect(integrity.unbudgetedSpending, month).toBe(0);
      expect(integrity.drift, month).toBe(0);
    }
  });

  // The §7 image is only as strong as the keys it covers. `nodes` used to be
  // outside it, and the platforms genuinely differed there: Swift's legacy
  // decoder materializes every NodeId, web emitted only the nodes the input
  // carried. Both sides now backfill, and both fixture tests compare `nodes`.
  it("backfills the whole node table, matching Swift's NodeId.allCases", () => {
    const out = migrate(read(v3Nasty));

    expect(Object.keys(out.nodes).sort()).toEqual([...NODE_IDS].sort());
    expect(Object.keys(out.nodes)).toHaveLength(32);
    // The nodes the input carried are untouched by the backfill...
    expect(out.nodes.Rent).toEqual({
      completed: false,
      notes: "due on the 1st",
      monthlyChecks: { "2026-05": true },
    });
    // ...and the ones it didn't arrive empty, exactly as a fresh document's do.
    expect(out.nodes.Options).toEqual(emptyNodeState());
  });

  it("survives deriveStatus on a v3 document with a sparse node table", () => {
    const sparse = read(v3Nasty);
    sparse.nodes = { Start: { completed: true, notes: "" } };

    const out = migrate(sparse);

    // Before the backfill this threw on the first absent node (derive.ts reads
    // `state.nodes[cur].completed` unguarded), white-screening into App.tsx's
    // error boundary on a document iOS rendered fine.
    expect(() => deriveStatus(out)).not.toThrow();
    expect(deriveStatus(out).Rent).toBeDefined();
  });

  it("drops node ids it doesn't know, exactly as Swift's keyed decode does", () => {
    const stray = read(v3Nasty);
    stray.nodes.NotANode = { completed: true, notes: "from the future" };

    expect(Object.keys(migrate(stray).nodes)).toHaveLength(32);
    expect((migrate(stray).nodes as Record<string, unknown>).NotANode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F5 (wave-3): the §7 "identical by construction" claim held for well-formed
// input and broke on hostile input — the same bytes produced different books on
// the two platforms. These three fixtures are committed alongside v3-nasty and
// the identical assertions run in `SharedMigrationFixtureTests.swift`.

describe("cross-platform determinism on hostile v3 input (F5)", () => {
  const read = (fixture: unknown) => JSON.parse(JSON.stringify(fixture));

  // (a) Money outside the range Swift's Int64 cents can hold. Web had no
  // ceiling at all, so `"amount": 1e17` migrated to 10000000000000000000 cents
  // here and 0 on iOS.
  it("clamps every out-of-Int64-range amount to zero, as Money.fromDollars does", () => {
    const out = migrate(read(v3OutOfRange));
    const amount = (id: string) => out.budget.transactions.find((t) => t.id === id)?.amount;

    expect(amount("t-over")).toBe(0); // 1e17 dollars -> 1e19 cents, past Int64
    expect(amount("t-under")).toBe(0); // -1e17 dollars, past Int64 the other way
    // 92233720368547758.08 scales to EXACTLY 2^63, which is one past Int.max —
    // the value that made Swift's `Int(_:)` trap before the bound went strict.
    expect(amount("t-edge")).toBe(0);
    // The clamp is not over-broad: a large value that still fits rides through.
    expect(amount("t-large-ok")).toBe(5_000_000_000_000_000_000);

    // Same rule everywhere money appears, not just on transactions.
    expect(out.settings.monthlyExpenses).toBe(0);
    expect(out.budget.categories.find((c) => c.id === "food")?.monthlyTarget).toBe(0);
    expect(out.budget.assignments["2026-06"].food).toBe(0);
    expect((out.nodes.College.data as { monthlyContribution: number }).monthlyContribution).toBe(0);
  });

  it("pins the exact Int64 boundary in centsFromDollars", () => {
    // Bounds copied from Money.swift: the low one is inclusive (-2^63 is an
    // exactly representable Int), the high one is strict (Double(Int.max)
    // rounds UP to 2^63, which no Int can hold).
    expect(centsFromDollars(-(2 ** 63) / 100)).toBe(-(2 ** 63));
    expect(centsFromDollars(2 ** 63 / 100)).toBe(0);
    expect(centsFromDollars(1e17)).toBe(0);
    expect(centsFromDollars(-1e17)).toBe(0);
    expect(centsFromDollars(Infinity)).toBe(0);
    expect(centsFromDollars(-Infinity)).toBe(0);
    expect(centsFromDollars(NaN)).toBe(0);
    // Ordinary money is untouched by the new guard.
    expect(centsFromDollars(-12.345)).toBe(-1234);
    expect(centsFromDollars(1234567.89)).toBe(123_456_789);
  });

  // (b) A missing required limit. Swift threw `keyNotFound` and quarantined the
  // entire book; web defaulted and migrated. Defaulting wins: the limits are
  // IRS figures the app ships a default for, and blanking a user's ledger over
  // one absent scalar is not a trade anyone would take.
  it("defaults the contribution limits the document omits instead of failing", () => {
    const out = migrate(read(v3OutOfRange));

    expect(out.settings.iraAnnualLimit).toBe(700_000);
    expect(out.settings.hsaSelfLimit).toBe(430_000);
    expect(out.settings.hsaFamilyLimit).toBe(855_000);
    // An explicit `null` is "no value", not zero dollars — `null * 100` used to
    // migrate a cleared field into a 0 the user never entered, while Swift's
    // decodeIfPresent read the same bytes as absent.
    expect(out.settings.preTaxIncome).toBeUndefined();
    // And the book itself survived, which is the whole point.
    expect(out.budget.transactions).toHaveLength(4);
  });

  // (c) Malformed rows. Web silently normalized garbage into a *different*
  // document and wrote it back over the original within one debounce.
  it("rejects a non-object row instead of normalizing it into a blank record", () => {
    expect(() => migrate(read(v3MalformedRows))).toThrow(/categories\[0\]/);
  });

  it("rejects a non-object assignment table instead of reading indices as ids", () => {
    expect(() => migrate(read(v3MalformedAssignments))).toThrow(/assignments\["2026-06"\]/);
  });

  it("rejects a non-object row in every table it walks, at v3 and at v4", () => {
    for (const table of ["accounts", "transactions", "groups", "categories"] as const) {
      const v4 = makeInitialState() as any;
      v4.budget[table] = [null];
      expect(() => migrate(v4), table).toThrow(new RegExp(`${table}\\[0\\]`));

      const v3 = read(v3MalformedRows);
      v3.budget.categories = [];
      v3.budget[table] = ["garbage"];
      expect(() => migrate(v3), table).toThrow(new RegExp(`${table}\\[0\\]`));
    }
  });

  it("still accepts empty tables and a book with no assignments at all", () => {
    const s = makeInitialState();
    expect(() => migrate(s)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F7 (wave-3): the v4 passthrough returned the parsed object itself, so every
// unknown top-level key rode into the store and out through exportJson —
// including `writeSeq`, a persistence-internal counter that has no business in
// a user-facing backup file. Swift's decoder ignores unknown keys, so this was
// a round-trip asymmetry too.

describe("v4 passthrough projects only the seven known fields (F7)", () => {
  const withStrays = () => ({
    ...(makeInitialState() as any),
    writeSeq: 7,
    leftover: "hello",
  });

  it("drops unknown top-level keys instead of carrying them into the store", () => {
    const out = migrate(withStrays()) as any;

    expect(Object.keys(out).sort()).toEqual(
      ["budget", "decisions", "earnedMedals", "nodes", "settings", "shownCelebrations", "version"],
    );
    expect(out.writeSeq).toBeUndefined();
    expect(out.leftover).toBeUndefined();
    // Everything that IS known is passed through untouched.
    expect(out).toEqual(makeInitialState());
  });

  it("keeps them out of exportJson", () => {
    const json = exportJson(migrate(withStrays()));

    expect(json).not.toMatch(/writeSeq/);
    expect(json).not.toMatch(/leftover/);
    // An export taken before the first mutation and one taken after it are now
    // the same bytes; they used to differ, because toPersistedSlice dropped the
    // strays on the first save.
    expect(JSON.parse(json)).toEqual(makeInitialState());
  });

  it("supplies the two optional lists when a v4 document omits them", () => {
    const doc = makeInitialState() as any;
    delete doc.shownCelebrations;
    delete doc.earnedMedals;

    const out = migrate(doc);

    expect(out.shownCelebrations).toEqual([]);
    expect(out.earnedMedals).toEqual([]);
  });
});
