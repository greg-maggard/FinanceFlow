import { motion } from "framer-motion";
import { useStore } from "../../state/store";
import type { Category, CategoryGroup, MonthKey } from "../../state/schema";
import type { MonthSnapshot } from "../../budget/ledger";
import { GlassCard } from "../glass/GlassCard";
import { NumberField } from "../glass/NumberField";
import { GoalBar } from "../glass/GoalBar";
import { InlineAdd, SectionTitle, dollars } from "./bits";

// Funding green — envelopes glow when money lands in them, not when it leaves.
const FUND_TINT = "#34d399";
const FUND_GLOW = "rgba(52, 211, 153, 0.55)";

const GRID = "grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_auto] items-center gap-2";

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

function CategoryRow({
  cat,
  month,
  snap,
}: {
  cat: Category;
  month: MonthKey;
  snap: MonthSnapshot;
}) {
  const m = snap.categories[cat.id] ?? { assigned: 0, activity: 0, available: 0 };
  // Bars track "needed for spending" first, save-a-total goals otherwise.
  const target = cat.monthlyTarget ?? cat.balanceTarget;
  return (
    <motion.div layout className="space-y-2 py-2.5">
      <div className={GRID}>
        <div className="truncate text-sm font-medium text-white/90">{cat.name}</div>
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
        </div>
        <div className="divide-y divide-white/5">
          {categories.map((c) => (
            <CategoryRow key={c.id} cat={c} month={month} snap={snap} />
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
