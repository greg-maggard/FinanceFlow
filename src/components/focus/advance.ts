import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { deriveStatus } from "../../graph/derive";
import { GRAPH } from "../../graph/flowchart";
import type { NodeId } from "../../state/schema";
import { MEDALS } from "../../theme/identity";

export function findCurrentNode(): NodeId {
  const status = deriveStatus(useStore.getState());
  for (const node of GRAPH) {
    if (status[node.id] === "current") return node.id;
  }
  return "Start";
}

export function advanceFromCurrent(): void {
  const next = findCurrentNode();
  useUI.getState().setFocus(next, "forward");
  checkPhaseCompletion();
}

function checkPhaseCompletion() {
  const state = useStore.getState();
  const status = deriveStatus(state);
  const earned = state.earnedMedals ?? [];
  for (let phase = 0; phase <= 6; phase++) {
    if (earned.includes(phase)) continue;
    if (!(phase in MEDALS)) continue;
    const tasks = GRAPH.filter((n) => n.phase === phase && n.kind === "task");
    const reachable = tasks.filter((n) => status[n.id] !== "skipped");
    if (reachable.length === 0) continue;
    const allDone = reachable.every((n) => state.nodes[n.id].completed);
    if (allDone) {
      useStore.setState({ earnedMedals: [...earned, phase] });
      useUI.getState().triggerMedal(phase);
      return;
    }
  }
}
