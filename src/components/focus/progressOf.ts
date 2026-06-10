import type { AppState, NodeId, RecurringData } from "../../state/schema";
import { bigEmergencyFundTarget, emergencyFundTarget } from "../../state/schema";
import { RECURRING } from "../../theme/identity";
import { GRAPH_BY_ID } from "../../graph/flowchart";
import { recurringTotals } from "../../graph/derive";

export type ProgressInfo =
  | { kind: "goal"; value: number; max: number; ready: boolean }
  | { kind: "streak"; months: number; checkedThisMonth: boolean }
  | { kind: "none"; ready: boolean };

export function progressOf(state: AppState, id: NodeId): ProgressInfo {
  const node = GRAPH_BY_ID[id];
  if (node.kind === "decision") return { kind: "none", ready: false };
  if (RECURRING.has(id)) {
    const { target, funded } = recurringTotals(
      state.nodes[id].data as RecurringData | undefined,
    );
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
      const balance =
        ((data?.balance as { value: number } | undefined)?.value ?? 0);
      const target = emergencyFundTarget(state.settings.monthlyExpenses);
      return { kind: "goal", value: balance, max: target, ready: balance >= target };
    }
    case "BigEF": {
      const months = (data?.targetMonths as number | undefined) ?? 3;
      const balance = ((data?.balance as { value: number } | undefined)?.value ?? 0);
      const target = bigEmergencyFundTarget(months, state.settings.monthlyExpenses);
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
      const saved = ((data?.saved as { value: number } | undefined)?.value ?? 0);
      const target = (data?.target as number | undefined) ?? 0;
      return { kind: "goal", value: saved, max: target || 1, ready: target > 0 && saved >= target };
    }
    case "HighDebt":
    case "ModDebt": {
      const debts =
        (data?.debts as { balance: number; paid: boolean }[] | undefined) ?? [];
      if (debts.length === 0) return { kind: "none", ready: false };
      const total = debts.reduce((s, d) => s + d.balance, 0);
      const paidAmt = debts.filter((d) => d.paid).reduce((s, d) => s + d.balance, 0);
      const allPaid = debts.every((d) => d.paid);
      return { kind: "goal", value: paidAmt, max: total || 1, ready: allPaid };
    }
    default:
      return { kind: "none", ready: true };
  }
}
