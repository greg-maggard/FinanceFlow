import { FieldLabel, GlassInput, GlassSelect } from "../glass/GlassInput";
import { useStore } from "../../state/store";
import type { Debt, NodeId } from "../../state/schema";
import { emergencyFundTarget, bigEmergencyFundTarget } from "../../state/schema";
import { motion } from "framer-motion";

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1.5">
    <FieldLabel>{label}</FieldLabel>
    {children}
  </label>
);

export function SmallEFFields() {
  const state = useStore();
  const data =
    (state.nodes.SmallEF.data as { balance: { value: number; source: "manual" } } | undefined) ?? {
      balance: { value: 0, source: "manual" as const },
    };
  const target = emergencyFundTarget(state.settings.monthlyExpenses);
  return (
    <div className="space-y-3">
      <div className="text-xs text-white/55">
        Target: <span className="font-semibold text-white/85">${target.toLocaleString()}</span>
      </div>
      <Field label="Current balance">
        <GlassInput
          type="number"
          value={data.balance.value}
          onChange={(e) =>
            useStore.getState().setNodeData("SmallEF", {
              balance: { value: Number(e.target.value), source: "manual" },
            })
          }
        />
      </Field>
    </div>
  );
}

export function BigEFFields() {
  const state = useStore();
  const data = (state.nodes.BigEF.data as
    | { targetMonths: 3 | 4 | 5 | 6; balance: { value: number; source: "manual" } }
    | undefined) ?? { targetMonths: 3, balance: { value: 0, source: "manual" as const } };
  const target = bigEmergencyFundTarget(data.targetMonths, state.settings.monthlyExpenses);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target months">
          <GlassSelect
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
          </GlassSelect>
        </Field>
        <Field label="Balance">
          <GlassInput
            type="number"
            value={data.balance.value}
            onChange={(e) =>
              useStore.getState().patchNodeData("BigEF", {
                balance: { value: Number(e.target.value), source: "manual" },
              })
            }
          />
        </Field>
      </div>
      <div className="text-xs text-white/55">
        {target > 0
          ? `Target: $${target.toLocaleString()}`
          : "Set monthly expenses in Settings to compute target."}
      </div>
    </div>
  );
}

export function MatchFields() {
  const state = useStore();
  const data =
    (state.nodes.Match.data as { matchPct: number; currentContribPct: number } | undefined) ?? {
      matchPct: 0,
      currentContribPct: 0,
    };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Match cap %">
        <GlassInput
          type="number"
          step="0.5"
          value={data.matchPct}
          onChange={(e) =>
            useStore.getState().patchNodeData("Match", { matchPct: Number(e.target.value) })
          }
        />
      </Field>
      <Field label="Your %">
        <GlassInput
          type="number"
          step="0.5"
          value={data.currentContribPct}
          onChange={(e) =>
            useStore.getState().patchNodeData("Match", {
              currentContribPct: Number(e.target.value),
            })
          }
        />
      </Field>
    </div>
  );
}

export function IRAFields() {
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
      <Field label="Type">
        <GlassSelect
          value={data.type}
          onChange={(e) =>
            useStore.getState().patchNodeData("IRA", {
              type: e.target.value as "roth" | "traditional",
            })
          }
        >
          <option value="roth">Roth IRA</option>
          <option value="traditional">Traditional IRA</option>
        </GlassSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="YTD">
          <GlassInput
            type="number"
            value={data.ytdContribution.value}
            onChange={(e) =>
              useStore.getState().patchNodeData("IRA", {
                ytdContribution: { value: Number(e.target.value), source: "manual" },
              })
            }
          />
        </Field>
        <Field label="Annual limit">
          <GlassInput
            type="number"
            value={data.annualLimit}
            onChange={(e) =>
              useStore.getState().patchNodeData("IRA", { annualLimit: Number(e.target.value) })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function HSAFields() {
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
  return (
    <div className="space-y-3">
      <Field label="Coverage">
        <GlassSelect
          value={data.coverage}
          onChange={(e) => {
            const cov = e.target.value as "self" | "family";
            useStore.getState().patchNodeData("HSA", {
              coverage: cov,
              annualLimit:
                cov === "self" ? state.settings.hsaSelfLimit : state.settings.hsaFamilyLimit,
            });
          }}
        >
          <option value="self">Self-only</option>
          <option value="family">Family</option>
        </GlassSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="YTD">
          <GlassInput
            type="number"
            value={data.ytdContribution.value}
            onChange={(e) =>
              useStore.getState().patchNodeData("HSA", {
                ytdContribution: { value: Number(e.target.value), source: "manual" },
              })
            }
          />
        </Field>
        <Field label="Annual limit">
          <GlassInput
            type="number"
            value={data.annualLimit}
            onChange={(e) =>
              useStore.getState().patchNodeData("HSA", { annualLimit: Number(e.target.value) })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function Increase401kFields() {
  const state = useStore();
  const data = (state.nodes.Increase401k.data as
    | { currentPct: number; targetPct: number }
    | undefined) ?? { currentPct: 0, targetPct: 15 };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Your %">
        <GlassInput
          type="number"
          step="0.5"
          value={data.currentPct}
          onChange={(e) =>
            useStore
              .getState()
              .patchNodeData("Increase401k", { currentPct: Number(e.target.value) })
          }
        />
      </Field>
      <Field label="Target %">
        <GlassInput
          type="number"
          step="0.5"
          value={data.targetPct}
          onChange={(e) =>
            useStore
              .getState()
              .patchNodeData("Increase401k", { targetPct: Number(e.target.value) })
          }
        />
      </Field>
    </div>
  );
}

export function SavePurchaseFields() {
  const state = useStore();
  const data = (state.nodes.SavePurchase.data as
    | {
        goalName: string;
        target: number;
        saved: { value: number; source: "manual" };
        byDate?: string;
      }
    | undefined) ?? { goalName: "", target: 0, saved: { value: 0, source: "manual" as const } };
  return (
    <div className="space-y-3">
      <Field label="Goal name">
        <GlassInput
          value={data.goalName}
          onChange={(e) =>
            useStore.getState().patchNodeData("SavePurchase", { goalName: e.target.value })
          }
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target $">
          <GlassInput
            type="number"
            value={data.target}
            onChange={(e) =>
              useStore.getState().patchNodeData("SavePurchase", { target: Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Saved $">
          <GlassInput
            type="number"
            value={data.saved.value}
            onChange={(e) =>
              useStore.getState().patchNodeData("SavePurchase", {
                saved: { value: Number(e.target.value), source: "manual" },
              })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function CollegeFields() {
  const state = useStore();
  const data = (state.nodes.College.data as
    | {
        monthlyContribution: number;
        balance: { value: number; source: "manual" };
        targetAge?: number;
      }
    | undefined) ?? { monthlyContribution: 0, balance: { value: 0, source: "manual" as const } };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Monthly $">
        <GlassInput
          type="number"
          value={data.monthlyContribution}
          onChange={(e) =>
            useStore
              .getState()
              .patchNodeData("College", { monthlyContribution: Number(e.target.value) })
          }
        />
      </Field>
      <Field label="Balance $">
        <GlassInput
          type="number"
          value={data.balance.value}
          onChange={(e) =>
            useStore.getState().patchNodeData("College", {
              balance: { value: Number(e.target.value), source: "manual" },
            })
          }
        />
      </Field>
    </div>
  );
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function DebtFields({ nodeId, aprThreshold }: { nodeId: "HighDebt" | "ModDebt"; aprThreshold: number }) {
  const state = useStore();
  const data = (state.nodes[nodeId].data as { debts: Debt[] } | undefined) ?? { debts: [] };
  const update = (debts: Debt[]) => useStore.getState().setNodeData(nodeId, { debts });
  const add = () =>
    update([
      ...data.debts,
      { id: uid(), name: "", balance: 0, apr: aprThreshold, minPayment: 0, paid: false },
    ]);
  const patch = (id: string, p: Partial<Debt>) =>
    update(data.debts.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const remove = (id: string) => update(data.debts.filter((d) => d.id !== id));

  return (
    <div className="space-y-2">
      <div className="text-xs text-white/55">
        Threshold: <span className="font-semibold text-white/85">{aprThreshold}%+ APR</span>. Avalanche
        (highest APR first) or snowball (smallest balance first).
      </div>
      {data.debts.map((d) => (
        <motion.div
          key={d.id}
          layout
          className="space-y-2 rounded-xl p-3"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex gap-2">
            <GlassInput
              placeholder="Name"
              value={d.name}
              onChange={(e) => patch(d.id, { name: e.target.value })}
            />
            <button
              type="button"
              onClick={() => remove(d.id)}
              className="rounded-full px-2 text-xs text-red-300 hover:bg-red-500/10"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Balance">
              <GlassInput
                type="number"
                value={d.balance}
                onChange={(e) => patch(d.id, { balance: Number(e.target.value) })}
              />
            </Field>
            <Field label="APR %">
              <GlassInput
                type="number"
                step="0.1"
                value={d.apr}
                onChange={(e) => patch(d.id, { apr: Number(e.target.value) })}
              />
            </Field>
            <Field label="Min pay">
              <GlassInput
                type="number"
                value={d.minPayment}
                onChange={(e) => patch(d.id, { minPayment: Number(e.target.value) })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/80">
            <input
              type="checkbox"
              checked={d.paid}
              onChange={(e) => patch(d.id, { paid: e.target.checked })}
            />
            Paid off
          </label>
        </motion.div>
      ))}
      <button
        type="button"
        onClick={add}
        className="w-full rounded-xl border border-dashed border-white/15 py-2 text-xs text-white/65 hover:bg-white/5"
      >
        + Add debt
      </button>
    </div>
  );
}

export function GoalsFields() {
  const state = useStore();
  const data = (state.nodes.Goals.data as
    | { items: { id: string; name: string; target: number; saved: number; horizonYears: number }[] }
    | undefined) ?? { items: [] };
  const update = (items: typeof data.items) => useStore.getState().setNodeData("Goals", { items });
  const add = () =>
    update([
      ...data.items,
      { id: uid(), name: "", target: 0, saved: 0, horizonYears: 1 },
    ]);
  const patch = (
    id: string,
    p: Partial<(typeof data.items)[number]>,
  ) => update(data.items.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const remove = (id: string) => update(data.items.filter((g) => g.id !== id));

  return (
    <div className="space-y-2">
      {data.items.map((g) => (
        <motion.div
          key={g.id}
          layout
          className="space-y-2 rounded-xl p-3"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex gap-2">
            <GlassInput
              placeholder="Goal"
              value={g.name}
              onChange={(e) => patch(g.id, { name: e.target.value })}
            />
            <button
              type="button"
              onClick={() => remove(g.id)}
              className="rounded-full px-2 text-xs text-red-300 hover:bg-red-500/10"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Target">
              <GlassInput
                type="number"
                value={g.target}
                onChange={(e) => patch(g.id, { target: Number(e.target.value) })}
              />
            </Field>
            <Field label="Saved">
              <GlassInput
                type="number"
                value={g.saved}
                onChange={(e) => patch(g.id, { saved: Number(e.target.value) })}
              />
            </Field>
            <Field label="Years">
              <GlassInput
                type="number"
                value={g.horizonYears}
                onChange={(e) => patch(g.id, { horizonYears: Number(e.target.value) })}
              />
            </Field>
          </div>
        </motion.div>
      ))}
      <button
        type="button"
        onClick={add}
        className="w-full rounded-xl border border-dashed border-white/15 py-2 text-xs text-white/65 hover:bg-white/5"
      >
        + Add goal
      </button>
    </div>
  );
}

export const FORM_BY_NODE: Partial<Record<NodeId, () => JSX.Element>> = {
  SmallEF: SmallEFFields,
  BigEF: BigEFFields,
  Match: MatchFields,
  IRA: IRAFields,
  HSA: HSAFields,
  Increase401k: Increase401kFields,
  SavePurchase: SavePurchaseFields,
  College: CollegeFields,
  HighDebt: () => <DebtFields nodeId="HighDebt" aprThreshold={10} />,
  ModDebt: () => <DebtFields nodeId="ModDebt" aprThreshold={4} />,
  Goals: GoalsFields,
};
