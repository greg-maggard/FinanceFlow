import { describe, expect, it } from "vitest";
import bookFixture from "../../fixtures/plaid/book.json";
import expectedOps from "../../fixtures/plaid/expected-ops.json";
import nightly from "../../fixtures/plaid/nightly-snapshot.json";
import type { Account, BudgetBook, Txn } from "../state/schema";
import {
  SYSTEM_GROUP_ID,
  UNCATEGORIZED_CATEGORY_ID,
  cents,
  emptyBudgetBook,
} from "../state/schema";
import { accountBalance, bookIntegrity } from "./ledger";
import type { BookOps } from "./nodeLedger";
import type { PlaidSnapshot, PlaidSnapshotTxn } from "./plaidImport";
import { planPlaidImport, plaidLocalTxnId } from "./plaidImport";

const MONTH = "2026-08";

/** Reference applier — the contract `store.applyBookOps` implements. */
function apply(book: BudgetBook, ops: BookOps): BudgetBook {
  const next: BudgetBook = JSON.parse(JSON.stringify(book));
  for (const g of ops.addGroups ?? []) next.groups.push(g);
  for (const a of ops.addAccounts ?? []) next.accounts.push(a);
  for (const c of ops.addCategories ?? []) next.categories.push(c);
  for (const t of ops.addTxns ?? []) next.transactions.push(t);
  return next;
}

function acct(id: string, plaidAccountId: string, kind: Account["kind"] = "checking"): Account {
  return { id, name: id, kind, source: "plaid", plaidAccountId };
}

function row(partial: Partial<PlaidSnapshotTxn>): PlaidSnapshotTxn {
  return {
    date: "2026-08-01",
    name: "MERCHANT",
    merchant_name: null,
    amount: 1,
    category: "GENERAL_MERCHANDISE",
    account_id: "plaid-chk",
    pending: false,
    ...partial,
  };
}

function snap(...transactions: PlaidSnapshotTxn[]): PlaidSnapshot {
  return { transactions };
}

/** A one-account book with a funded starting balance, ready to import into. */
function bookWith(...accounts: Account[]): BudgetBook {
  return { ...emptyBudgetBook(), accounts };
}

describe("planPlaidImport", () => {
  it("inverts Plaid's sign: a +4.50 coffee becomes a -4.50 transaction", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const plan = planPlaidImport(
      book,
      snap(row({ name: "COFFEE ROASTERS", merchant_name: "Coffee Roasters", amount: 4.5 })),
    );

    expect(plan.ops.addTxns).toHaveLength(1);
    const txn = plan.ops.addTxns![0];
    expect(txn.amount).toBe(-450);
    expect(txn.payee).toBe("Coffee Roasters");
    expect(txn.accountId).toBe("chk");
    expect(txn.source).toBe("plaid");
  });

  it("inverts the other direction too: a Plaid -2200 deposit becomes an inflow", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const plan = planPlaidImport(book, snap(row({ name: "PAYROLL", amount: -2200 })));

    expect(plan.ops.addTxns![0].amount).toBe(220000);
  });

  it("lands every row in Uncategorized rather than guessing from Plaid's taxonomy", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const plan = planPlaidImport(
      book,
      snap(
        row({ name: "GROCERIES", category: "FOOD_AND_DRINK", amount: 20 }),
        row({ name: "RENT", category: "RENT_AND_UTILITIES", amount: 1200 }),
      ),
    );

    for (const t of plan.ops.addTxns ?? []) {
      expect(t.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
    }
    // ...and the envelope it categorizes into is materialized by the same plan,
    // because `applyBookOps` applies ops verbatim.
    expect(plan.ops.addGroups).toEqual([
      { id: SYSTEM_GROUP_ID, name: "System", order: 999999 },
    ]);
    expect(plan.ops.addCategories).toEqual([
      {
        id: UNCATEGORIZED_CATEGORY_ID,
        groupId: SYSTEM_GROUP_ID,
        name: "Uncategorized",
        order: 999999,
      },
    ]);
  });

  it("does not re-materialize Uncategorized when the book already has it", () => {
    const book: BudgetBook = {
      ...bookWith(acct("chk", "plaid-chk")),
      groups: [{ id: SYSTEM_GROUP_ID, name: "System", order: 999999 }],
      categories: [
        {
          id: UNCATEGORIZED_CATEGORY_ID,
          groupId: SYSTEM_GROUP_ID,
          name: "Uncategorized",
          order: 999999,
        },
      ],
    };
    const plan = planPlaidImport(book, snap(row({})));

    expect(plan.ops.addGroups).toBeUndefined();
    expect(plan.ops.addCategories).toBeUndefined();
    expect(plan.ops.addTxns).toHaveLength(1);
  });

  it("excludes pending rows and counts them", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const plan = planPlaidImport(
      book,
      snap(
        row({ name: "POSTED", amount: 10 }),
        row({ name: "NOT YET", amount: 96.13, pending: true }),
        row({ name: "ALSO NOT YET", amount: 6.75, pending: true }),
      ),
    );

    expect(plan.skipped.pending).toBe(2);
    expect(plan.ops.addTxns).toHaveLength(1);
    expect(plan.ops.addTxns![0].payee).toBe("POSTED");
  });

  it("reports an unmapped account_id instead of dropping or guessing it", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const plan = planPlaidImport(
      book,
      snap(
        row({ account_id: "plaid-brokerage", name: "DIVIDEND", amount: -12.44 }),
        row({ account_id: "plaid-brokerage", name: "FEE", amount: 5 }),
        row({ account_id: "plaid-savings", name: "INTEREST", amount: -0.87 }),
        row({ name: "MAPPED", amount: 1 }),
      ),
    );

    // Reported once each, in first-appearance order; no transaction attached to
    // some other account to make the row "fit".
    expect(plan.skipped.unmappedAccounts).toEqual(["plaid-brokerage", "plaid-savings"]);
    expect(plan.ops.addTxns).toHaveLength(1);
    expect(plan.ops.addTxns![0].accountId).toBe("chk");
  });

  it("importing the same snapshot twice adds zero duplicate rows", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const snapshot = snap(
      row({ name: "COFFEE", merchant_name: "Coffee Roasters", amount: 4.5 }),
      row({ name: "UTILITIES", amount: 138.42, date: "2026-08-02" }),
    );

    const first = planPlaidImport(book, snapshot);
    const once = apply(book, first.ops);
    expect(once.transactions).toHaveLength(2);

    const second = planPlaidImport(once, snapshot);
    // A no-op is an EMPTY plan, not ops that happen to land on the same values.
    expect(second.ops).toEqual({});
    expect(second.skipped.duplicates).toBe(2);

    const twice = apply(once, second.ops);
    expect(twice.transactions).toHaveLength(2);
    expect(bookIntegrity(twice, MONTH).drift).toBe(0);
  });

  it("separates two genuinely identical purchases, and still dedupes them on re-import", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const coffee = row({ name: "COFFEE ROASTERS #22", merchant_name: "Coffee Roasters", amount: 4.5 });
    const snapshot = snap(coffee, { ...coffee });

    const first = planPlaidImport(book, snapshot);
    expect(first.ops.addTxns).toHaveLength(2);
    expect(first.ops.addTxns![0].plaidTxnId).not.toBe(first.ops.addTxns![1].plaidTxnId);

    const once = apply(book, first.ops);
    expect(planPlaidImport(once, snapshot).skipped.duplicates).toBe(2);
  });

  it("never emits two rows carrying the same id when the file repeats a transaction_id", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const dup = row({ transaction_id: "plaid-txn-abc", amount: 10 });
    const plan = planPlaidImport(book, snap(dup, { ...dup }));

    expect(plan.ops.addTxns).toHaveLength(1);
    expect(plan.skipped.duplicates).toBe(1);
  });

  it("prefers Plaid's own transaction_id, and derives the local id from it", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const plan = planPlaidImport(book, snap(row({ transaction_id: "plaid-txn-abc", amount: 10 })));

    expect(plan.ops.addTxns![0].plaidTxnId).toBe("plaid-txn-abc");
    expect(plan.ops.addTxns![0].id).toBe(plaidLocalTxnId("plaid-txn-abc"));
    expect(plan.ops.addTxns![0].id).toBe("txn:plaid:plaid-txn-abc");
  });

  it("dedupes against a row the OTHER platform imported (same plaidTxnId, any local id)", () => {
    const already: Txn = {
      id: "some-other-id",
      accountId: "chk",
      date: "2026-08-01",
      amount: cents(-1000),
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "plaid",
      plaidTxnId: "plaid-txn-abc",
    };
    const book: BudgetBook = { ...bookWith(acct("chk", "plaid-chk")), transactions: [already] };
    const plan = planPlaidImport(book, snap(row({ transaction_id: "plaid-txn-abc", amount: 10 })));

    expect(plan.ops).toEqual({});
    expect(plan.skipped.duplicates).toBe(1);
  });

  it("falls back to the raw name when Plaid has no merchant name", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    const plan = planPlaidImport(
      book,
      snap(row({ name: "PAYROLL DIRECT DEP", merchant_name: null, amount: -2200 })),
    );

    expect(plan.ops.addTxns![0].payee).toBe("PAYROLL DIRECT DEP");
  });

  it("survives a snapshot with no transactions and a row with nothing in it", () => {
    const book = bookWith(acct("chk", "plaid-chk"));
    expect(planPlaidImport(book, {}).ops).toEqual({});
    expect(planPlaidImport(book, { transactions: [] }).skipped.unmappedAccounts).toEqual([]);
    // A row with no account_id maps to nothing, and says so under "".
    expect(planPlaidImport(book, { transactions: [{}] }).skipped.unmappedAccounts).toEqual([""]);
  });

  it("keeps bookIntegrity().drift at 0 after import", () => {
    const book = bookWith(acct("chk", "plaid-chk"), acct("visa", "plaid-visa", "credit"));
    const plan = planPlaidImport(
      book,
      snap(
        row({ amount: 4.5 }),
        row({ amount: -2200 }),
        row({ account_id: "plaid-visa", amount: 62.3 }),
        row({ account_id: "plaid-visa", amount: -500 }),
      ),
    );

    expect(bookIntegrity(apply(book, plan.ops), MONTH).drift).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The cross-platform fixture: a real-shaped nightly snapshot, the book it
// imports into, and the ops it must produce — all committed. The identical
// assertions run in `PlaidImportTests.swift`. If both platforms turn the same
// committed bytes into the same ops, an import that diverges between them is
// impossible by construction.

describe("cross-platform Plaid import fixture", () => {
  const book = JSON.parse(JSON.stringify(bookFixture)) as BudgetBook;
  const snapshot = JSON.parse(JSON.stringify(nightly)) as PlaidSnapshot;

  /** Every op slot, so the golden also pins what the planner must NOT emit. */
  const canonical = (plan: ReturnType<typeof planPlaidImport>) =>
    JSON.parse(
      JSON.stringify({
        addGroups: plan.ops.addGroups ?? [],
        addAccounts: plan.ops.addAccounts ?? [],
        updateAccounts: plan.ops.updateAccounts ?? [],
        addCategories: plan.ops.addCategories ?? [],
        updateCategories: plan.ops.updateCategories ?? [],
        addTxns: plan.ops.addTxns ?? [],
        updateTxns: plan.ops.updateTxns ?? [],
        deleteTxnIds: plan.ops.deleteTxnIds ?? [],
        setAssignments: plan.ops.setAssignments ?? [],
        skipped: plan.skipped,
      }),
    );

  it("produces the committed ops, field for field", () => {
    expect(canonical(planPlaidImport(book, snapshot))).toEqual(
      JSON.parse(JSON.stringify(expectedOps)),
    );
  });

  it("adds zero rows the second time the same nightly file is imported", () => {
    const once = apply(book, planPlaidImport(book, snapshot).ops);
    expect(once.transactions).toHaveLength(book.transactions.length + 5);

    const second = planPlaidImport(once, snapshot);
    expect(second.ops).toEqual({});
    // The row already in the book counts once; the five just imported join it.
    expect(second.skipped.duplicates).toBe(6);
    expect(apply(once, second.ops).transactions).toHaveLength(once.transactions.length);
  });

  it("leaves every account's balance equal to the balance Plaid reported", () => {
    const once = apply(book, planPlaidImport(book, snapshot).ops);
    const plaidBalance = (plaidAccountId: string) =>
      snapshot.accounts!.find((a) => a.account_id === plaidAccountId)!.current_balance!;

    // Checking: Plaid's balance is the balance, and the local one matches only
    // if every sign was inverted correctly on the way in.
    expect(accountBalance(once, "acct-chk")).toBe(Math.round(plaidBalance("plaid-acct-chk") * 100));
    // Credit: Plaid reports what is OWED as a positive number, so the local
    // balance is its negative.
    expect(accountBalance(once, "acct-visa")).toBe(
      -Math.round(plaidBalance("plaid-acct-visa") * 100),
    );
  });

  it("leaves the imported book with zero drift", () => {
    const once = apply(book, planPlaidImport(book, snapshot).ops);
    expect(bookIntegrity(once, MONTH).drift).toBe(0);
  });
});
