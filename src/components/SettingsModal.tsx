import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";
import { bookIntegrity } from "../budget/ledger";
import { ymKey } from "../state/recurring";
import { GlassCard } from "./glass/GlassCard";
import { FieldLabel } from "./glass/GlassInput";
import { NumberField } from "./glass/NumberField";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function relativeTime(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * "Last saved" read-out, fed by the same successful-save path as the
 * persist-failure banner (see store.ts writeNow / uiStore.ts lastSavedAt) —
 * a corroborating, human-visible signal that saves are actually landing,
 * visible even before a failure would surface the banner.
 */
function LastSaved() {
  const lastSavedAt = useUI((s) => s.lastSavedAt);
  const [now, setNow] = useState(() => Date.now());

  // Ticks while the modal is open so the relative label ("5s ago" -> "1m
  // ago") advances even without a fresh save.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-baseline justify-between gap-4 text-[11px] text-white/45">
      <span>Last saved</span>
      <span className="tabular-nums">
        {lastSavedAt ? relativeTime(lastSavedAt, now) : "not yet"}
      </span>
    </div>
  );
}

/**
 * Conservation-of-money read-out. Every dollar in an on-budget account must be
 * sitting in an envelope, waiting in Ready-to-Assign, or spent outside the
 * budget — a non-zero drift means the book invented or lost money.
 */
function IntegrityCheck() {
  const budget = useStore((s) => s.budget);
  const integrity = bookIntegrity(budget, ymKey());
  const ok = integrity.drift === 0;
  const rows: [string, number][] = [
    ["On-budget cash", integrity.onBudgetCash],
    ["Sum of available", integrity.sumAvailable],
    ["Ready to assign", integrity.readyToAssign],
    ["Unbudgeted spending", integrity.unbudgetedSpending],
  ];

  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">
        Check integrity
      </div>
      <dl className="space-y-1 text-[12px] text-white/70">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt>{label}</dt>
            <dd className="tabular-nums text-white/90">{money(value)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 pt-1">
          <dt className={ok ? "text-emerald-300" : "text-red-300"}>
            {ok ? "Balanced" : "Drift"}
          </dt>
          <dd className={`tabular-nums ${ok ? "text-emerald-300" : "text-red-300"}`}>
            {money(integrity.drift)}
          </dd>
        </div>
      </dl>
      <span className="text-[11px] text-white/45">
        {ok
          ? "Every dollar is accounted for."
          : "The books don't balance — this is a bug, not your data."}
      </span>
    </div>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md max-h-[85vh]"
            initial={{ scale: 0.94, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <GlassCard intensity="strong" className="max-h-[85vh] overflow-y-auto p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight text-white/95">Settings</h2>
                <button
                  onClick={onClose}
                  className="text-white/40 hover:text-white/85"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <FieldLabel>Monthly expenses ($)</FieldLabel>
                  <NumberField
                    value={settings.monthlyExpenses ?? 0}
                    onChange={(v) =>
                      useStore.getState().setSettings({
                        monthlyExpenses: v || undefined,
                      })
                    }
                  />
                  <span className="text-[11px] text-white/45">
                    Drives emergency fund targets.
                  </span>
                </label>
                <label className="block space-y-1.5">
                  <FieldLabel>Pre-tax annual income ($)</FieldLabel>
                  <NumberField
                    value={settings.preTaxIncome ?? 0}
                    onChange={(v) =>
                      useStore.getState().setSettings({
                        preTaxIncome: v || undefined,
                      })
                    }
                  />
                  <span className="text-[11px] text-white/45">For the 15% retirement check.</span>
                </label>
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">
                    Annual contribution limits
                  </div>
                  <label className="block space-y-1.5">
                    <FieldLabel>IRA</FieldLabel>
                    <NumberField
                      value={settings.iraAnnualLimit}
                      onChange={(v) =>
                        useStore.getState().setSettings({ iraAnnualLimit: v })
                      }
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <FieldLabel>HSA self</FieldLabel>
                      <NumberField
                        value={settings.hsaSelfLimit}
                        onChange={(v) =>
                          useStore.getState().setSettings({ hsaSelfLimit: v })
                        }
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <FieldLabel>HSA family</FieldLabel>
                      <NumberField
                        value={settings.hsaFamilyLimit}
                        onChange={(v) =>
                          useStore.getState().setSettings({ hsaFamilyLimit: v })
                        }
                      />
                    </label>
                  </div>
                </div>
                <IntegrityCheck />
                <LastSaved />
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
