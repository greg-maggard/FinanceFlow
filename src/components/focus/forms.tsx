import { FieldLabel, GlassInput, GlassSelect } from "../glass/GlassInput";
import { NumberField } from "../glass/NumberField";
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
        <NumberField
          value={data.balance.value}
          onChange={(v) =>
            useStore.getState().setNodeData("SmallEF", {
              balance: { value: v, source: "manual" },
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
          <NumberField
            value={data.balance.value}
            onChange={(v) =>
              useStore.getState().patchNodeData("BigEF", {
                balance: { value: v, source: "manual" },
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
        <NumberField
          step="0.5"
          value={data.matchPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Match", { matchPct: v })
          }
        />
      </Field>
      <Field label="Your %">
        <NumberField
          step="0.5"
          value={data.currentContribPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Match", { currentContribPct: v })
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
          <NumberField
            value={data.ytdContribution.value}
            onChange={(v) =>
              useStore.getState().patchNodeData("IRA", {
                ytdContribution: { value: v, source: "manual" },
              })
            }
          />
        </Field>
        <Field label="Annual limit">
          <NumberField
            value={data.annualLimit}
            onChange={(v) =>
              useStore.getState().patchNodeData("IRA", { annualLimit: v })
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
          <NumberField
            value={data.ytdContribution.value}
            onChange={(v) =>
              useStore.getState().patchNodeData("HSA", {
                ytdContribution: { value: v, source: "manual" },
              })
            }
          />
        </Field>
        <Field label="Annual limit">
          <NumberField
            value={data.annualLimit}
            onChange={(v) =>
              useStore.getState().patchNodeData("HSA", { annualLimit: v })
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
        <NumberField
          step="0.5"
          value={data.currentPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Increase401k", { currentPct: v })
          }
        />
      </Field>
      <Field label="Target %">
        <NumberField
          step="0.5"
          value={data.targetPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Increase401k", { targetPct: v })
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
          <NumberField
            value={data.target}
            onChange={(v) =>
              useStore.getState().patchNodeData("SavePurchase", { target: v })
            }
          />
        </Field>
        <Field label="Saved $">
          <NumberField
            value={data.saved.value}
            onChange={(v) =>
              useStore.getState().patchNodeData("SavePurchase", {
                saved: { value: v, source: "manual" },
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
        <NumberField
          value={data.monthlyContribution}
          onChange={(v) =>
            useStore.getState().patchNodeData("College", { monthlyContribution: v })
          }
        />
      </Field>
      <Field label="Balance $">
        <NumberField
          value={data.balance.value}
          onChange={(v) =>
            useStore.getState().patchNodeData("College", {
              balance: { value: v, source: "manual" },
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
              <NumberField
                value={d.balance}
                onChange={(v) => patch(d.id, { balance: v })}
              />
            </Field>
            <Field label="APR %">
              <NumberField
                step="0.1"
                value={d.apr}
                onChange={(v) => patch(d.id, { apr: v })}
              />
            </Field>
            <Field label="Min pay">
              <NumberField
                value={d.minPayment}
                onChange={(v) => patch(d.id, { minPayment: v })}
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
              <NumberField
                value={g.target}
                onChange={(v) => patch(g.id, { target: v })}
              />
            </Field>
            <Field label="Saved">
              <NumberField
                value={g.saved}
                onChange={(v) => patch(g.id, { saved: v })}
              />
            </Field>
            <Field label="Years">
              <NumberField
                value={g.horizonYears}
                onChange={(v) => patch(g.id, { horizonYears: v })}
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
  Rent: () => <RecurringTargetFields nodeId="Rent" label="Rent / mortgage" />,
  Food: () => <RecurringTargetFields nodeId="Food" label="Groceries" />,
  Essential: () => <RecurringTargetFields nodeId="Essential" label="Utilities & essentials" />,
  Income: () => <RecurringTargetFields nodeId="Income" label="Transportation, internet, phone" />,
  Health: () => <RecurringTargetFields nodeId="Health" label="Insurance & health care" />,
  MinDebt: () => <RecurringTargetFields nodeId="MinDebt" label="Total minimum payments" />,
  NonEssential: () => <RecurringTargetFields nodeId="NonEssential" label="Non-essential subscriptions" />,
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

type RecurringNodeId =
  | "Rent"
  | "Food"
  | "Essential"
  | "Income"
  | "Health"
  | "MinDebt"
  | "NonEssential";

function RecurringTargetFields({ nodeId, label }: { nodeId: RecurringNodeId; label: string }) {
  const state = useStore();
  const data = (state.nodes[nodeId].data as
    | { target: { value: number; source: "manual" } }
    | undefined) ?? { target: { value: 0, source: "manual" as const } };
  return (
    <Field label={`Monthly ${label.toLowerCase()} ($)`}>
      <NumberField
        value={data.target.value}
        onChange={(v) =>
          useStore.getState().setNodeData(nodeId, { target: { value: v, source: "manual" } })
        }
      />
    </Field>
  );
}
