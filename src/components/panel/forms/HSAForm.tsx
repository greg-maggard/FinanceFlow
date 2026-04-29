import { useStore } from "../../../state/store";
import { ProgressBar } from "../ProgressBar";

export function HSAForm() {
  const state = useStore();
  const data = (state.nodes.HSA.data as
    | {
        coverage: "self" | "family";
        ytdContribution: { value: number; source: "manual" };
        annualLimit: number;
      }
    | undefined) ?? {
    coverage: "self" as const,
    ytdContribution: { value: 0, source: "manual" as const },
    annualLimit: state.settings.hsaSelfLimit,
  };

  const updateCoverage = (coverage: "self" | "family") =>
    useStore.getState().patchNodeData("HSA", {
      coverage,
      annualLimit: coverage === "self" ? state.settings.hsaSelfLimit : state.settings.hsaFamilyLimit,
    });

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Coverage</span>
        <select
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.coverage}
          onChange={(e) => updateCoverage(e.target.value as "self" | "family")}
        >
          <option value="self">Self-only</option>
          <option value="family">Family</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">YTD contributions</span>
        <input
          type="number"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.ytdContribution.value}
          onChange={(e) =>
            useStore.getState().patchNodeData("HSA", {
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
            useStore.getState().patchNodeData("HSA", { annualLimit: Number(e.target.value) })
          }
        />
      </label>
      <ProgressBar value={data.ytdContribution.value} max={data.annualLimit} label="YTD vs limit" />
    </div>
  );
}
