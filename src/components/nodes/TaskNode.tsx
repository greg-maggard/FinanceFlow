import { Handle, Position } from "@xyflow/react";
import type { Status } from "../../graph/derive";
import type { Phase } from "../../graph/flowchart";

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

export type TaskNodeData = {
  label: string;
  sublabel?: string;
  phase: Phase;
  status: Status;
  completed: boolean;
};

export function TaskNode({ data }: { data: TaskNodeData }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs w-56 cursor-pointer transition-all ${STATUS_RING[data.status]}`}
      style={{
        background: PHASE_BG[data.phase],
        border: `2px solid ${PHASE_BORDER[data.phase]}`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#555" }} />
      <div className="flex items-start gap-2">
        <div
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border ${
            data.completed
              ? "bg-emerald-500 border-emerald-600"
              : "bg-white border-slate-400"
          }`}
        >
          {data.completed && (
            <svg viewBox="0 0 12 12" className="h-full w-full text-white">
              <path d="M2 6 L5 9 L10 3" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          )}
        </div>
        <div className="leading-tight">
          <div className="font-semibold">{data.label}</div>
          {data.sublabel && (
            <div className="text-[10px] italic text-slate-700 mt-0.5">{data.sublabel}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "#555" }} />
    </div>
  );
}
