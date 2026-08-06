import type {
  Account,
  AppState,
  BudgetBook,
  Category,
  CategoryGroup,
  Cents,
  Decisions,
  NodeDataMap,
  NodeId,
  NodeState,
  Source,
  Txn,
} from "./schema";
import {
  DEFAULT_SETTINGS,
  NODE_IDS,
  RTA_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_ID,
  centsFromDollars,
  emptyNodeState,
  ensureUncategorized,
} from "./schema";
import { ymKey } from "./recurring";
import { isoDay, isOnBudget } from "../budget/ledger";
import {
  COLLEGE_ACCOUNT_ID,
  GROUP_BILLS,
  GROUP_EF,
  GROUP_GOALS,
  ensureGroup,
} from "../budget/nodeLedger";

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(raw: string): AppState {
  const parsed = JSON.parse(raw);
  return migrate(parsed);
}

export function migrate(input: unknown, now: Date = new Date()): AppState {
  if (!input || typeof input !== "object") {
    throw new Error("Not a FinanceFlow document.");
  }
  const obj = input as { version?: number };
  if (obj.version === 4) {
    // A `version: 4` tag alone proves nothing about the payload behind it —
    // see F10 in the wave-1 review: casting here unvalidated let a bare
    // `{"version":4}` boot with an active (and immediately overwriting)
    // persistence subscription, and a doc missing `budget.assignments`
    // white-screened with no recovery route. Validate structurally and
    // throw so loadInitial()'s catch routes to RecoveryScreen instead.
    const err = invalidBookReason(obj);
    if (err) throw new Error(`Stored document isn't a valid FinanceFlow document: ${err}`);
    // Project the seven known top-level fields rather than returning the parsed
    // object itself. Returning it whole carried every unknown key straight into
    // the store — including `writeSeq`, a persistence-internal counter — where
    // `exportJson` then wrote them into user-facing backup files, until the
    // first mutation's `toPersistedSlice` silently dropped them again (so two
    // exports of the "same" document differed). Swift's decoder ignores unknown
    // keys, so projecting here is also what makes the round trip symmetric.
    const v4 = obj as unknown as AppState;
    return {
      version: 4,
      settings: v4.settings,
      decisions: v4.decisions,
      nodes: v4.nodes,
      budget: v4.budget,
      shownCelebrations: v4.shownCelebrations ?? [],
      earnedMedals: v4.earnedMedals ?? [],
    };
  }
  // v3 and v4 are structurally identical — only the units differ — so the same
  // shallow validation guards the v3 document before it is walked.
  if (obj.version === 3) {
    const err = invalidBookReason(obj);
    if (err) throw new Error(`Stored document isn't a valid FinanceFlow document: ${err}`);
    return migrateV3(obj as unknown as V3State);
  }
  if (obj.version === 2) return migrateV3(migrateV2(obj as unknown as V2State, now));
  if (obj.version === 1) {
    return migrateV3(migrateV2(migrateV1(obj as unknown as V1State, now), now));
  }
  // Never silently reset: a document from a newer (or unknown) version must
  // surface as an error the caller can show, not vanish into a fresh state.
  throw new Error(`Unsupported FinanceFlow version: ${String(obj.version)}.`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structural check for a v3/v4 document, run before it's cast or walked.
 * Returns a human-readable reason it's invalid, or `null` when it's shaped
 * correctly enough to trust. Still shallow in the sense that it does not check
 * every *field* of every row — but it does check that every row IS a row, and
 * that every assignment table IS a table.
 *
 * That last part is not pedantry. Without it a damaged document was silently
 * normalized into a different, wrong document: `categories: [7]` became a
 * category with no `id`, `groupId` or `order`, and
 * `assignments: {"2026-06": [1, 2]}` became `{"0": 100, "1": 200}` — array
 * indices reinterpreted as category ids — and the result was written back over
 * the original within one debounce, leaving the D7 backup as the only copy of
 * the user's book. Swift throws on all of these and quarantines the file, so
 * rejecting here is both the safe answer and the cross-platform one: a document
 * this damaged goes to RecoveryScreen with its bytes intact.
 */
function invalidBookReason(obj: Record<string, unknown>): string | null {
  if (!isPlainObject(obj.settings)) return "missing settings.";
  if (!isPlainObject(obj.decisions)) return "missing decisions.";
  if (!isPlainObject(obj.nodes)) return "missing nodes.";
  const budget = obj.budget;
  if (!isPlainObject(budget)) return "missing its budget.";
  if (!Array.isArray(budget.accounts)) return "budget is missing accounts.";
  if (!Array.isArray(budget.transactions)) return "budget is missing transactions.";
  if (!Array.isArray(budget.groups)) return "budget is missing groups.";
  if (!Array.isArray(budget.categories)) return "budget is missing categories.";
  if (!isPlainObject(budget.assignments)) return "budget is missing assignments.";

  for (const table of ["accounts", "transactions", "groups", "categories"] as const) {
    const rows = budget[table] as unknown[];
    const bad = rows.findIndex((row) => !isPlainObject(row));
    if (bad !== -1) return `budget.${table}[${bad}] isn't a record.`;
  }
  for (const [month, table] of Object.entries(budget.assignments as Record<string, unknown>)) {
    if (!isPlainObject(table)) return `budget.assignments["${month}"] isn't a record.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// v3 -> v4: dollars-as-float become integer cents, everywhere at once.
//
// One pure function over a v3 document (money-migration-v4.md §5 step 2). Every
// money field goes through `centsFromDollars` — the §4 rule, evaluated in
// IEEE-754 double so the Swift mirror produces bit-identical output. Percentages
// and rates (`apr`, `matchPct`, `currentContribPct`, `currentPct`, `targetPct`),
// counts (`targetMonths`, `targetAge`, `order`), dates, ids and enums are NOT
// money and are copied through untouched.

/**
 * Optional money: absent stays absent rather than becoming 0. `null` counts as
 * absent — a hand-edited document (or one written by a tool that spells a
 * cleared field as `null`) has no value to convert, and `null * 100` is 0,
 * which would invent a zero the user never entered. Swift's `decodeIfPresent`
 * already reads `null` as "no value", so this is also what keeps the two
 * platforms reading the same bytes the same way.
 */
function optCents(d: number | null | undefined): Cents | undefined {
  return d == null ? undefined : centsFromDollars(d);
}

/**
 * Required money with a fallback: a hand-edited v3 document missing one of the
 * annual limits used to carry `undefined` through untouched. Converting that
 * would produce `NaN`, which serializes as `null` and quietly destroys the
 * field, so fall back to the v4 default instead. (Swift used to answer the same
 * input by throwing `keyNotFound`, which quarantined the entire book over one
 * absent scalar; it now defaults exactly like this.) `null` takes the fallback
 * for the same reason `optCents` treats it as absent.
 */
function requiredCents(d: number | null | undefined, fallback: Cents): Cents {
  return d == null ? fallback : centsFromDollars(d);
}

function migrateV3(v3: V3State): AppState {
  const book = v3.budget;

  const accounts: Account[] = book.accounts.map((a) => ({
    ...a,
    // `apr` is a rate, not money (D8) — it rides through unconverted.
    minPayment: optCents(a.minPayment),
  }));

  const categories: Category[] = book.categories.map((c) => ({
    ...c,
    monthlyTarget: optCents(c.monthlyTarget),
    balanceTarget: optCents(c.balanceTarget),
  }));

  const transactions: Txn[] = book.transactions.map((t) => ({
    ...t,
    amount: centsFromDollars(t.amount),
  }));

  const assignments: Record<string, Record<string, Cents>> = {};
  for (const [month, table] of Object.entries(book.assignments)) {
    const converted: Record<string, Cents> = {};
    for (const [categoryId, amount] of Object.entries(table)) {
      converted[categoryId] = centsFromDollars(amount);
    }
    assignments[month] = converted;
  }

  const groups: CategoryGroup[] = [...book.groups];

  const migrated: BudgetBook = { accounts, transactions, groups, categories, assignments };
  backfillUncategorized(migrated);

  return {
    version: 4,
    settings: {
      monthlyExpenses: optCents(v3.settings.monthlyExpenses),
      preTaxIncome: optCents(v3.settings.preTaxIncome),
      iraAnnualLimit: requiredCents(v3.settings.iraAnnualLimit, DEFAULT_SETTINGS.iraAnnualLimit),
      hsaSelfLimit: requiredCents(v3.settings.hsaSelfLimit, DEFAULT_SETTINGS.hsaSelfLimit),
      hsaFamilyLimit: requiredCents(v3.settings.hsaFamilyLimit, DEFAULT_SETTINGS.hsaFamilyLimit),
    },
    decisions: v3.decisions,
    nodes: migrateNodesToV4(v3.nodes),
    budget: migrated,
    shownCelebrations: v3.shownCelebrations ?? [],
    earnedMedals: v3.earnedMedals ?? [],
  };
}

/**
 * The three node payloads that carry money (IRA, HSA, College). `Match` and
 * `Increase401k` are percentages only (D8) and `BigEF` is a month count, so
 * those ride through untouched; `College.targetAge` is an age, not money.
 *
 * The table is materialized over every `NodeId`, exactly as Swift's legacy
 * decoder does (`LegacyDocument.swift:536`), so a sparse v3 document produces
 * the same 32-node v4 document on both platforms instead of 4 here and 32
 * there. It also removes a real crash on the sparse path: `deriveStatus`
 * (`src/graph/derive.ts`) reads `state.nodes[cur].completed` unguarded and
 * threw on the first absent node, white-screening into the error boundary on a
 * document iOS rendered fine. Unknown ids are dropped for the same reason
 * Swift drops them (it only walks `NodeId.allCases`).
 */
function migrateNodesToV4(
  v3Nodes: Record<NodeId, V3NodeState>,
): Record<NodeId, NodeState> {
  const nodes = {} as Record<NodeId, NodeState>;
  for (const id of NODE_IDS) {
    const legacy = (v3Nodes ?? {})[id];
    if (!legacy || typeof legacy !== "object") {
      nodes[id] = emptyNodeState();
      continue;
    }
    const { data, ...rest } = legacy;
    const node: NodeState = { ...rest };
    if (data !== undefined) {
      if (id === "IRA" || id === "HSA") {
        const d = data as V3ContributionData;
        node.data = {
          ...d,
          ytdContribution: {
            ...d.ytdContribution,
            value: centsFromDollars(d.ytdContribution.value),
          },
          annualLimit: centsFromDollars(d.annualLimit),
        } as NodeDataMap["IRA"] | NodeDataMap["HSA"];
      } else if (id === "College") {
        const d = data as { monthlyContribution: number; targetAge?: number };
        node.data = {
          ...d,
          monthlyContribution: centsFromDollars(d.monthlyContribution),
        } satisfies NodeDataMap["College"];
      } else if (id === "BigEF" || id === "Match" || id === "Increase401k") {
        // Counts and percentages — no money to convert.
        node.data = data as NodeState["data"];
      }
      // Anything else is ledger-owned (v2 -> v3 already stripped it) or a shape
      // this version doesn't know; it does not survive into v4. The Swift
      // mirror drops the same set, so a document round-tripping between the
      // platforms can't gain or lose a payload.
    }
    nodes[id] = node;
  }
  return nodes;
}

/**
 * The one extra rewrite v4 rides along with: every on-budget row that never
 * entered an envelope lands on `cat:uncategorized`, materializing the system
 * group and the envelope in the same pass.
 *
 * The rows selected here are exactly the rows `bookIntegrity` counts in its
 * `unbudgetedSpending` residual: on an on-budget account, carrying no
 * `categoryId`, and not one leg of an on-budget -> on-budget transfer (that
 * pair cancels inside the cash total, so giving it an envelope would invent
 * activity that never happened). An on-budget -> off-budget leg IS included:
 * that money really does leave the budget, and every live write path already
 * makes the user categorize it.
 *
 * Consequence, stated plainly: an uncategorized outflow that used to sit
 * outside the envelope system now shows as overspending in Uncategorized, and
 * a *past* month's overspend sweeps into Ready-to-Assign. That is the
 * correction, not a side effect — the money always left, the book just wasn't
 * saying where from. After this pass `unbudgetedSpending` is 0 and stays 0,
 * which is what makes `drift === 0` an unconditional invariant from v4 forward.
 *
 * Mutates `book` in place. Does nothing (and creates nothing) when the document
 * has no such rows, so a clean book gains no rows the user never asked for.
 */
function backfillUncategorized(book: BudgetBook): void {
  const onBudget = new Set(
    book.accounts.filter((a) => isOnBudget(a.kind)).map((a) => a.id),
  );

  let touched = false;
  book.transactions = book.transactions.map((t) => {
    if (t.categoryId !== undefined) return t;
    if (!onBudget.has(t.accountId)) return t;
    if (t.transferAccountId && onBudget.has(t.transferAccountId)) return t;
    touched = true;
    return { ...t, categoryId: UNCATEGORIZED_CATEGORY_ID };
  });
  if (!touched) return;

  // One definition of the system group + envelope, shared with every live
  // write path (store.addTxn, store.deleteCategory, ...).
  const ensured = ensureUncategorized(book);
  book.groups = ensured.groups;
  book.categories = ensured.categories;
}

// ---------------------------------------------------------------------------
// Legacy document shapes (v1/v2/v3) — decode/migration-only. The live schema no
// longer carries these; see `NodeDataMap` in schema.ts.
//
// EVERY money value below is DOLLARS-as-float. The v1 and v2 migrations are
// deliberately left running in dollars (D6): they are pinned by tests against
// documents that no longer exist anywhere else, and re-deriving them in cents
// would change their output for no gain. The chain is v1 -> v2 -> v3 -> v4, and
// `migrateV3` is the single place units change.

/** Dollars, as they appear in a v1/v2/v3 document. Never `Cents`. */
type Dollars = number;

/**
 * The cents-exact helpers the v1/v2 migrations used to import from the ledger.
 * They moved here when `ledger.ts` went all-integer: the legacy path is the
 * only remaining caller, and keeping them private stops new code reaching for
 * a rounding step that no longer exists anywhere else.
 */
function toCents(n: Dollars): number {
  return Math.round(n * 100);
}

function fromCents(c: number): Dollars {
  return c / 100;
}

/** `accountBalance` in dollars, for the v2 migration's paid-debt check. */
function dollarAccountBalance(book: V3BudgetBook, accountId: string): Dollars {
  let c = 0;
  for (const t of book.transactions) {
    if (t.accountId === accountId) c += toCents(t.amount);
  }
  return fromCents(c);
}

/** The pre-v4 (dollar) emergency-fund targets, frozen for the legacy path. */
function emergencyFundTargetDollars(monthlyExpenses?: Dollars): Dollars {
  if (!monthlyExpenses || monthlyExpenses <= 0) return 1000;
  return Math.max(1000, monthlyExpenses);
}

function bigEmergencyFundTargetDollars(months: number, monthlyExpenses?: Dollars): Dollars {
  if (!monthlyExpenses || monthlyExpenses <= 0) return 0;
  return months * monthlyExpenses;
}

function emptyV3Book(): V3BudgetBook {
  return { accounts: [], transactions: [], groups: [], categories: [], assignments: {} };
}

// The v3 document: structurally identical to `AppState`, but every money field
// is dollars. `migrateV3` consumes exactly this and produces `AppState`.

type SourcedNumber = { value: Dollars; source: Source; lastSyncedAt?: string };

type V3Account = Omit<Account, "minPayment"> & { minPayment?: Dollars };
type V3Txn = Omit<Txn, "amount"> & { amount: Dollars };
type V3Category = Omit<Category, "monthlyTarget" | "balanceTarget"> & {
  monthlyTarget?: Dollars;
  balanceTarget?: Dollars;
};

type V3BudgetBook = {
  accounts: V3Account[];
  transactions: V3Txn[];
  groups: CategoryGroup[];
  categories: V3Category[];
  assignments: Record<string, Record<string, Dollars>>;
};

type V3Settings = {
  monthlyExpenses?: Dollars;
  preTaxIncome?: Dollars;
  iraAnnualLimit: Dollars;
  hsaSelfLimit: Dollars;
  hsaFamilyLimit: Dollars;
};

/** The two node payloads whose money survived into v3: IRA and HSA. */
type V3ContributionData = {
  ytdContribution: SourcedNumber;
  annualLimit: Dollars;
};

type V3NodeState = Omit<NodeState, "data"> & { data?: unknown };

type V3State = {
  version: 3;
  settings: V3Settings;
  decisions: Decisions;
  nodes: Record<NodeId, V3NodeState>;
  budget: V3BudgetBook;
  shownCelebrations?: NodeId[];
  earnedMedals?: number[];
};

type V2RecurringItem = { id: string; name: string; target: SourcedNumber; funded?: SourcedNumber };
type V2RecurringData = { target: SourcedNumber; funded?: SourcedNumber; items?: V2RecurringItem[] };
type V2EFBucket = { id: string; name: string; target: number; balance: SourcedNumber };
type V2SmallEF = { balance: SourcedNumber; items?: V2EFBucket[] };
type V2BigEF = { targetMonths: number; balance?: SourcedNumber; items?: V2EFBucket[] };
type V2PurchaseGoal = { id: string; name: string; target: number; saved: SourcedNumber; byDate?: string };
type V2SavePurchase = {
  goalName: string;
  target: number;
  saved: SourcedNumber;
  byDate?: string;
  items?: V2PurchaseGoal[];
};
type V2Goal = { id: string; name: string; target: number; saved: number; horizonYears: number };
type V2Goals = { items?: V2Goal[] };
type V2Debts = { debts?: V2Debt[] };
type V2Debt = { id: string; name: string; balance: number; apr: number; minPayment: number; paid: boolean };
type V2College = { monthlyContribution: number; balance?: SourcedNumber; targetAge?: number };

type LegacyNodeState = V3NodeState;

/**
 * Which EF payload node supersedes the other. SmallEF grows into BigEF — one
 * real-world fund — so when BigEF holds any data it is the superset and
 * SmallEF is not seeded a second time. This is a DOMAIN rule, not a v1 rule:
 * it has to hold wherever payload-to-ledger seeding happens, or a v2 document
 * carrying items on both nodes gets both funds' buckets and two starting
 * inflows for one fund's worth of cash.
 */
function efPayloadNode(big: V2BigEF | undefined, small: V2SmallEF | undefined): NodeId | null {
  if (big && ((big.balance?.value ?? 0) > 0 || (big.items?.length ?? 0) > 0)) return "BigEF";
  if (small) return "SmallEF";
  return null;
}

type V1State = {
  version: 1;
  settings: V3Settings;
  decisions: Decisions;
  nodes: Record<NodeId, LegacyNodeState>;
  shownCelebrations?: NodeId[];
  earnedMedals?: number[];
};

type V2State = Omit<V1State, "version"> & { version: 2; budget?: V3BudgetBook };

const RECURRING_NODES = [
  "Rent",
  "Food",
  "Essential",
  "Income",
  "Health",
  "MinDebt",
  "NonEssential",
] as const;

// ---------------------------------------------------------------------------
// v1 -> v2: seed the budget book from the node payloads (payloads preserved;
// v2 -> v3 strips them). Deterministic ids — both platforms migrate one
// document identically.
//
// Seeding rule: each funded/saved amount becomes that category's assignment
// in the migration month, and one starting-balance inflow on a seeded Cash
// account covers the total — so every envelope's available matches its v1
// bar exactly and Ready-to-Assign lands at exactly zero.

function migrateV1(v1: V1State, now: Date): V2State {
  const book = emptyV3Book();
  const month = ymKey(now);
  const today = isoDay(now);
  const seeded: Record<string, number> = {};

  const addCategory = (cat: Omit<V3Category, "order">, seed: Dollars) => {
    book.categories.push({ ...cat, order: book.categories.length });
    if (seed > 0) seeded[cat.id] = seed;
  };

  // Bills: the recurring nodes' items (or single target/funded pair).
  book.groups.push({ id: GROUP_BILLS, name: "Bills", order: 0 });
  for (const nodeId of RECURRING_NODES) {
    const data = v1.nodes[nodeId]?.data as V2RecurringData | undefined;
    if (!data) continue;
    if (data.items?.length) {
      for (const item of data.items) {
        addCategory(
          {
            id: `${nodeId}:${item.id}`,
            groupId: GROUP_BILLS,
            name: item.name,
            monthlyTarget: item.target.value,
            nodeId,
          },
          item.funded?.value ?? 0,
        );
      }
    } else if (data.target.value > 0 || (data.funded?.value ?? 0) > 0) {
      addCategory(
        {
          id: nodeId,
          groupId: GROUP_BILLS,
          name: nodeId,
          monthlyTarget: data.target.value,
          nodeId,
        },
        data.funded?.value ?? 0,
      );
    }
  }

  // Emergency fund. SmallEF grows into BigEF, so when BigEF holds any data it
  // is treated as the superset and SmallEF is not seeded a second time.
  book.groups.push({ id: GROUP_EF, name: "Emergency Fund", order: 1 });
  const big = v1.nodes.BigEF?.data as V2BigEF | undefined;
  const small = v1.nodes.SmallEF?.data as V2SmallEF | undefined;
  const efNode = efPayloadNode(big, small);
  if (efNode) {
    const data = (efNode === "BigEF" ? big : small) as V2BigEF & V2SmallEF;
    if (data.items?.length) {
      for (const bucket of data.items) {
        addCategory(
          {
            id: `${efNode}:${bucket.id}`,
            groupId: GROUP_EF,
            name: bucket.name,
            balanceTarget: bucket.target,
            nodeId: efNode,
          },
          bucket.balance.value,
        );
      }
    } else if ((data.balance?.value ?? 0) > 0) {
      const target =
        efNode === "BigEF"
          ? bigEmergencyFundTargetDollars(big!.targetMonths, v1.settings.monthlyExpenses)
          : emergencyFundTargetDollars(v1.settings.monthlyExpenses);
      addCategory(
        {
          id: efNode,
          groupId: GROUP_EF,
          name: "Emergency Fund",
          balanceTarget: target > 0 ? target : undefined,
          nodeId: efNode,
        },
        data.balance!.value,
      );
    }
  }

  // Savings goals: SavePurchase goals plus the long-term Goals list.
  book.groups.push({ id: GROUP_GOALS, name: "Savings Goals", order: 2 });
  const purchase = v1.nodes.SavePurchase?.data as V2SavePurchase | undefined;
  if (purchase?.items?.length) {
    for (const goal of purchase.items) {
      addCategory(
        {
          id: `SavePurchase:${goal.id}`,
          groupId: GROUP_GOALS,
          name: goal.name,
          balanceTarget: goal.target,
          targetDate: goal.byDate,
          nodeId: "SavePurchase",
        },
        goal.saved.value,
      );
    }
  } else if (purchase && (purchase.target > 0 || purchase.saved.value > 0)) {
    addCategory(
      {
        id: "SavePurchase",
        groupId: GROUP_GOALS,
        name: purchase.goalName || "SavePurchase",
        balanceTarget: purchase.target,
        targetDate: purchase.byDate,
        nodeId: "SavePurchase",
      },
      purchase.saved.value,
    );
  }
  const goals = (v1.nodes.Goals?.data as V2Goals | undefined)?.items ?? [];
  for (const goal of goals) {
    addCategory(
      {
        id: `Goals:${goal.id}`,
        groupId: GROUP_GOALS,
        name: goal.name,
        balanceTarget: goal.target,
        nodeId: "Goals",
      },
      goal.saved,
    );
  }

  // Debts become off-budget loan accounts (balance, APR, minimum payment).
  for (const nodeId of ["HighDebt", "ModDebt"] as const) {
    const debts = (v1.nodes[nodeId]?.data as V2Debts | undefined)?.debts ?? [];
    for (const debt of debts) {
      const account: V3Account = {
        id: `debt:${debt.id}`,
        name: debt.name,
        kind: "loan",
        apr: debt.apr,
        minPayment: debt.minPayment,
        source: "manual",
        nodeId,
      };
      book.accounts.push(account);
      if (debt.balance !== 0) {
        book.transactions.push(startingTxn(account.id, today, -debt.balance));
      }
    }
  }

  // The 529 balance becomes a tracking account.
  const college = v1.nodes.College?.data as V2College | undefined;
  if (college && (college.balance?.value ?? 0) > 0) {
    book.accounts.push({
      id: COLLEGE_ACCOUNT_ID,
      name: "529 Plan",
      kind: "tracking",
      source: "manual",
      nodeId: "College",
    });
    book.transactions.push(startingTxn(COLLEGE_ACCOUNT_ID, today, college.balance!.value));
  }

  // Cash account + one RTA inflow covering everything seeded, so the books
  // open balanced: every available equals its v1 bar and RTA is exactly 0.
  book.accounts.push({ id: "acct:cash", name: "Cash", kind: "cash", source: "manual" });
  let totalC = 0;
  for (const v of Object.values(seeded)) totalC += toCents(v);
  if (totalC > 0) {
    book.transactions.push({
      ...startingTxn("acct:cash", today, fromCents(totalC)),
      categoryId: RTA_CATEGORY_ID,
    });
  }
  if (Object.keys(seeded).length > 0) {
    book.assignments = { [month]: seeded };
  }

  return { ...v1, version: 2, budget: book };
}

// ---------------------------------------------------------------------------
// v2 -> v3: reconcile, then strip.
//
// Both UIs were live during v2, so payloads and ledger may have diverged.
// The ledger wins wherever both describe the same thing (it has the
// transaction history); payload items with no linked ledger entity are
// created with the same deterministic ids the v1 migration used, their
// funded/saved amounts seeded as this month's assignments and covered by one
// RTA inflow so Ready-to-Assign is unchanged. The single payload-wins case:
// a debt explicitly marked paid gets a zeroing adjustment, because that user
// action had no ledger representation. Then every ledger-owned payload field
// is stripped; nodes keep only what the ledger doesn't model.

function migrateV2(v2: V2State, now: Date): V3State {
  const book: V3BudgetBook = JSON.parse(JSON.stringify(v2.budget ?? emptyV3Book()));
  const month = ymKey(now);
  const today = isoDay(now);
  const seeded: Record<string, number> = {};

  const catExists = (id: string) => book.categories.some((c) => c.id === id);
  const accountById = (id: string) => book.accounts.find((a) => a.id === id);
  const ensureGrp = (groupId: string) => {
    const group = ensureGroup(book, groupId);
    if (group) book.groups.push(group);
  };
  const addCat = (cat: Omit<V3Category, "order">, seed: Dollars) => {
    ensureGrp(cat.groupId);
    book.categories.push({ ...cat, order: book.categories.length });
    if (seed > 0) seeded[cat.id] = seed;
  };

  // 1. Recurring: create missing payload items; ledger wins where ids match.
  for (const nodeId of RECURRING_NODES) {
    const data = v2.nodes[nodeId]?.data as V2RecurringData | undefined;
    if (!data) continue;
    if (data.items?.length) {
      for (const item of data.items) {
        const id = `${nodeId}:${item.id}`;
        if (catExists(id)) continue;
        addCat(
          { id, groupId: GROUP_BILLS, name: item.name, monthlyTarget: item.target.value, nodeId },
          item.funded?.value ?? 0,
        );
      }
    } else if (data.target.value > 0 || (data.funded?.value ?? 0) > 0) {
      if (!catExists(nodeId)) {
        addCat(
          { id: nodeId, groupId: GROUP_BILLS, name: nodeId, monthlyTarget: data.target.value, nodeId },
          data.funded?.value ?? 0,
        );
      }
    }
  }

  // 2. Emergency fund. Supersession is the same domain rule the v1 migration
  // applies (`efPayloadNode`): only the superseding node's payload seeds
  // anything, so a document with items on BOTH nodes doesn't get both funds'
  // buckets. `unionExists` gates exactly one thing — never create the SCALAR
  // MIRROR when the fund is already bucketed in the ledger. Bucket creation is
  // gated by supersession plus `catExists`.
  const big = v2.nodes.BigEF?.data as V2BigEF | undefined;
  const small = v2.nodes.SmallEF?.data as V2SmallEF | undefined;
  const unionExists = book.categories.some(
    (c) => c.nodeId === "SmallEF" || c.nodeId === "BigEF",
  );
  const efNode = efPayloadNode(big, small);
  if (efNode) {
    const data = (efNode === "BigEF" ? big : small) as V2BigEF & V2SmallEF;
    if (data.items?.length) {
      for (const bucket of data.items) {
        const id = `${efNode}:${bucket.id}`;
        if (catExists(id)) continue;
        addCat(
          {
            id,
            groupId: GROUP_EF,
            name: bucket.name,
            balanceTarget: bucket.target,
            nodeId: efNode,
          },
          bucket.balance.value,
        );
      }
    } else if (!unionExists && (data.balance?.value ?? 0) > 0) {
      const target =
        efNode === "BigEF"
          ? bigEmergencyFundTargetDollars(big!.targetMonths, v2.settings.monthlyExpenses)
          : emergencyFundTargetDollars(v2.settings.monthlyExpenses);
      addCat(
        {
          id: efNode,
          groupId: GROUP_EF,
          name: "Emergency Fund",
          balanceTarget: target > 0 ? target : undefined,
          nodeId: efNode,
        },
        data.balance!.value,
      );
    }
  }

  // 3. SavePurchase / Goals. Goals' horizonYears becomes a target date.
  const purchase = v2.nodes.SavePurchase?.data as V2SavePurchase | undefined;
  if (purchase?.items?.length) {
    for (const goal of purchase.items) {
      const id = `SavePurchase:${goal.id}`;
      if (catExists(id)) continue;
      addCat(
        {
          id,
          groupId: GROUP_GOALS,
          name: goal.name,
          balanceTarget: goal.target,
          targetDate: goal.byDate,
          nodeId: "SavePurchase",
        },
        goal.saved.value,
      );
    }
  } else if (purchase && (purchase.target > 0 || purchase.saved.value > 0)) {
    if (!catExists("SavePurchase")) {
      addCat(
        {
          id: "SavePurchase",
          groupId: GROUP_GOALS,
          name: purchase.goalName || "SavePurchase",
          balanceTarget: purchase.target,
          targetDate: purchase.byDate,
          nodeId: "SavePurchase",
        },
        purchase.saved.value,
      );
    }
  }
  for (const goal of (v2.nodes.Goals?.data as V2Goals | undefined)?.items ?? []) {
    const id = `Goals:${goal.id}`;
    const existing = book.categories.find((c) => c.id === id);
    if (existing) {
      if (!existing.targetDate) existing.targetDate = horizonDate(now, goal.horizonYears);
      continue;
    }
    addCat(
      {
        id,
        groupId: GROUP_GOALS,
        name: goal.name,
        balanceTarget: goal.target,
        targetDate: horizonDate(now, goal.horizonYears),
        nodeId: "Goals",
      },
      goal.saved,
    );
  }

  // 4. Debts: backfill nodeId on matched accounts; create missing ones; honor
  // an explicit paid flag the ledger couldn't represent.
  for (const nodeId of ["HighDebt", "ModDebt"] as const) {
    const debts = (v2.nodes[nodeId]?.data as V2Debts | undefined)?.debts ?? [];
    for (const debt of debts) {
      const id = `debt:${debt.id}`;
      const existing = accountById(id);
      if (existing) {
        if (!existing.nodeId) existing.nodeId = nodeId;
        const balanceC = toCents(dollarAccountBalance(book, id));
        if (debt.paid && balanceC < 0) {
          book.transactions.push({
            id: `txn:adjust:v3:debt:${debt.id}`,
            accountId: id,
            date: today,
            payee: "Balance adjustment",
            memo: "Marked paid",
            amount: fromCents(-balanceC),
            source: "manual",
          });
        }
      } else {
        book.accounts.push({
          id,
          name: debt.name,
          kind: "loan",
          apr: debt.apr,
          minPayment: debt.minPayment,
          source: "manual",
          nodeId,
        });
        if (debt.balance !== 0) {
          book.transactions.push(startingTxn(id, today, -debt.balance));
        }
      }
    }
  }

  // 5. College: ensure/backfill the tracking account.
  const college = v2.nodes.College?.data as V2College | undefined;
  if (college) {
    const existing = accountById(COLLEGE_ACCOUNT_ID);
    if (existing) {
      if (!existing.nodeId) existing.nodeId = "College";
    } else if ((college.balance?.value ?? 0) > 0) {
      book.accounts.push({
        id: COLLEGE_ACCOUNT_ID,
        name: "529 Plan",
        kind: "tracking",
        source: "manual",
        nodeId: "College",
      });
      book.transactions.push(startingTxn(COLLEGE_ACCOUNT_ID, today, college.balance!.value));
    }
  }

  // 6. Seed cover: created categories' amounts become this month's
  // assignments, balanced by one RTA inflow — migration never moves RTA.
  let totalC = 0;
  for (const v of Object.values(seeded)) totalC += toCents(v);
  if (Object.keys(seeded).length > 0) {
    book.assignments[month] = { ...(book.assignments[month] ?? {}), ...seeded };
  }
  if (totalC > 0) {
    if (!accountById("acct:cash")) {
      book.accounts.push({ id: "acct:cash", name: "Cash", kind: "cash", source: "manual" });
    }
    book.transactions.push({
      id: "txn:start:v3",
      accountId: "acct:cash",
      date: today,
      payee: "Starting balance",
      amount: fromCents(totalC),
      categoryId: RTA_CATEGORY_ID,
      source: "manual",
    });
  }

  // Phase 2 — strip: nodes keep only what the ledger doesn't model.
  const nodes = {} as Record<NodeId, V3NodeState>;
  for (const [id, legacy] of Object.entries(v2.nodes) as [NodeId, LegacyNodeState][]) {
    const { data, ...rest } = legacy;
    const node: V3NodeState = { ...rest };
    if (data !== undefined) {
      if (id === "BigEF") {
        const months = (data as V2BigEF).targetMonths;
        node.data = {
          targetMonths: (months === 4 || months === 5 || months === 6 ? months : 3),
        } satisfies NodeDataMap["BigEF"];
      } else if (id === "College") {
        const c = data as V2College;
        node.data = {
          monthlyContribution: c.monthlyContribution ?? 0,
          ...(c.targetAge !== undefined ? { targetAge: c.targetAge } : {}),
        };
      } else if (id === "Match" || id === "IRA" || id === "HSA" || id === "Increase401k") {
        node.data = data;
      }
      // Everything else (recurring, EFs, SavePurchase, Goals, debts) is
      // ledger-owned now — the payload is dropped.
    }
    nodes[id] = node;
  }

  return {
    version: 3,
    settings: v2.settings,
    decisions: v2.decisions,
    nodes,
    budget: book,
    shownCelebrations: v2.shownCelebrations ?? [],
    earnedMedals: v2.earnedMedals ?? [],
  };
}

/** `now` shifted by a (possibly fractional) number of years, as a local day. */
function horizonDate(now: Date, years: number): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() + Math.round(years * 12));
  return isoDay(d);
}

function startingTxn(accountId: string, date: string, amount: Dollars): V3Txn {
  return {
    id: `txn:start:${accountId}`,
    accountId,
    date,
    payee: "Starting balance",
    amount,
    source: "manual",
  };
}

export function downloadJson(state: AppState, filename = "financeflow.json"): void {
  const blob = new Blob([exportJson(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
