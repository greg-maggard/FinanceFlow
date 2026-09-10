import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "../../state/store";
import type { Account, BudgetBook } from "../../state/schema";
import type { PlaidSnapshot } from "../../budget/plaidImport";
import { planPlaidImport } from "../../budget/plaidImport";
import type { BookOps } from "../../budget/nodeLedger";
import { GlassCard } from "../glass/GlassCard";
import { GlassButton } from "../glass/GlassButton";
import { GlassSelect } from "../glass/GlassInput";
import { SectionTitle } from "./bits";

/**
 * Import a nightly Plaid snapshot (w3-plaid-ui): file in, preview, confirm.
 *
 * Explicitly NOT live Plaid — the nightly JSON already lands on this Mac via
 * Google Drive (a separate, unattended job), so this is a file importer, not
 * an OAuth flow. Nothing here makes a network call; `planPlaidImport`
 * (w3-plaid-planner) is the only logic, this component is entirely the file
 * read, the account-mapping prompt, and the confirm gate around it.
 *
 * Three stages, in order, each gated on the previous:
 * 1. `pick` — read a file (drop or picker), parse it as JSON.
 * 2. `mapping` — shown only when the snapshot references a Plaid account_id
 *    with no local account carrying that `plaidAccountId` yet. The user picks
 *    an existing account per unmapped id, or leaves it skipped.
 * 3. `preview` — the plan `planPlaidImport` would apply against the book AS
 *    IF the chosen mappings were already saved, stated as counts, plus
 *    whatever is still unmapped. Nothing is written until Confirm.
 */

type Stage = "pick" | "mapping" | "preview" | "done";

function pluralTxns(n: number): string {
  return `${n} transaction${n === 1 ? "" : "s"}`;
}

export function PlaidImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const budget = useStore((s) => s.budget);
  const accounts = budget.accounts.filter((a) => !a.closed);

  const [stage, setStage] = useState<Stage>("pick");
  const [fileName, setFileName] = useState("");
  const [snapshot, setSnapshot] = useState<PlaidSnapshot | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Plaid account_id -> chosen local Account.id. Absent means "skip for now".
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // A clean slate every time the sheet opens, so a previous import's state
  // (or error) never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    setStage("pick");
    setFileName("");
    setSnapshot(null);
    setParseError(null);
    setMapping({});
    setImportedCount(0);
  }, [open]);

  // The plan against the book exactly as it stands — used only to decide
  // whether the mapping step is needed at all.
  const rawPlan = useMemo(
    () => (snapshot ? planPlaidImport(budget, snapshot) : null),
    [snapshot, budget],
  );
  const needsMapping = (rawPlan?.skipped.unmappedAccounts.length ?? 0) > 0;

  useEffect(() => {
    if (!snapshot || !rawPlan) return;
    setStage(needsMapping ? "mapping" : "preview");
    // Only advance out of "pick" — re-running planPlaidImport as the book
    // changes underneath an open sheet must not yank the user back a stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // The book AS IF the chosen mappings were already saved — never written
  // until Confirm. This is what the final plan and the preview both read.
  const effectiveBook: BudgetBook = useMemo(() => {
    const entries = Object.entries(mapping);
    if (entries.length === 0) return budget;
    const localIdToPlaidId = new Map(entries.map(([plaidId, localId]) => [localId, plaidId]));
    return {
      ...budget,
      accounts: budget.accounts.map((a) =>
        localIdToPlaidId.has(a.id) ? { ...a, plaidAccountId: localIdToPlaidId.get(a.id)! } : a,
      ),
    };
  }, [budget, mapping]);

  const finalPlan = useMemo(
    () => (snapshot ? planPlaidImport(effectiveBook, snapshot) : null),
    [snapshot, effectiveBook],
  );

  const accountLabel = (plaidAccountId: string): string =>
    snapshot?.accounts?.find((a) => a.account_id === plaidAccountId)?.name || plaidAccountId;

  const loadFile = async (file: File) => {
    setFileName(file.name);
    setParseError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("That file isn't a Plaid snapshot document.");
      }
      setSnapshot(parsed as PlaidSnapshot);
    } catch (err) {
      setSnapshot(null);
      setParseError(
        err instanceof SyntaxError
          ? "Could not parse that file as JSON."
          : (err as Error).message,
      );
    }
  };

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (file) void loadFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  // Which local accounts are still free to offer for `plaidAccountId` — every
  // account already linked to some other Plaid id is off the table, and so is
  // any account this sheet's own (unsaved) picks have already claimed for a
  // different row, so one local account can't be mapped to two Plaid ids by
  // mistake.
  const optionsFor = (plaidAccountId: string): Account[] => {
    const claimedElsewhere = new Set(
      Object.entries(mapping)
        .filter(([id]) => id !== plaidAccountId)
        .map(([, localId]) => localId),
    );
    return accounts.filter((a) => !a.plaidAccountId && !claimedElsewhere.has(a.id));
  };

  const setAccountMapping = (plaidAccountId: string, localAccountId: string) => {
    setMapping((prev) => {
      if (!localAccountId) {
        const { [plaidAccountId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [plaidAccountId]: localAccountId };
    });
  };

  const confirm = () => {
    if (!finalPlan) return;
    const changedAccounts: Account[] = [];
    for (const [plaidAccountId, localAccountId] of Object.entries(mapping)) {
      const account = budget.accounts.find((a) => a.id === localAccountId);
      if (account && account.plaidAccountId !== plaidAccountId) {
        changedAccounts.push({ ...account, plaidAccountId });
      }
    }
    const ops: BookOps = { ...finalPlan.ops };
    if (changedAccounts.length > 0) ops.updateAccounts = changedAccounts;
    useStore.getState().applyBookOps(ops);
    setImportedCount(finalPlan.ops.addTxns?.length ?? 0);
    setStage("done");
  };

  const title =
    stage === "pick"
      ? "Import bank snapshot"
      : stage === "mapping"
        ? "Match accounts"
        : stage === "preview"
          ? "Review import"
          : "Imported";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-md p-4"
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
                <h2 className="text-lg font-semibold tracking-tight text-white/95">{title}</h2>
                <button onClick={onClose} className="text-white/40 hover:text-white/85" aria-label="Close">
                  ×
                </button>
              </div>

              {stage === "pick" && (
                <div className="space-y-3">
                  <p className="text-[12px] text-white/55">
                    Drop the nightly snapshot JSON, or choose the file. Nothing in your budget
                    changes until you review and confirm.
                  </p>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center"
                    style={{
                      borderColor: dragOver ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)",
                      background: dragOver ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <span className="text-[12px] text-white/55">Drag a .json file here</span>
                    <GlassButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => fileRef.current?.click()}
                    >
                      Choose file
                    </GlassButton>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={onFileInput}
                    />
                  </div>
                  {fileName && !parseError && (
                    <p className="text-[11px] text-white/40">Reading {fileName}…</p>
                  )}
                  {parseError && <p className="text-[12px] text-red-300/85">{parseError}</p>}
                  <div className="flex justify-end pt-1">
                    <GlassButton size="sm" variant="secondary" onClick={onClose}>
                      Cancel
                    </GlassButton>
                  </div>
                </div>
              )}

              {stage === "mapping" && rawPlan && (
                <div className="space-y-3">
                  <p className="text-[12px] text-white/60">
                    These Plaid accounts don't match one of yours yet. Pick an existing account
                    for each, or skip — unmapped rows are reported, never attached to the wrong
                    account.
                  </p>
                  <div className="space-y-2">
                    {rawPlan.skipped.unmappedAccounts.map((plaidAccountId) => (
                      <div key={plaidAccountId} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white/85">
                            {accountLabel(plaidAccountId)}
                          </div>
                        </div>
                        <div className="w-40 shrink-0">
                          <GlassSelect
                            aria-label={`Map ${accountLabel(plaidAccountId)} to`}
                            value={mapping[plaidAccountId] ?? ""}
                            onChange={(e) => setAccountMapping(plaidAccountId, e.target.value)}
                          >
                            <option value="">Skip for now</option>
                            {optionsFor(plaidAccountId).map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </GlassSelect>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <GlassButton size="sm" variant="secondary" onClick={onClose}>
                      Cancel
                    </GlassButton>
                    <GlassButton size="sm" variant="primary" onClick={() => setStage("preview")}>
                      Continue
                    </GlassButton>
                  </div>
                </div>
              )}

              {stage === "preview" && finalPlan && (
                <div className="space-y-3">
                  <SectionTitle>What this import will do</SectionTitle>
                  <p className="text-sm text-white/85">
                    Import {pluralTxns(finalPlan.ops.addTxns?.length ?? 0)}, skip{" "}
                    {finalPlan.skipped.duplicates} already imported, skip{" "}
                    {finalPlan.skipped.pending} pending.
                  </p>
                  {finalPlan.skipped.unmappedAccounts.length > 0 && (
                    <div
                      className="rounded-xl p-3 text-[12px] text-white/60"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="mb-1 font-medium text-white/70">
                        Not imported — no matching account:
                      </div>
                      <ul className="space-y-0.5">
                        {finalPlan.skipped.unmappedAccounts.map((id) => (
                          <li key={id}>{accountLabel(id)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-[11px] text-white/40">
                    Imported rows land in Uncategorized for you to sort.
                  </p>
                  <div className="flex justify-end gap-2 pt-1">
                    <GlassButton size="sm" variant="secondary" onClick={onClose}>
                      Cancel
                    </GlassButton>
                    <GlassButton size="sm" variant="primary" onClick={confirm}>
                      Confirm import
                    </GlassButton>
                  </div>
                </div>
              )}

              {stage === "done" && (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-white/85">
                    Imported {pluralTxns(importedCount)} into Uncategorized.
                  </p>
                  <div className="flex justify-center">
                    <GlassButton size="sm" variant="primary" onClick={onClose}>
                      Done
                    </GlassButton>
                  </div>
                </div>
              )}
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
