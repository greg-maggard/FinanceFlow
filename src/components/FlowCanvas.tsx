import { useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import { GRAPH } from "../graph/flowchart";
import { POSITIONS } from "../graph/layout";
import { deriveStatus } from "../graph/derive";
import { useStore } from "../state/store";
import { TaskNode } from "./nodes/TaskNode";
import { DecisionNode } from "./nodes/DecisionNode";

const NODE_TYPES = {
  task: TaskNode,
  decision: DecisionNode,
};

export function FlowCanvas({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const state = useStore();
  const status = useMemo(() => deriveStatus(state), [state]);

  const nodes: RFNode[] = useMemo(
    () =>
      GRAPH.map((n) => ({
        id: n.id,
        type: n.kind,
        position: POSITIONS[n.id],
        data:
          n.kind === "task"
            ? {
                label: n.label,
                sublabel: n.sublabel,
                phase: n.phase,
                status: status[n.id],
                completed: state.nodes[n.id].completed,
              }
            : {
                label: n.label,
                sublabel: n.sublabel,
                phase: n.phase,
                status: status[n.id],
                answer: state.decisions[n.decisionId!],
              },
        selected: selectedId === n.id,
      })),
    [state, status, selectedId],
  );

  const edges: RFEdge[] = useMemo(() => {
    const list: RFEdge[] = [];
    for (const n of GRAPH) {
      for (const e of n.edges) {
        const isSkipped = status[e.to] === "skipped" || status[n.id] === "skipped";
        list.push({
          id: `${n.id}-${e.to}-${e.when ?? "x"}`,
          source: n.id,
          target: e.to,
          sourceHandle: e.when ?? undefined,
          label: e.when?.toUpperCase(),
          style: {
            stroke: isSkipped ? "#cbd5e1" : e.when === "no" ? "#ef4444" : e.when === "yes" ? "#10b981" : "#64748b",
            strokeWidth: 2,
            opacity: isSkipped ? 0.4 : 1,
          },
          labelStyle: { fontSize: 10, fontWeight: 600 },
          animated: status[e.to] === "current",
        });
      }
    }
    return list;
  }, [status]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, n) => onSelect(n.id)}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
