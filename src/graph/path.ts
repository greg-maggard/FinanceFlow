import type { AppState, NodeId } from "../state/schema";
import { GRAPH, GRAPH_BY_ID, type GraphNode } from "./flowchart";

export function linearPath(state: Pick<AppState, "decisions">): NodeId[] {
  const out: NodeId[] = [];
  const visited = new Set<NodeId>();
  let cur: NodeId | null = "Start";
  while (cur) {
    if (visited.has(cur)) break;
    visited.add(cur);
    out.push(cur);
    const node: GraphNode = GRAPH_BY_ID[cur];
    if (node.kind === "decision") {
      const ans = state.decisions[node.decisionId!];
      if (ans) {
        cur = node.edges.find((e) => e.when === ans)?.to ?? null;
      } else {
        cur = node.edges.find((e) => e.when === "yes")?.to ?? node.edges[0]?.to ?? null;
      }
    } else {
      cur = node.edges[0]?.to ?? null;
    }
  }
  return out;
}

export function neighbors(
  state: Pick<AppState, "decisions">,
  id: NodeId,
): { prev: NodeId | null; next: NodeId | null } {
  const path = linearPath(state);
  const idx = path.indexOf(id);
  if (idx >= 0) {
    return {
      prev: idx > 0 ? path[idx - 1] : null,
      next: idx < path.length - 1 ? path[idx + 1] : null,
    };
  }

  // Off-path fallback: graph topology only
  const node: GraphNode = GRAPH_BY_ID[id];
  let next: NodeId | null = null;
  if (node.kind === "decision") {
    const ans = state.decisions[node.decisionId!];
    next = node.edges.find((e) => e.when === (ans ?? "yes"))?.to ?? node.edges[0]?.to ?? null;
  } else {
    next = node.edges[0]?.to ?? null;
  }
  let prev: NodeId | null = null;
  for (const n of GRAPH) {
    if (n.edges.some((e) => e.to === id)) {
      prev = n.id;
      break;
    }
  }
  return { prev, next };
}
