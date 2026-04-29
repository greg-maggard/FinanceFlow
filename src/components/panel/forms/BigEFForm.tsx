import { useStore } from "../../../state/store";
import { bigEmergencyFundTarget } from "../../../state/schema";
import { ProgressBar } from "../ProgressBar";

export function BigEFForm() {
  const state = useStore();
  const data = (state.nodes.BigEF.data as
    | { targetMonths: 3 | 4 | 5 | 6; balance: { value: number; source: "manual" } }
    | undefined) ?? { targetMonths: 3, balance: { value: 0, source: "manual" as const } };
  const target = bigEmergencyFundTarget(data.targetMonths, state.settings.monthlyExpenses);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Target months of expenses</span>
        <select
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.targetMonths}
          onChange={(e) =>
            useStore.getState().patchNodeData("BigEF", {
              targetMonths: Number(e.target.value) as 3 | 4 | 5 | 6,
            })
          }
        >
          <option value={3}>3 months</option>
          <option value={4}>4 months</option>
          <option value={5}>5 months</option>
          <option value={6}>6 months</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">Current balance</span>
        <input
          type="number"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.balance.value}
          onChange={(e) =>
            useStore.getState().patchNodeData("BigEF", {
              balance: { value: Number(e.target.value), source: "manual" },
            })
          }
        />
      </label>
      {target > 0 ? (
        <ProgressBar value={data.balance.value} max={target} label={`Target (${data.targetMonths}mo)`} />
      ) : (
        <div className="text-xs italic text-slate-500">Set monthly expenses in Settings to see target.</div>
      )}
    </div>
  );
}
