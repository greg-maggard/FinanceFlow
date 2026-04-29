import { useStore } from "../state/store";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-lg">Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg">
            ×
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Monthly expenses ($)</span>
            <input
              type="number"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={settings.monthlyExpenses ?? ""}
              onChange={(e) =>
                useStore.getState().setSettings({
                  monthlyExpenses: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
            <span className="text-[10px] text-slate-500">
              Used to compute emergency fund targets.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-medium">Pre-tax annual income ($)</span>
            <input
              type="number"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={settings.preTaxIncome ?? ""}
              onChange={(e) =>
                useStore.getState().setSettings({
                  preTaxIncome: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
            <span className="text-[10px] text-slate-500">
              Used for the 15% retirement check.
            </span>
          </label>

          <div className="border-t border-slate-200 pt-3 space-y-3">
            <div className="text-xs font-medium text-slate-700">Annual contribution limits</div>
            <label className="block">
              <span className="text-xs">IRA</span>
              <input
                type="number"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={settings.iraAnnualLimit}
                onChange={(e) =>
                  useStore.getState().setSettings({ iraAnnualLimit: Number(e.target.value) })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs">HSA self</span>
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={settings.hsaSelfLimit}
                  onChange={(e) =>
                    useStore.getState().setSettings({ hsaSelfLimit: Number(e.target.value) })
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs">HSA family</span>
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={settings.hsaFamilyLimit}
                  onChange={(e) =>
                    useStore.getState().setSettings({ hsaFamilyLimit: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
