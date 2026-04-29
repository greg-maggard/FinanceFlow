import { GRAPH_BY_ID, PHASE_LABELS } from "../../graph/flowchart";
import type { NodeId } from "../../state/schema";
import { useStore } from "../../state/store";
import { SmallEFForm } from "./forms/SmallEFForm";
import { BigEFForm } from "./forms/BigEFForm";
import { DebtForm } from "./forms/DebtForm";
import { MatchForm } from "./forms/MatchForm";
import { IRAForm } from "./forms/IRAForm";
import { HSAForm } from "./forms/HSAForm";
import {
  CollegeForm,
  GoalsForm,
  Increase401kForm,
  SavePurchaseForm,
} from "./forms/SimpleForms";

const FORMS: Partial<Record<NodeId, () => JSX.Element>> = {
  SmallEF: SmallEFForm,
  BigEF: BigEFForm,
  HighDebt: () => <DebtForm nodeId="HighDebt" aprThreshold={10} />,
  ModDebt: () => <DebtForm nodeId="ModDebt" aprThreshold={4} />,
  Match: MatchForm,
  IRA: IRAForm,
  HSA: HSAForm,
  SavePurchase: SavePurchaseForm,
  Increase401k: Increase401kForm,
  College: CollegeForm,
  Goals: GoalsForm,
};

export function NodePanel({ nodeId, onClose }: { nodeId: NodeId; onClose: () => void }) {
  const node = GRAPH_BY_ID[nodeId];
  const state = useStore();
  const nodeState = state.nodes[nodeId];
  const Form = FORMS[nodeId];

  return (
    <aside className="w-96 shrink-0 border-l border-slate-200 bg-white p-4 overflow-y-auto">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            {PHASE_LABELS[node.phase]}
          </div>
          <h2 className="text-base font-semibold leading-tight mt-0.5">{node.label}</h2>
          {node.sublabel && (
            <p className="text-xs italic text-slate-600 mt-1">{node.sublabel}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {node.kind === "task" ? (
        <label className="flex items-center gap-2 text-sm mb-4">
          <input
            type="checkbox"
            checked={nodeState.completed}
            onChange={() => useStore.getState().toggleComplete(nodeId)}
            className="h-4 w-4"
          />
          <span>Mark complete</span>
          {nodeState.completedAt && (
            <span className="text-[10px] text-slate-500 ml-auto">
              {new Date(nodeState.completedAt).toLocaleDateString()}
            </span>
          )}
        </label>
      ) : (
        <div className="mb-4">
          <div className="text-xs font-medium mb-1">Your answer</div>
          <div className="flex gap-2">
            {(["yes", "no", null] as const).map((opt) => {
              const current = state.decisions[node.decisionId!];
              const active = current === opt;
              const label = opt === null ? "—" : opt.toUpperCase();
              return (
                <button
                  key={String(opt)}
                  type="button"
                  onClick={() => useStore.getState().setDecision(node.decisionId!, opt)}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${
                    active
                      ? opt === "yes"
                        ? "bg-emerald-500 text-white border-emerald-600"
                        : opt === "no"
                          ? "bg-red-500 text-white border-red-600"
                          : "bg-slate-300 border-slate-400"
                      : "bg-white border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {Form && (
        <div className="mb-4 border-t border-slate-200 pt-3">
          <Form />
        </div>
      )}

      <div className="border-t border-slate-200 pt-3">
        <label className="block">
          <span className="text-xs font-medium">Notes</span>
          <textarea
            rows={4}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={nodeState.notes}
            onChange={(e) => useStore.getState().setNotes(nodeId, e.target.value)}
            placeholder="Anything you want to remember about this step…"
          />
        </label>
      </div>
    </aside>
  );
}
