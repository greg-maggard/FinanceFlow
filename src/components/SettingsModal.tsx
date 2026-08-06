import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";
import type { Cents } from "../state/schema";
import { bookIntegrity } from "../budget/ledger";
import { ymKey } from "../state/recurring";
import { downloadJson, importJson } from "../state/io";
import { readLatestBackup } from "../state/storage";
import { GlassCard } from "./glass/GlassCard";
import { FieldLabel } from "./glass/GlassInput";
import { NumberField } from "./glass/NumberField";

const RESET_PHRASE = "RESET";

/**
 * Off-device backup — the entire backup story until Wave 3's rolling backup
 * key lands, so it's the first item in Settings (reachable in two taps:
 * Settings gear, then Export) rather than sitting under theme options.
 */
function BackupSection() {
  const state = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    try {
      useStore.getState().replaceAll(importJson(text));
    } catch {
      alert("Could not parse that file as FinanceFlow JSON.");
    }
  };

  return (
    <div className="space-y-1.5">
      <FieldLabel>Backup</FieldLabel>
      <div className="flex gap-2">
        <button
          onClick={() => downloadJson(state)}
          className="flex-1 rounded-full px-3 py-2 text-[12px] font-medium text-white/80 hover:text-white/95"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          Export
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 rounded-full px-3 py-2 text-[12px] font-medium text-white/70 hover:text-white/95"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
      </div>
      <span className="text-[11px] text-white/45">
        Your data lives only on this device.
      </span>
    </div>
  );
}

/**
 * Destructive reset, moved out of the header (w2-cleanup) and behind a
 * typed confirmation rather than a bare confirm() — harder to fire by
 * reflex than the OS-native dialog most people click through.
 */
function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  const canReset = phrase.trim().toUpperCase() === RESET_PHRASE;

  return (
    <div className="space-y-2 border-t border-white/10 pt-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-red-300/60">
        Danger zone
      </div>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="w-full rounded-full px-3 py-2 text-[12px] font-medium text-red-300/80 hover:text-red-200"
          style={{
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.18)",
          }}
        >
          Reset all progress
        </button>
      ) : (
        <div
          className="space-y-2 rounded-2xl p-3"
          style={{
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.18)",
          }}
        >
          <p className="text-[11px] text-red-200/80">
            This clears all progress and data on this device. Export a backup
            first if you want to keep it. Type {RESET_PHRASE} to confirm.
          </p>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={RESET_PHRASE}
            autoFocus
            className="w-full rounded-lg px-3 py-1.5 text-[12px] text-white/90 outline-none"
            style={{
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(248,113,113,0.3)",
            }}
          />
          <div className="flex gap-2">
            <button
              disabled={!canReset}
              onClick={() => {
                useStore.getState().reset();
                setConfirming(false);
                setPhrase("");
              }}
              className="flex-1 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: "rgba(248,113,113,0.35)",
                border: "1px solid rgba(248,113,113,0.6)",
              }}
            >
              Reset everything
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                setPhrase("");
              }}
              className="rounded-full px-3 py-1.5 text-[12px] text-white/60 hover:text-white/90"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Integer cents -> "$1,234.56". */
const money = (c: Cents) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

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
 * "Last backup" read-out (w3-backup-key), next to LastSaved above. Reads
 * storage.ts's rolling backup key directly — there's no reactive store slice
 * for it (promotion is a side effect of the persistence write path, not a
 * store mutation) — so it's re-read on the same 5s tick LastSaved uses,
 * which is frequent enough to reflect a promotion that happens to land while
 * Settings is open without needing dedicated plumbing for a value that only
 * ever changes at most once per 24h.
 */
function LastBackup() {
  const [now, setNow] = useState(() => Date.now());
  const [backupAt, setBackupAt] = useState(() => readLatestBackup()?.at ?? null);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setBackupAt(readLatestBackup()?.at ?? null);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-baseline justify-between gap-4 text-[11px] text-white/45">
      <span>Last backup</span>
      <span className="tabular-nums">{backupAt ? relativeTime(backupAt, now) : "none yet"}</span>
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
  const rows: [string, Cents][] = [
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
                <BackupSection />
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
                <LastBackup />
                <DangerZone />
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
