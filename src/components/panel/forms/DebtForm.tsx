import { useStore } from "../../../state/store";
import type { Debt, NodeId } from "../../../state/schema";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function DebtForm({ nodeId, aprThreshold }: { nodeId: NodeId & ("HighDebt" | "ModDebt"); aprThreshold: number }) {
  const state = useStore();
  const data = (state.nodes[nodeId].data as { debts: Debt[] } | undefined) ?? { debts: [] };

  const update = (debts: Debt[]) => useStore.getState().setNodeData(nodeId, { debts });

  const addDebt = () =>
    update([
      ...data.debts,
      { id: uid(), name: "", balance: 0, apr: aprThreshold, minPayment: 0, paid: false },
    ]);
  const remove = (id: string) => update(data.debts.filter((d) => d.id !== id));
  const patch = (id: string, p: Partial<Debt>) =>
    update(data.debts.map((d) => (d.id === id ? { ...d, ...p } : d)));

  const totalBalance = data.debts.filter((d) => !d.paid).reduce((s, d) => s + d.balance, 0);

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-600">
        Threshold: <strong>{aprThreshold}%+ APR</strong>. Use avalanche (highest APR first) or
        snowball (smallest balance first).
      </div>
      <div className="space-y-2">
        {data.debts.map((d) => (
          <div key={d.id} className="rounded border border-slate-200 p-2 space-y-1.5 bg-slate-50">
            <div className="flex gap-1">
              <input
                placeholder="Name"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                value={d.name}
                onChange={(e) => patch(d.id, { name: e.target.value })}
              />
              <button
                className="text-xs text-red-600 hover:text-red-800 px-1"
                onClick={() => remove(d.id)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <label className="text-[10px] text-slate-600">
                Balance
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={d.balance}
                  onChange={(e) => patch(d.id, { balance: Number(e.target.value) })}
                />
              </label>
              <label className="text-[10px] text-slate-600">
                APR %
                <input
                  type="number"
                  step="0.1"
                  className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={d.apr}
                  onChange={(e) => patch(d.id, { apr: Number(e.target.value) })}
                />
              </label>
              <label className="text-[10px] text-slate-600">
                Min pay
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={d.minPayment}
                  onChange={(e) => patch(d.id, { minPayment: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={d.paid}
                onChange={(e) => patch(d.id, { paid: e.target.checked })}
              />
              Paid off
            </label>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        onClick={addDebt}
      >
        + Add debt
      </button>
      <div className="text-xs text-slate-600">
        Outstanding total: <strong>${totalBalance.toLocaleString()}</strong>
      </div>
    </div>
  );
}
