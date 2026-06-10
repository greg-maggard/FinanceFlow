import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useStore } from "../../state/store";
import type { MonthKey } from "../../state/schema";
import { snapshot } from "../../budget/ledger";
import { ymKey } from "../../state/recurring";
import { M } from "../../theme/motion";
import { GlassCard } from "../glass/GlassCard";
import { dollars } from "./bits";
import { CategoryGroups } from "./CategoryGroups";
import { AccountsSection } from "./AccountsSection";
import { TransactionsSection } from "./TransactionsSection";

/** Step a "YYYY-MM" key by whole months; Date handles the year rollover. */
function stepYm(key: MonthKey, delta: number): MonthKey {
  const [y, m] = key.split("-").map(Number);
  return ymKey(new Date(y, m - 1 + delta, 1));
}

function monthLabel(key: MonthKey): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function MonthArrow({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full text-base text-white/70 hover:text-white/95"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      {glyph}
    </button>
  );
}

function RtaPill({ amount }: { amount: number }) {
  const cents = Math.round(amount * 100);
  const palette =
    cents > 0
      ? {
          background: "rgba(52, 211, 153, 0.14)",
          border: "1px solid rgba(52, 211, 153, 0.38)",
          color: "#a7f3d0",
          boxShadow: "0 0 24px rgba(52, 211, 153, 0.22)",
        }
      : cents < 0
        ? {
            background: "rgba(248, 113, 113, 0.12)",
            border: "1px solid rgba(248, 113, 113, 0.38)",
            color: "#fca5a5",
            boxShadow: "0 0 24px rgba(248, 113, 113, 0.20)",
          }
        : {
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.70)",
          };
  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-2.5" style={palette}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-80">
        Ready to Assign
      </span>
      <span className="text-xl font-semibold tabular-nums">
        {cents === 0 ? "All assigned" : dollars(amount)}
      </span>
    </div>
  );
}

export function BudgetScreen() {
  const budget = useStore((s) => s.budget);
  const [month, setMonth] = useState<MonthKey>(() => ymKey());
  // Live-derived: any edit to the book lands here on the next render.
  const snap = useMemo(() => snapshot(budget, month), [budget, month]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-3 pb-4 sm:px-5">
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...M.fade, delay: 0.05 }}
      >
        <GlassCard intensity="normal" className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MonthArrow
                label="Previous month"
                glyph="‹"
                onClick={() => setMonth(stepYm(month, -1))}
              />
              <div className="min-w-[9.5rem] text-center text-lg font-semibold tracking-tight text-white/95">
                {monthLabel(month)}
              </div>
              <MonthArrow
                label="Next month"
                glyph="›"
                onClick={() => setMonth(stepYm(month, 1))}
              />
            </div>
            <RtaPill amount={snap.readyToAssign} />
          </div>
        </GlassCard>
      </motion.div>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...M.fade, delay: 0.1 }}
      >
        <CategoryGroups month={month} snap={snap} />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...M.fade, delay: 0.16 }}
      >
        <AccountsSection />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...M.fade, delay: 0.22 }}
      >
        <TransactionsSection />
      </motion.section>
    </div>
  );
}
