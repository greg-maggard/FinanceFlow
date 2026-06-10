import type { AccountKind, BudgetBook, MonthKey } from "../state/schema";
import { RTA_CATEGORY_ID } from "../state/schema";

// All arithmetic happens in integer cents: every dollars-as-`number` operand
// is rounded to the cent exactly once on the way in, summed exactly, and
// converted back at the boundary — float drift can never accumulate.

export function toCents(n: number): number {
  return Math.round(n * 100);
}

export function fromCents(c: number): number {
  return c / 100;
}

/** Month bucket of a "YYYY-MM-DD" transaction date. */
export function monthOf(date: string): MonthKey {
  return date.slice(0, 7);
}

/** On-budget dollars are assignable; loan/tracking accounts only report. */
export function isOnBudget(kind: AccountKind): boolean {
  return kind === "checking" || kind === "savings" || kind === "cash" || kind === "credit";
}

export function accountBalance(book: BudgetBook, accountId: string): number {
  let cents = 0;
  for (const t of book.transactions) {
    if (t.accountId === accountId) cents += toCents(t.amount);
  }
  return fromCents(cents);
}

export type CategoryMonth = {
  assigned: number;
  activity: number;
  available: number;
};

export type MonthSnapshot = {
  month: MonthKey;
  readyToAssign: number;
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
 * - Ready-to-Assign = RTA inflows through this month, minus dollars assigned
 *   in ANY month (assigning ahead can't double-spend a dollar), minus
 *   overspending swept from earlier months.
 */
export function snapshot(book: BudgetBook, month: MonthKey): MonthSnapshot {
  const onBudget = new Set(
    book.accounts.filter((a) => isOnBudget(a.kind)).map((a) => a.id),
  );

  // Cents tables per month: category activity, RTA inflows.
  const activityC = new Map<MonthKey, Map<string, number>>();
  const inflowC = new Map<MonthKey, number>();
  const monthSet = new Set<MonthKey>([month, ...Object.keys(book.assignments)]);
  for (const t of book.transactions) {
    if (!onBudget.has(t.accountId)) continue;
    const m = monthOf(t.date);
    monthSet.add(m);
    if (t.categoryId === RTA_CATEGORY_ID) {
      inflowC.set(m, (inflowC.get(m) ?? 0) + toCents(t.amount));
    } else if (t.categoryId) {
      let table = activityC.get(m);
      if (!table) activityC.set(m, (table = new Map()));
      table.set(t.categoryId, (table.get(t.categoryId) ?? 0) + toCents(t.amount));
    }
  }

  let inflowToDateC = 0;
  let sweptOverspendC = 0;
  let assignedAllC = 0;
  for (const table of Object.values(book.assignments)) {
    for (const v of Object.values(table)) assignedAllC += toCents(v);
  }

  const carryC = new Map<string, number>();
  let categories: Record<string, CategoryMonth> = {};

  for (const m of [...monthSet].sort()) {
    if (m > month) break;
    const assignedM = book.assignments[m] ?? {};
    const activityM = activityC.get(m) ?? new Map<string, number>();
    const catIds = new Set([
      ...book.categories.map((c) => c.id),
      ...Object.keys(assignedM),
      ...activityM.keys(),
      ...carryC.keys(),
    ]);

    const snap: Record<string, CategoryMonth> = {};
    let overspendM = 0;
    for (const id of catIds) {
      const assigned = toCents(assignedM[id] ?? 0);
      const activity = activityM.get(id) ?? 0;
      const available = (carryC.get(id) ?? 0) + assigned + activity;
      snap[id] = {
        assigned: fromCents(assigned),
        activity: fromCents(activity),
        available: fromCents(available),
      };
      if (available >= 0) {
        carryC.set(id, available);
      } else {
        carryC.set(id, 0);
        overspendM += -available;
      }
    }

    inflowToDateC += inflowC.get(m) ?? 0;
    if (m === month) categories = snap;
    else sweptOverspendC += overspendM;
  }

  return {
    month,
    readyToAssign: fromCents(inflowToDateC - assignedAllC - sweptOverspendC),
    categories,
  };
}
