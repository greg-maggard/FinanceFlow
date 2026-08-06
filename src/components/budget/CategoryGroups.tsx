import { useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import type { Category, CategoryGroup, Cents, MonthKey, NodeId } from "../../state/schema";
import { UNCATEGORIZED_CATEGORY_ID } from "../../state/schema";
import type { MonthSnapshot } from "../../budget/ledger";
import { IDENTITY } from "../../theme/identity";
import { GlassCard } from "../glass/GlassCard";
import { GlassInput, GlassSelect } from "../glass/GlassInput";
import { NumberField } from "../glass/NumberField";
import { GoalBar } from "../glass/GoalBar";
import { KebabMenu } from "../glass/KebabMenu";
import { Field, FundMonthButton, InlineAdd, SectionTitle, dollars } from "./bits";

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

function availableChipStyle(amount: Cents): React.CSSProperties {
  if (amount > 0) {
    return {
      background: "rgba(52, 211, 153, 0.14)",
      color: "#a7f3d0",
      border: "1px solid rgba(52, 211, 153, 0.32)",
    };
  }
  if (amount < 0) {
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
  hideMonthlyBar,
}: {
  cat: Category;
  month: MonthKey;
  snap: MonthSnapshot;
  menuDrop: "down" | "up";
  /** An untouched month: every monthly bar would read $0 of its target. */
  hideMonthlyBar?: boolean;
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
            <ConfirmDelete cat={cat} />
          </div>
        </KebabMenu>
      </div>
      {target !== undefined && target > 0 && !(hideMonthlyBar && cat.monthlyTarget !== undefined) && (
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

/**
 * Two-tap delete: arming says where the money goes before committing.
 *
 * An envelope with spending can't just be dropped — its transactions and its
 * assigned dollars have to move together, or the delete conjures the spent
 * money back into Ready to Assign. So arming asks which envelope receives
 * both, defaulting to Uncategorized. An envelope no transaction ever touched
 * has no activity to carry, so there is nothing to choose: it deletes outright
 * and its assignments return to Ready to Assign — the common case of throwing
 * away a mistake.
 */
export function ConfirmDelete({ cat, name }: { cat: Category; name?: string }) {
  const transactions = useStore((s) => s.budget.transactions);
  const categories = useStore((s) => s.budget.categories);
  const [armed, setArmed] = useState(false);
  const [target, setTarget] = useState(UNCATEGORIZED_CATEGORY_ID);

  // The catch-all holds what other envelopes hand off; it has nowhere to go.
  if (cat.id === UNCATEGORIZED_CATEGORY_ID) return null;

  const label = name || cat.name;
  const hasTxns = transactions.some((t) => t.categoryId === cat.id);
  const choices = [...categories]
    .filter((c) => c.id !== cat.id && !c.hidden)
    .sort((a, b) => a.order - b.order);
  // Created lazily, so offer it even before it exists — picking it makes it.
  const knowsUncategorized = choices.some((c) => c.id === UNCATEGORIZED_CATEGORY_ID);

  return (
    <div className="space-y-1.5">
      {armed &&
        (hasTxns ? (
          <>
            <p className="text-[11px] text-white/45">
              Move {label}&rsquo;s transactions and money to…
            </p>
            <GlassSelect
              aria-label={`Move ${label}'s transactions and money to`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {!knowsUncategorized && (
                <option value={UNCATEGORIZED_CATEGORY_ID}>Uncategorized</option>
              )}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </GlassSelect>
          </>
        ) : (
          <p className="text-[11px] text-white/45">
            Nothing was ever spent here — its assigned dollars return to Ready to Assign.
          </p>
        ))}
      <button
        type="button"
        onClick={() =>
          armed
            ? useStore
                .getState()
                .deleteCategory(cat.id, hasTxns ? target : UNCATEGORIZED_CATEGORY_ID)
            : setArmed(true)
        }
        className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-red-300 hover:bg-red-500/10"
      >
        {armed ? (hasTxns ? `Move & delete ${label}` : "Tap again to confirm") : `Delete ${label}`}
      </button>
    </div>
  );
}

function GroupCard({
  group,
  categories,
  month,
  snap,
  hideMonthlyBars,
}: {
  group: CategoryGroup;
  categories: Category[];
  month: MonthKey;
  snap: MonthSnapshot;
  hideMonthlyBars?: boolean;
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
              hideMonthlyBar={hideMonthlyBars}
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

export function CategoryGroups({
  month,
  snap,
  untouched,
  onFundMonth,
}: {
  month: MonthKey;
  snap: MonthSnapshot;
  /** Nothing assigned yet this month, and monthly targets still unmet. */
  untouched?: boolean;
  onFundMonth?: () => void;
}) {
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

  // A new month starts with every assignment at zero, so its monthly bars all
  // read $0 of their target — fifteen empty bars that look like fifteen
  // failures. Say what actually happened and offer the one tap that fixes it.
  return (
    <div className="space-y-4">
      {untouched && onFundMonth && (
        <GlassCard className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/70">Nothing assigned yet this month</p>
            <FundMonthButton onClick={onFundMonth} />
          </div>
        </GlassCard>
      )}
      {groups.map((g) => (
        <GroupCard
          key={g.id}
          group={g}
          categories={budget.categories
            .filter((c) => c.groupId === g.id && !c.hidden)
            .sort((a, b) => a.order - b.order)}
          month={month}
          snap={snap}
          hideMonthlyBars={untouched}
        />
      ))}
      <InlineAdd label="Add group" placeholder="Group name" onAdd={addGroup} />
    </div>
  );
}
