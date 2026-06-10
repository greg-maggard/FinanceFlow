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
  v1.nodes.College.data = { monthlyContribution: 100, balance: m(2500) };
  return v1;
}

describe("migrate", () => {
  it("passes a version-2 document through", () => {
    const s = makeInitialState();
    expect(migrate(s)).toEqual(s);
  });

  it("throws on a newer version instead of silently resetting", () => {
    const s = { ...makeInitialState(), version: 3 };
    expect(() => migrate(s)).toThrow(/version/i);
  });

  it("throws on non-object input", () => {
    expect(() => migrate("nope")).toThrow();
    expect(() => migrate(null)).toThrow();
  });

  it("upgrades an empty v1 document to balanced empty books", () => {
    const out = migrate(makeV1(), NOW);
    expect(out.version).toBe(2);
    expect(out.budget.categories).toEqual([]);
    expect(out.budget.accounts.map((a) => a.id)).toEqual(["acct:cash"]);
    expect(out.budget.transactions).toEqual([]);
    expect(out.budget.assignments).toEqual({});
  });

  it("preserves every v1 field untouched", () => {
    const v1 = makeRichV1();
    const out = migrate(v1, NOW);
    expect(out.nodes).toEqual(v1.nodes);
    expect(out.settings).toEqual(v1.settings);
    expect(out.decisions).toEqual(v1.decisions);
  });

  it("seeds categories from items with deterministic ids", () => {
    const out = migrate(makeRichV1(), NOW);
    const ids = out.budget.categories.map((c) => c.id);
    expect(ids).toEqual(["Rent:r1", "Food", "BigEF:b1", "BigEF:b2", "SavePurchase:p1", "Goals:gl1"]);

    const byId = Object.fromEntries(out.budget.categories.map((c) => [c.id, c]));
    expect(byId["Rent:r1"]).toMatchObject({ groupId: "g:bills", monthlyTarget: 1800, nodeId: "Rent" });
    expect(byId["Food"]).toMatchObject({ groupId: "g:bills", monthlyTarget: 600 });
    expect(byId["BigEF:b1"]).toMatchObject({ groupId: "g:ef", name: "Medical", balanceTarget: 3000 });
    expect(byId["SavePurchase:p1"]).toMatchObject({
      groupId: "g:goals",
      balanceTarget: 20000,
      targetDate: "2027-01-01",
    });
    expect(byId["Goals:gl1"]).toMatchObject({ groupId: "g:goals", balanceTarget: 3000 });
  });

  it("seeds the emergency fund from BigEF only when BigEF has data", () => {
    const out = migrate(makeRichV1(), NOW);
    expect(out.budget.categories.some((c) => c.id.startsWith("SmallEF"))).toBe(false);

    const v1 = makeV1();
    v1.nodes.SmallEF.data = { balance: m(700) };
    const small = migrate(v1, NOW);
    expect(small.budget.categories.map((c) => c.id)).toEqual(["SmallEF"]);
    expect(small.budget.categories[0]).toMatchObject({ name: "Emergency Fund", balanceTarget: 1000 });
  });

  it("turns debts into loan accounts and the 529 into a tracking account", () => {
    const out = migrate(makeRichV1(), NOW);
    const byId = Object.fromEntries(out.budget.accounts.map((a) => [a.id, a]));
    expect(byId["debt:d1"]).toMatchObject({ kind: "loan", apr: 24.99, minPayment: 50 });
    expect(byId["acct:college"]).toMatchObject({ kind: "tracking" });
    expect(accountBalance(out.budget, "debt:d1")).toBe(-4200);
    expect(accountBalance(out.budget, "acct:college")).toBe(2500);
  });

  it("opens the books balanced: bars preserved and RTA exactly zero", () => {
    const out = migrate(makeRichV1(), NOW);
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
    expect(june.categories["Rent:r1"].available).toBe(1800);
    expect(june.categories["BigEF:b1"].available).toBe(1200);
    expect(june.categories["SavePurchase:p1"].available).toBe(5000);
  });
});

describe("export/import", () => {
  it("is identity for a version-2 state", () => {
    const s = makeInitialState();
    s.nodes.Start.completed = true;
    s.budget.accounts.push({ id: "a1", name: "Checking", kind: "checking", source: "manual" });
    s.budget.assignments["2026-06"] = { groceries: 12.34 };
    expect(importJson(exportJson(s))).toEqual(s);
  });

  it("migrates a v1 export on import", () => {
    const imported = importJson(JSON.stringify(makeRichV1()));
    expect(imported.version).toBe(2);
    expect(imported.budget.categories.length).toBeGreaterThan(0);
  });
});
