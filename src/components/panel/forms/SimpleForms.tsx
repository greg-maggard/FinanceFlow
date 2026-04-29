import { useStore } from "../../../state/store";
import { ProgressBar } from "../ProgressBar";

export function SavePurchaseForm() {
  const state = useStore();
  const data = (state.nodes.SavePurchase.data as
    | { goalName: string; target: number; saved: { value: number; source: "manual" }; byDate?: string }
    | undefined) ?? { goalName: "", target: 0, saved: { value: 0, source: "manual" as const } };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Goal name</span>
        <input
          type="text"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.goalName}
          onChange={(e) =>
            useStore.getState().patchNodeData("SavePurchase", { goalName: e.target.value })
          }
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-medium">Target $</span>
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={data.target}
            onChange={(e) =>
              useStore.getState().patchNodeData("SavePurchase", { target: Number(e.target.value) })
            }
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Saved $</span>
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={data.saved.value}
            onChange={(e) =>
              useStore.getState().patchNodeData("SavePurchase", {
                saved: { value: Number(e.target.value), source: "manual" },
              })
            }
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium">Need by (optional)</span>
        <input
          type="date"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.byDate ?? ""}
          onChange={(e) =>
            useStore.getState().patchNodeData("SavePurchase", { byDate: e.target.value })
          }
        />
      </label>
      {data.target > 0 && <ProgressBar value={data.saved.value} max={data.target} label="Progress" />}
    </div>
  );
}

export function Increase401kForm() {
  const state = useStore();
  const data = (state.nodes.Increase401k.data as
    | { currentPct: number; targetPct: number }
    | undefined) ?? { currentPct: 0, targetPct: 15 };
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Current contribution % (pre-tax)</span>
        <input
          type="number"
          step="0.5"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.currentPct}
          onChange={(e) =>
            useStore.getState().patchNodeData("Increase401k", {
              currentPct: Number(e.target.value),
            })
          }
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium">Target %</span>
        <input
          type="number"
          step="0.5"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.targetPct}
          onChange={(e) =>
            useStore.getState().patchNodeData("Increase401k", {
              targetPct: Number(e.target.value),
            })
          }
        />
      </label>
      <ProgressBar value={data.currentPct} max={data.targetPct} label="Toward 15%" />
    </div>
  );
}

export function CollegeForm() {
  const state = useStore();
  const data = (state.nodes.College.data as
    | { monthlyContribution: number; balance: { value: number; source: "manual" }; targetAge?: number }
    | undefined) ?? { monthlyContribution: 0, balance: { value: 0, source: "manual" as const } };
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">529 monthly contribution $</span>
        <input
          type="number"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.monthlyContribution}
          onChange={(e) =>
            useStore.getState().patchNodeData("College", {
              monthlyContribution: Number(e.target.value),
            })
          }
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium">Current balance $</span>
        <input
          type="number"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={data.balance.value}
          onChange={(e) =>
            useStore.getState().patchNodeData("College", {
              balance: { value: Number(e.target.value), source: "manual" },
            })
          }
        />
      </label>
    </div>
  );
}

export function GoalsForm() {
  const state = useStore();
  const data = (state.nodes.Goals.data as
    | { items: { id: string; name: string; target: number; saved: number; horizonYears: number }[] }
    | undefined) ?? { items: [] };

  const update = (items: typeof data.items) => useStore.getState().setNodeData("Goals", { items });
  const add = () =>
    update([
      ...data.items,
      {
        id: Math.random().toString(36).slice(2, 9),
        name: "",
        target: 0,
        saved: 0,
        horizonYears: 1,
      },
    ]);
  const patch = (id: string, p: Partial<(typeof data.items)[number]>) =>
    update(data.items.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const remove = (id: string) => update(data.items.filter((g) => g.id !== id));

  return (
    <div className="space-y-2">
      {data.items.map((g) => (
        <div key={g.id} className="rounded border border-slate-200 p-2 space-y-1.5 bg-slate-50">
          <div className="flex gap-1">
            <input
              placeholder="Goal name"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
              value={g.name}
              onChange={(e) => patch(g.id, { name: e.target.value })}
            />
            <button
              type="button"
              className="text-xs text-red-600 px-1"
              onClick={() => remove(g.id)}
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <label className="text-[10px] text-slate-600">
              Target
              <input
                type="number"
                className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                value={g.target}
                onChange={(e) => patch(g.id, { target: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-600">
              Saved
              <input
                type="number"
                className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                value={g.saved}
                onChange={(e) => patch(g.id, { saved: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-600">
              Horizon (yr)
              <input
                type="number"
                className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                value={g.horizonYears}
                onChange={(e) => patch(g.id, { horizonYears: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        onClick={add}
      >
        + Add goal
      </button>
    </div>
  );
}
