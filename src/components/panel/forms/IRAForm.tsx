import { useStore } from "../../../state/store";
import { ProgressBar } from "../ProgressBar";

export function IRAForm() {
  const state = useStore();
  const data = (state.nodes.IRA.data as
    | {
        type: "roth" | "traditional";
        ytdContribution: { value: number; source: "manual" };
        annualLimit: number;
      }
    | undefined) ?? {
    type: "roth" as const,
    ytdContribution: { value: 0, source: "manual" as const },
    annualLimit: state.settings.iraAnnualLimit,
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Account type</span>
        <select
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.type}
          onChange={(e) =>
            useStore.getState().patchNodeData("IRA", {
              type: e.target.value as "roth" | "traditional",
            })
          }
        >
          <option value="roth">Roth IRA</option>
          <option value="traditional">Traditional IRA</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">YTD contributions</span>
        <input
          type="number"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.ytdContribution.value}
          onChange={(e) =>
            useStore.getState().patchNodeData("IRA", {
              ytdContribution: { value: Number(e.target.value), source: "manual" },
            })
          }
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium">Annual limit</span>
        <input
          type="number"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.annualLimit}
          onChange={(e) =>
            useStore.getState().patchNodeData("IRA", { annualLimit: Number(e.target.value) })
          }
        />
      </label>
      <ProgressBar value={data.ytdContribution.value} max={data.annualLimit} label="YTD vs limit" />
    </div>
  );
}
