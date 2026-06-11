import type { AppState, MonthKey, NodeId } from "../../state/schema";
import { bigEmergencyFundTarget, emergencyFundTarget } from "../../state/schema";
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

export type ProgressInfo =
  | { kind: "goal"; value: number; max: number; ready: boolean }
  | { kind: "streak"; months: number; checkedThisMonth: boolean }
  | { kind: "none"; ready: boolean };

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
    if (target > 0) {
      return { kind: "goal", value: funded, max: target, ready: funded >= target };
    }
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
      return { kind: "goal", value: balance, max: target, ready: balance >= target };
    }
    case "BigEF": {
      const months = (data?.targetMonths as number | undefined) ?? 3;
      const computed = bigEmergencyFundTarget(months, state.settings.monthlyExpenses);
      const balance = efBalance(state.budget, snap);
      const target = efTarget(state.budget, "BigEF", computed);
      return { kind: "goal", value: balance, max: target || 1, ready: target > 0 && balance >= target };
    }
    case "Match": {
      const matchPct = (data?.matchPct as number | undefined) ?? 0;
      const cur = (data?.currentContribPct as number | undefined) ?? 0;
      return { kind: "goal", value: cur, max: matchPct || 1, ready: matchPct > 0 && cur >= matchPct };
    }
    case "IRA": {
      const ytd = ((data?.ytdContribution as { value: number } | undefined)?.value ?? 0);
      const limit = ((data?.annualLimit as number | undefined) ?? state.settings.iraAnnualLimit);
      return { kind: "goal", value: ytd, max: limit, ready: ytd >= limit };
    }
    case "HSA": {
      const ytd = ((data?.ytdContribution as { value: number } | undefined)?.value ?? 0);
      const limit = ((data?.annualLimit as number | undefined) ?? state.settings.hsaSelfLimit);
      return { kind: "goal", value: ytd, max: limit, ready: ytd >= limit };
    }
    case "Increase401k": {
      const cur = (data?.currentPct as number | undefined) ?? 0;
      const target = (data?.targetPct as number | undefined) ?? 15;
      return { kind: "goal", value: cur, max: target, ready: cur >= target };
    }
    case "SavePurchase": {
      const { saved, target } = purchaseTotals(state.budget, snap, "SavePurchase");
      return { kind: "goal", value: saved, max: target || 1, ready: target > 0 && saved >= target };
    }
    case "HighDebt":
    case "ModDebt": {
      const { paid, total, allPaid, hasAny } = debtTotals(state.budget, id);
      if (!hasAny) return { kind: "none", ready: false };
      return { kind: "goal", value: paid, max: total || 1, ready: allPaid };
    }
    default:
      return { kind: "none", ready: true };
  }
}
