import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";
import type { Account } from "../state/schema";
import { UNCATEGORIZED_CATEGORY_ID, newId } from "../state/schema";
import { isoDay } from "../budget/ledger";
import { GlassCard } from "./glass/GlassCard";
import { GlassButton } from "./glass/GlassButton";
import { GlassInput } from "./glass/GlassInput";
import { NumberField } from "./glass/NumberField";
import { Field, dollars } from "./budget/bits";
import {
  AccountSelect,
  AddTxnForm,
  CategorySelect,
  ModeToggle,
  categoryLabel,
  type Mode,
  type SavedTxnInfo,
} from "./budget/TransactionsSection";

/**
 * The expense fast path (w2-fastentry): Amount first and autofocused,
 * then Category, then optional Payee last — the inverse of the full form's
 * order, because on this path Amount is the only field a user must type.
 * Account and date are never shown here at all; they're silently pre-filled
 * from last use (see uiStore's `lastUsedTxn`) rather than costing a tap,
 * which is what keeps the whole flow at "tap FAB, type amount, tap Save".
 */
function FastExpenseForm({
  accounts,
  onSaved,
}: {
  accounts: Account[];
  onSaved: (info: SavedTxnInfo) => void;
}) {
  const categories = useStore((s) => s.budget.categories);
  const lastUsedTxn = useUI((s) => s.lastUsedTxn);

  // Never blank (w1-bug3): fall back to the most recent account, then the
  // first account, and to Uncategorized for the category either way.
  const initialAccountId = (() => {
    const preferred = lastUsedTxn?.accountId;
    if (preferred && accounts.some((a) => a.id === preferred)) return preferred;
    return accounts[0]?.id ?? "";
  })();
  const categoryForAccount = (accId: string): string => {
    const remembered = lastUsedTxn?.categoryByAccount[accId];
    if (remembered && categories.some((c) => c.id === remembered && !c.hidden)) {
      return remembered;
    }
    return UNCATEGORIZED_CATEGORY_ID;
  };

  const [accountId, setAccountId] = useState(initialAccountId);
  const [categoryId, setCategoryId] = useState(() => categoryForAccount(initialAccountId));
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState(0);

  const magnitude = Math.abs(amount);
  const canSubmit = magnitude > 0 && Boolean(accountId);

  const submit = () => {
    if (!canSubmit) return;
    const finalCategoryId = categoryId || UNCATEGORIZED_CATEGORY_ID;
    useStore.getState().addTxn({
      id: newId(),
      accountId,
      date: isoDay(),
      payee: payee.trim() || undefined,
      amount: -magnitude,
      categoryId: finalCategoryId,
      source: "manual",
    });
    useUI.getState().recordTxnUsage(accountId, finalCategoryId);
    onSaved({ amount: magnitude, envelopeName: categoryLabel(categories, finalCategoryId) });
  };

  return (
    <div className="space-y-3">
      <Field label="Amount $">
        <NumberField autoFocus value={amount} onChange={setAmount} min={0} />
      </Field>
      <Field label="Category">
        <CategorySelect value={categoryId} onChange={setCategoryId} />
      </Field>
      <Field label="Payee (optional)">
        <GlassInput
          placeholder="e.g. Coffee shop"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
        />
      </Field>
      {/* Only surfaced when there's a real choice to make — a single-account
          book has nothing to pick, so this stays out of the tap count. */}
      {accounts.length > 1 && (
        <Field label="Account">
          <AccountSelect
            value={accountId}
            onChange={(id) => {
              setAccountId(id);
              setCategoryId(categoryForAccount(id));
            }}
            accounts={accounts}
            placeholder="Pick account"
          />
        </Field>
      )}
      <div className="flex justify-end pt-1">
        <GlassButton
          size="sm"
          variant="primary"
          disabled={!canSubmit}
          onClick={submit}
          className="disabled:opacity-40"
        >
          Save
        </GlassButton>
      </div>
    </div>
  );
}

function AddTransactionSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (info: SavedTxnInfo) => void;
}) {
  // Selector returns the store's own array reference (stable until accounts
  // actually change); filtering happens outside the selector so zustand 5's
  // useSyncExternalStore never sees a fresh array on every render (the same
  // pattern TransactionsSection uses for this same subscription).
  const allAccounts = useStore((s) => s.budget.accounts);
  const accounts = allAccounts.filter((a) => !a.closed);
  const [mode, setMode] = useState<Mode>("expense");

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-sm"
        initial={{ scale: 0.94, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <GlassCard intensity="strong" className="max-h-[85vh] overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-white/95">
              Add {mode === "expense" ? "expense" : mode}
            </h2>
            <button onClick={onClose} className="text-white/40 hover:text-white/85" aria-label="Close">
              ×
            </button>
          </div>
          {accounts.length === 0 ? (
            <p className="text-sm text-white/65">
              Add an account first — transactions need a home.
            </p>
          ) : (
            <div className="space-y-3">
              <ModeToggle mode={mode} onChange={setMode} />
              {mode === "expense" ? (
                <FastExpenseForm accounts={accounts} onSaved={onSaved} />
              ) : (
                <AddTxnForm accounts={accounts} mode={mode} onModeChange={setMode} onSaved={onSaved} />
              )}
            </div>
          )}
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

function SavedToast({ info }: { info: SavedTxnInfo }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      role="status"
      className="fixed z-40 rounded-2xl px-4 py-2.5 text-sm font-medium text-white/95"
      style={{
        right: "1.25rem",
        bottom: "calc(5.5rem + env(safe-area-inset-bottom))",
        background: "rgba(52, 211, 153, 0.16)",
        border: "1px solid rgba(52, 211, 153, 0.4)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35), 0 0 24px rgba(52, 211, 153, 0.18)",
      }}
    >
      Added {dollars(info.amount)} to {info.envelopeName}
    </motion.div>
  );
}

const TOAST_MS = 2600;

/**
 * The one persistent, always-reachable way to log a transaction (w2-fastentry).
 * Fixed above the safe-area inset so it stays clear of home-indicator gestures
 * on notched devices, and mounted once at the app shell so it's visible on
 * every view — no navigation is ever required to reach it.
 */
export function AddTransactionFab() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<SavedTxnInfo | null>(null);
  // The Overview sheet (z-20) renders a full-bleed node grid; the FAB's own
  // z-30 circle would otherwise float over its bottom-right tile and make it
  // partially untappable. Cleanest fix is to not render the FAB at all while
  // Overview is open, rather than juggle z-index against a sheet meant to
  // cover the whole screen.
  const view = useUI((s) => s.view);

  const handleSaved = (info: SavedTxnInfo) => {
    setOpen(false);
    setToast(info);
    window.setTimeout(() => setToast(null), TOAST_MS);
  };

  return (
    <>
      {view !== "overview" && (
        <motion.button
          type="button"
          aria-label="Add transaction"
          onClick={() => setOpen(true)}
          className="fixed z-30 flex h-14 w-14 items-center justify-center rounded-full text-white/95"
          style={{
            right: "1.25rem",
            bottom: "calc(1.25rem + env(safe-area-inset-bottom))",
            background: "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.30)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.32), 0 10px 30px rgba(0,0,0,0.45), 0 0 32px rgba(255,255,255,0.14)",
          }}
          whileHover={{ scale: 1.05, y: -1 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.25">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </motion.button>
      )}

      {/* Plain conditional, not AnimatePresence: the sheet must be gone from
          the DOM the instant Save (or Close) fires — no exit-animation frame
          for a screen reader or the next interaction to race against. */}
      {open && <AddTransactionSheet onClose={() => setOpen(false)} onSaved={handleSaved} />}

      <AnimatePresence>{toast && <SavedToast key="toast" info={toast} />}</AnimatePresence>
    </>
  );
}
