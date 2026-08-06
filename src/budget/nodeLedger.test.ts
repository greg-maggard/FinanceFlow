import { describe, expect, it } from "vitest";
import type { Account, BudgetBook, Category, Txn } from "../state/schema";
import { RTA_CATEGORY_ID, emptyBudgetBook } from "../state/schema";
import { bookIntegrity, snapshot } from "./ledger";
import type { BookOps } from "./nodeLedger";
import {
  ADJUST_ACCOUNT_ID,
  COLLEGE_ACCOUNT_ID,
  collegeBalance,
  debtRows,
  debtTotals,
  efBalance,
  efTarget,
  planBalanceEdit,
  planCollegeBalanceEdit,
  planCreateDebtAccount,
  planCreateLinkedCategory,
  planDebtBalanceEdit,
  planMarkDebtPaid,
  purchaseTotals,
  recurringTotals,
  startingTxnId,
} from "./nodeLedger";

const MONTH = "2026-06";
const TODAY = "2026-06-10";

let n = 0;
function txn(partial: Omit<Txn, "id" | "source">): Txn {
  return { id: `t${++n}`, source: "manual", ...partial };
}

function cat(partial: Partial<Category> & Pick<Category, "id" | "nodeId">): Category {
  return { groupId: "g:bills", name: partial.id, order: 0, ...partial };
}

function acct(partial: Partial<Account> & Pick<Account, "id" | "kind">): Account {
  return { name: partial.id, source: "manual", ...partial };
}

/** Reference applier — the contract `store.applyBookOps` implements. */
function apply(book: BudgetBook, ops: BookOps): BudgetBook {
  const next: BudgetBook = JSON.parse(JSON.stringify(book));
  for (const g of ops.addGroups ?? []) next.groups.push(g);
  for (const a of ops.addAccounts ?? []) next.accounts.push(a);
  for (const a of ops.updateAccounts ?? [])
    next.accounts = next.accounts.map((x) => (x.id === a.id ? a : x));
  for (const c of ops.addCategories ?? []) next.categories.push(c);
  for (const c of ops.updateCategories ?? [])
    next.categories = next.categories.map((x) => (x.id === c.id ? c : x));
  for (const t of ops.addTxns ?? []) next.transactions.push(t);
  for (const t of ops.updateTxns ?? [])
    next.transactions = next.transactions.map((x) => (x.id === t.id ? t : x));
  if (ops.deleteTxnIds?.length)
    next.transactions = next.transactions.filter((t) => !ops.deleteTxnIds!.includes(t.id));
  for (const s of ops.setAssignments ?? []) {
    const table = { ...(next.assignments[s.month] ?? {}) };
    if (s.amount > 0) table[s.categoryId] = s.amount;
    else delete table[s.categoryId];
    if (Object.keys(table).length > 0) next.assignments[s.month] = table;
    else delete next.assignments[s.month];
  }
  return next;
}

function fundedBook(): BudgetBook {
  return {
    ...emptyBudgetBook(),
    accounts: [acct({ id: "checking", kind: "checking" })],
    transactions: [
      txn({ accountId: "checking", date: "2026-06-01", amount: 5000, categoryId: RTA_CATEGORY_ID }),
    ],
  };
}

describe("node reads", () => {
  it("recurring totals: Σ monthly targets vs Σ assigned this month", () => {
    const book: BudgetBook = {
      ...fundedBook(),
      categories: [
        cat({ id: "Rent:r1", nodeId: "Rent", monthlyTarget: 1800 }),
        cat({ id: "Rent:r2", nodeId: "Rent", monthlyTarget: 0.1 }),
        cat({ id: "Food", nodeId: "Food", monthlyTarget: 600 }),
      ],
      assignments: { [MONTH]: { "Rent:r1": 1800, "Rent:r2": 0.2, Food: 450 } },
    };
    const snap = snapshot(book, MONTH);
    expect(recurringTotals(book, snap, "Rent")).toEqual({ target: 1800.1, funded: 1800.2 });
    expect(recurringTotals(book, snap, "Food")).toEqual({ target: 600, funded: 450 });
    expect(recurringTotals(book, snap, "Essential")).toEqual({ target: 0, funded: 0 });
  });

  it("EF balance is the SmallEF/BigEF union; only BigEF's target grows with buckets", () => {
    const book: BudgetBook = {
      ...fundedBook(),
      categories: [
        cat({ id: "SmallEF", nodeId: "SmallEF", groupId: "g:ef", balanceTarget: 1000 }),
        cat({ id: "BigEF:b1", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 9000 }),
        cat({ id: "Goals:g1", nodeId: "Goals", groupId: "g:goals", balanceTarget: 500 }),
      ],
      assignments: { [MONTH]: { SmallEF: 700, "BigEF:b1": 1200, "Goals:g1": 100 } },
    };
    const snap = snapshot(book, MONTH);
    expect(efBalance(book, snap)).toBe(1900);
    expect(efTarget(book, "SmallEF", 1000)).toBe(1000);
    expect(efTarget(book, "BigEF", 6000)).toBe(10000);
    expect(efTarget(book, "BigEF", 24000)).toBe(24000);
  });

  it("purchase totals: saved = Σ available, target = Σ balance targets", () => {
    const book: BudgetBook = {
      ...fundedBook(),
      categories: [
        cat({ id: "SavePurchase:p1", nodeId: "SavePurchase", groupId: "g:goals", balanceTarget: 20000 }),
        cat({ id: "SavePurchase:p2", nodeId: "SavePurchase", groupId: "g:goals", balanceTarget: 3000 }),
      ],
      assignments: { "2026-05": { "SavePurchase:p1": 4000 }, [MONTH]: { "SavePurchase:p2": 250 } },
    };
    const snap = snapshot(book, MONTH);
    expect(purchaseTotals(book, snap, "SavePurchase")).toEqual({ saved: 4250, target: 23000 });
  });

  it("debt rows derive principal, outstanding, and paid from the account ledger", () => {
    const visa = acct({ id: "debt:d1", kind: "loan", nodeId: "HighDebt", apr: 24.99 });
    const closed = acct({ id: "debt:d2", kind: "loan", nodeId: "HighDebt", closed: true });
    const book: BudgetBook = {
      ...emptyBudgetBook(),
      accounts: [visa, closed],
      transactions: [
        { ...txn({ accountId: "debt:d1", date: "2026-01-05", amount: -4200 }), id: startingTxnId("debt:d1") },
        txn({ accountId: "debt:d1", date: "2026-03-01", amount: 1200 }),
      ],
    };
    const rows = debtRows(book, "HighDebt");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outstanding: 3000, principal: 4200, paid: false });

    const totals = debtTotals(book, "HighDebt");
    expect(totals).toEqual({ paid: 1200, total: 4200, allPaid: false, hasAny: true });
    expect(debtTotals(book, "ModDebt")).toEqual({ paid: 0, total: 0, allPaid: false, hasAny: false });
  });

  it("college balance reads the tracking account, zero when absent", () => {
    expect(collegeBalance(emptyBudgetBook())).toBe(0);
    const book: BudgetBook = {
      ...emptyBudgetBook(),
      accounts: [acct({ id: COLLEGE_ACCOUNT_ID, kind: "tracking" })],
      transactions: [txn({ accountId: COLLEGE_ACCOUNT_ID, date: "2026-01-01", amount: 2500 })],
    };
    expect(collegeBalance(book)).toBe(2500);
  });
});

describe("planBalanceEdit", () => {
  function efBook(): BudgetBook {
    return {
      ...fundedBook(),
      categories: [cat({ id: "BigEF:b1", nodeId: "BigEF", groupId: "g:ef", balanceTarget: 3000 })],
      assignments: { [MONTH]: { "BigEF:b1": 1200 } },
    };
  }

  it("raising a balance assigns more this month", () => {
    const book = efBook();
    const next = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", 1500, TODAY));
    expect(next.assignments[MONTH]["BigEF:b1"]).toBe(1500);
    expect(next.transactions).toHaveLength(book.transactions.length);
    expect(snapshot(next, MONTH).categories["BigEF:b1"].available).toBe(1500);
  });

  it("lowering within the assignment just un-assigns (dollars return to RTA)", () => {
    const book = efBook();
    const next = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", 900, TODAY));
    expect(next.assignments[MONTH]["BigEF:b1"]).toBe(900);
    const snap = snapshot(next, MONTH);
    expect(snap.categories["BigEF:b1"].available).toBe(900);
    expect(snap.readyToAssign).toBe(5000 - 900);
  });

  it("lowering past the assignment writes one coalesced adjustment transaction", () => {
    let book = efBook();
    // 1200 available, 1200 assigned; drop to 200 → un-assign all + adjust −1000? No:
    // available target 200 → un-assign 1000 (assigned 200) covers it fully. Go below 0:
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", -300, TODAY));
    expect(book.assignments[MONTH]?.["BigEF:b1"]).toBeUndefined();
    const adjustments = book.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount).toBe(-300);
    expect(adjustments[0].categoryId).toBe("BigEF:b1");
    expect(book.accounts.some((a) => a.id === ADJUST_ACCOUNT_ID)).toBe(true);
    expect(snapshot(book, MONTH).categories["BigEF:b1"].available).toBe(-300);
  });

  it("keystroke sequence converges: 5 → 50 → 500 ends exact with no adjustment", () => {
    let book = efBook();
    for (const v of [5, 50, 500]) {
      book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", v, TODAY));
    }
    expect(snapshot(book, MONTH).categories["BigEF:b1"].available).toBe(500);
    expect(book.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID)).toHaveLength(0);
    expect(book.assignments[MONTH]["BigEF:b1"]).toBe(500);
  });

  it("raising after a same-day lowering unwinds the adjustment before assigning", () => {
    let book = efBook();
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", -300, TODAY)); // adj −300
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", 250, TODAY));
    expect(book.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID)).toHaveLength(0);
    expect(book.assignments[MONTH]["BigEF:b1"]).toBe(250);
    expect(snapshot(book, MONTH).categories["BigEF:b1"].available).toBe(250);
  });

  it("raising the next day unwinds the write-off instead of burning RTA", () => {
    const before = efBook();
    const rtaBefore = snapshot(before, MONTH).readyToAssign;
    // Day 10: fat-finger the balance down past the assignment. Day 11: fix it.
    let book = apply(before, planBalanceEdit(before, MONTH, "BigEF:b1", -300, `${MONTH}-10`));
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", 1200, `${MONTH}-11`));

    expect(book.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID)).toHaveLength(0);
    expect(book.assignments).toEqual(before.assignments);
    const snap = snapshot(book, MONTH);
    expect(snap.categories["BigEF:b1"].available).toBe(1200);
    expect(snap.readyToAssign).toBe(rtaBefore);
    expect(bookIntegrity(book, MONTH).drift).toBe(0);
  });

  it("raising past the write-offs clears them, then assigns the residual", () => {
    let book = efBook();
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", -300, `${MONTH}-10`));
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", 500, `${MONTH}-11`));

    expect(book.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID)).toHaveLength(0);
    expect(book.assignments[MONTH]["BigEF:b1"]).toBe(500);
    expect(snapshot(book, MONTH).categories["BigEF:b1"].available).toBe(500);
    expect(bookIntegrity(book, MONTH).drift).toBe(0);
  });

  it("a partial raise unwinds the NEWEST write-off first", () => {
    let book = efBook();
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", -300, `${MONTH}-10`));
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", -800, `${MONTH}-12`));
    book = apply(book, planBalanceEdit(book, MONTH, "BigEF:b1", -600, `${MONTH}-13`));

    const byDate = Object.fromEntries(
      book.transactions
        .filter((t) => t.accountId === ADJUST_ACCOUNT_ID)
        .map((t) => [t.date, t.amount]),
    );
    // The 12th's −500 absorbs the whole +200; the 10th's −300 is untouched.
    expect(byDate).toEqual({ [`${MONTH}-10`]: -300, [`${MONTH}-12`]: -300 });
    expect(snapshot(book, MONTH).categories["BigEF:b1"].available).toBe(-600);
    expect(bookIntegrity(book, MONTH).drift).toBe(0);
  });

  it("does not treat a sub-half-cent row as an outstanding write-off", () => {
    // Both engines select unwind candidates on the CENTS-rounded amount, so a
    // row that rounds to zero is invisible to both. Pinned on each platform:
    // if the two disagree here, an imported book unwinds a different row.
    const book: BudgetBook = {
      ...efBook(),
      accounts: [...efBook().accounts, acct({ id: ADJUST_ACCOUNT_ID, kind: "cash", name: "Adjustments" })],
      transactions: [
        ...efBook().transactions,
        {
          ...txn({
            accountId: ADJUST_ACCOUNT_ID,
            date: `${MONTH}-09`,
            amount: -0.004,
            categoryId: "BigEF:b1",
          }),
          id: `txn:adjust:BigEF:b1:${MONTH}-09`,
        },
      ],
    };
    const ops = planBalanceEdit(book, MONTH, "BigEF:b1", 1500, TODAY);
    expect(ops.deleteTxnIds).toBeUndefined();
    expect(ops.updateTxns).toBeUndefined();
    expect(ops.setAssignments).toEqual([{ month: MONTH, categoryId: "BigEF:b1", amount: 1500 }]);
  });
});

describe("account planners", () => {
  it("debt balance edits upsert one adjustment and delete it at net zero", () => {
    let book: BudgetBook = {
      ...emptyBudgetBook(),
      accounts: [acct({ id: "debt:d1", kind: "loan", nodeId: "HighDebt" })],
      transactions: [
        { ...txn({ accountId: "debt:d1", date: "2026-01-05", amount: -4200 }), id: startingTxnId("debt:d1") },
      ],
    };
    book = apply(book, planDebtBalanceEdit(book, "debt:d1", 4000, TODAY));
    book = apply(book, planDebtBalanceEdit(book, "debt:d1", 3500, TODAY));
    const adjustments = book.transactions.filter((t) => t.id.startsWith("txn:adjust:"));
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount).toBe(700);
    expect(debtRows(book, "HighDebt")[0].outstanding).toBe(3500);

    book = apply(book, planDebtBalanceEdit(book, "debt:d1", 4200, TODAY));
    expect(book.transactions.filter((t) => t.id.startsWith("txn:adjust:"))).toHaveLength(0);
  });

  it("mark paid zeroes the account and derives paid", () => {
    let book: BudgetBook = {
      ...emptyBudgetBook(),
      accounts: [acct({ id: "debt:d1", kind: "loan", nodeId: "HighDebt" })],
      transactions: [
        { ...txn({ accountId: "debt:d1", date: "2026-01-05", amount: -4200 }), id: startingTxnId("debt:d1") },
      ],
    };
    book = apply(book, planMarkDebtPaid(book, "debt:d1", TODAY));
    const rows = debtRows(book, "HighDebt");
    expect(rows[0].paid).toBe(true);
    expect(rows[0].outstanding).toBe(0);
    expect(debtTotals(book, "HighDebt")).toEqual({ paid: 4200, total: 4200, allPaid: true, hasAny: true });
  });

  it("college balance edits create the tracking account on first use", () => {
    let book = emptyBudgetBook();
    book = apply(book, planCollegeBalanceEdit(book, 2500, TODAY));
    expect(book.accounts.map((a) => a.id)).toEqual([COLLEGE_ACCOUNT_ID]);
    expect(book.accounts[0].nodeId).toBe("College");
    expect(collegeBalance(book)).toBe(2500);
  });
});

describe("creation planners", () => {
  it("creates a linked category and its well-known group exactly once", () => {
    let book = emptyBudgetBook();
    const first = planCreateLinkedCategory(book, "Rent", "Apartment", { monthlyTarget: 1800 });
    book = apply(book, first.ops);
    expect(book.groups.map((g) => g.id)).toEqual(["g:bills"]);
    expect(book.categories[0]).toMatchObject({
      id: first.categoryId,
      groupId: "g:bills",
      name: "Apartment",
      monthlyTarget: 1800,
      nodeId: "Rent",
    });

    const second = planCreateLinkedCategory(book, "Food", "Groceries", { monthlyTarget: 600 });
    expect(second.ops.addGroups).toBeUndefined();
  });

  it("creates a debt account with its opening-balance transaction", () => {
    const book = emptyBudgetBook();
    const { ops, accountId } = planCreateDebtAccount(
      book,
      "HighDebt",
      { name: "Visa", balance: 4200, apr: 24.99, minPayment: 50 },
      TODAY,
    );
    const next = apply(book, ops);
    expect(next.accounts[0]).toMatchObject({ id: accountId, kind: "loan", apr: 24.99, nodeId: "HighDebt" });
    const start = next.transactions.find((t) => t.id === startingTxnId(accountId));
    expect(start?.amount).toBe(-4200);
    expect(debtRows(next, "HighDebt")[0]).toMatchObject({ principal: 4200, outstanding: 4200, paid: false });
  });
});
