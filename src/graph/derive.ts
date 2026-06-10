import type { AppState, NodeId, RecurringData } from "../state/schema";
import { RECURRING } from "../theme/identity";
import { GRAPH, GRAPH_BY_ID, type GraphNode } from "./flowchart";

export type Status = "done" | "current" | "upcoming" | "skipped";

export type DerivedStatus = Record<NodeId, Status>;

export function deriveStatus(state: AppState): DerivedStatus {
  const status: Partial<Record<NodeId, Status>> = {};
  const visited = new Set<NodeId>();
  let frontier: NodeId[] = [];
  let cur: NodeId | null = "Start";

  while (cur) {
    if (visited.has(cur)) {
      status[cur] = "current";
      frontier = [cur];
      break;
    }
    visited.add(cur);
    const node: GraphNode = GRAPH_BY_ID[cur];
    if (node.kind === "task") {
      if (!state.nodes[cur].completed) {
        status[cur] = "current";
        frontier = [cur];
        break;
      }
      status[cur] = "done";
      if (node.edges.length === 1) {
        cur = node.edges[0].to;
      } else if (node.edges.length === 0) {
        frontier = [];
        cur = null;
      } else {
        frontier = node.edges.map((e) => e.to);
        cur = null;
      }
    } else {
      const ans = state.decisions[node.decisionId!];
      if (ans === null) {
        status[cur] = "current";
        frontier = [cur];
        break;
      }
      status[cur] = "done";
      const branch = node.edges.find((e) => e.when === ans);
      if (branch) {
        cur = branch.to;
      } else {
        frontier = [];
        cur = null;
      }
    }
  }

  const reachable = new Set<NodeId>();
  const queue: NodeId[] = [...frontier];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const n: GraphNode = GRAPH_BY_ID[id];
    if (n.kind === "task") {
      n.edges.forEach((e) => queue.push(e.to));
    } else {
      const ans = state.decisions[n.decisionId!];
      if (ans === null) {
        n.edges.forEach((e) => queue.push(e.to));
      } else {
        const branch = n.edges.find((e) => e.when === ans);
        if (branch) queue.push(branch.to);
      }
    }
  }

  for (const node of GRAPH) {
    if (status[node.id]) continue;
    if (reachable.has(node.id)) {
      status[node.id] = state.nodes[node.id].completed ? "done" : "upcoming";
    } else {
      status[node.id] = "skipped";
    }
  }

  return status as DerivedStatus;
}

export function overallProgress(state: AppState): { done: number; total: number; pct: number } {
  const status = deriveStatus(state);
  let done = 0;
  let total = 0;
  for (const node of GRAPH) {
    if (status[node.id] === "skipped") continue;
    if (node.kind === "decision") continue;
    total += 1;
    if (state.nodes[node.id].completed) done += 1;
  }
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * The node's monthly goal/funded pair: sums of the item-level goals when the
 * budget is split into items, else the single top-level pair.
 * Mirrors `RecurringData.effectiveTarget/effectiveFunded` in FinanceFlowKit.
 */
export function recurringTotals(data: RecurringData | undefined): { target: number; funded: number } {
  const items = data?.items;
  if (items && items.length > 0) {
    return {
      target: items.reduce((s, it) => s + (it.target?.value ?? 0), 0),
      funded: items.reduce((s, it) => s + (it.funded?.value ?? 0), 0),
    };
  }
  return { target: data?.target?.value ?? 0, funded: data?.funded?.value ?? 0 };
}

export type BudgetSummary = { target: number; funded: number };

/**
 * Dollar-denominated rollup of the monthly budget across the seven recurring
 * nodes. Mirrors `Derive.monthlyBudgetSummary` in FinanceFlowKit.
 */
export function monthlyBudgetSummary(state: AppState): BudgetSummary {
  let target = 0;
  let funded = 0;
  for (const id of RECURRING) {
    const totals = recurringTotals(state.nodes[id]?.data as RecurringData | undefined);
    target += totals.target;
    funded += totals.funded;
  }
  return { target, funded };
}
