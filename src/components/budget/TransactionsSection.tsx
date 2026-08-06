import { memo, useEffect, useMemo, useState } from "react";
import { useStore } from "../../state/store";
import type { Account, Txn } from "../../state/schema";
import { RTA_CATEGORY_ID, UNCATEGORIZED_CATEGORY_ID, newId } from "../../state/schema";
import { isOnBudget, isoDay } from "../../budget/ledger";
import { GlassCard } from "../glass/GlassCard";
import { GlassButton } from "../glass/GlassButton";
import { GlassInput, GlassSelect } from "../glass/GlassInput";
import { NumberField } from "../glass/NumberField";
import { KebabMenu } from "../glass/KebabMenu";
import { Field, SectionTitle, dollars } from "./bits";

type Mode = "expense" | "income" | "transfer";

const MODE_LABEL: Record<Mode, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex gap-1.5">
      {(Object.keys(MODE_LABEL) as Mode[]).map((m) => {
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

function AccountSelect({
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

function CategorySelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
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

function AddTxnForm({ accounts }: { accounts: Account[] }) {
  const [mode, setMode] = useState<Mode>("expense");
  const [accountId, setAccountId] = useState(() => accounts[0]?.id ?? "");
  const [fromId, setFromId] = useState(() => accounts[0]?.id ?? "");
  const [toId, setToId] = useState("");
  const [date, setDate] = useState(isoDay());
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState(0);
  // Pre-selected so an expense can never be saved with no envelope at all —
  // money that leaves an account with no category leaves the envelope system
  // entirely (see bookIntegrity's unbudgetedSpending residual).
  const [categoryId, setCategoryId] = useState(UNCATEGORIZED_CATEGORY_ID);

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
    if (mode === "transfer") {
      useStore.getState().addTransfer({
        from: fromId,
        to: toId,
        amount: magnitude,
        date,
        // Same rule as the expense branch below: where money crosses the
        // budget boundary it has to land in an envelope, so "— No category —"
        // falls back to the catch-all rather than leaking out of the system.
        categoryId: transferNeedsCategory
          ? categoryId || UNCATEGORIZED_CATEGORY_ID
          : undefined,
      });
    } else {
      useStore.getState().addTxn({
        id: newId(),
        accountId,
        date,
        payee: payee.trim() || undefined,
        amount: mode === "expense" ? -magnitude : magnitude,
        categoryId:
          mode === "income" ? RTA_CATEGORY_ID : categoryId || UNCATEGORIZED_CATEGORY_ID,
        source: "manual",
      });
    }
    setPayee("");
    setAmount(0);
  };

  return (
    <div className="space-y-3">
      <ModeToggle mode={mode} onChange={setMode} />

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

      <div className="flex justify-end pt-1">
        <GlassButton
          size="sm"
          variant="primary"
          disabled={!canSubmit}
          onClick={submit}
          className="disabled:opacity-40"
        >
          Add {MODE_LABEL[mode].toLowerCase()}
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
}: {
  txn: Txn;
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
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
    <div className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white/90">{title}</div>
        <div className="truncate text-[11px] tabular-nums text-white/45">{sub}</div>
      </div>
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
    </GlassCard>
  );
}
