import { useStore } from "../../../state/store";

export function MatchForm() {
  const state = useStore();
  const data = (state.nodes.Match.data as { matchPct: number; currentContribPct: number } | undefined) ?? {
    matchPct: 0,
    currentContribPct: 0,
  };
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Employer match cap (% of salary)</span>
        <input
          type="number"
          step="0.5"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.matchPct}
          onChange={(e) =>
            useStore.getState().patchNodeData("Match", { matchPct: Number(e.target.value) })
          }
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium">Your contribution (% of salary)</span>
        <input
          type="number"
          step="0.5"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.currentContribPct}
          onChange={(e) =>
            useStore.getState().patchNodeData("Match", { currentContribPct: Number(e.target.value) })
          }
        />
      </label>
      {data.matchPct > 0 && (
        <div className="text-xs">
          {data.currentContribPct >= data.matchPct ? (
            <span className="text-emerald-700 font-medium">✓ Capturing the full match</span>
          ) : (
            <span className="text-amber-700">
              Below match cap by {(data.matchPct - data.currentContribPct).toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
