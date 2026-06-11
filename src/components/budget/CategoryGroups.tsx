import { useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import type { Category, CategoryGroup, MonthKey, NodeId } from "../../state/schema";
import type { MonthSnapshot } from "../../budget/ledger";
import { IDENTITY } from "../../theme/identity";
import { GlassCard } from "../glass/GlassCard";
import { GlassInput } from "../glass/GlassInput";
import { NumberField } from "../glass/NumberField";
import { GoalBar } from "../glass/GoalBar";
import { KebabMenu } from "../glass/KebabMenu";
import { Field, InlineAdd, SectionTitle, dollars } from "./bits";

// Funding green — envelopes glow when money lands in them, not when it leaves.
const FUND_TINT = "#34d399";
// Exported for BudgetScreen's cross-navigation pulse, so arrival glows the
// same green as funding does.
export const FUND_GLOW = "rgba(52, 211, 153, 0.55)";

const GRID = "grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_auto_1.25rem] items-center gap-2";

type GoalKind = "none" | "monthly" | "total";

const GOAL_KINDS: { kind: GoalKind; label: string; hint: string }[] = [
  { kind: "none", label: "No goal", hint: "The envelope just holds what you assign." },
  { kind: "monthly", label: "Monthly", hint: "Needed every month — the bar tracks available vs. this amount." },
  { kind: "total", label: "Total", hint: "Save up to a total — the bar fills as the balance grows." },
];

function availableChipStyle(amount: number): React.CSSProperties {
  const cents = Math.round(amount * 100);
  if (cents > 0) {
    return {
      background: "rgba(52, 211, 153, 0.14)",
      color: "#a7f3d0",
      border: "1px solid rgba(52, 211, 153, 0.32)",
    };
  }
  if (cents < 0) {
    return {
      background: "rgba(248, 113, 113, 0.12)",
      color: "#fca5a5",
      border: "1px solid rgba(248, 113, 113, 0.32)",
    };
  }
  return {
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.60)",
    border: "1px solid rgba(255,255,255,0.12)",
  };
}

/**
 * Subtle chip a budget row wears when a flowchart node reads it — tapping
 * jumps to that node's focus card (the other half of cross-navigation).
 * Shared with AccountsSection so linked accounts get the identical chip.
 */
export function NodeChip({ nodeId }: { nodeId: NodeId }) {
  return (
    <button
      type="button"
      title="Open on the path"
      onClick={() => useUI.getState().setFocus(nodeId)}
      className="max-w-[10rem] shrink-0 truncate rounded-full px-2 py-0.5 text-left text-[10px] font-medium transition hover:brightness-125"
      style={availableChipStyle(0)}
    >
      {IDENTITY[nodeId] ?? nodeId}
    </button>
  );
}

function CategoryRow({
  cat,
  month,
  snap,
  menuDrop,
}: {
  cat: Category;
  month: MonthKey;
  snap: MonthSnapshot;
  menuDrop: "down" | "up";
}) {
  const m = snap.categories[cat.id] ?? { assigned: 0, activity: 0, available: 0 };
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [goalKind, setGoalKind] = useState<GoalKind>("none");
  const [goalAmount, setGoalAmount] = useState(0);
  // Bars track "needed for spending" first, save-a-total goals otherwise.
  const target = cat.monthlyTarget ?? cat.balanceTarget;

  const beginEdit = () => {
    setName(cat.name);
    setGoalKind(cat.monthlyTarget ? "monthly" : cat.balanceTarget ? "total" : "none");
    setGoalAmount(cat.monthlyTarget ?? cat.balanceTarget ?? 0);
    setEditing(true);
  };

  const saveEdit = () => {
    useStore.getState().updateCategory({
      ...cat,
      name: name.trim() || cat.name,
      monthlyTarget: goalKind === "monthly" && goalAmount > 0 ? goalAmount : undefined,
      balanceTarget: goalKind === "total" && goalAmount > 0 ? goalAmount : undefined,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <motion.div layout id={`cat-${cat.id}`} className="space-y-3 py-2.5">
        <Field label={`Edit ${cat.name}`}>
          <GlassInput
            autoFocus
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            {GOAL_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setGoalKind(kind)}
                className="rounded-full px-3 py-1 text-[11px] font-medium text-white/75 hover:text-white/95"
                style={{
                  background:
                    goalKind === kind ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {goalKind !== "none" && (
            <NumberField
              aria-label={`Goal amount for ${cat.name}`}
              value={goalAmount}
              onChange={setGoalAmount}
            />
          )}
          <p className="text-[11px] text-white/45">
            {GOAL_KINDS.find((g) => g.kind === goalKind)?.hint}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveEdit}
            className="rounded-xl px-3 py-1.5 text-xs font-medium text-white/85 hover:text-white/95"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.16)",
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-xl px-3 py-1.5 text-xs text-white/55 hover:text-white/80"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div layout id={`cat-${cat.id}`} className="space-y-2 py-2.5">
      <div className={GRID}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white/90">{cat.name}</span>
          {cat.nodeId && <NodeChip nodeId={cat.nodeId} />}
        </div>
        <NumberField
          aria-label={`Assigned to ${cat.name}`}
          value={m.assigned}
          onChange={(v) => useStore.getState().assign(month, cat.id, v)}
        />
        <div className="text-right text-xs tabular-nums text-white/45">
          {dollars(m.activity)}
        </div>
        <span
          className="justify-self-end rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
          style={availableChipStyle(m.available)}
        >
          {dollars(m.available)}
        </span>
        <KebabMenu ariaLabel={`${cat.name} actions`} drop={menuDrop}>
          <div className="space-y-2">
            <button
              type="button"
              onClick={beginEdit}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-white/85 hover:bg-white/5"
            >
              Edit name &amp; goal
            </button>
            <ConfirmDelete name={cat.name} onDelete={() => useStore.getState().deleteCategory(cat.id)} />
          </div>
        </KebabMenu>
      </div>
      {target !== undefined && target > 0 && (
        <GoalBar
          value={m.available}
          max={target}
          tint={FUND_TINT}
          glow={FUND_GLOW}
          caption={cat.monthlyTarget !== undefined ? "Monthly target" : "Balance target"}
        />
      )}
    </motion.div>
  );
}

/** Two-tap delete: arming explains where the money goes before committing. */
export function ConfirmDelete({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="space-y-1.5">
      {armed && (
        <p className="text-[11px] text-white/45">
          Transactions stay, uncategorized; assigned dollars return to Ready to Assign.
        </p>
      )}
      <button
        type="button"
        onClick={() => (armed ? onDelete() : setArmed(true))}
        className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-red-300 hover:bg-red-500/10"
      >
        {armed ? "Tap again to confirm" : `Delete ${name}`}
      </button>
    </div>
  );
}

function GroupCard({
  group,
  categories,
  month,
  snap,
}: {
  group: CategoryGroup;
  categories: Category[];
  month: MonthKey;
  snap: MonthSnapshot;
}) {
  return (
    <GlassCard className="px-5 py-4">
      <div className="space-y-2">
        <SectionTitle>{group.name}</SectionTitle>
        <div className={`${GRID} text-[10px] uppercase tracking-[0.18em] text-white/35`}>
          <span>Category</span>
          <span>Assigned</span>
          <span className="text-right">Activity</span>
          <span className="justify-self-end">Available</span>
          <span />
        </div>
        <div className="divide-y divide-white/5">
          {categories.map((c, i) => (
            <CategoryRow
              key={c.id}
              cat={c}
              month={month}
              snap={snap}
              menuDrop={i === 0 ? "down" : "up"}
            />
          ))}
          {categories.length === 0 && (
            <p className="py-2 text-xs text-white/40">Nothing here yet.</p>
          )}
        </div>
        <InlineAdd
          label="Add category"
          placeholder="Category name"
          onAdd={(name) => useStore.getState().addCategory(group.id, name)}
        />
      </div>
    </GlassCard>
  );
}

export function CategoryGroups({ month, snap }: { month: MonthKey; snap: MonthSnapshot }) {
  const budget = useStore((s) => s.budget);
  const groups = [...budget.groups].sort((a, b) => a.order - b.order);
  const addGroup = (name: string) => useStore.getState().addGroup(name);

  if (groups.length === 0) {
    return (
      <GlassCard className="px-6 py-6">
        <div className="space-y-3">
          <SectionTitle>Budget</SectionTitle>
          <p className="text-sm text-white/65">
            No envelopes yet. Make a group — Bills, Everyday, Goals — and give
            every dollar a job.
          </p>
          <InlineAdd label="Add group" placeholder="Group name" onAdd={addGroup} />
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <GroupCard
          key={g.id}
          group={g}
          categories={budget.categories
            .filter((c) => c.groupId === g.id && !c.hidden)
            .sort((a, b) => a.order - b.order)}
          month={month}
          snap={snap}
        />
      ))}
      <InlineAdd label="Add group" placeholder="Group name" onAdd={addGroup} />
    </div>
  );
}
