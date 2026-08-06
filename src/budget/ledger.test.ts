import { describe, expect, it } from "vitest";
import type { Account, BudgetBook, Txn } from "../state/schema";
import { RTA_CATEGORY_ID, emptyBudgetBook } from "../state/schema";
import {
  accountBalance,
  accountBalances,
  assignedAfter,
  bookIntegrity,
  isOnBudget,
  monthOf,
  pairTransfer,
  snapshot,
} from "./ledger";

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

  it("computes every account's balance in one pass, matching accountBalance per account", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 0.1 }),
        txn({ accountId: "checking", date: "2026-06-02", amount: 0.2 }),
        txn({ accountId: "savings", date: "2026-06-01", amount: 33.33 }),
        txn({ accountId: "savings", date: "2026-06-03", amount: -33.34 }),
        txn({ accountId: "card", date: "2026-06-05", amount: -80.01 }),
        // "ira" (tracking) gets no transactions and should still show up as 0.
      ],
    });
    const balances = accountBalances(b);
    for (const account of b.accounts) {
      expect(balances.get(account.id)).toBe(accountBalance(b, account.id));
    }
    expect(balances.get("ira")).toBe(0);
  });
});

describe("snapshot", () => {
  it("computes RTA from inflows and assignments through the viewed month", () => {
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
    expect(june.readyToAssign).toBe(400);
    expect(june.categories.groceries).toEqual({ assigned: 600, activity: 0, available: 600 });
  });

  it("carries RTA cumulatively: a balanced month reads the same viewed later", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-07-01", amount: 100, categoryId: RTA_CATEGORY_ID }),
      ],
      assignments: { "2026-06": { groceries: 100 }, "2026-07": { groceries: 100 } },
    });
    expect(snapshot(b, "2026-06").readyToAssign).toBe(900);
    expect(snapshot(b, "2026-07").readyToAssign).toBe(900);
  });

  it("shows a negative RTA in the month you over-assigned ahead into", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 100, categoryId: RTA_CATEGORY_ID }),
      ],
      assignments: { "2026-07": { groceries: 250 } },
    });
    expect(snapshot(b, "2026-06").readyToAssign).toBe(100);
    expect(snapshot(b, "2026-07").readyToAssign).toBe(-150);
  });

  it("reports dollars parked in months after the viewed one", () => {
    const b = book({
      assignments: {
        "2026-06": { groceries: 100 },
        "2026-07": { groceries: 50 },
        "2026-08": { groceries: 25.5 },
      },
    });
    expect(assignedAfter(b, "2026-06")).toBe(75.5);
    expect(assignedAfter(b, "2026-07")).toBe(25.5);
    expect(assignedAfter(b, "2026-08")).toBe(0);
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

describe("bookIntegrity", () => {
  it("reports zero drift on a fully budgeted book", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-05", amount: -120, categoryId: "food" }),
      ],
      assignments: { "2026-06": { food: 300 } },
    });
    const i = bookIntegrity(b, "2026-06");
    expect(i.onBudgetCash).toBe(880);
    expect(i.sumAvailable).toBe(180);
    expect(i.readyToAssign).toBe(700);
    expect(i.unbudgetedSpending).toBe(0);
    expect(i.drift).toBe(0);
  });

  it("books an uncategorized on-budget expense as unbudgetedSpending, not drift", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-07", amount: -45.55 }),
      ],
    });
    const i = bookIntegrity(b, "2026-06");
    expect(i.unbudgetedSpending).toBe(-45.55);
    // The residual is named, so conservation still holds exactly.
    expect(i.drift).toBe(0);
  });

  it("ignores off-budget accounts on both sides of the identity", () => {
    const b = book({
      transactions: [
        txn({ accountId: "ira", date: "2026-06-02", amount: 5000 }),
        txn({ accountId: "checking", date: "2026-06-02", amount: 200, categoryId: RTA_CATEGORY_ID }),
      ],
    });
    const i = bookIntegrity(b, "2026-06");
    expect(i.onBudgetCash).toBe(200);
    expect(i.drift).toBe(0);
  });

  it("keeps conservation exact when dollars are assigned into future months", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: RTA_CATEGORY_ID }),
      ],
      assignments: { "2026-06": { food: 300 }, "2026-07": { food: 200 } },
    });
    // Assigning ahead moves no cash, so June must still balance to the cent.
    expect(bookIntegrity(b, "2026-06").drift).toBe(0);
  });

  it("holds across a six-month history, month by month", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const b = book({
      transactions: months.flatMap((m) => [
        txn({ accountId: "checking", date: `${m}-01`, amount: 1650.37, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: `${m}-14`, amount: -1200, categoryId: "rent" }),
        txn({ accountId: "card", date: `${m}-18`, amount: -450.37, categoryId: "food" }),
      ]),
      assignments: Object.fromEntries(months.map((m) => [m, { rent: 1200, food: 450.37 }])),
    });
    // Every month funds itself exactly, so RTA is zero whichever month you view.
    for (const m of months) expect(bookIntegrity(b, m).readyToAssign).toBe(0);
    expect(bookIntegrity(b, "2026-06").drift).toBe(0);
  });

  /**
   * The six-month fixture above funds itself exactly every month, so cumulative
   * cash is $0 at every boundary and drift reads 0 whether or not the cash side
   * is filtered to the viewed month — it cannot see a month-filter bug. This
   * book deliberately carries cash forward (income $3,000/mo, rent $1,200,
   * uneven food leaving June overspent, one $80 ATM withdrawal that never gets
   * a category) so any drift between the cash side and the envelope side shows
   * up the moment you view an older month.
   */
  function carryForwardBook(extra: Txn[] = []): BudgetBook {
    return book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 3000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-03", amount: -1200, categoryId: "rent" }),
        txn({ accountId: "checking", date: "2026-06-20", amount: -550, categoryId: "food" }),
        txn({ accountId: "checking", date: "2026-07-01", amount: 3000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-07-03", amount: -1200, categoryId: "rent" }),
        txn({ accountId: "checking", date: "2026-07-15", amount: -300, categoryId: "food" }),
        txn({ accountId: "checking", date: "2026-07-25", amount: -80 }), // ATM cash, never categorized
        txn({ accountId: "checking", date: "2026-08-01", amount: 3000, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-08-03", amount: -1200, categoryId: "rent" }),
        ...extra,
      ],
      assignments: {
        "2026-06": { rent: 1200, food: 400 },
        "2026-07": { rent: 1200, food: 500 },
        "2026-08": { rent: 1200 },
      },
    });
  }

  it("holds at every month boundary of a book that carries cash forward", () => {
    const b = carryForwardBook();
    // Hand-derived: cash is cumulative THROUGH the viewed month, like every
    // other term. June ends $150 overspent on food, which sweeps in July.
    expect(bookIntegrity(b, "2026-06")).toEqual({
      onBudgetCash: 1250,
      sumAvailable: -150,
      readyToAssign: 1400,
      unbudgetedSpending: 0,
      drift: 0,
    });
    expect(bookIntegrity(b, "2026-07")).toEqual({
      onBudgetCash: 2670,
      sumAvailable: 200,
      readyToAssign: 2550,
      unbudgetedSpending: -80,
      drift: 0,
    });
    expect(bookIntegrity(b, "2026-08")).toEqual({
      onBudgetCash: 4470,
      sumAvailable: 200,
      readyToAssign: 4350,
      unbudgetedSpending: -80,
      drift: 0,
    });
  });

  it("leaves a future-dated transaction out of the viewed month's cash", () => {
    // A post-dated bill (the date input has no max) must not make the books
    // "not balance" in August — it isn't part of August's cash yet.
    const b = carryForwardBook([
      txn({ accountId: "checking", date: "2026-09-01", amount: -250, categoryId: "rent" }),
    ]);
    const aug = bookIntegrity(b, "2026-08");
    expect(aug.onBudgetCash).toBe(4470);
    expect(aug.drift).toBe(0);
    // Once September is the viewed month it counts, on both sides.
    const sep = bookIntegrity(b, "2026-09");
    expect(sep.onBudgetCash).toBe(4220);
    expect(sep.drift).toBe(0);
  });

  it("books the on-budget leg of an on->off transfer as unbudgetedSpending", () => {
    // Checking -> tracking with "— No category —": the counterpart lives off
    // budget and is never summed, so this leg has to land in the identity.
    const b = carryForwardBook(
      pairTransfer(book({}).accounts, {
        from: "checking",
        to: "ira",
        amount: 500,
        date: "2026-08-10",
      }),
    );
    const i = bookIntegrity(b, "2026-08");
    expect(i.onBudgetCash).toBe(3970);
    expect(i.unbudgetedSpending).toBe(-580);
    expect(i.drift).toBe(0);
  });

  it("keeps an on->on transfer pair out of unbudgetedSpending entirely", () => {
    // Control: both legs are on budget, so they cancel in cash and must not be
    // counted as spending on either side.
    const b = carryForwardBook(
      pairTransfer(book({}).accounts, {
        from: "checking",
        to: "savings",
        amount: 500,
        date: "2026-08-10",
      }),
    );
    const i = bookIntegrity(b, "2026-08");
    expect(i.onBudgetCash).toBe(4470);
    expect(i.unbudgetedSpending).toBe(-80);
    expect(i.drift).toBe(0);
  });

  it("stays exact on cent-level amounts that would drift as floats", () => {
    const b = book({
      transactions: [
        txn({ accountId: "checking", date: "2026-06-01", amount: 0.1, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-02", amount: 0.2, categoryId: RTA_CATEGORY_ID }),
        txn({ accountId: "checking", date: "2026-06-03", amount: -0.3, categoryId: "food" }),
      ],
      assignments: { "2026-06": { food: 0.3 } },
    });
    expect(bookIntegrity(b, "2026-06").drift).toBe(0);
  });
});
