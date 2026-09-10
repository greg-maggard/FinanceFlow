import type {
  Account,
  BudgetBook,
  Category,
  CategoryGroup,
  Cents,
  MonthKey,
  NodeId,
  Txn,
} from "../state/schema";
import { cents, newId } from "../state/schema";
import type { MonthSnapshot } from "./ledger";
import { accountBalance, monthOf, snapshot } from "./ledger";
import { RECURRING } from "../theme/identity";

/**
 * The node ↔ ledger view layer: how each flowchart node reads its money from
 * the budget book, and pure "planners" that turn node edits into book
 * operations. Mirrors `Domain/NodeLedger.swift`; `NodeLedgerTests` pins the
 * two engines to the same numbers.
 *
 * Nothing here touches a store — planners return `BookOps`, applied
 * atomically by `store.applyBookOps`.
 */

export const GROUP_BILLS = "g:bills";
export const GROUP_EF = "g:ef";
export const GROUP_GOALS = "g:goals";

export const ADJUST_ACCOUNT_ID = "acct:adjust";
export const COLLEGE_ACCOUNT_ID = "acct:college";

/** One real-world fund, two flowchart milestones. */
export const EF_NODES: ReadonlySet<NodeId> = new Set<NodeId>(["SmallEF", "BigEF"]);

const GROUP_NAMES: Record<string, string> = {
  [GROUP_BILLS]: "Bills",
  [GROUP_EF]: "Emergency Fund",
  [GROUP_GOALS]: "Savings Goals",
};

export function groupForNode(nodeId: NodeId): string {
  if (RECURRING.has(nodeId)) return GROUP_BILLS;
  if (EF_NODES.has(nodeId)) return GROUP_EF;
  return GROUP_GOALS;
}

/** Deterministic id of an account's opening-balance transaction. */
export function startingTxnId(accountId: string): string {
  return `txn:start:${accountId}`;
}

/**
 * Deterministic id of a balance-adjustment transaction, keyed per target
 * (category or account) per day so keystroke-by-keystroke edits coalesce
 * into a single row instead of spawning one per digit.
 */
export function adjustmentTxnId(targetId: string, date: string): string {
  return `txn:adjust:${targetId}:${date}`;
}

// ---------------------------------------------------------------------------
// Reads

/** The month entry of an envelope the snapshot has never heard of. */
const ZERO_MONTH = { assigned: cents(0), activity: cents(0), available: cents(0) };

export function linkedCategories(book: BudgetBook, nodeId: NodeId): Category[] {
  return book.categories.filter((c) => c.nodeId === nodeId);
}

export function efCategories(book: BudgetBook): Category[] {
  return book.categories.filter((c) => c.nodeId !== undefined && EF_NODES.has(c.nodeId));
}

export function linkedAccounts(book: BudgetBook, nodeId: NodeId): Account[] {
  return book.accounts.filter((a) => a.nodeId === nodeId);
}

export type NodeRow = {
  category: Category;
  assigned: Cents;
  activity: Cents;
  available: Cents;
};

/** The node's envelopes joined with the month snapshot (EF nodes see the union). */
export function nodeRows(book: BudgetBook, snap: MonthSnapshot, nodeId: NodeId): NodeRow[] {
  const cats = EF_NODES.has(nodeId) ? efCategories(book) : linkedCategories(book, nodeId);
  return cats.map((category) => {
    const m = snap.categories[category.id] ?? ZERO_MONTH;
    return { category, assigned: m.assigned, activity: m.activity, available: m.available };
  });
}

/**
 * Recurring node: target = Σ monthly targets, funded = Σ what each envelope
 * actually held for the month, capped at that envelope's target.
 *
 * A bills node asks "is this month's bill covered?", and money that already
 * left the envelope paying that bill still counts. Since
 * `available = carryIn + assigned + activity`, the money that sat in the
 * envelope during the month is `available - activity` — which counts a
 * carried-over balance, so budgeting a month ahead (assign in July, spend in
 * August) no longer reads as unfunded. Clamped at zero so an envelope already
 * in the hole before the month started can't lend negative funding.
 *
 * The per-category `min(target, …)` matters because target and funded are both
 * summed across the node's categories: without it one over-stuffed envelope
 * would mask an empty sibling inside the same node.
 */
export function recurringTotals(
  book: BudgetBook,
  snap: MonthSnapshot,
  nodeId: NodeId,
): { target: Cents; funded: Cents } {
  let target = 0;
  let funded = 0;
  for (const row of nodeRows(book, snap, nodeId)) {
    const catTarget = row.category.monthlyTarget ?? 0;
    const held = Math.max(0, row.available - row.activity);
    target += catTarget;
    funded += Math.min(catTarget, held);
  }
  return { target: cents(target), funded: cents(funded) };
}

/** Emergency fund balance: Σ available over the SmallEF/BigEF union. */
export function efBalance(book: BudgetBook, snap: MonthSnapshot): Cents {
  let total = 0;
  for (const cat of efCategories(book)) {
    total += snap.categories[cat.id]?.available ?? 0;
  }
  return cents(total);
}

/**
 * EF target per milestone: SmallEF keeps the computed starter gate; BigEF's
 * bucket targets may grow the terminal goal beyond months × expenses but can
 * never shrink it.
 */
export function efTarget(book: BudgetBook, nodeId: "SmallEF" | "BigEF", computed: Cents): Cents {
  if (nodeId === "SmallEF") return computed;
  let buckets = 0;
  for (const cat of efCategories(book)) {
    buckets += cat.balanceTarget ?? 0;
  }
  return cents(Math.max(computed, buckets));
}

/** SavePurchase / Goals: saved = Σ available, target = Σ balance targets. */
export function purchaseTotals(
  book: BudgetBook,
  snap: MonthSnapshot,
  nodeId: "SavePurchase" | "Goals",
): { saved: Cents; target: Cents } {
  let saved = 0;
  let target = 0;
  for (const row of nodeRows(book, snap, nodeId)) {
    saved += row.available;
    target += row.category.balanceTarget ?? 0;
  }
  return { saved: cents(saved), target: cents(target) };
}

export type DebtRow = {
  account: Account;
  /** What's still owed (0 once cleared). */
  outstanding: Cents;
  /** Original principal, read from the account's starting transaction. */
  principal: Cents;
  paid: boolean;
};

/** The node's open (non-closed) linked debt accounts. */
export function debtRows(book: BudgetBook, nodeId: "HighDebt" | "ModDebt"): DebtRow[] {
  const accounts = linkedAccounts(book, nodeId).filter((a) => a.closed !== true);
  // Having no linked debt accounts is the common case, and `debtTotals` calls
  // this for both HighDebt and ModDebt on every node-graph render. Bail before
  // the scan below rather than walking the whole book to build an empty list.
  if (accounts.length === 0) return [];
  const wanted = new Set(accounts.map((a) => a.id));
  const balances = new Map<string, number>();
  const startingTxns = new Map<string, Txn>();
  for (const t of book.transactions) {
    if (!wanted.has(t.accountId)) continue;
    balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + t.amount);
    if (t.id === startingTxnId(t.accountId)) startingTxns.set(t.accountId, t);
  }
  return accounts.map((account) => {
    const balance = balances.get(account.id) ?? 0;
    const start = startingTxns.get(account.id);
    const outstanding = Math.max(0, -balance);
    const principal = start ? Math.max(0, -start.amount) : outstanding;
    return {
      account,
      outstanding: cents(outstanding),
      principal: cents(principal),
      paid: balance >= 0,
    };
  });
}

/**
 * Debt progress: continuous payoff bar. `paid` climbs as outstanding shrinks
 * against original principal; `allPaid` (every open account cleared) gates
 * readiness; no linked accounts at all means the list hasn't been set up yet.
 */
export function debtTotals(
  book: BudgetBook,
  nodeId: "HighDebt" | "ModDebt",
): { paid: Cents; total: Cents; allPaid: boolean; hasAny: boolean } {
  const rows = debtRows(book, nodeId);
  let total = 0;
  let outstanding = 0;
  for (const row of rows) {
    total += row.principal;
    outstanding += row.outstanding;
  }
  const paid = Math.min(Math.max(total - outstanding, 0), total);
  return {
    paid: cents(paid),
    total: cents(total),
    allPaid: rows.length > 0 && rows.every((r) => r.paid),
    hasAny: rows.length > 0,
  };
}

export function collegeBalance(book: BudgetBook): Cents {
  return accountBalance(book, COLLEGE_ACCOUNT_ID);
}

// ---------------------------------------------------------------------------
// Write planners

/** A batch of book operations, applied atomically by `store.applyBookOps`. */
export type BookOps = {
  addGroups?: CategoryGroup[];
  addAccounts?: Account[];
  updateAccounts?: Account[];
  addCategories?: Category[];
  updateCategories?: Category[];
  addTxns?: Txn[];
  updateTxns?: Txn[];
  deleteTxnIds?: string[];
  /** Absolute amounts, `store.assign` semantics (<= 0 clears). */
  setAssignments?: { month: MonthKey; categoryId: string; amount: Cents }[];
};

export function ensureGroup(book: BudgetBook, groupId: string): CategoryGroup | null {
  if (book.groups.some((g) => g.id === groupId)) return null;
  return { id: groupId, name: GROUP_NAMES[groupId] ?? groupId, order: book.groups.length };
}

export function ensureAdjustmentAccount(book: BudgetBook): Account | null {
  if (book.accounts.some((a) => a.id === ADJUST_ACCOUNT_ID)) return null;
  return { id: ADJUST_ACCOUNT_ID, name: "Adjustments", kind: "cash", source: "manual" };
}

export function ensureCollegeAccount(book: BudgetBook): Account | null {
  if (book.accounts.some((a) => a.id === COLLEGE_ACCOUNT_ID)) return null;
  return {
    id: COLLEGE_ACCOUNT_ID,
    name: "529 Plan",
    kind: "tracking",
    source: "manual",
    nodeId: "College",
  };
}

/**
 * The envelope's outstanding write-offs for a month, newest first.
 *
 * Total order is `(date DESC, id DESC)` and must be implemented identically
 * here and in `NodeLedger.swift`: the two engines have to unwind the SAME row
 * or a book that round-trips through export/import diverges between platforms.
 */
function outstandingAdjustments(book: BudgetBook, month: MonthKey, categoryId: string): Txn[] {
  return book.transactions
    .filter(
      (t) =>
        t.accountId === ADJUST_ACCOUNT_ID &&
        t.categoryId === categoryId &&
        monthOf(t.date) === month &&
        t.amount < 0,
    )
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.id !== b.id) return a.id < b.id ? 1 : -1;
      return 0;
    });
}

/**
 * Make an envelope's available equal `newAvailable`, expressed in honest
 * ledger operations. Raising first unwinds this month's outstanding
 * write-offs newest-first — correcting yesterday's typo today must give the
 * money back, not burn a second helping of Ready to Assign — and only the
 * residual assigns more this month (RTA may go negative — visible on the
 * Budget screen by design). Unwinding stops at the month boundary: a
 * prior-month write-off crosses the carry clamp, where the effect on this
 * month's available is no longer 1:1. Lowering un-assigns toward zero first;
 * whatever that can't express becomes ONE coalesced same-day "Balance
 * adjustment" transaction on the Adjustments account, keyed by deterministic
 * txn id so per-keystroke edits self-correct instead of compounding.
 */
export function planBalanceEdit(
  book: BudgetBook,
  month: MonthKey,
  categoryId: string,
  newAvailable: Cents,
  today: string,
): BookOps {
  const snap = snapshot(book, month);
  const entry = snap.categories[categoryId] ?? ZERO_MONTH;
  let delta = newAvailable - entry.available;
  if (delta === 0) return {};

  const ops: BookOps = {};
  const adjId = adjustmentTxnId(categoryId, today);
  const existingAdj = book.transactions.find((t) => t.id === adjId);
  const assigned = entry.assigned;

  if (delta > 0) {
    for (const adj of outstandingAdjustments(book, month, categoryId)) {
      if (delta <= 0) break;
      const unwind = Math.min(delta, -adj.amount);
      if (adj.amount + unwind === 0) (ops.deleteTxnIds ??= []).push(adj.id);
      else (ops.updateTxns ??= []).push({ ...adj, amount: cents(adj.amount + unwind) });
      delta -= unwind;
    }
    if (delta > 0) {
      ops.setAssignments = [{ month, categoryId, amount: cents(assigned + delta) }];
    }
    return ops;
  }

  const fromAssign = Math.min(-delta, assigned);
  if (fromAssign > 0) {
    ops.setAssignments = [{ month, categoryId, amount: cents(assigned - fromAssign) }];
  }
  const remainder = -delta - fromAssign;
  if (remainder > 0) {
    const account = ensureAdjustmentAccount(book);
    if (account) ops.addAccounts = [account];
    const base = existingAdj ? existingAdj.amount : 0;
    const txn: Txn = {
      id: adjId,
      accountId: ADJUST_ACCOUNT_ID,
      date: today,
      payee: "Balance adjustment",
      amount: cents(base - remainder),
      categoryId,
      source: "manual",
    };
    if (existingAdj) ops.updateTxns = [txn];
    else ops.addTxns = [txn];
  }
  return ops;
}

/** One targeted envelope the month's Ready to Assign could not fill. */
export type FundShortfall = {
  categoryId: string;
  name: string;
  /** Cents still needed to reach the monthly target. */
  short: Cents;
};

/**
 * What one tap of "Fund this month" would do — described as a *plan*, before
 * anything is applied. Every count here answers "what is about to happen",
 * which is what a confirmation dialog has to state out loud.
 */
export type FundMonthPlan = {
  ops: BookOps;
  /** Envelopes carrying a positive monthly target. */
  targeted: number;
  /** Of those, how many this plan actually moves money into. */
  funding: number;
  /** Cents this plan moves out of Ready to Assign — Σ of the ops' increases. */
  total: Cents;
  /** Envelopes the money ran out before filling, in book order. */
  underfunded: FundShortfall[];
  /** Σ of `underfunded[].short`. */
  shortfall: Cents;
};

/**
 * Fill this month's monthly targets from Ready to Assign, in one batch.
 *
 * Assignments are keyed per month, so a new month starts with every Assigned
 * field at zero — without this, funding ~15 envelopes is ~15 manual number
 * entries on the 1st of every month, forever.
 *
 * The need is measured against what the envelope HELD for the month —
 * `available - activity`, i.e. carryover + assigned — which is the same
 * quantity `recurringTotals` calls funded. One definition of "funded for month
 * M", used by both, so the Focus card and this button can never disagree:
 *
 * - Money carried in from last month already covers the target, so a
 *   month-ahead user is never asked to fund the same envelope twice.
 * - Spending *from* an envelope during the month does not re-open its need.
 *   This is a once-a-month contribution, not a refill-to-target that stays
 *   armed all month and quietly re-funds every dollar spent.
 * - An envelope overspent this month asks for its target and no more; the
 *   overspend is the sweep's business (a negative available never carries), not
 *   something to top up past target out of Ready to Assign.
 *
 * Categories are walked in the book's declared order — `book.categories` as
 * stored, which is a deterministic total order on both platforms — each taking
 * `min(need, what's left)`. Ready to Assign is the hard ceiling: it starts at
 * the month's figure (clamped at zero, since a book already overspent has
 * nothing to hand out) and this action can never drive it negative. Whatever
 * the money ran out before reaching is reported, not silently skipped.
 *
 * Idempotent for the rest of the month: once an envelope has held its target,
 * its need is 0 and it emits no op — running this again does nothing, whatever
 * has been spent since.
 *
 * `snap` is an optional precomputed `snapshot(book, month)` — callers that
 * already have one (BudgetScreen re-plans on every keystroke; see
 * w2-fund-month finding 8) can pass it through to skip a second full ledger
 * pass. Omitted, this computes it exactly as before.
 */
export function planFundMonth(
  book: BudgetBook,
  month: MonthKey,
  snap: MonthSnapshot = snapshot(book, month),
): FundMonthPlan {
  let remaining = Math.max(0, snap.readyToAssign);

  const setAssignments: { month: MonthKey; categoryId: string; amount: Cents }[] = [];
  const underfunded: FundShortfall[] = [];
  let targeted = 0;
  let shortfall = 0;
  let total = 0;

  for (const cat of book.categories) {
    const target = cat.monthlyTarget ?? 0;
    if (target <= 0) continue;
    targeted += 1;
    const m = snap.categories[cat.id] ?? ZERO_MONTH;
    // What the envelope held for the month: carryover + assigned. Carryover is
    // never negative (`snapshot` sweeps a month-end hole into Ready to Assign
    // instead of carrying it), so this is >= 0 and needs no clamp.
    const held = m.available - m.activity;
    const need = Math.max(0, target - held);
    if (need === 0) continue;
    const give = Math.min(need, remaining);
    if (give > 0) {
      setAssignments.push({ month, categoryId: cat.id, amount: cents(m.assigned + give) });
      remaining -= give;
      total += give;
    }
    if (give < need) {
      underfunded.push({ categoryId: cat.id, name: cat.name, short: cents(need - give) });
      shortfall += need - give;
    }
  }

  const ops: BookOps = {};
  if (setAssignments.length > 0) ops.setAssignments = setAssignments;
  return {
    ops,
    targeted,
    funding: setAssignments.length,
    total: cents(total),
    underfunded,
    shortfall: cents(shortfall),
  };
}

/** Drive an account's derived balance to `target` via a coalesced same-day adjustment. */
function planAccountBalanceTo(
  book: BudgetBook,
  accountId: string,
  targetBalance: Cents,
  today: string,
  memo?: string,
): BookOps {
  const delta = targetBalance - accountBalance(book, accountId);
  if (delta === 0) return {};
  const adjId = adjustmentTxnId(accountId, today);
  const existing = book.transactions.find((t) => t.id === adjId);
  const newAmount = (existing ? existing.amount : 0) + delta;
  if (existing && newAmount === 0) return { deleteTxnIds: [adjId] };
  const txn: Txn = {
    id: adjId,
    accountId,
    date: today,
    payee: "Balance adjustment",
    amount: cents(newAmount),
    memo,
    source: "manual",
  };
  return existing ? { updateTxns: [txn] } : { addTxns: [txn] };
}

/** Set what's owed on a debt account (its balance is the negative of that). */
export function planDebtBalanceEdit(
  book: BudgetBook,
  accountId: string,
  newOwed: Cents,
  today: string,
): BookOps {
  return planAccountBalanceTo(book, accountId, cents(-Math.abs(newOwed)), today);
}

export function planCollegeBalanceEdit(
  book: BudgetBook,
  newBalance: Cents,
  today: string,
): BookOps {
  const ops = planAccountBalanceTo(book, COLLEGE_ACCOUNT_ID, newBalance, today);
  const account = ensureCollegeAccount(book);
  if (account) ops.addAccounts = [account, ...(ops.addAccounts ?? [])];
  return ops;
}

export function planMarkDebtPaid(book: BudgetBook, accountId: string, today: string): BookOps {
  return planAccountBalanceTo(book, accountId, cents(0), today, "Marked paid");
}

/** Create an envelope linked to a node, ensuring its well-known group exists. */
export function planCreateLinkedCategory(
  book: BudgetBook,
  nodeId: NodeId,
  name: string,
  goal?: { monthlyTarget?: Cents; balanceTarget?: Cents; targetDate?: string },
): { ops: BookOps; categoryId: string } {
  const groupId = groupForNode(nodeId);
  const group = ensureGroup(book, groupId);
  const category: Category = {
    id: newId(),
    groupId,
    name,
    order: book.categories.length,
    monthlyTarget: goal?.monthlyTarget,
    balanceTarget: goal?.balanceTarget,
    targetDate: goal?.targetDate,
    nodeId,
  };
  const ops: BookOps = { addCategories: [category] };
  if (group) ops.addGroups = [group];
  return { ops, categoryId: category.id };
}

/** Create a debt account under a node, with its opening-balance transaction. */
export function planCreateDebtAccount(
  _book: BudgetBook,
  nodeId: "HighDebt" | "ModDebt",
  init: { name: string; balance: Cents; apr: number; minPayment: Cents },
  today: string,
): { ops: BookOps; accountId: string } {
  const account: Account = {
    id: newId(),
    name: init.name,
    kind: "loan",
    apr: init.apr,
    minPayment: init.minPayment,
    source: "manual",
    nodeId,
  };
  const ops: BookOps = { addAccounts: [account] };
  if (init.balance !== 0) {
    ops.addTxns = [
      {
        id: startingTxnId(account.id),
        accountId: account.id,
        date: today,
        payee: "Starting balance",
        amount: cents(-Math.abs(init.balance)),
        source: "manual",
      },
    ];
  }
  return { ops, accountId: account.id };
}
