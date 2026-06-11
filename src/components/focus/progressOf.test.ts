import { describe, expect, it } from "vitest";
import type { AppState, Category, Txn } from "../../state/schema";
import { RTA_CATEGORY_ID, makeInitialState } from "../../state/schema";
import { startingTxnId } from "../../budget/nodeLedger";
import { progressOf } from "./progressOf";

const MONTH = "2026-06";

let n = 0;
function txn(partial: Omit<Txn, "id" | "source"> & { id?: string }): Txn {
  return { id: `t${++n}`, source: "manual", ...partial };
}

function cat(partial: Partial<Category> & Pick<Category, "id" | "nodeId">): Category {
  return { groupId: "g:bills", name: partial.id, order: 0, ...partial };
}

/**
 * A state whose book has one on-budget account and an RTA inflow, so the
 * category availables the assignments create are real money.
 */
function seeded(build: (s: AppState) => void): AppState {
  const s = makeInitialState();
  s.budget.accounts = [{ id: "checking", name: "checking", kind: "checking", source: "manual" }];
  s.budget.transactions = [
    txn({ accountId: "checking", date: "2026-06-01", amount: 100000, categoryId: RTA_CATEGORY_ID }),
  ];
  build(s);
  return s;
}

describe("progressOf recurring nodes", () => {
  it("aggregates target and funded across linked categories", () => {
    const s = seeded((s) => {
      s.budget.categories = [
        cat({ id: "Rent:base", nodeId: "Rent", monthlyTarget: 1500 }),
        cat({ id: "Rent:parking", nodeId: "Rent", monthlyTarget: 200 }),
      ];
      s.budget.assignments = { [MONTH]: { "Rent:base": 1500, "Rent:parking": 100 } };
    });
    expect(progressOf(s, "Rent", MONTH)).toEqual({ kind: "goal", value: 1600, max: 1700, ready: false });
  });

  it("exact-cents sums meet the target with no floating-point drift", () => {
    // As raw doubles, assigned 0.7 + 0.1 == 0.7999999999999999, a hair below
    // the target 0.4 + 0.4 == 0.8 — the ledger's integer-cents arithmetic
    // makes both sides exactly 0.8, so plain `>=` is enough.
    const s = seeded((s) => {
      s.budget.categories = [
        cat({ id: "Food:a", nodeId: "Food", monthlyTarget: 0.4 }),
        cat({ id: "Food:b", nodeId: "Food", monthlyTarget: 0.4 }),
      ];
      s.budget.assignments = { [MONTH]: { "Food:a": 0.7, "Food:b": 0.1 } };
    });
    expect(progressOf(s, "Food", MONTH)).toEqual({ kind: "goal", value: 0.8, max: 0.8, ready: true });
  });

  it("keeps today's zero-target behavior: none, ready", () => {
    // No linked categories at all…
    expect(progressOf(seeded(() => {}), "Rent", MONTH)).toEqual({ kind: "none", ready: true });
    // …and categories without monthly targets (even with money assigned).
    const s = seeded((s) => {
      s.budget.categories = [cat({ id: "Food", nodeId: "Food" })];
      s.budget.assignments = { [MONTH]: { Food: 200 } };
    });
    expect(progressOf(s, "Food", MONTH)).toEqual({ kind: "none", ready: true });
  });
});

describe("progressOf emergency funds", () => {
  it("SmallEF keeps the single-balance behavior with one envelope", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = 3000;
      s.budget.categories = [cat({ id: "SmallEF", nodeId: "SmallEF", groupId: "g:ef" })];
      s.budget.assignments = { [MONTH]: { SmallEF: 3000 } };
    });
    expect(progressOf(s, "SmallEF", MONTH)).toEqual({ kind: "goal", value: 3000, max: 3000, ready: true });
  });

  it("buckets sum the balance but never shrink the computed target", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = 3000;
      s.budget.categories = [
        cat({ id: "SmallEF:medical", nodeId: "SmallEF", groupId: "g:ef", balanceTarget: 1000 }),
        cat({ id: "SmallEF:car", nodeId: "SmallEF", groupId: "g:ef", balanceTarget: 500 }),
      ];
      s.budget.assignments = { [MONTH]: { "SmallEF:medical": 800, "SmallEF:car": 500 } };
    });
    // Bucket targets (1500) stay below one month of expenses (3000): the
    // computed starter gate wins, so naming buckets never shrinks the goal.
    expect(progressOf(s, "SmallEF", MONTH)).toEqual({ kind: "goal", value: 1300, max: 3000, ready: false });
  });

  it("SmallEF keeps the computed gate even when bucket targets exceed it", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = 3000;
      s.budget.categories = [
        cat({ id: "SmallEF:medical", nodeId: "SmallEF", groupId: "g:ef", balanceTarget: 9000 }),
      ];
      s.budget.assignments = { [MONTH]: { "SmallEF:medical": 800 } };
    });
    // Big bucket ambitions live on BigEF; the $1k-or-one-month starter gate
    // never inflates, so the first milestone stays reachable.
    expect(progressOf(s, "SmallEF", MONTH)).toEqual({ kind: "goal", value: 800, max: 3000, ready: false });
  });

  it("bucket targets beyond the computed milestone grow the goal", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = 3000;
      s.nodes.BigEF.data = { targetMonths: 3 };
      s.budget.categories = [
        cat({ id: "BigEF:medical", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 6000 }),
        cat({ id: "BigEF:home", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 5000 }),
      ];
      s.budget.assignments = { [MONTH]: { "BigEF:medical": 6000, "BigEF:home": 4000 } };
    });
    // Σ bucket targets (11000) exceeds 3 × 3000: the user's real goal shows.
    expect(progressOf(s, "BigEF", MONTH)).toEqual({ kind: "goal", value: 10000, max: 11000, ready: false });
  });

  it("BigEF buckets define the goal when expenses are unset", () => {
    const s = seeded((s) => {
      s.nodes.BigEF.data = { targetMonths: 6 };
      s.budget.categories = [cat({ id: "BigEF:car", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 4000 })];
      s.budget.assignments = { [MONTH]: { "BigEF:car": 4000 } };
    });
    expect(progressOf(s, "BigEF", MONTH)).toEqual({ kind: "goal", value: 4000, max: 4000, ready: true });
  });

  it("BigEF without balance targets keeps the computed goal", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = 3000;
      s.nodes.BigEF.data = { targetMonths: 6 };
      s.budget.categories = [cat({ id: "BigEF", nodeId: "BigEF", groupId: "g:ef" })];
      s.budget.assignments = { [MONTH]: { BigEF: 18000 } };
    });
    expect(progressOf(s, "BigEF", MONTH)).toEqual({ kind: "goal", value: 18000, max: 18000, ready: true });
  });
});

describe("progressOf SavePurchase", () => {
  it("keeps the single-goal behavior with one envelope", () => {
    const s = seeded((s) => {
      s.budget.categories = [
        cat({ id: "SavePurchase:car", nodeId: "SavePurchase", groupId: "g:goals", balanceTarget: 12000 }),
      ];
      s.budget.assignments = { [MONTH]: { "SavePurchase:car": 12000 } };
    });
    expect(progressOf(s, "SavePurchase", MONTH)).toEqual({ kind: "goal", value: 12000, max: 12000, ready: true });
  });

  it("aggregates saved and target across goal envelopes", () => {
    const s = seeded((s) => {
      s.budget.categories = [
        cat({ id: "SavePurchase:down", nodeId: "SavePurchase", groupId: "g:goals", balanceTarget: 40000 }),
        cat({ id: "SavePurchase:car", nodeId: "SavePurchase", groupId: "g:goals", balanceTarget: 12000 }),
      ];
      s.budget.assignments = { [MONTH]: { "SavePurchase:down": 15000, "SavePurchase:car": 12000 } };
    });
    expect(progressOf(s, "SavePurchase", MONTH)).toEqual({ kind: "goal", value: 27000, max: 52000, ready: false });
  });
});

describe("progressOf debts", () => {
  /** A Visa with its $4,200 opening balance and `paidSoFar` paid back. */
  function debtState(paidSoFar: number): AppState {
    const s = makeInitialState();
    s.budget.accounts = [
      { id: "debt:d1", name: "Visa", kind: "loan", apr: 24.99, source: "manual", nodeId: "HighDebt" },
    ];
    s.budget.transactions = [
      txn({ accountId: "debt:d1", date: "2026-01-05", amount: -4200, id: startingTxnId("debt:d1") }),
    ];
    if (paidSoFar > 0) {
      s.budget.transactions.push(txn({ accountId: "debt:d1", date: "2026-03-01", amount: paidSoFar }));
    }
    return s;
  }

  it("no linked accounts is not ready", () => {
    expect(progressOf(makeInitialState(), "HighDebt", MONTH)).toEqual({ kind: "none", ready: false });
  });

  it("partial payoff climbs the bar continuously", () => {
    expect(progressOf(debtState(1200), "HighDebt", MONTH)).toEqual({
      kind: "goal",
      value: 1200,
      max: 4200,
      ready: false,
    });
  });

  it("ready once every open account is cleared", () => {
    expect(progressOf(debtState(4200), "HighDebt", MONTH)).toEqual({
      kind: "goal",
      value: 4200,
      max: 4200,
      ready: true,
    });
  });
});
