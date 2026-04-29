import { Handle, Position } from "@xyflow/react";
import type { Status } from "../../graph/derive";
import type { Phase } from "../../graph/flowchart";
import type { Decision } from "../../state/schema";

const PHASE_BG: Record<Phase, string> = {
  0: "#e8eaed",
  1: "#fde0e0",
  2: "#fef3c7",
  3: "#d4edda",
  4: "#d6ecff",
  5: "#b8d8f0",
  6: "#e8d5f0",
};
const PHASE_BORDER: Record<Phase, string> = {
  0: "#5f6368",
  1: "#d93025",
  2: "#f59e0b",
  3: "#28a745",
  4: "#5dade2",
  5: "#1f618d",
  6: "#7d3c98",
};

const STATUS_RING: Record<Status, string> = {
  done: "ring-2 ring-emerald-500",
  current: "ring-4 ring-blue-500 shadow-lg",
  upcoming: "ring-1 ring-slate-300",
  skipped: "opacity-40",
};

export type DecisionNodeData = {
  label: string;
  sublabel?: string;
  phase: Phase;
  status: Status;
  answer: Decision;
};

export function DecisionNode({ data }: { data: DecisionNodeData }) {
  return (
    <div
      className={`px-3 py-2 text-xs w-56 cursor-pointer transition-all ${STATUS_RING[data.status]}`}
      style={{
        background: PHASE_BG[data.phase],
        border: `2px solid ${PHASE_BORDER[data.phase]}`,
        clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        minHeight: "120px",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#555" }} />
      <div className="flex flex-col items-center justify-center text-center px-6 py-4 leading-tight">
        <div className="font-semibold">{data.label}</div>
        {data.sublabel && (
          <div className="text-[10px] italic text-slate-700 mt-0.5">{data.sublabel}</div>
        )}
        {data.answer && (
          <div className="mt-1 text-[10px] font-bold uppercase">
            {data.answer === "yes" ? "✓ Yes" : "✗ No"}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: "75%", background: "#10b981" }} />
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: "25%", background: "#ef4444" }} />
    </div>
  );
}
