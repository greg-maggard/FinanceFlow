import type { AppState, Cents, MonthKey, NodeId } from "../../state/schema";
import { bigEmergencyFundTarget, cents, emergencyFundTarget } from "../../state/schema";
import { RECURRING } from "../../theme/identity";
import { GRAPH_BY_ID } from "../../graph/flowchart";
import { snapshot } from "../../budget/ledger";
import { ymKey } from "../../state/recurring";
import {
  debtTotals,
  efBalance,
  efTarget,
  purchaseTotals,
  recurringTotals,
} from "../../budget/nodeLedger";

/**
 * What `value`/`max` on a goal are counted in. Most nodes measure money, but
 * Match and Increase401k measure percentage points of salary — before v4 both
 * were bare `number` and every display site guessed "money", which rendered a
 * 15% target as "$15". Now the unit travels with the numbers.
 */
export type ProgressUnit = "cents" | "percent";

export type ProgressInfo =
  | { kind: "goal"; unit: ProgressUnit; value: number; max: number; ready: boolean }
  | { kind: "streak"; months: number; checkedThisMonth: boolean }
  | { kind: "none"; ready: boolean };

/** A money goal: `value`/`max` are integer cents. */
const goalCents = (value: Cents, max: Cents, ready: boolean): ProgressInfo => ({
  kind: "goal",
  unit: "cents",
  value,
  max,
  ready,
});

/** A percentage-of-salary goal: `value`/`max` are percentage points. */
const goalPercent = (value: number, max: number, ready: boolean): ProgressInfo => ({
  kind: "goal",
  unit: "percent",
  value,
  max,
  ready,
});

/**
 * Compute progress for a node. Money-bearing nodes read the envelope ledger
 * (the same book the Budget screen shows — see `src/budget/nodeLedger.ts`);
 * the rest still read their node payloads. Mirrors `progressOf` in
 * `Domain/Progress.swift`.
 */
export function progressOf(state: AppState, id: NodeId, month: MonthKey = ymKey()): ProgressInfo {
  const node = GRAPH_BY_ID[id];
  if (node.kind === "decision") return { kind: "none", ready: false };

  const snap = snapshot(state.budget, month);

  if (RECURRING.has(id)) {
    const { target, funded } = recurringTotals(state.budget, snap, id);
    if (target > 0) return goalCents(funded, target, funded >= target);
    return { kind: "none", ready: true };
  }

  const data = state.nodes[id].data as Record<string, unknown> | undefined;

  switch (id) {
    case "Start":
      return { kind: "none", ready: true };
    case "SmallEF": {
      const computed = emergencyFundTarget(state.settings.monthlyExpenses);
      const balance = efBalance(state.budget, snap);
      const target = efTarget(state.budget, "SmallEF", computed);
      return goalCents(balance, target, balance >= target);
    }
    case "BigEF": {
      const months = (data?.targetMonths as number | undefined) ?? 3;
      const computed = bigEmergencyFundTarget(months, state.settings.monthlyExpenses);
      const balance = efBalance(state.budget, snap);
      const target = efTarget(state.budget, "BigEF", computed);
      return goalCents(balance, cents(target || 1), target > 0 && balance >= target);
    }
    case "Match": {
      const matchPct = (data?.matchPct as number | undefined) ?? 0;
      const cur = (data?.currentContribPct as number | undefined) ?? 0;
      return goalPercent(cur, matchPct || 1, matchPct > 0 && cur >= matchPct);
    }
    case "IRA": {
      const ytd = cents((data?.ytdContribution as { value: number } | undefined)?.value ?? 0);
      const limit = cents((data?.annualLimit as number | undefined) ?? state.settings.iraAnnualLimit);
      return goalCents(ytd, limit, ytd >= limit);
    }
    case "HSA": {
      const ytd = cents((data?.ytdContribution as { value: number } | undefined)?.value ?? 0);
      const limit = cents((data?.annualLimit as number | undefined) ?? state.settings.hsaSelfLimit);
      return goalCents(ytd, limit, ytd >= limit);
    }
    case "Increase401k": {
      const cur = (data?.currentPct as number | undefined) ?? 0;
      const target = (data?.targetPct as number | undefined) ?? 15;
      return goalPercent(cur, target, cur >= target);
    }
    case "SavePurchase": {
      const { saved, target } = purchaseTotals(state.budget, snap, "SavePurchase");
      return goalCents(saved, cents(target || 1), target > 0 && saved >= target);
    }
    case "HighDebt":
    case "ModDebt": {
      const { paid, total, allPaid, hasAny } = debtTotals(state.budget, id);
      if (!hasAny) return { kind: "none", ready: false };
      return goalCents(paid, cents(total || 1), allPaid);
    }
    default:
      return { kind: "none", ready: true };
  }
}
