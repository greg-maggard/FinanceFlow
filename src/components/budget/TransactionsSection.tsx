import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import type { Account, Category, Txn } from "../../state/schema";
import { RTA_CATEGORY_ID, UNCATEGORIZED_CATEGORY_ID, newId } from "../../state/schema";
import { isOnBudget, isoDay } from "../../budget/ledger";
import { ADJUST_ACCOUNT_ID } from "../../budget/nodeLedger";
import { GlassCard } from "../glass/GlassCard";
import { GlassButton } from "../glass/GlassButton";
import { GlassInput, GlassSelect } from "../glass/GlassInput";
import { NumberField } from "../glass/NumberField";
import { KebabMenu } from "../glass/KebabMenu";
import { Field, SectionTitle, dollars } from "./bits";

export type Mode = "expense" | "income" | "transfer";

/** What just landed and where, for a save confirmation (w2-fastentry). */
export type SavedTxnInfo = { amount: number; envelopeName: string };

export const MODE_LABEL: Record<Mode, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

/** A category's display name for a save confirmation, matching the
 *  "Uncategorized" label CategorySelect/TxnRow already use. */
export function categoryLabel(categories: Category[], id: string): string {
  if (id === UNCATEGORIZED_CATEGORY_ID) return "Uncategorized";
  return categories.find((c) => c.id === id)?.name ?? "Uncategorized";
}

export function ModeToggle({
  mode,
  onChange,
  modes = Object.keys(MODE_LABEL) as Mode[],
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  /** Which modes to offer — narrowed to expense/income while editing an
   *  existing row, since turning an edit into a transfer would have to
   *  conjure a second leg (see AddTxnForm's editingTxn branch). */
  modes?: Mode[];
}) {
  return (
    <div className="flex gap-1.5">
      {modes.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium"
            style={{
              background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)",
              border: `1px solid rgba(255,255,255,${active ? 0.22 : 0.1})`,
              color: `rgba(255,255,255,${active ? 0.95 : 0.65})`,
            }}
          >
            {MODE_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

export function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  accounts: Account[];
  placeholder: string;
}) {
  return (
    <GlassSelect value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— {placeholder} —</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </GlassSelect>
  );
}

export function CategorySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const budget = useStore((s) => s.budget);
  const groups = [...budget.groups].sort((a, b) => a.order - b.order);
  // The catch-all envelope is created lazily, so offer it even before it's in
  // the book — choosing it (or saving an expense with nothing else picked) is
  // what brings it into being.
  const knowsUncategorized = budget.categories.some((c) => c.id === UNCATEGORIZED_CATEGORY_ID);
  return (
    <GlassSelect value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— No category —</option>
      {!knowsUncategorized && (
        <option value={UNCATEGORIZED_CATEGORY_ID}>Uncategorized</option>
      )}
      {groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {budget.categories
            .filter((c) => c.groupId === g.id && !c.hidden)
            .sort((a, b) => a.order - b.order)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </GlassSelect>
  );
}

/**
 * The full expense/income/transfer form. `mode`/`onModeChange` are optional
 * and controlled — pass both to drive the mode from outside (the fast-entry
 * FAB does this so its own ModeToggle stays the single source of truth
 * instead of stacking a second one); omit both and the form manages its own
 * mode and renders its own toggle, as TransactionsSection uses it below.
 * `onSaved` fires once a save actually commits, naming the amount and
 * envelope it landed in, for callers that want to surface a confirmation.
 */
export function AddTxnForm({
  accounts,
  mode: controlledMode,
  onModeChange,
  onSaved,
  editingTxn,
  onCancelEdit,
}: {
  accounts: Account[];
  mode?: Mode;
  onModeChange?: (m: Mode) => void;
  onSaved?: (info: SavedTxnInfo) => void;
  /** Pre-fills every field from an existing (non-transfer) row and switches
   *  Save to `updateTxn` in place instead of adding a new one (w2-edit-txn).
   *  Callers must never pass a transfer leg here — TransactionsSection's
   *  editor refuses those before this component ever mounts, since editing
   *  one leg without its mirror would break the drift invariant. */
  editingTxn?: Txn;
  /** Fires once a save or cancel finishes an edit, so the caller can close
   *  whatever chrome (e.g. a modal) is hosting the form. No-op outside edit. */
  onCancelEdit?: () => void;
}) {
  const [internalMode, setInternalMode] = useState<Mode>(() =>
    editingTxn && editingTxn.categoryId === RTA_CATEGORY_ID ? "income" : "expense",
  );
  const mode = controlledMode ?? internalMode;
  const setMode = onModeChange ?? setInternalMode;
  // Only render our own toggle when nobody outside is already driving mode —
  // otherwise the caller's toggle and this one would fight over one value.
  const showOwnToggle = controlledMode === undefined;
  const categories = useStore((s) => s.budget.categories);
  const [accountId, setAccountId] = useState(() => editingTxn?.accountId ?? accounts[0]?.id ?? "");
  const [fromId, setFromId] = useState(() => accounts[0]?.id ?? "");
  const [toId, setToId] = useState("");
  const [date, setDate] = useState(() => editingTxn?.date ?? isoDay());
  const [payee, setPayee] = useState(() => editingTxn?.payee ?? "");
  const [amount, setAmount] = useState(() => Math.abs(editingTxn?.amount ?? 0));
  // Pre-selected so an expense can never be saved with no envelope at all —
  // money that leaves an account with no category leaves the envelope system
  // entirely (see bookIntegrity's unbudgetedSpending residual).
  const [categoryId, setCategoryId] = useState(
    () => editingTxn?.categoryId ?? UNCATEGORIZED_CATEGORY_ID,
  );

  const kindOf = (id: string) => accounts.find((a) => a.id === id)?.kind;
  const fromKind = kindOf(fromId);
  const toKind = kindOf(toId);
  // A category only matters where money crosses the budget boundary.
  const transferNeedsCategory =
    fromKind !== undefined &&
    toKind !== undefined &&
    fromId !== toId &&
    isOnBudget(fromKind) !== isOnBudget(toKind);

  const magnitude = Math.abs(amount);
  const canSubmit =
    Math.round(magnitude * 100) > 0 &&
    date.length > 0 &&
    (mode === "transfer" ? Boolean(fromId && toId && fromId !== toId) : Boolean(accountId));

  const submit = () => {
    if (!canSubmit) return;
    // Editing never offers the transfer mode (see ModeToggle's `modes` prop
    // below), but guard defensively anyway: one leg of a transfer must never
    // be rewritten on its own, or the mirrored pair drifts apart.
    if (editingTxn && mode === "transfer") return;
    let envelopeName: string;
    if (mode === "transfer") {
      const transferCategoryId = transferNeedsCategory
        ? categoryId || UNCATEGORIZED_CATEGORY_ID
        : undefined;
      useStore.getState().addTransfer({
        from: fromId,
        to: toId,
        amount: magnitude,
        date,
        // Same rule as the expense branch below: where money crosses the
        // budget boundary it has to land in an envelope, so "— No category —"
        // falls back to the catch-all rather than leaking out of the system.
        categoryId: transferCategoryId,
      });
      envelopeName = transferCategoryId
        ? categoryLabel(categories, transferCategoryId)
        : (accounts.find((a) => a.id === toId)?.name ?? "another account");
    } else {
      const finalCategoryId =
        mode === "income" ? RTA_CATEGORY_ID : categoryId || UNCATEGORIZED_CATEGORY_ID;
      const finalAmount = mode === "expense" ? -magnitude : magnitude;
      if (editingTxn) {
        // Same id, same row count — spread over the original so anything
        // this form doesn't surface (memo, plaidTxnId, source, ...) survives
        // the edit untouched.
        useStore.getState().updateTxn({
          ...editingTxn,
          accountId,
          date,
          payee: payee.trim() || undefined,
          amount: finalAmount,
          categoryId: finalCategoryId,
        });
      } else {
        useStore.getState().addTxn({
          id: newId(),
          accountId,
          date,
          payee: payee.trim() || undefined,
          amount: finalAmount,
          categoryId: finalCategoryId,
          source: "manual",
        });
        // Shared fast-entry memory (w2-fastentry): every expense, from this
        // full form or the FAB's fast path, refreshes the FAB's next pre-fill.
        // Editing an existing row isn't a fresh entry, so it doesn't retrain it.
        if (mode === "expense") {
          useUI.getState().recordTxnUsage(accountId, finalCategoryId);
        }
      }
      envelopeName = mode === "income" ? "Ready to Assign" : categoryLabel(categories, finalCategoryId);
    }
    onSaved?.({ amount: magnitude, envelopeName });
    if (editingTxn) {
      onCancelEdit?.();
      return;
    }
    setPayee("");
    setAmount(0);
  };

  return (
    <div className="space-y-3">
      {showOwnToggle && (
        <ModeToggle
          mode={mode}
          onChange={setMode}
          modes={editingTxn ? ["expense", "income"] : undefined}
        />
      )}

      {mode === "transfer" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <AccountSelect
                value={fromId}
                onChange={(id) => {
                  setFromId(id);
                  if (id && id === toId) setToId("");
                }}
                accounts={accounts}
                placeholder="Pick account"
              />
            </Field>
            <Field label="To">
              <AccountSelect
                value={toId}
                onChange={setToId}
                accounts={accounts.filter((a) => a.id !== fromId)}
                placeholder="Pick account"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount $">
              <NumberField value={amount} onChange={setAmount} min={0} />
            </Field>
            <Field label="Date">
              <GlassInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ colorScheme: "dark" }}
              />
            </Field>
          </div>
          {transferNeedsCategory && (
            <Field label="Category (budget side)">
              <CategorySelect value={categoryId} onChange={setCategoryId} />
            </Field>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account">
              <AccountSelect
                value={accountId}
                onChange={setAccountId}
                accounts={accounts}
                placeholder="Pick account"
              />
            </Field>
            <Field label="Date">
              <GlassInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ colorScheme: "dark" }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payee">
              <GlassInput
                placeholder={mode === "expense" ? "e.g. Grocery store" : "e.g. Paycheck"}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </Field>
            <Field label="Amount $">
              <NumberField value={amount} onChange={setAmount} min={0} />
            </Field>
          </div>
          <Field label="Category">
            {mode === "income" ? (
              <GlassSelect value={RTA_CATEGORY_ID} disabled className="opacity-60">
                <option value={RTA_CATEGORY_ID}>Ready to Assign</option>
              </GlassSelect>
            ) : (
              <CategorySelect value={categoryId} onChange={setCategoryId} />
            )}
          </Field>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {editingTxn && (
          <GlassButton size="sm" variant="secondary" onClick={onCancelEdit}>
            Cancel
          </GlassButton>
        )}
        <GlassButton
          size="sm"
          variant="primary"
          disabled={!canSubmit}
          onClick={submit}
          className="disabled:opacity-40"
        >
          {editingTxn ? "Save changes" : `Add ${MODE_LABEL[mode].toLowerCase()}`}
        </GlassButton>
      </div>
    </div>
  );
}

// Memoized so a budget mutation elsewhere on the screen (e.g. a keystroke in
// a category's Assigned field) doesn't re-render every transaction row.
// Props are memo-friendly: `txn` is a stable object reference per row, and
// the name Maps are useMemo'd by the parent.
const TxnRow = memo(function TxnRow({
  txn,
  accountNames,
  categoryNames,
  onEdit,
}: {
  txn: Txn;
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
  /** Row tap opens the editor (w2-edit-txn); the row itself decides nothing
   *  about whether that's allowed — a transfer leg still opens it, and the
   *  modal is what refuses. */
  onEdit: (txn: Txn) => void;
}) {
  const isTransfer = Boolean(txn.transferAccountId);
  const cents = Math.round(txn.amount * 100);
  const title = isTransfer
    ? `Transfer ${cents < 0 ? "→" : "←"} ${
        accountNames.get(txn.transferAccountId ?? "") ?? "Unknown account"
      }`
    : txn.payee?.trim() || "No payee";
  const sub = [
    txn.date,
    accountNames.get(txn.accountId) ?? "Unknown account",
    txn.categoryId ? categoryNames.get(txn.categoryId) ?? "Uncategorized" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5">
      {/* A real <button>, sibling to the KebabMenu below rather than an
          ancestor `role="button"` wrapping it — that older shape let the
          kebab's own keydown bubble up into this row's handler, so Enter on
          the kebab (or on "Delete transaction") always opened Edit and
          delete was unreachable by keyboard. Siblings don't intercept each
          other's keys. */}
      <button
        type="button"
        onClick={() => onEdit(txn)}
        aria-label={`Edit ${title}`}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <div className="truncate text-sm font-medium text-white/90">{title}</div>
        <div className="truncate text-[11px] tabular-nums text-white/45">{sub}</div>
      </button>
      <span
        className={`text-sm font-semibold tabular-nums ${
          cents < 0 ? "text-red-300/90" : cents > 0 ? "text-emerald-300/90" : "text-white/60"
        }`}
      >
        {dollars(txn.amount)}
      </span>
      {/* The add form above leaves headroom, so row menus unfold upward and
          never clip against the card's bottom edge. */}
      <KebabMenu ariaLabel="Transaction actions" drop="up">
        <div className="space-y-2">
          {isTransfer && (
            <p className="text-[11px] text-white/45">
              Both sides of the transfer go together.
            </p>
          )}
          <button
            type="button"
            onClick={() => useStore.getState().deleteTxn(txn.id)}
            className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-red-300 hover:bg-red-500/10"
          >
            Delete {isTransfer ? "transfer" : "transaction"}
          </button>
        </div>
      </KebabMenu>
    </div>
  );
});

/**
 * Hosts AddTxnForm in edit mode for a normal row, or a plain refusal for a
 * transfer leg or a machine-generated balance-adjustment row.
 *
 * Transfers refuse because editing one leg without its mirror would desync
 * the pair (see store.ts's paired addTransfer/deleteTxn).
 *
 * Balance-adjustment rows (accountId === ADJUST_ACCOUNT_ID) refuse for a
 * parallel reason: `outstandingAdjustments` finds the write-off to unwind by
 * filtering on `monthOf(t.date) === month` (nodeLedger.ts), so the date on
 * this row is load-bearing. Moving it to another month via this form would
 * strand the adjustment outside the window planBalanceEdit unwinds, and the
 * next balance edit on that envelope would assign a fresh correction from
 * Ready to Assign on top of the one that already ran — the user pays for the
 * same correction twice. Category and amount edits mostly self-heal on the
 * next balance edit; a cross-month date edit does not, so the whole row is
 * refused the same way a transfer leg is (spec: "Refusing is acceptable for
 * this item").
 */
function EditTxnModal({
  txn,
  accounts,
  onClose,
}: {
  txn: Txn;
  accounts: Account[];
  onClose: () => void;
}) {
  const isTransfer = Boolean(txn.transferAccountId);
  const isAdjustment = txn.accountId === ADJUST_ACCOUNT_ID;
  const isRefused = isTransfer || isAdjustment;
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
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
              <h2 className="text-lg font-semibold tracking-tight text-white/95">
                {isTransfer ? "Transfer" : isAdjustment ? "Balance adjustment" : "Edit transaction"}
              </h2>
              <button
                onClick={onClose}
                className="text-white/40 hover:text-white/85"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {isRefused ? (
              <div className="space-y-4">
                <p className="text-sm text-white/70">
                  {isTransfer
                    ? "Transfers can't be edited here — the two linked rows would drift out of sync. Delete the transfer from its kebab menu and re-enter it instead."
                    : "Balance adjustments can't be edited here — this row's date is what keeps it inside the month it corrects. Moving it would let the same correction get charged again next time this envelope's balance is fixed. Delete the adjustment from its kebab menu and re-enter the balance edit instead."}
                </p>
                <div className="flex justify-end">
                  <GlassButton size="sm" variant="secondary" onClick={onClose}>
                    Got it
                  </GlassButton>
                </div>
              </div>
            ) : (
              <AddTxnForm accounts={accounts} editingTxn={txn} onCancelEdit={onClose} />
            )}
          </GlassCard>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Render this many rows up front; "Show more" reveals another page.
const PAGE_SIZE = 50;

export function TransactionsSection() {
  // Narrowed subscriptions: only the slices this section actually reads, so
  // a mutation elsewhere in the budget (e.g. an Assigned-field keystroke)
  // doesn't re-render the whole transaction list. Each call returns a stable
  // array reference until that slice itself changes, so plain per-slice
  // selectors are safe here — no fresh-object selector to trip zustand 5's
  // re-render loop guard.
  const allTransactions = useStore((s) => s.budget.transactions);
  const allAccounts = useStore((s) => s.budget.accounts);
  const allCategories = useStore((s) => s.budget.categories);
  const accounts = allAccounts.filter((a) => !a.closed);

  // Most recent date first; the stable sort keeps insertion order within a day.
  const txns = useMemo(
    () => [...allTransactions].sort((a, b) => b.date.localeCompare(a.date)),
    [allTransactions],
  );
  const accountNames = useMemo(
    () => new Map(allAccounts.map((a) => [a.id, a.name])),
    [allAccounts],
  );
  const categoryNames = useMemo(
    () =>
      new Map([
        [RTA_CATEGORY_ID, "Ready to Assign"],
        ...allCategories.map((c) => [c.id, c.name] as [string, string]),
      ]),
    [allCategories],
  );

  // The row currently open in the edit modal, or null when it's closed.
  const [editingTxn, setEditingTxn] = useState<Txn | null>(null);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Keep the user's place. `txns` gets a fresh identity on every add, delete
  // and edit, so resetting to page 1 here would throw away their scroll
  // position every time they delete a row — and the delete button lives
  // inside the rows being collapsed. Only clamp when the list actually got
  // shorter than what's on screen.
  useEffect(() => {
    setVisibleCount((n) => Math.min(n, Math.max(PAGE_SIZE, txns.length)));
  }, [txns]);
  const visibleTxns = useMemo(() => txns.slice(0, visibleCount), [txns, visibleCount]);
  const hasMore = visibleCount < txns.length;

  return (
    <GlassCard className="px-5 py-4">
      <div className="space-y-3">
        <SectionTitle>Transactions</SectionTitle>

        {accounts.length === 0 ? (
          <p className="text-sm text-white/65">
            Add an account first — transactions need a home.
          </p>
        ) : (
          <>
            {/* Remounts when the first account arrives, so defaults pick it up. */}
            <AddTxnForm key={accounts[0].id} accounts={accounts} />
            <div className="h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
            <div className="divide-y divide-white/5">
              {visibleTxns.map((t) => (
                <TxnRow
                  key={t.id}
                  txn={t}
                  accountNames={accountNames}
                  categoryNames={categoryNames}
                  onEdit={setEditingTxn}
                />
              ))}
              {txns.length === 0 && (
                <p className="py-1 text-xs text-white/40">
                  No transactions yet — income lands in Ready to Assign.
                </p>
              )}
            </div>
            {txns.length > 0 && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-white/40">
                  {visibleTxns.length.toLocaleString()} of {txns.length.toLocaleString()}
                </span>
                {hasMore && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                    className="rounded-full px-3 py-1.5 text-[11px] font-medium text-white/65 hover:text-white/95"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    Show more
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {editingTxn && (
        <EditTxnModal
          txn={editingTxn}
          accounts={accounts}
          onClose={() => setEditingTxn(null)}
        />
      )}
    </GlassCard>
  );
}
