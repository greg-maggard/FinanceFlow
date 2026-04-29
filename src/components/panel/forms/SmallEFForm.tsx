import { useStore } from "../../../state/store";
import { emergencyFundTarget } from "../../../state/schema";
import { ProgressBar } from "../ProgressBar";

export function SmallEFForm() {
  const state = useStore();
  const data = (state.nodes.SmallEF.data as { balance: { value: number; source: "manual" } } | undefined) ?? {
    balance: { value: 0, source: "manual" as const },
  };
  const target = emergencyFundTarget(state.settings.monthlyExpenses);
  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-600">
        Target: <strong>${target.toLocaleString()}</strong> (max of $1,000 and 1 month expenses)
      </div>
      <label className="block">
        <span className="text-xs font-medium">Current balance</span>
        <input
          type="number"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.balance.value}
          onChange={(e) =>
            useStore.getState().setNodeData("SmallEF", {
              balance: { value: Number(e.target.value), source: "manual" },
            })
          }
        />
      </label>
      <ProgressBar value={data.balance.value} max={target} label="Progress" />
    </div>
  );
}
