import { describe, expect, it } from "vitest";
import type { SourcedNumber } from "./schema";
import { makeInitialState } from "./schema";
import { exportJson, importJson, migrate } from "./io";
import { accountBalance, snapshot } from "../budget/ledger";

const NOW = new Date(2026, 5, 10); // 2026-06-10 local

function m(value: number): SourcedNumber {
  return { value, source: "manual" };
}

/** A version-1 document (no `budget`), as written by pre-v2 builds. */
function makeV1(): any {
  const v1 = JSON.parse(JSON.stringify(makeInitialState()));
  delete v1.budget;
  v1.version = 1;
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
  it("passes a version-3 document through", () => {
    const s = makeInitialState();
    expect(migrate(s)).toEqual(s);
  });

  it("throws on a newer version instead of silently resetting", () => {
    const s = { ...makeInitialState(), version: 4 };
    expect(() => migrate(s)).toThrow(/version/i);
  });

  it("throws on non-object input", () => {
    expect(() => migrate("nope")).toThrow();
    expect(() => migrate(null)).toThrow();
  });

  // F10: a `version: 3` tag alone must not be enough to reach the cast —
  // see wave1-review.md cases A and B, reproduced directly against migrate().
  describe("structural validation of a claimed v3 document (F10)", () => {
    it("case A: rejects a bare {version:3} with nothing else", () => {
      expect(() => migrate({ version: 3 })).toThrow(/settings|budget/i);
    });

    it("case B: rejects a v3 document missing budget.assignments", () => {
      const s = makeInitialState() as any;
      delete s.budget.assignments;
      expect(() => migrate(s)).toThrow(/assignments/i);
    });

    it("rejects a v3 document whose budget.transactions isn't an array", () => {
      const s = makeInitialState() as any;
      s.budget.transactions = "not-an-array";
      expect(() => migrate(s)).toThrow(/transactions/i);
    });

    it("rejects a v3 document missing settings/decisions/nodes", () => {
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

    it("still lets a well-formed v3 document through unmodified", () => {
      const s = makeInitialState();
      expect(migrate(s)).toEqual(s);
    });
  });
});

describe("v1 -> v3 chain", () => {
  it("books match the old v1->v2 goldens and payloads are stripped", () => {
    const out = migrate(makeRichV1(), NOW);
    expect(out.version).toBe(3);

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
        "Rent:r1": 1800,
        Food: 450,
        "BigEF:b1": 1200,
        "BigEF:b2": 800,
        "SavePurchase:p1": 5000,
        "Goals:gl1": 500,
      },
    });
    const inflow = out.budget.transactions.find((t) => t.categoryId === "rta");
    expect(inflow).toMatchObject({ accountId: "acct:cash", amount: 9750 });
    const june = snapshot(out.budget, "2026-06");
    expect(june.readyToAssign).toBe(0);
    expect(june.categories["BigEF:b1"].available).toBe(1200);

    // v3 additions: account backlinks and horizon -> target date.
    const debt = out.budget.accounts.find((a) => a.id === "debt:d1");
    expect(debt).toMatchObject({ nodeId: "HighDebt", apr: 24.99 });
    expect(accountBalance(out.budget, "debt:d1")).toBe(-4200);
    expect(out.budget.accounts.find((a) => a.id === "acct:college")?.nodeId).toBe("College");
    expect(out.budget.categories.find((c) => c.id === "Goals:gl1")?.targetDate).toBe("2028-06-10");

    // Payloads: ledger-owned ones gone, node-only ones kept or slimmed.
    expect(out.nodes.Rent.data).toBeUndefined();
    expect(out.nodes.SmallEF.data).toBeUndefined();
    expect(out.nodes.SavePurchase.data).toBeUndefined();
    expect(out.nodes.Goals.data).toBeUndefined();
    expect(out.nodes.HighDebt.data).toBeUndefined();
    expect(out.nodes.BigEF.data).toEqual({ targetMonths: 6 });
    expect(out.nodes.College.data).toEqual({ monthlyContribution: 100 });
    expect(out.nodes.IRA.data).toEqual({
      type: "roth",
      ytdContribution: m(2500),
      annualLimit: 7000,
    });

    // Non-financial node state is preserved.
    expect(out.nodes.Start.completed).toBe(true);
    expect(out.nodes.Rent.notes).toBe("due on the 1st");
    expect(out.nodes.Rent.monthlyChecks).toEqual({ "2026-05": true });
    expect(out.decisions).toEqual(makeRichV1().decisions);
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
    expect(cat?.monthlyTarget).toBe(1900);
    expect(out.budget.assignments["2026-06"]).toEqual({ "Rent:r1": 500 });
    expect(out.budget.transactions).toHaveLength(1);
    expect(out.budget.categories).toHaveLength(1);
    expect(out.nodes.Rent.data).toBeUndefined();
  });

  it("creates payload-only items without moving Ready-to-Assign", () => {
    const v2 = makeV2();
    v2.nodes.Food.data = { target: m(600), funded: m(450) };
    const before = makeV2();
    expect(snapshot(before.budget, "2026-06").readyToAssign).toBe(0);

    const out = migrate(v2, NOW);
    expect(out.budget.categories.map((c) => c.id)).toEqual(["Food"]);
    expect(out.budget.assignments["2026-06"]).toEqual({ Food: 450 });
    const june = snapshot(out.budget, "2026-06");
    expect(june.readyToAssign).toBe(0);
    expect(june.categories.Food.available).toBe(450);
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
    expect(adjust).toMatchObject({ amount: 4200, memo: "Marked paid" });
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
  it("is identity for a version-3 state", () => {
    const s = makeInitialState();
    s.nodes.Start.completed = true;
    s.budget.accounts.push({ id: "a1", name: "Checking", kind: "checking", source: "manual" });
    s.budget.assignments["2026-06"] = { groceries: 12.34 };
    expect(importJson(exportJson(s))).toEqual(s);
  });

  it("migrates a v1 export on import", () => {
    const imported = importJson(JSON.stringify(makeRichV1()));
    expect(imported.version).toBe(3);
    expect(imported.budget.categories.length).toBeGreaterThan(0);
  });
});
