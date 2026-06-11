import { describe, expect, it } from "vitest";
import type { Account, BudgetBook, Txn } from "../state/schema";
import { RTA_CATEGORY_ID, emptyBudgetBook } from "../state/schema";
import { accountBalance, isOnBudget, monthOf, pairTransfer, snapshot } from "./ledger";

let nextId = 0;
function txn(partial: Omit<Txn, "id" | "source">): Txn {
  return { id: `t${++nextId}`, source: "manual", ...partial };
}

function acct(id: string, kind: Account["kind"]): Account {
  return { id, name: id, kind, source: "manual" };
}

function book(partial: Partial<BudgetBook>): BudgetBook {
  return {
    ...emptyBudgetBook(),
    accounts: [acct("checking", "checking"), acct("savings", "savings"), acct("card", "credit"), acct("ira", "tracking")],
    ...partial,
  };
}

describe("helpers", () => {
  it("buckets dates into months", () => {
    expect(monthOf("2026-06-10")).toBe("2026-06");
  });

  it("treats loan and tracking accounts as off-budget", () => {
    expect(isOnBudget("checking")).toBe(true);
    expect(isOnBudget("credit")).toBe(true);
    expect(isOnBudget("loan")).toBe(false);
    expect(isOnBudget("tracking")).toBe(false);
  });

  it("sums balances exactly despite float-dirty amounts", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 0.1 }),
        txn({ accountId: "checking", date: "2026-06-02", amount: 0.2 }),
      ],
    });
    expect(accountBalance(b, "checking")).toBe(0.3);
  });
});

describe("snapshot", () => {
  it("computes RTA from inflows minus every assignment, even future ones", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
      ],
      assignments: {
        "2026-06": { groceries: 600 },
        "2026-07": { groceries: 50 },
      },
    });
    const june = snapshot(b, "2026-06");
    expect(june.readyToAssign).toBe(350);
    expect(june.categories.groceries).toEqual({ assigned: 600, activity: 0, available: 600 });
  });

  it("rolls positive available forward across months", () => {
    const b = book({
      assignments: { "2026-06": { groceries: 100 }, "2026-07": { groceries: 50 } },
    });
    const july = snapshot(b, "2026-07");
    expect(july.categories.groceries).toEqual({ assigned: 50, activity: 0, available: 150 });
  });

  it("rolls available across empty gap months", () => {
    const b = book({ assignments: { "2026-04": { goal: 100 } } });
    expect(snapshot(b, "2026-07").categories.goal.available).toBe(100);
  });

  it("resets overspending and debits the following month's RTA", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-15", amount: -150, categoryId: "groceries" }),
      ],
      assignments: { "2026-06": { groceries: 100 } },
    });
    const june = snapshot(b, "2026-06");
    expect(june.categories.groceries.available).toBe(-50);
    expect(june.readyToAssign).toBe(900);

    const july = snapshot(b, "2026-07");
    expect(july.categories.groceries.available).toBe(0);
    expect(july.readyToAssign).toBe(850);
  });

  it("ignores transfers between on-budget accounts", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-05", amount: -200, transferAccountId: "savings" }),
        txn({ accountId: "savings", date: "2026-06-05", amount: 200, transferAccountId: "checking" }),
      ],
    });
    const june = snapshot(b, "2026-06");
    expect(june.readyToAssign).toBe(1000);
    expect(Object.keys(june.categories)).toHaveLength(0);
    expect(accountBalance(b, "checking")).toBe(800);
    expect(accountBalance(b, "savings")).toBe(200);
  });

  it("counts a categorized transfer to an off-budget account as activity", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-10", amount: -500, categoryId: "retirement", transferAccountId: "ira" }),
        txn({ accountId: "ira", date: "2026-06-10", amount: 500, transferAccountId: "checking" }),
      ],
      assignments: { "2026-06": { retirement: 500 } },
    });
    const june = snapshot(b, "2026-06");
    expect(june.categories.retirement).toEqual({ assigned: 500, activity: -500, available: 0 });
    expect(june.readyToAssign).toBe(500);
    expect(accountBalance(b, "ira")).toBe(500);
  });

  it("treats credit spending as activity but credit payments as plain transfers", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "card", date: "2026-06-08", amount: -80, categoryId: "groceries" }),
        txn({ accountId: "checking", date: "2026-06-20", amount: -60, transferAccountId: "card" }),
        txn({ accountId: "card", date: "2026-06-20", amount: 60, transferAccountId: "checking" }),
      ],
      assignments: { "2026-06": { groceries: 80 } },
    });
    const june = snapshot(b, "2026-06");
    expect(june.categories.groceries).toEqual({ assigned: 80, activity: -80, available: 0 });
    expect(june.readyToAssign).toBe(920);
    expect(accountBalance(b, "card")).toBe(-20);
  });

  it("excludes activity on off-budget accounts", () => {
    const b = book({
      transactions: [
        txn({ accountId: "ira", date: "2026-06-15", amount: -25, categoryId: "fees" }),
      ],
    });
    expect("fees" in snapshot(b, "2026-06").categories).toBe(false);
  });

  it("keeps envelope math exact at the cent", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-03", amount: -33.33, categoryId: "phone" }),
        txn({ accountId: "checking", date: "2026-06-04", amount: -33.33, categoryId: "phone" }),
        txn({ accountId: "checking", date: "2026-06-05", amount: -33.34, categoryId: "phone" }),
      ],
      assignments: { "2026-06": { phone: 100 } },
    });
    const june = snapshot(b, "2026-06");
    expect(june.categories.phone.activity).toBe(-100);
    expect(june.categories.phone.available).toBe(0);
  });

  it("builds transfer pairs: linked ids, opposite amounts, no category between on-budget accounts", () => {
    const accounts = book({}).accounts;
    const [out, inflow] = pairTransfer(accounts, {
      from: "checking",
      to: "savings",
      amount: 200,
      date: "2026-06-05",
      categoryId: "should-be-stripped",
    });
    expect(out.amount).toBe(-200);
    expect(inflow.amount).toBe(200);
    expect(out.transferPairId).toBe(inflow.id);
    expect(inflow.transferPairId).toBe(out.id);
    expect(out.transferAccountId).toBe("savings");
    expect(inflow.transferAccountId).toBe("checking");
    expect(out.categoryId).toBeUndefined();
    expect(inflow.categoryId).toBeUndefined();
  });

  it("puts the category on the on-budget row of an on->off transfer", () => {
    const accounts = book({}).accounts;
    const [out, inflow] = pairTransfer(accounts, {
      from: "checking",
      to: "ira",
      amount: 500,
      date: "2026-06-10",
      categoryId: "retirement",
    });
    expect(out.categoryId).toBe("retirement");
    expect(inflow.categoryId).toBeUndefined();
  });

  it("puts the category on the on-budget row of an off->on transfer", () => {
    const accounts = book({}).accounts;
    const [out, inflow] = pairTransfer(accounts, {
      from: "ira",
      to: "checking",
      amount: 300,
      date: "2026-06-12",
      categoryId: "windfall",
    });
    expect(out.categoryId).toBeUndefined();
    expect(inflow.categoryId).toBe("windfall");
  });

  it("accumulates a multi-month funded-vs-spent chain", () => {
    const months = ["2026-04", "2026-05", "2026-06"];
    const b = book({
      transactions: months.map((m) =>
        txn({ accountId: "checking", date: `${m}-20`, amount: -90, categoryId: "food" }),
      ),
      assignments: Object.fromEntries(months.map((m) => [m, { food: 100 }])),
    });
    expect(snapshot(b, "2026-06").categories.food.available).toBe(30);
  });
});
