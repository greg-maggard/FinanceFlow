import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";

const UNDO_MS = 5000;

/**
 * Five-second undo (w3-search-undo) for a transaction delete or a confirmed
 * category delete. Neither delete writes a tombstone — store.ts's
 * deleteTxn/deleteCategory mutate the document immediately, exactly as
 * before this item — this toast just holds what got removed in memory
 * (uiStore's `pendingUndo`) and can hand it straight back:
 *   - a transaction delete restores the exact removed row(s) verbatim
 *     (a transfer's two legs together), so the id round-trips.
 *   - a category delete restores the entire pre-delete book slice, since
 *     deleteCategory reassigns transactions and merges assignments and
 *     nothing narrower round-trips byte-for-byte.
 * Letting the toast expire — or deleting something else, which replaces the
 * pending entry outright — discards the held state for good.
 *
 * Mounted once at the app shell so a delete from anywhere (TransactionsSection,
 * CategoryGroups) surfaces the same toast.
 */
export function UndoToast() {
  const pending = useUI((s) => s.pendingUndo);

  // Keyed on `pending`'s identity: a fresh delete while a toast is already
  // showing replaces `pendingUndo` outright (see the callers), which gives
  // this effect a new object and restarts the five-second window rather than
  // firing early on the previous entry's timer.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => useUI.getState().setPendingUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const undo = () => {
    if (!pending) return;
    if (pending.kind === "txn") {
      useStore.getState().restoreTxns(pending.txns);
    } else {
      useStore.getState().restoreBudget(pending.budget);
    }
    useUI.getState().setPendingUndo(null);
  };

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          key="undo-toast"
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          role="status"
          className="fixed z-40 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium text-white/95"
          style={{
            left: "1.25rem",
            bottom: "calc(1.25rem + env(safe-area-inset-bottom))",
            background: "rgba(248, 113, 113, 0.14)",
            border: "1px solid rgba(248, 113, 113, 0.38)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35), 0 0 24px rgba(248, 113, 113, 0.16)",
          }}
        >
          <span>{pending.message}</span>
          <button
            type="button"
            onClick={undo}
            className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-white/95 hover:bg-white/10"
            style={{ border: "1px solid rgba(255,255,255,0.28)" }}
          >
            Undo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
