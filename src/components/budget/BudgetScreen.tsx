import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import type { MonthKey } from "../../state/schema";
import { UNCATEGORIZED_CATEGORY_ID } from "../../state/schema";
import { assignedAfter, fromCents, snapshot, toCents } from "../../budget/ledger";
import { planFundMonth, type FundMonthPlan } from "../../budget/nodeLedger";
import { ymKey } from "../../state/recurring";
import { M } from "../../theme/motion";
import { GlassButton } from "../glass/GlassButton";
import { GlassCard } from "../glass/GlassCard";
import { FundMonthButton, dollars } from "./bits";
import { CategoryGroups, FUND_GLOW } from "./CategoryGroups";
import { AccountsSection } from "./AccountsSection";
import { TransactionsSection, categoryLabel } from "./TransactionsSection";

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

/**
 * The compact "how much can I spend right now" row (w2-today-strip): Ready
 * to Assign, total on-budget cash, and the balance of whichever envelope
 * was last used, so the answer costs zero taps on cold open. `onBudgetCash`
 * and `categoryAvailable` are both derived from the `snap` the caller
 * already computed — no second `snapshot()` call. Grid, not flex-wrap, so
 * labels truncate instead of wrapping to a second line on a phone.
 */
function TodayStrip({
  readyToAssign,
  onBudgetCash,
  categoryName,
  categoryAvailable,
  ahead,
}: {
  readyToAssign: number;
  onBudgetCash: number;
  categoryName: string;
  categoryAvailable: number;
  ahead: number;
}) {
  return (
    <GlassCard intensity="subtle" className="px-4 py-3">
      <div className="grid grid-cols-3 gap-3">
        <StripStat label="Ready to Assign" value={readyToAssign} />
        <StripStat label="On-budget cash" value={onBudgetCash} />
        <StripStat label={categoryName} value={categoryAvailable} />
      </div>
      {Math.round(ahead * 100) !== 0 && (
        <div className="mt-2 truncate border-t border-white/5 pt-2 text-[11px] tabular-nums text-white/50">
          {dollars(ahead)} assigned in future months
        </div>
      )}
    </GlassCard>
  );
}

function StripStat({ label, value }: { label: string; value: number }) {
  const negative = Math.round(value * 100) < 0;
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-white/50">
        {label}
      </div>
      <div
        className={`truncate text-sm font-semibold tabular-nums ${
          negative ? "text-rose-300" : "text-white/90"
        }`}
      >
        {dollars(value)}
      </div>
    </div>
  );
}

function envelopes(n: number): string {
  return `${n} ${n === 1 ? "envelope" : "envelopes"}`;
}

/**
 * What the fund actually did, in one line — rendered on every tap, success
 * included. A one-tap action that moves money silently is the thing the user
 * cannot check afterwards; this is the receipt.
 */
function fundReport(plan: FundMonthPlan): string {
  if (plan.funding === 0) {
    return plan.shortfall > 0
      ? `Nothing to move — Ready to Assign is empty, ${dollars(plan.shortfall)} still short`
      : "Every target is already funded — nothing to move";
  }
  const moved = `Funded ${envelopes(plan.funding)}, ${dollars(plan.total)} moved`;
  return plan.shortfall > 0 ? `${moved} — ${dollars(plan.shortfall)} still short` : moved;
}

/**
 * Say what is about to move before it moves. Shared by both Fund buttons (the
 * month header's and the untouched-month prompt's) so the confirmation is not
 * a property of which button you happened to tap.
 */
function FundMonthDialog({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: FundMonthPlan;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
      >
        <motion.div
          className="w-full max-w-sm"
          initial={{ scale: 0.94, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.94, y: 20, opacity: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 24 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Fund this month"
        >
          <GlassCard intensity="strong" className="space-y-4 p-6">
            <h2 className="text-lg font-semibold tracking-tight text-white/95">
              Fund this month
            </h2>
            <p className="text-sm text-white/75">
              Move {dollars(plan.total)} into {envelopes(plan.funding)}?
            </p>
            {plan.shortfall > 0 && (
              <p className="text-xs text-white/55">
                Ready to Assign runs out first — {dollars(plan.shortfall)} of this
                month's targets stays unfunded.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <GlassButton size="sm" variant="secondary" onClick={onCancel}>
                Cancel
              </GlassButton>
              <GlassButton size="sm" variant="yes" onClick={onConfirm}>
                Move {dollars(plan.total)}
              </GlassButton>
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function BudgetScreen() {
  const budget = useStore((s) => s.budget);
  const budgetFocus = useUI((s) => s.budgetFocus);
  const lastUsedTxn = useUI((s) => s.lastUsedTxn);
  const [month, setMonth] = useState<MonthKey>(() => ymKey());
  // Live-derived: any edit to the book lands here on the next render.
  const snap = useMemo(() => snapshot(budget, month), [budget, month]);
  // Ready-to-Assign stops at the viewed month, so dollars parked further out
  // are invisible to it — call them out rather than let them look unspent.
  const ahead = useMemo(() => assignedAfter(budget, month), [budget, month]);

  // Same fallback the fast-entry FAB uses (w2-fastentry): the last category
  // used for the last-used account, or Uncategorized if that pointer is
  // stale/missing/hidden — never blank. Both figures below come from `snap`,
  // already computed above, so this adds no snapshot() call.
  const stripCategoryId = useMemo(() => {
    const remembered = lastUsedTxn?.categoryByAccount[lastUsedTxn.accountId];
    if (remembered && budget.categories.some((c) => c.id === remembered && !c.hidden)) {
      return remembered;
    }
    return UNCATEGORIZED_CATEGORY_ID;
  }, [lastUsedTxn, budget.categories]);
  const stripCategoryName = categoryLabel(budget.categories, stripCategoryId);
  const stripCategoryAvailable = snap.categories[stripCategoryId]?.available ?? 0;
  // "Cash on budget" = every dollar still sitting in an envelope plus what's
  // unassigned — the two terms `snap` already carries, summed in cents to
  // stay exact.
  const onBudgetCash = useMemo(() => {
    let cents = toCents(snap.readyToAssign);
    for (const c of Object.values(snap.categories)) cents += toCents(c.available);
    return fromCents(cents);
  }, [snap]);

  // Assignments are keyed per month, so every month opens with every envelope
  // back at zero. The plan is re-derived on each edit purely to answer "is
  // anything still short of its monthly target?" — the tap itself re-plans
  // against the freshest book.
  const plan = useMemo(() => planFundMonth(budget, month), [budget, month]);
  const unmet = plan.underfunded.length > 0 || plan.funding > 0;
  // An untouched month is the real cliff: not a wall of failed goal bars, just
  // a month nobody has funded yet.
  const untouched = Object.keys(budget.assignments[month] ?? {}).length === 0;
  const [report, setReport] = useState<{ month: MonthKey; text: string } | null>(null);
  // The plan the confirmation dialog is describing — re-planned at tap time,
  // so what the dialog states is exactly what Confirm will apply.
  const [pending, setPending] = useState<FundMonthPlan | null>(null);

  const applyFund = (fresh: FundMonthPlan) => {
    if (fresh.ops.setAssignments?.length) useStore.getState().applyBookOps(fresh.ops);
    setReport({ month, text: fundReport(fresh) });
    setPending(null);
  };

  // Both Fund buttons land here. Nothing to move means nothing to confirm —
  // go straight to the report rather than opening a "Move $0?" dialog.
  const requestFund = () => {
    const fresh = planFundMonth(useStore.getState().budget, month);
    if (fresh.funding === 0) applyFund(fresh);
    else setPending(fresh);
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
            </div>
          </div>
          {/* The button retires the moment every target is met — it would do
              nothing. The report does NOT: a successful fund empties the need
              and would otherwise take its own receipt down with it, leaving a
              tap that moved four figures with no trace on screen. */}
          {(unmet || (report !== null && report.month === month)) && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
              {unmet && <FundMonthButton onClick={requestFund} />}
              {report && report.month === month && (
                <span className="text-xs tabular-nums text-white/55">{report.text}</span>
              )}
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* Zero-tap "can I afford this" strip (w2-today-strip): static, no
          motion wrapper — this is read on every open and must render
          instantly, not fade in. */}
      <TodayStrip
        readyToAssign={snap.readyToAssign}
        onBudgetCash={onBudgetCash}
        categoryName={stripCategoryName}
        categoryAvailable={stripCategoryAvailable}
        ahead={ahead}
      />

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...M.fade, delay: 0.1 }}
      >
        <CategoryGroups
          month={month}
          snap={snap}
          untouched={untouched && unmet}
          onFundMonth={requestFund}
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

      {pending && (
        <FundMonthDialog
          plan={pending}
          onConfirm={() => applyFund(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
