import { describe, expect, it } from "vitest";
import type { AppState, Category, Txn } from "../../state/schema";
import { RTA_CATEGORY_ID, makeInitialState } from "../../state/schema";
import { startingTxnId } from "../../budget/nodeLedger";
import { progressOf } from "./progressOf";

const MONTH = "2026-06";

/**
 * Every money number in this file is INTEGER CENTS (schema v4). Where a test
 * needs a value the domain has an opinion about — the emergency-fund gate is
 * `max($1,000, one month of expenses)` — it is spelled in cents explicitly.
 */
const MONTHLY_EXPENSES = 300_000; // $3,000/mo

/** A money goal, with the unit `progressOf` now tags its results with. */
const GOAL = (value: number, max: number, ready: boolean) => ({
  kind: "goal",
  unit: "cents",
  value,
  max,
  ready,
});

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
    expect(progressOf(s, "Rent", MONTH)).toEqual(GOAL(1600, 1700, false));
  });

  it("cent-sized sums meet the target exactly (v4: nothing smaller exists)", () => {
    // 70c + 10c. As dollars-as-doubles this was 0.7 + 0.1 == 0.7999999999999999
    // — a hair below 0.8 on both sides of the comparison, and the reason every
    // arithmetic site used to need a rounding step. In integer cents the sum is
    // exactly 80 by construction, so plain `>=` is enough and no sub-cent
    // operand can exist to make iOS disagree.
    const s = seeded((s) => {
      s.budget.categories = [
        cat({ id: "Food:a", nodeId: "Food", monthlyTarget: 70 }),
        cat({ id: "Food:b", nodeId: "Food", monthlyTarget: 10 }),
      ];
      s.budget.assignments = { [MONTH]: { "Food:a": 70, "Food:b": 10 } };
    });
    expect(progressOf(s, "Food", MONTH)).toEqual(GOAL(80, 80, true));
  });

  it("a target met entirely by carryover reads ready with nothing assigned", () => {
    // Month-ahead budgeting: May's assignment carries into June untouched.
    const s = seeded((s) => {
      s.budget.transactions = [
        txn({ accountId: "checking", date: "2026-05-01", amount: 100000, categoryId: RTA_CATEGORY_ID }),
      ];
      s.budget.categories = [cat({ id: "Rent:base", nodeId: "Rent", monthlyTarget: 1800 })];
      s.budget.assignments = { "2026-05": { "Rent:base": 1800 } };
    });
    expect(progressOf(s, "Rent", MONTH)).toEqual(GOAL(1800, 1800, true));
  });

  it("one over-stuffed envelope cannot cover an empty sibling in the same node", () => {
    const s = seeded((s) => {
      s.budget.categories = [
        cat({ id: "Rent:base", nodeId: "Rent", monthlyTarget: 1500 }),
        cat({ id: "Rent:parking", nodeId: "Rent", monthlyTarget: 200 }),
      ];
      s.budget.assignments = { [MONTH]: { "Rent:base": 1700 } };
    });
    expect(progressOf(s, "Rent", MONTH)).toEqual(GOAL(1500, 1700, false));
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
      s.settings.monthlyExpenses = MONTHLY_EXPENSES;
      s.budget.categories = [cat({ id: "SmallEF", nodeId: "SmallEF", groupId: "g:ef" })];
      s.budget.assignments = { [MONTH]: { SmallEF: MONTHLY_EXPENSES } };
    });
    expect(progressOf(s, "SmallEF", MONTH)).toEqual(
      GOAL(MONTHLY_EXPENSES, MONTHLY_EXPENSES, true),
    );
  });

  it("buckets sum the balance but never shrink the computed target", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = MONTHLY_EXPENSES;
      s.budget.categories = [
        cat({ id: "SmallEF:medical", nodeId: "SmallEF", groupId: "g:ef", balanceTarget: 100_000 }),
        cat({ id: "SmallEF:car", nodeId: "SmallEF", groupId: "g:ef", balanceTarget: 50_000 }),
      ];
      s.budget.assignments = { [MONTH]: { "SmallEF:medical": 80_000, "SmallEF:car": 50_000 } };
    });
    // Bucket targets ($1,500) stay below one month of expenses ($3,000): the
    // computed starter gate wins, so naming buckets never shrinks the goal.
    expect(progressOf(s, "SmallEF", MONTH)).toEqual(GOAL(130_000, MONTHLY_EXPENSES, false));
  });

  it("SmallEF keeps the computed gate even when bucket targets exceed it", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = MONTHLY_EXPENSES;
      s.budget.categories = [
        cat({ id: "SmallEF:medical", nodeId: "SmallEF", groupId: "g:ef", balanceTarget: 900_000 }),
      ];
      s.budget.assignments = { [MONTH]: { "SmallEF:medical": 80_000 } };
    });
    // Big bucket ambitions live on BigEF; the $1k-or-one-month starter gate
    // never inflates, so the first milestone stays reachable.
    expect(progressOf(s, "SmallEF", MONTH)).toEqual(GOAL(80_000, MONTHLY_EXPENSES, false));
  });

  it("bucket targets beyond the computed milestone grow the goal", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = MONTHLY_EXPENSES;
      s.nodes.BigEF.data = { targetMonths: 3 };
      s.budget.categories = [
        cat({ id: "BigEF:medical", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 600_000 }),
        cat({ id: "BigEF:home", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 500_000 }),
      ];
      s.budget.assignments = { [MONTH]: { "BigEF:medical": 600_000, "BigEF:home": 400_000 } };
    });
    // Σ bucket targets ($11,000) exceeds 3 × $3,000: the user's real goal shows.
    expect(progressOf(s, "BigEF", MONTH)).toEqual(GOAL(1_000_000, 1_100_000, false));
  });

  it("BigEF buckets define the goal when expenses are unset", () => {
    const s = seeded((s) => {
      s.nodes.BigEF.data = { targetMonths: 6 };
      s.budget.categories = [cat({ id: "BigEF:car", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 400_000 })];
      s.budget.assignments = { [MONTH]: { "BigEF:car": 400_000 } };
    });
    expect(progressOf(s, "BigEF", MONTH)).toEqual(GOAL(400_000, 400_000, true));
  });

  it("BigEF without balance targets keeps the computed goal", () => {
    const s = seeded((s) => {
      s.settings.monthlyExpenses = MONTHLY_EXPENSES;
      s.nodes.BigEF.data = { targetMonths: 6 };
      s.budget.categories = [cat({ id: "BigEF", nodeId: "BigEF", groupId: "g:ef" })];
      s.budget.assignments = { [MONTH]: { BigEF: 1_800_000 } };
    });
    expect(progressOf(s, "BigEF", MONTH)).toEqual(GOAL(1_800_000, 1_800_000, true));
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
    expect(progressOf(s, "SavePurchase", MONTH)).toEqual(GOAL(12000, 12000, true));
  });

  it("aggregates saved and target across goal envelopes", () => {
    const s = seeded((s) => {
      s.budget.categories = [
        cat({ id: "SavePurchase:down", nodeId: "SavePurchase", groupId: "g:goals", balanceTarget: 40000 }),
        cat({ id: "SavePurchase:car", nodeId: "SavePurchase", groupId: "g:goals", balanceTarget: 12000 }),
      ];
      s.budget.assignments = { [MONTH]: { "SavePurchase:down": 15000, "SavePurchase:car": 12000 } };
    });
    expect(progressOf(s, "SavePurchase", MONTH)).toEqual(GOAL(27000, 52000, false));
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
    expect(progressOf(debtState(1200), "HighDebt", MONTH)).toEqual(GOAL(1200, 4200, false));
  });

  it("ready once every open account is cleared", () => {
    expect(progressOf(debtState(4200), "HighDebt", MONTH)).toEqual(GOAL(4200, 4200, true));
  });
});
