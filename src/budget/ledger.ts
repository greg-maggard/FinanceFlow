import type { Account, AccountKind, BudgetBook, Cents, MonthKey, Txn } from "../state/schema";
import { RTA_CATEGORY_ID, cents, newId } from "../state/schema";

// Every amount here is already integer `Cents` (schema v4), so all arithmetic
// below is exact integer arithmetic. There is no rounding step: the old
// `toCents`/`fromCents` round-trips are gone, and with them the per-site
// discipline that used to be the only thing keeping float drift out.

/** Month bucket of a "YYYY-MM-DD" transaction date. */
export function monthOf(date: string): MonthKey {
  return date.slice(0, 7);
}

/** On-budget dollars are assignable; loan/tracking accounts only report. */
export function isOnBudget(kind: AccountKind): boolean {
  return kind === "checking" || kind === "savings" || kind === "cash" || kind === "credit";
}

/** Local "YYYY-MM-DD" for a date — the convention `Txn.date` uses. */
export function isoDay(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Build the two rows of a transfer of `amount` (a positive magnitude) from
 * one account to another. A category is meaningful only where money crosses
 * the budget boundary, so it lands on the on-budget row of an on/off pair
 * and is stripped entirely from same-side transfers.
 */
export function pairTransfer(
  accounts: Account[],
  args: { from: string; to: string; amount: Cents; date: string; payee?: string; categoryId?: string },
): [Txn, Txn] {
  const kindOf = (id: string): AccountKind =>
    accounts.find((a) => a.id === id)?.kind ?? "tracking";
  const fromOn = isOnBudget(kindOf(args.from));
  const toOn = isOnBudget(kindOf(args.to));
  const magnitude = cents(Math.abs(args.amount));
  const outId = newId();
  const inId = newId();
  const out: Txn = {
    id: outId,
    accountId: args.from,
    date: args.date,
    payee: args.payee,
    amount: cents(-magnitude),
    categoryId: fromOn && !toOn ? args.categoryId : undefined,
    transferAccountId: args.to,
    transferPairId: inId,
    source: "manual",
  };
  const inflow: Txn = {
    id: inId,
    accountId: args.to,
    date: args.date,
    payee: args.payee,
    amount: magnitude,
    categoryId: !fromOn && toOn ? args.categoryId : undefined,
    transferAccountId: args.from,
    transferPairId: outId,
    source: "manual",
  };
  return [out, inflow];
}

export function accountBalance(book: BudgetBook, accountId: string): Cents {
  let total = 0;
  for (const t of book.transactions) {
    if (t.accountId === accountId) total += t.amount;
  }
  return cents(total);
}

/** Every account's balance in one pass over `book.transactions`. */
export function accountBalances(book: BudgetBook): Map<string, Cents> {
  const balances = new Map<string, Cents>();
  for (const a of book.accounts) balances.set(a.id, cents(0));
  for (const t of book.transactions) {
    balances.set(t.accountId, cents((balances.get(t.accountId) ?? 0) + t.amount));
  }
  return balances;
}

export type CategoryMonth = {
  assigned: Cents;
  activity: Cents;
  available: Cents;
};

export type MonthSnapshot = {
  month: MonthKey;
  readyToAssign: Cents;
  categories: Record<string, CategoryMonth>;
};

/**
 * The envelope state for one month, derived live from the book — nothing here
 * is stored, so the numbers are current the moment a transaction or
 * assignment changes, with no refresh step and no cadence assumptions.
 *
 * Mechanics (YNAB-style zero-based):
 * - available = positive carryover from the prior month + assigned + activity.
 * - A month-end *negative* available does not follow the category: it resets
 *   to zero and debits the next month's Ready-to-Assign instead.
 * - Ready-to-Assign is cumulative *through the viewed month*: RTA inflows
 *   through this month, minus dollars assigned in this month and every month
 *   before it, minus overspending swept from earlier months. All three terms
 *   run through `month` and no further, so viewing a past month reports the
 *   number that month actually had. Dollars parked in future months are not
 *   subtracted here — see `assignedAfter`.
 */
export function snapshot(book: BudgetBook, month: MonthKey): MonthSnapshot {
  const onBudget = new Set(
    book.accounts.filter((a) => isOnBudget(a.kind)).map((a) => a.id),
  );

  // Per-month tables: category activity, RTA inflows.
  const activity = new Map<MonthKey, Map<string, number>>();
  const inflow = new Map<MonthKey, number>();
  const monthSet = new Set<MonthKey>([month, ...Object.keys(book.assignments)]);
  for (const t of book.transactions) {
    if (!onBudget.has(t.accountId)) continue;
    const m = monthOf(t.date);
    monthSet.add(m);
    if (t.categoryId === RTA_CATEGORY_ID) {
      inflow.set(m, (inflow.get(m) ?? 0) + t.amount);
    } else if (t.categoryId) {
      let table = activity.get(m);
      if (!table) activity.set(m, (table = new Map()));
      table.set(t.categoryId, (table.get(t.categoryId) ?? 0) + t.amount);
    }
  }

  let inflowToDate = 0;
  let sweptOverspend = 0;
  let assignedAll = 0;

  const carry = new Map<string, number>();
  let categories: Record<string, CategoryMonth> = {};

  for (const m of [...monthSet].sort()) {
    if (m > month) break;
    const assignedM = book.assignments[m] ?? {};
    const activityM = activity.get(m) ?? new Map<string, number>();
    const catIds = new Set([
      ...book.categories.map((c) => c.id),
      ...Object.keys(assignedM),
      ...activityM.keys(),
      ...carry.keys(),
    ]);

    const snap: Record<string, CategoryMonth> = {};
    let overspendM = 0;
    for (const id of catIds) {
      const assigned = assignedM[id] ?? 0;
      const activityId = activityM.get(id) ?? 0;
      const available = (carry.get(id) ?? 0) + assigned + activityId;
      snap[id] = {
        assigned: cents(assigned),
        activity: cents(activityId),
        available: cents(available),
      };
      if (available >= 0) {
        carry.set(id, available);
      } else {
        carry.set(id, 0);
        overspendM += -available;
      }
    }

    inflowToDate += inflow.get(m) ?? 0;
    for (const v of Object.values(assignedM)) assignedAll += v;
    if (m === month) categories = snap;
    else sweptOverspend += overspendM;
  }

  return {
    month,
    readyToAssign: cents(inflowToDate - assignedAll - sweptOverspend),
    categories,
  };
}

/**
 * Dollars assigned in months strictly after `month` — money already parked in
 * the future. Ready-to-Assign deliberately ignores it (it belongs to those
 * months, not this one), so surface it beside the RTA figure to keep
 * assigning-ahead visible rather than silently double-spendable.
 */
export function assignedAfter(book: BudgetBook, month: MonthKey): Cents {
  let total = 0;
  for (const [m, table] of Object.entries(book.assignments)) {
    if (m <= month) continue;
    for (const v of Object.values(table)) total += v;
  }
  return cents(total);
}

export type BookIntegrity = {
  onBudgetCash: Cents;
  sumAvailable: Cents;
  readyToAssign: Cents;
  unbudgetedSpending: Cents;
  drift: Cents;
};

/**
 * The conservation-of-money invariant, made machine-checkable.
 *
 * `snapshot()` builds each category's `available` from assignments plus
 * categorized activity, and Ready-to-Assign from inflows minus assignments
 * minus swept overspending — every term cumulative through the viewed month.
 * Summing those definitions across all
 * categories collapses to:
 *
 *   Sigma available + readyToAssign + unbudgetedSpending === Sigma on-budget
 *   cash through the viewed month
 *
 * where `unbudgetedSpending` is the on-budget money that never entered an
 * envelope (no `categoryId`, and not an RTA inflow), including the on-budget
 * leg of a transfer OUT of the budget — only on-budget-to-on-budget pairs
 * cancel in the cash total and are skipped. Every dollar in an on-budget
 * account is therefore accounted for exactly once, and any
 * non-zero `drift` is money the book conjured or destroyed — a bug, not a
 * rounding artifact: every amount is an integer number of cents, so a healthy
 * book reports exactly 0 rather than 1e-13.
 *
 * From v4 forward `unbudgetedSpending` is permanently 0 for on-budget spending:
 * `migrateV3` back-filled every categoryless on-budget non-transfer row onto
 * `cat:uncategorized`, and every write path materializes that envelope rather
 * than leaving a row uncategorized. What remains is the on-budget leg of a
 * transfer OUT of the budget, which is money genuinely leaving.
 */
export function bookIntegrity(book: BudgetBook, month: MonthKey): BookIntegrity {
  const onBudget = new Set(
    book.accounts.filter((a) => isOnBudget(a.kind)).map((a) => a.id),
  );

  let onBudgetCash = 0;
  let unbudgetedSpending = 0;
  for (const t of book.transactions) {
    if (!onBudget.has(t.accountId)) continue;
    // Every term of the identity is cumulative THROUGH the viewed month, so the
    // cash side must be too — a future-dated transaction is not yet in the book
    // the user is looking at.
    if (monthOf(t.date) > month) continue;
    onBudgetCash += t.amount;
    // Only an on-budget -> on-budget pair cancels inside `onBudgetCash`; skip
    // just that leg. An on-budget -> off-budget transfer really does leave the
    // budget, so it has to land somewhere in the identity.
    if (t.transferAccountId && onBudget.has(t.transferAccountId)) continue;
    if (t.categoryId) continue; // categorized (incl. RTA) money is already counted
    unbudgetedSpending += t.amount;
  }

  const snap = snapshot(book, month);
  let sumAvailable = 0;
  for (const c of Object.values(snap.categories)) sumAvailable += c.available;

  return {
    onBudgetCash: cents(onBudgetCash),
    sumAvailable: cents(sumAvailable),
    readyToAssign: snap.readyToAssign,
    unbudgetedSpending: cents(unbudgetedSpending),
    drift: cents(onBudgetCash - (sumAvailable + snap.readyToAssign + unbudgetedSpending)),
  };
}
