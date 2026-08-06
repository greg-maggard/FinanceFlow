import type {
  Account,
  BudgetBook,
  Category,
  CategoryGroup,
  MonthKey,
  NodeId,
  Txn,
} from "../state/schema";
import { newId } from "../state/schema";
import type { MonthSnapshot } from "./ledger";
import { accountBalance, fromCents, monthOf, snapshot, toCents } from "./ledger";
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
  assigned: number;
  activity: number;
  available: number;
};

/** The node's envelopes joined with the month snapshot (EF nodes see the union). */
export function nodeRows(book: BudgetBook, snap: MonthSnapshot, nodeId: NodeId): NodeRow[] {
  const cats = EF_NODES.has(nodeId) ? efCategories(book) : linkedCategories(book, nodeId);
  return cats.map((category) => {
    const m = snap.categories[category.id] ?? { assigned: 0, activity: 0, available: 0 };
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
): { target: number; funded: number } {
  let targetC = 0;
  let fundedC = 0;
  for (const row of nodeRows(book, snap, nodeId)) {
    const catTargetC = toCents(row.category.monthlyTarget ?? 0);
    const heldC = Math.max(0, toCents(row.available) - toCents(row.activity));
    targetC += catTargetC;
    fundedC += Math.min(catTargetC, heldC);
  }
  return { target: fromCents(targetC), funded: fromCents(fundedC) };
}

/** Emergency fund balance: Σ available over the SmallEF/BigEF union. */
export function efBalance(book: BudgetBook, snap: MonthSnapshot): number {
  let c = 0;
  for (const cat of efCategories(book)) {
    c += toCents(snap.categories[cat.id]?.available ?? 0);
  }
  return fromCents(c);
}

/**
 * EF target per milestone: SmallEF keeps the computed starter gate; BigEF's
 * bucket targets may grow the terminal goal beyond months × expenses but can
 * never shrink it.
 */
export function efTarget(book: BudgetBook, nodeId: "SmallEF" | "BigEF", computed: number): number {
  if (nodeId === "SmallEF") return computed;
  let bucketsC = 0;
  for (const cat of efCategories(book)) {
    bucketsC += toCents(cat.balanceTarget ?? 0);
  }
  return Math.max(computed, fromCents(bucketsC));
}

/** SavePurchase / Goals: saved = Σ available, target = Σ balance targets. */
export function purchaseTotals(
  book: BudgetBook,
  snap: MonthSnapshot,
  nodeId: "SavePurchase" | "Goals",
): { saved: number; target: number } {
  let savedC = 0;
  let targetC = 0;
  for (const row of nodeRows(book, snap, nodeId)) {
    savedC += toCents(row.available);
    targetC += toCents(row.category.balanceTarget ?? 0);
  }
  return { saved: fromCents(savedC), target: fromCents(targetC) };
}

export type DebtRow = {
  account: Account;
  /** What's still owed (0 once cleared). */
  outstanding: number;
  /** Original principal, read from the account's starting transaction. */
  principal: number;
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
  const balancesC = new Map<string, number>();
  const startingTxns = new Map<string, Txn>();
  for (const t of book.transactions) {
    if (!wanted.has(t.accountId)) continue;
    balancesC.set(t.accountId, (balancesC.get(t.accountId) ?? 0) + toCents(t.amount));
    if (t.id === startingTxnId(t.accountId)) startingTxns.set(t.accountId, t);
  }
  return accounts.map((account) => {
    const balanceC = balancesC.get(account.id) ?? 0;
    const start = startingTxns.get(account.id);
    const outstandingC = Math.max(0, -balanceC);
    const principalC = start ? Math.max(0, -toCents(start.amount)) : outstandingC;
    return {
      account,
      outstanding: fromCents(outstandingC),
      principal: fromCents(principalC),
      paid: balanceC >= 0,
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
): { paid: number; total: number; allPaid: boolean; hasAny: boolean } {
  const rows = debtRows(book, nodeId);
  let totalC = 0;
  let outstandingC = 0;
  for (const row of rows) {
    totalC += toCents(row.principal);
    outstandingC += toCents(row.outstanding);
  }
  const paidC = Math.min(Math.max(totalC - outstandingC, 0), totalC);
  return {
    paid: fromCents(paidC),
    total: fromCents(totalC),
    allPaid: rows.length > 0 && rows.every((r) => r.paid),
    hasAny: rows.length > 0,
  };
}

export function collegeBalance(book: BudgetBook): number {
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
  setAssignments?: { month: MonthKey; categoryId: string; amount: number }[];
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
        toCents(t.amount) < 0,
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
  newAvailable: number,
  today: string,
): BookOps {
  const snap = snapshot(book, month);
  const entry = snap.categories[categoryId] ?? { assigned: 0, activity: 0, available: 0 };
  let deltaC = toCents(newAvailable) - toCents(entry.available);
  if (deltaC === 0) return {};

  const ops: BookOps = {};
  const adjId = adjustmentTxnId(categoryId, today);
  const existingAdj = book.transactions.find((t) => t.id === adjId);
  const assignedC = toCents(entry.assigned);

  if (deltaC > 0) {
    for (const adj of outstandingAdjustments(book, month, categoryId)) {
      if (deltaC <= 0) break;
      const adjC = toCents(adj.amount);
      const unwindC = Math.min(deltaC, -adjC);
      if (adjC + unwindC === 0) (ops.deleteTxnIds ??= []).push(adj.id);
      else (ops.updateTxns ??= []).push({ ...adj, amount: fromCents(adjC + unwindC) });
      deltaC -= unwindC;
    }
    if (deltaC > 0) {
      ops.setAssignments = [{ month, categoryId, amount: fromCents(assignedC + deltaC) }];
    }
    return ops;
  }

  const fromAssignC = Math.min(-deltaC, assignedC);
  if (fromAssignC > 0) {
    ops.setAssignments = [{ month, categoryId, amount: fromCents(assignedC - fromAssignC) }];
  }
  const remainderC = -deltaC - fromAssignC;
  if (remainderC > 0) {
    const account = ensureAdjustmentAccount(book);
    if (account) ops.addAccounts = [account];
    const baseC = existingAdj ? toCents(existingAdj.amount) : 0;
    const txn: Txn = {
      id: adjId,
      accountId: ADJUST_ACCOUNT_ID,
      date: today,
      payee: "Balance adjustment",
      amount: fromCents(baseC - remainderC),
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
  /** Dollars still needed to reach the monthly target. */
  short: number;
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
  /** Dollars this plan moves out of Ready to Assign — Σ of the ops' increases. */
  total: number;
  /** Envelopes the money ran out before filling, in book order. */
  underfunded: FundShortfall[];
  /** Σ of `underfunded[].short`. */
  shortfall: number;
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
  let remainingC = Math.max(0, toCents(snap.readyToAssign));

  const setAssignments: { month: MonthKey; categoryId: string; amount: number }[] = [];
  const underfunded: FundShortfall[] = [];
  let targeted = 0;
  let shortfallC = 0;
  let totalC = 0;

  for (const cat of book.categories) {
    const targetC = toCents(cat.monthlyTarget ?? 0);
    if (targetC <= 0) continue;
    targeted += 1;
    const m = snap.categories[cat.id] ?? { assigned: 0, activity: 0, available: 0 };
    // What the envelope held for the month: carryover + assigned. Carryover is
    // never negative (`snapshot` sweeps a month-end hole into Ready to Assign
    // instead of carrying it), so this is >= 0 and needs no clamp.
    const heldC = toCents(m.available) - toCents(m.activity);
    const needC = Math.max(0, targetC - heldC);
    if (needC === 0) continue;
    const giveC = Math.min(needC, remainingC);
    if (giveC > 0) {
      setAssignments.push({
        month,
        categoryId: cat.id,
        amount: fromCents(toCents(m.assigned) + giveC),
      });
      remainingC -= giveC;
      totalC += giveC;
    }
    if (giveC < needC) {
      underfunded.push({ categoryId: cat.id, name: cat.name, short: fromCents(needC - giveC) });
      shortfallC += needC - giveC;
    }
  }

  const ops: BookOps = {};
  if (setAssignments.length > 0) ops.setAssignments = setAssignments;
  return {
    ops,
    targeted,
    funding: setAssignments.length,
    total: fromCents(totalC),
    underfunded,
    shortfall: fromCents(shortfallC),
  };
}

/** Drive an account's derived balance to `target` via a coalesced same-day adjustment. */
function planAccountBalanceTo(
  book: BudgetBook,
  accountId: string,
  targetBalance: number,
  today: string,
  memo?: string,
): BookOps {
  const deltaC = toCents(targetBalance) - toCents(accountBalance(book, accountId));
  if (deltaC === 0) return {};
  const adjId = adjustmentTxnId(accountId, today);
  const existing = book.transactions.find((t) => t.id === adjId);
  const newAmountC = (existing ? toCents(existing.amount) : 0) + deltaC;
  if (existing && newAmountC === 0) return { deleteTxnIds: [adjId] };
  const txn: Txn = {
    id: adjId,
    accountId,
    date: today,
    payee: "Balance adjustment",
    amount: fromCents(newAmountC),
    memo,
    source: "manual",
  };
  return existing ? { updateTxns: [txn] } : { addTxns: [txn] };
}

/** Set what's owed on a debt account (its balance is the negative of that). */
export function planDebtBalanceEdit(
  book: BudgetBook,
  accountId: string,
  newOwed: number,
  today: string,
): BookOps {
  return planAccountBalanceTo(book, accountId, -Math.abs(newOwed), today);
}

export function planCollegeBalanceEdit(
  book: BudgetBook,
  newBalance: number,
  today: string,
): BookOps {
  const ops = planAccountBalanceTo(book, COLLEGE_ACCOUNT_ID, newBalance, today);
  const account = ensureCollegeAccount(book);
  if (account) ops.addAccounts = [account, ...(ops.addAccounts ?? [])];
  return ops;
}

export function planMarkDebtPaid(book: BudgetBook, accountId: string, today: string): BookOps {
  return planAccountBalanceTo(book, accountId, 0, today, "Marked paid");
}

/** Create an envelope linked to a node, ensuring its well-known group exists. */
export function planCreateLinkedCategory(
  book: BudgetBook,
  nodeId: NodeId,
  name: string,
  goal?: { monthlyTarget?: number; balanceTarget?: number; targetDate?: string },
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
  init: { name: string; balance: number; apr: number; minPayment: number },
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
        amount: -Math.abs(init.balance),
        source: "manual",
      },
    ];
  }
  return { ops, accountId: account.id };
}
