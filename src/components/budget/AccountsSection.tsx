import { useState } from "react";
import { useStore } from "../../state/store";
import type { Account, AccountKind } from "../../state/schema";
import { newId } from "../../state/schema";
import { accountBalance, isOnBudget } from "../../budget/ledger";
import { GlassCard } from "../glass/GlassCard";
import { GlassInput, GlassSelect } from "../glass/GlassInput";
import { Field, SectionTitle, dollars } from "./bits";

const KIND_LABEL: Record<AccountKind, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  credit: "Credit card",
  loan: "Loan",
  tracking: "Tracking",
};

function AccountRow({ account, balance }: { account: Account; balance: number }) {
  const negative = Math.round(balance * 100) < 0;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white/90">{account.name}</div>
        <div className="text-[11px] text-white/45">{KIND_LABEL[account.kind]}</div>
      </div>
      <span
        className={`text-sm font-semibold tabular-nums ${
          negative ? "text-red-300/90" : "text-white/90"
        }`}
      >
        {dollars(balance)}
      </span>
    </div>
  );
}

function AccountList({ caption, accounts }: { caption: string; accounts: Account[] }) {
  const budget = useStore((s) => s.budget);
  if (accounts.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">{caption}</div>
      <div className="divide-y divide-white/5">
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} balance={accountBalance(budget, a.id)} />
        ))}
      </div>
    </div>
  );
}

export function AccountsSection() {
  const budget = useStore((s) => s.budget);
  const accounts = budget.accounts.filter((a) => !a.closed);
  const empty = accounts.length === 0;

  // The first account is the whole point of the empty state, so the form
  // starts unfolded there and stays tucked away once accounts exist.
  const [adding, setAdding] = useState(empty);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("checking");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    useStore.getState().addAccount({ id: newId(), name: trimmed, kind, source: "manual" });
    setName("");
    setKind("checking");
    setAdding(false);
  };

  return (
    <GlassCard className="px-5 py-4">
      <div className="space-y-3">
        <SectionTitle>Accounts</SectionTitle>

        {empty ? (
          <p className="text-sm text-white/65">
            Add your first account — the budget starts where the money lives.
          </p>
        ) : (
          <div className="space-y-3">
            <AccountList caption="On budget" accounts={accounts.filter((a) => isOnBudget(a.kind))} />
            <AccountList caption="Off budget" accounts={accounts.filter((a) => !isOnBudget(a.kind))} />
          </div>
        )}

        {adding ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2">
            <Field label="Name">
              <GlassInput
                autoFocus={!empty}
                placeholder="e.g. Everyday Checking"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  else if (e.key === "Escape" && !empty) setAdding(false);
                }}
              />
            </Field>
            <Field label="Kind">
              <GlassSelect value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </GlassSelect>
            </Field>
            <button
              type="button"
              onClick={submit}
              className="rounded-xl px-3 py-2 text-xs font-medium text-white/80 hover:text-white/95"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              Add
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full rounded-xl border border-dashed border-white/15 py-2 text-xs text-white/65 hover:bg-white/5"
          >
            + Add account
          </button>
        )}
      </div>
    </GlassCard>
  );
}
