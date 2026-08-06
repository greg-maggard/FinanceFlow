import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import type { MonthKey } from "../../state/schema";
import { assignedAfter, snapshot } from "../../budget/ledger";
import { planFundMonth } from "../../budget/nodeLedger";
import { ymKey } from "../../state/recurring";
import { M } from "../../theme/motion";
import { GlassCard } from "../glass/GlassCard";
import { FundMonthButton, dollars } from "./bits";
import { CategoryGroups, FUND_GLOW } from "./CategoryGroups";
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
  const budgetFocus = useUI((s) => s.budgetFocus);
  const [month, setMonth] = useState<MonthKey>(() => ymKey());
  // Live-derived: any edit to the book lands here on the next render.
  const snap = useMemo(() => snapshot(budget, month), [budget, month]);
  // Ready-to-Assign stops at the viewed month, so dollars parked further out
  // are invisible to it — call them out rather than let them look unspent.
  const ahead = useMemo(() => assignedAfter(budget, month), [budget, month]);

  // Assignments are keyed per month, so every month opens with every envelope
  // back at zero. The plan is re-derived on each edit purely to answer "is
  // anything still short of its monthly target?" — the tap itself re-plans
  // against the freshest book.
  const plan = useMemo(() => planFundMonth(budget, month), [budget, month]);
  const unmet = plan.underfunded.length > 0 || (plan.ops.setAssignments?.length ?? 0) > 0;
  // An untouched month is the real cliff: not a wall of failed goal bars, just
  // a month nobody has funded yet.
  const untouched = Object.keys(budget.assignments[month] ?? {}).length === 0;
  const [report, setReport] = useState<{ month: MonthKey; text: string } | null>(null);

  const fundMonth = () => {
    const s = useStore.getState();
    const fresh = planFundMonth(s.budget, month);
    if (fresh.ops.setAssignments?.length) s.applyBookOps(fresh.ops);
    setReport(
      fresh.underfunded.length > 0
        ? {
            month,
            text: `Funded ${fresh.funded} of ${fresh.targeted} envelopes — ${dollars(fresh.shortfall)} short`,
          }
        : null,
    );
  };

  // Cross-navigation landing: scroll the requested row into view and pulse it
  // in the funding green for ~2s. The request is consumed up front so the
  // re-run this triggers (and any later visit) is a no-op; the pulse is plain
  // inline style because the row belongs to a child section, not to us.
  useEffect(() => {
    if (!budgetFocus) return;
    useUI.getState().clearBudgetFocus();
    const domId = budgetFocus.categoryId
      ? `cat-${budgetFocus.categoryId}`
      : budgetFocus.accountId
        ? `acct-${budgetFocus.accountId}`
        : null;
    const el = domId ? document.getElementById(domId) : null;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.style.transition = "box-shadow 500ms ease";
    el.style.borderRadius = "0.75rem";
    el.style.boxShadow = `0 0 0 1px ${FUND_GLOW}, 0 0 24px ${FUND_GLOW}`;
    window.setTimeout(() => {
      el.style.boxShadow = "";
      // Drop the rest only after the fade so it animates out cleanly.
      window.setTimeout(() => {
        el.style.transition = "";
        el.style.borderRadius = "";
      }, 500);
    }, 2000);
  }, [budgetFocus]);

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
            <div className="flex flex-col items-end gap-1">
              <RtaPill amount={snap.readyToAssign} />
              {Math.round(ahead * 100) !== 0 && (
                <span className="pr-1 text-[11px] tabular-nums text-white/50">
                  {dollars(ahead)} assigned in future months
                </span>
              )}
            </div>
          </div>
          {/* Both retire the moment every target is met — a button that would
              do nothing, and a shortfall line that is no longer true. */}
          {unmet && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
              <FundMonthButton onClick={fundMonth} />
              {report && report.month === month && (
                <span className="text-xs tabular-nums text-white/55">{report.text}</span>
              )}
            </div>
          )}
        </GlassCard>
      </motion.div>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...M.fade, delay: 0.1 }}
      >
        <CategoryGroups
          month={month}
          snap={snap}
          untouched={untouched && unmet}
          onFundMonth={fundMonth}
        />
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
