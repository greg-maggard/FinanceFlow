import { FieldLabel, GlassInput, GlassSelect } from "../glass/GlassInput";
import { NumberField } from "../glass/NumberField";
import { KebabMenu } from "../glass/KebabMenu";
import { useStore } from "../../state/store";
import type { Account, Category, NodeId } from "../../state/schema";
import { emergencyFundTarget, bigEmergencyFundTarget } from "../../state/schema";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { ymKey } from "../../state/recurring";
import { isoDay, snapshot } from "../../budget/ledger";
import {
  COLLEGE_ACCOUNT_ID,
  collegeBalance,
  debtRows,
  efCategories,
  efTarget,
  linkedCategories,
  nodeRows,
  planBalanceEdit,
  planCollegeBalanceEdit,
  planCreateDebtAccount,
  planCreateLinkedCategory,
  planDebtBalanceEdit,
  planMarkDebtPaid,
} from "../../budget/nodeLedger";
import { useUI, type BudgetFocus } from "../../state/uiStore";
import { ConfirmDelete } from "../budget/CategoryGroups";
import { InlineAdd, dollars } from "../budget/bits";

/**
 * Node forms edit the envelope ledger directly — every dollar field here is
 * the same envelope or account the Budget screen shows, so the two views can
 * never disagree. Money edits always target the current month (`ymKey()`);
 * percent/limit fields that have no ledger meaning stay node payloads.
 */

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1.5">
    <FieldLabel>{label}</FieldLabel>
    {children}
  </label>
);

// ---------------------------------------------------------------------------
// Ledger writes. Handlers re-read the live store so per-keystroke planners
// always see the latest book — a render-time copy would compound edits.

function patchCategory(id: string, patch: Partial<Category>) {
  const s = useStore.getState();
  const cat = s.budget.categories.find((c) => c.id === id);
  if (cat) s.updateCategory({ ...cat, ...patch });
}

function assignThisMonth(categoryId: string, v: number) {
  useStore.getState().assign(ymKey(), categoryId, v);
}

/** Drive an envelope's available to the typed value (absolute-target planner). */
function setAvailable(categoryId: string, v: number) {
  const s = useStore.getState();
  s.applyBookOps(planBalanceEdit(s.budget, ymKey(), categoryId, v, isoDay()));
}

function addCategoryFor(nodeId: NodeId, name: string) {
  const s = useStore.getState();
  s.applyBookOps(planCreateLinkedCategory(s.budget, nodeId, name).ops);
}

function patchAccount(id: string, patch: Partial<Account>) {
  const s = useStore.getState();
  const account = s.budget.accounts.find((a) => a.id === id);
  if (account) s.updateAccount({ ...account, ...patch });
}

function setOutstanding(accountId: string, v: number) {
  const s = useStore.getState();
  s.applyBookOps(planDebtBalanceEdit(s.budget, accountId, v, isoDay()));
}

function markDebtPaid(accountId: string) {
  const s = useStore.getState();
  s.applyBookOps(planMarkDebtPaid(s.budget, accountId, isoDay()));
}

// ---------------------------------------------------------------------------
// Shared row chrome

/**
 * Cross-navigation chip: jumps to this row's envelope/account on the Budget
 * screen, which scrolls to it and pulses. Plain button — no transient chrome,
 * so no TapAway token.
 */
function OpenInBudget({ target }: { target: BudgetFocus }) {
  return (
    <button
      type="button"
      title="Open in Budget"
      aria-label="Open in Budget"
      onClick={() => useUI.getState().openInBudget(target)}
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white/55 transition hover:text-white/85"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      Budget ↗
    </button>
  );
}

/** One editable envelope/account row: name up top, fields below, kebab for the rest. */
function RowCard({
  name,
  placeholder,
  onRename,
  aside,
  budgetTarget,
  menu,
  drop,
  children,
}: {
  name: string;
  placeholder: string;
  onRename: (name: string) => void;
  aside?: React.ReactNode;
  /** Where this row lives on the Budget screen, for the Open-in-Budget chip. */
  budgetTarget?: BudgetFocus;
  menu: React.ReactNode;
  drop: "down" | "up";
  children: React.ReactNode;
}) {
  return (
    <motion.div
      layout
      className="space-y-2 rounded-xl p-3"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-2">
        <GlassInput placeholder={placeholder} value={name} onChange={(e) => onRename(e.target.value)} />
        {aside}
        {budgetTarget && <OpenInBudget target={budgetTarget} />}
        <div className="shrink-0">
          <KebabMenu ariaLabel={`${name || placeholder} actions`} drop={drop}>
            {menu}
          </KebabMenu>
        </div>
      </div>
      {children}
    </motion.div>
  );
}

/** Two-tap close for debt accounts — closing hides the row, never the history. */
function ConfirmClose({ name, onClose }: { name: string; onClose: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="space-y-1.5">
      {armed && (
        <p className="text-[11px] text-white/45">
          The account closes; its history stays in Accounts.
        </p>
      )}
      <button
        type="button"
        onClick={() => (armed ? onClose() : setArmed(true))}
        className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-red-300 hover:bg-red-500/10"
      >
        {armed ? "Tap again to confirm" : `Remove ${name}`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recurring nodes — envelopes in the Bills group

type RecurringNodeId =
  | "Rent"
  | "Food"
  | "Essential"
  | "Income"
  | "Health"
  | "MinDebt"
  | "NonEssential";

const RECURRING_LABEL: Record<RecurringNodeId, string> = {
  Rent: "Rent / mortgage",
  Food: "Groceries",
  Essential: "Utilities & essentials",
  Income: "Transportation, internet, phone",
  Health: "Insurance & health care",
  MinDebt: "Total minimum payments",
  NonEssential: "Non-essential subscriptions",
};

export function RecurringEditor({ nodeId }: { nodeId: RecurringNodeId }) {
  const budget = useStore((s) => s.budget);
  const [draftId, setDraftId] = useState<string | null>(null);
  const month = ymKey();
  const snap = useMemo(() => snapshot(budget, month), [budget, month]);
  const rows = nodeRows(budget, snap, nodeId);
  const label = RECURRING_LABEL[nodeId] ?? nodeId;

  /** First edit on a bare node materializes its single envelope, named for the node. */
  const ensureCategory = (): string => {
    const s = useStore.getState();
    const existing = linkedCategories(s.budget, nodeId);
    if (existing.length > 0) return existing[0].id;
    const plan = planCreateLinkedCategory(s.budget, nodeId, label);
    s.applyBookOps(plan.ops);
    setDraftId(plan.categoryId);
    return plan.categoryId;
  };

  // The simple pair stays mounted through the edit that creates the envelope,
  // so typing isn't interrupted by the switch to row mode.
  const simple = rows.length === 0 || (rows.length === 1 && rows[0].category.id === draftId);

  return (
    <div className="space-y-4">
      {simple ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly target ($)">
              <NumberField
                value={rows[0]?.category.monthlyTarget ?? 0}
                onChange={(v) =>
                  patchCategory(ensureCategory(), { monthlyTarget: v > 0 ? v : undefined })
                }
              />
            </Field>
            <Field label="Saved this month ($)">
              <NumberField
                value={rows[0]?.assigned ?? 0}
                onChange={(v) => assignThisMonth(ensureCategory(), v)}
              />
            </Field>
          </div>
          {rows[0] && <OpenInBudget target={{ categoryId: rows[0].category.id }} />}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">
            Items — bar totals their goals
          </div>
          {rows.map((row, i) => (
            <RowCard
              key={row.category.id}
              name={row.category.name}
              placeholder="Item name (e.g., Power)"
              onRename={(name) => patchCategory(row.category.id, { name })}
              budgetTarget={{ categoryId: row.category.id }}
              drop={i === 0 ? "down" : "up"}
              menu={
                <ConfirmDelete cat={row.category} name={row.category.name || "item"} />
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Target $">
                  <NumberField
                    value={row.category.monthlyTarget ?? 0}
                    onChange={(v) =>
                      patchCategory(row.category.id, { monthlyTarget: v > 0 ? v : undefined })
                    }
                  />
                </Field>
                <Field label="Saved $">
                  <NumberField
                    value={row.assigned}
                    onChange={(v) => assignThisMonth(row.category.id, v)}
                  />
                </Field>
              </div>
            </RowCard>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {simple && (
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">
            Or split into items
          </div>
        )}
        <InlineAdd
          label="Add item"
          placeholder="Item name (e.g., Power)"
          onAdd={(name) => addCategoryFor(nodeId, name)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emergency fund — both milestones edit the same SmallEF/BigEF envelope union

export function EFEditor({ nodeId }: { nodeId: "SmallEF" | "BigEF" }) {
  const budget = useStore((s) => s.budget);
  const nodes = useStore((s) => s.nodes);
  const settings = useStore((s) => s.settings);
  const [draftId, setDraftId] = useState<string | null>(null);
  const month = ymKey();
  const snap = useMemo(() => snapshot(budget, month), [budget, month]);
  const rows = nodeRows(budget, snap, nodeId);

  const targetMonths =
    (nodes.BigEF.data as { targetMonths?: 3 | 4 | 5 | 6 } | undefined)?.targetMonths ?? 3;
  const computed =
    nodeId === "SmallEF"
      ? emergencyFundTarget(settings.monthlyExpenses)
      : bigEmergencyFundTarget(targetMonths, settings.monthlyExpenses);
  const target = efTarget(budget, nodeId, computed);

  /** First edit on an empty fund materializes the single v1-style envelope. */
  const ensureCategory = (): string => {
    const s = useStore.getState();
    const existing = efCategories(s.budget);
    if (existing.length > 0) return existing[0].id;
    const months =
      (s.nodes.BigEF.data as { targetMonths?: 3 | 4 | 5 | 6 } | undefined)?.targetMonths ?? 3;
    const comp =
      nodeId === "SmallEF"
        ? emergencyFundTarget(s.settings.monthlyExpenses)
        : bigEmergencyFundTarget(months, s.settings.monthlyExpenses);
    const plan = planCreateLinkedCategory(
      s.budget,
      nodeId,
      "Emergency Fund",
      comp > 0 ? { balanceTarget: comp } : undefined,
    );
    s.applyBookOps(plan.ops);
    setDraftId(plan.categoryId);
    return plan.categoryId;
  };

  const simple = rows.length === 0 || (rows.length === 1 && rows[0].category.id === draftId);

  const hint = (
    <div className="text-xs text-white/55">
      {target > 0 ? (
        <>
          Target: <span className="font-semibold text-white/85">{dollars(target)}</span>
        </>
      ) : (
        "Set monthly expenses in Settings to compute target."
      )}
    </div>
  );

  const monthsSelect = nodeId === "BigEF" && (
    <Field label="Target months">
      <GlassSelect
        value={targetMonths}
        onChange={(e) =>
          useStore.getState().patchNodeData("BigEF", {
            targetMonths: Number(e.target.value) as 3 | 4 | 5 | 6,
          })
        }
      >
        <option value={3}>3 months</option>
        <option value={4}>4 months</option>
        <option value={5}>5 months</option>
        <option value={6}>6 months</option>
      </GlassSelect>
    </Field>
  );

  const balanceField = (
    <Field label="Current balance">
      <NumberField
        value={rows[0]?.available ?? 0}
        onChange={(v) => setAvailable(ensureCategory(), v)}
      />
    </Field>
  );

  if (simple) {
    return (
      <div className="space-y-3">
        {nodeId === "BigEF" ? (
          <div className="grid grid-cols-2 gap-3">
            {monthsSelect}
            {balanceField}
          </div>
        ) : (
          <>
            {hint}
            {balanceField}
          </>
        )}
        {nodeId === "BigEF" && hint}
        {rows[0] && <OpenInBudget target={{ categoryId: rows[0].category.id }} />}
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">
            Or split into buckets
          </div>
          <InlineAdd
            label="Add bucket"
            placeholder="Bucket name (e.g., Car repairs)"
            onAdd={(name) => addCategoryFor(nodeId, name)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {monthsSelect}
      {hint}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <RowCard
            key={row.category.id}
            name={row.category.name}
            placeholder="Bucket name (e.g., Car repairs)"
            onRename={(name) => patchCategory(row.category.id, { name })}
            budgetTarget={{ categoryId: row.category.id }}
            drop={i === 0 ? "down" : "up"}
            menu={
              <ConfirmDelete cat={row.category} name={row.category.name || "bucket"} />
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Target $">
                <NumberField
                  value={row.category.balanceTarget ?? 0}
                  onChange={(v) =>
                    patchCategory(row.category.id, { balanceTarget: v > 0 ? v : undefined })
                  }
                />
              </Field>
              <Field label="Balance $">
                <NumberField
                  value={row.available}
                  onChange={(v) => setAvailable(row.category.id, v)}
                />
              </Field>
            </div>
          </RowCard>
        ))}
      </div>
      <InlineAdd
        label="Add bucket"
        placeholder="Bucket name (e.g., Car repairs)"
        onAdd={(name) => addCategoryFor(nodeId, name)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payload-only nodes — percent and limit fields with no ledger meaning

export function MatchFields() {
  const nodes = useStore((s) => s.nodes);
  const data =
    (nodes.Match.data as { matchPct: number; currentContribPct: number } | undefined) ?? {
      matchPct: 0,
      currentContribPct: 0,
    };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Match cap %">
        <NumberField
          step="0.5"
          value={data.matchPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Match", { matchPct: v })
          }
        />
      </Field>
      <Field label="Your %">
        <NumberField
          step="0.5"
          value={data.currentContribPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Match", { currentContribPct: v })
          }
        />
      </Field>
    </div>
  );
}

export function IRAFields() {
  const nodes = useStore((s) => s.nodes);
  const settings = useStore((s) => s.settings);
  const data = (nodes.IRA.data as
    | {
        type: "roth" | "traditional";
        ytdContribution: { value: number; source: "manual" };
        annualLimit: number;
      }
    | undefined) ?? {
    type: "roth" as const,
    ytdContribution: { value: 0, source: "manual" as const },
    annualLimit: settings.iraAnnualLimit,
  };
  return (
    <div className="space-y-3">
      <Field label="Type">
        <GlassSelect
          value={data.type}
          onChange={(e) =>
            useStore.getState().patchNodeData("IRA", {
              type: e.target.value as "roth" | "traditional",
            })
          }
        >
          <option value="roth">Roth IRA</option>
          <option value="traditional">Traditional IRA</option>
        </GlassSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="YTD">
          <NumberField
            value={data.ytdContribution.value}
            onChange={(v) =>
              useStore.getState().patchNodeData("IRA", {
                ytdContribution: { value: v, source: "manual" },
              })
            }
          />
        </Field>
        <Field label="Annual limit">
          <NumberField
            value={data.annualLimit}
            onChange={(v) =>
              useStore.getState().patchNodeData("IRA", { annualLimit: v })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function HSAFields() {
  const nodes = useStore((s) => s.nodes);
  const settings = useStore((s) => s.settings);
  const data = (nodes.HSA.data as
    | {
        coverage: "self" | "family";
        ytdContribution: { value: number; source: "manual" };
        annualLimit: number;
      }
    | undefined) ?? {
    coverage: "self" as const,
    ytdContribution: { value: 0, source: "manual" as const },
    annualLimit: settings.hsaSelfLimit,
  };
  return (
    <div className="space-y-3">
      <Field label="Coverage">
        <GlassSelect
          value={data.coverage}
          onChange={(e) => {
            const cov = e.target.value as "self" | "family";
            useStore.getState().patchNodeData("HSA", {
              coverage: cov,
              annualLimit: cov === "self" ? settings.hsaSelfLimit : settings.hsaFamilyLimit,
            });
          }}
        >
          <option value="self">Self-only</option>
          <option value="family">Family</option>
        </GlassSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="YTD">
          <NumberField
            value={data.ytdContribution.value}
            onChange={(v) =>
              useStore.getState().patchNodeData("HSA", {
                ytdContribution: { value: v, source: "manual" },
              })
            }
          />
        </Field>
        <Field label="Annual limit">
          <NumberField
            value={data.annualLimit}
            onChange={(v) =>
              useStore.getState().patchNodeData("HSA", { annualLimit: v })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function Increase401kFields() {
  const nodes = useStore((s) => s.nodes);
  const data = (nodes.Increase401k.data as
    | { currentPct: number; targetPct: number }
    | undefined) ?? { currentPct: 0, targetPct: 15 };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Your %">
        <NumberField
          step="0.5"
          value={data.currentPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Increase401k", { currentPct: v })
          }
        />
      </Field>
      <Field label="Target %">
        <NumberField
          step="0.5"
          value={data.targetPct}
          onChange={(v) =>
            useStore.getState().patchNodeData("Increase401k", { targetPct: v })
          }
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Savings goals — SavePurchase and Goals share one editor over linked envelopes

export function GoalEditor({ nodeId }: { nodeId: "SavePurchase" | "Goals" }) {
  const budget = useStore((s) => s.budget);
  const month = ymKey();
  const snap = useMemo(() => snapshot(budget, month), [budget, month]);
  const rows = nodeRows(budget, snap, nodeId);
  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-white/45">Add a goal to start saving toward it.</p>
      )}
      {rows.map((row, i) => (
        <RowCard
          key={row.category.id}
          name={row.category.name}
          placeholder="Goal"
          onRename={(name) => patchCategory(row.category.id, { name })}
          budgetTarget={{ categoryId: row.category.id }}
          drop={i === 0 ? "down" : "up"}
          menu={
            <ConfirmDelete cat={row.category} name={row.category.name || "goal"} />
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Target $">
              <NumberField
                value={row.category.balanceTarget ?? 0}
                onChange={(v) =>
                  patchCategory(row.category.id, { balanceTarget: v > 0 ? v : undefined })
                }
              />
            </Field>
            <Field label="Saved $">
              <NumberField
                value={row.available}
                onChange={(v) => setAvailable(row.category.id, v)}
              />
            </Field>
          </div>
          <Field label="By date">
            <GlassInput
              type="date"
              value={row.category.targetDate ?? ""}
              onChange={(e) =>
                patchCategory(row.category.id, { targetDate: e.target.value || undefined })
              }
            />
          </Field>
        </RowCard>
      ))}
      <InlineAdd
        label="Add goal"
        placeholder="Goal name"
        onAdd={(name) => addCategoryFor(nodeId, name)}
      />
    </div>
  );
}

export function CollegeFields() {
  const nodes = useStore((s) => s.nodes);
  const budget = useStore((s) => s.budget);
  const data = (nodes.College.data as
    | { monthlyContribution: number; targetAge?: number }
    | undefined) ?? { monthlyContribution: 0 };
  // The 529 account materializes on the first balance edit; the chip only
  // shows once there's an account row on the Budget screen to jump to.
  const hasCollegeAccount = budget.accounts.some(
    (a) => a.id === COLLEGE_ACCOUNT_ID && !a.closed,
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Monthly $">
        <NumberField
          value={data.monthlyContribution}
          onChange={(v) =>
            useStore.getState().patchNodeData("College", { monthlyContribution: v })
          }
        />
      </Field>
      <div className="space-y-1.5">
        <Field label="Balance $">
          <NumberField
            value={collegeBalance(budget)}
            onChange={(v) => {
              const s = useStore.getState();
              s.applyBookOps(planCollegeBalanceEdit(s.budget, v, isoDay()));
            }}
          />
        </Field>
        {hasCollegeAccount && <OpenInBudget target={{ accountId: COLLEGE_ACCOUNT_ID }} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debts — rows are open loan accounts linked to the node

export function DebtEditor({
  nodeId,
  aprThreshold,
}: {
  nodeId: "HighDebt" | "ModDebt";
  aprThreshold: number;
}) {
  const budget = useStore((s) => s.budget);
  const rows = debtRows(budget, nodeId);

  const addDebt = () => {
    const s = useStore.getState();
    s.applyBookOps(
      planCreateDebtAccount(
        s.budget,
        nodeId,
        { name: "", balance: 0, apr: aprThreshold, minPayment: 0 },
        isoDay(),
      ).ops,
    );
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-white/55">
        Threshold: <span className="font-semibold text-white/85">{aprThreshold}%+ APR</span>. Avalanche
        (highest APR first) or snowball (smallest balance first).
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-white/45">Add a debt to track your payoff.</p>
      )}
      {rows.map((row, i) => (
        <RowCard
          key={row.account.id}
          name={row.account.name}
          placeholder="Name"
          onRename={(name) => patchAccount(row.account.id, { name })}
          budgetTarget={{ accountId: row.account.id }}
          drop={i === 0 ? "down" : "up"}
          aside={
            row.paid ? (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: "rgba(52, 211, 153, 0.14)",
                  color: "#a7f3d0",
                  border: "1px solid rgba(52, 211, 153, 0.32)",
                }}
              >
                Paid
              </span>
            ) : (
              <button
                type="button"
                onClick={() => markDebtPaid(row.account.id)}
                className="shrink-0 rounded-full px-3 py-1 text-[11px] font-medium"
                style={{
                  background: "rgba(52, 211, 153, 0.14)",
                  border: "1px solid rgba(52, 211, 153, 0.32)",
                  color: "#a7f3d0",
                }}
              >
                Mark paid
              </button>
            )
          }
          menu={
            <ConfirmClose
              name={row.account.name || "debt"}
              onClose={() => patchAccount(row.account.id, { closed: true })}
            />
          }
        >
          <div className="grid grid-cols-3 gap-2">
            <Field label="Balance">
              <NumberField
                value={row.outstanding}
                onChange={(v) => setOutstanding(row.account.id, v)}
              />
            </Field>
            <Field label="APR %">
              <NumberField
                step="0.1"
                value={row.account.apr ?? 0}
                onChange={(v) => patchAccount(row.account.id, { apr: v })}
              />
            </Field>
            <Field label="Min pay">
              <NumberField
                value={row.account.minPayment ?? 0}
                onChange={(v) => patchAccount(row.account.id, { minPayment: v })}
              />
            </Field>
          </div>
        </RowCard>
      ))}
      <button
        type="button"
        onClick={addDebt}
        className="w-full rounded-xl border border-dashed border-white/15 py-2 text-xs text-white/65 hover:bg-white/5"
      >
        + Add debt
      </button>
    </div>
  );
}

export const FORM_BY_NODE: Partial<Record<NodeId, () => JSX.Element>> = {
  Rent: () => <RecurringEditor nodeId="Rent" />,
  Food: () => <RecurringEditor nodeId="Food" />,
  Essential: () => <RecurringEditor nodeId="Essential" />,
  Income: () => <RecurringEditor nodeId="Income" />,
  Health: () => <RecurringEditor nodeId="Health" />,
  MinDebt: () => <RecurringEditor nodeId="MinDebt" />,
  NonEssential: () => <RecurringEditor nodeId="NonEssential" />,
  SmallEF: () => <EFEditor nodeId="SmallEF" />,
  BigEF: () => <EFEditor nodeId="BigEF" />,
  Match: MatchFields,
  IRA: IRAFields,
  HSA: HSAFields,
  Increase401k: Increase401kFields,
  SavePurchase: () => <GoalEditor nodeId="SavePurchase" />,
  College: CollegeFields,
  HighDebt: () => <DebtEditor nodeId="HighDebt" aprThreshold={10} />,
  ModDebt: () => <DebtEditor nodeId="ModDebt" aprThreshold={4} />,
  Goals: () => <GoalEditor nodeId="Goals" />,
};

// Goal settings moved inline — the editors above ARE the settings, so the
// kebab menu has nothing left to hold. The map stays for FocusCard's wiring.
export const MENU_BY_NODE: Partial<Record<NodeId, () => JSX.Element>> = {};
