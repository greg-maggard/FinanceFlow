export type Decision = "yes" | "no" | null;

export type DecisionId =
  | "Q_Match"
  | "Q_HighDebt"
  | "Q_ModDebt"
  | "Q_Purchase"
  | "Q_15pct"
  | "Q_401k"
  | "Q_HSA"
  | "Q_College"
  | "Q_Early"
  | "Q_Goals";

export type Decisions = Record<DecisionId, Decision>;

export type Source = "manual" | "plaid" | "ynab";

// ---------------------------------------------------------------------------
// Money (v4): integer cents, everywhere.
//
// Before v4 money was dollars-as-`number` on the wire and every arithmetic
// site had to remember to route through a `toCents` helper. That was exact
// only by discipline, and it was not the same discipline iOS used (exact
// `Decimal`), so a document carrying a sub-cent amount — which nothing stopped
// the input fields from producing — could render a different `ready` flag on
// each platform. Storing integer cents makes sub-cent states unrepresentable:
// both platforms are deterministic by construction.
//
// The brand is erased at runtime (a `Cents` IS a `number`); it exists so the
// compiler catches a dollars value reaching a cents parameter during and after
// the port. `migrate()` casts once, at the boundary.

/** Integer cents. Runtime representation is a plain `number`. */
export type Cents = number & { readonly __cents?: unique symbol };

/** Brand an integer as `Cents`. No rounding — see `centsFromDollars`. */
export const cents = (n: number): Cents => n as Cents;

/**
 * The one rounding rule (money-migration-v4.md §4), shared by the v3→v4
 * migration and both platforms' input parsing:
 *
 *     cents(d) = floor(d * 100 + 0.5)     // evaluated in IEEE-754 double
 *
 * Spelled as the formula rather than `Math.round` so the Swift mirror is
 * literally the same expression. A half cent goes toward +infinity on both
 * platforms, so -1234.5 dollars is -123450 cents and -12.345 is -1234 (NOT
 * -1235 — do not substitute a round-half-away-from-zero rule on either side).
 */
export function centsFromDollars(dollars: number): Cents {
  const scaled = Math.floor(dollars * 100 + 0.5);
  // A JSON document cannot spell NaN or Infinity, but it CAN spell a literal
  // too large for a double (`1e400` parses as Infinity). Migration must never
  // turn unreadable input into a NaN that then serializes as `null` and eats
  // the field — clamp to zero, which is at least a number the ledger can
  // reason about.
  //
  // The range check is the *same* guard, not an extra one: Swift's cents are
  // `Int` (64-bit), so `Money.fromDollars` clamps anything outside Int64 to
  // zero. A JS `number` has no such ceiling, so without this a hostile
  // `"amount": 1e17` migrated to `10000000000000000000` on web and `0` on iOS
  // — the same bytes, two different books. Bounds are copied from Swift
  // literally, including the strict upper one: `Double(Int.max)` rounds UP to
  // 2⁶³, which `Int(_:)` cannot represent (it traps), so 2⁶³ itself is out of
  // range on BOTH platforms. `Double(Int.min)` is exactly -2⁶³ and IS
  // representable, so that side is inclusive.
  if (!Number.isFinite(scaled) || scaled < -(2 ** 63) || scaled >= 2 ** 63) return cents(0);
  return cents(scaled);
}

export type SourcedNumber = {
  value: Cents;
  source: Source;
  lastSyncedAt?: string;
};

// v3: financial data lives in `AppState.budget` (the envelope ledger); node
// payloads keep only what the ledger doesn't model. The old wide payload
// shapes (recurring items, EF buckets, purchase goals, debt lists) survive
// as decode/migration-only types in `io.ts`.
export type NodeDataMap = {
  BigEF: { targetMonths: 3 | 4 | 5 | 6 };
  Match: { matchPct: number; currentContribPct: number };
  IRA: {
    type: "roth" | "traditional";
    ytdContribution: SourcedNumber;
    annualLimit: Cents;
  };
  Increase401k: { currentPct: number; targetPct: number };
  HSA: {
    coverage: "self" | "family";
    ytdContribution: SourcedNumber;
    annualLimit: Cents;
  };
  College: { monthlyContribution: Cents; targetAge?: number };
};

export type NodeId =
  | "Start"
  | "Rent"
  | "Food"
  | "Essential"
  | "Income"
  | "Health"
  | "MinDebt"
  | "SmallEF"
  | "NonEssential"
  | "BigEF"
  | "Q_Match"
  | "Match"
  | "Q_HighDebt"
  | "HighDebt"
  | "Q_ModDebt"
  | "ModDebt"
  | "IRA"
  | "Q_Purchase"
  | "SavePurchase"
  | "Q_15pct"
  | "Q_401k"
  | "Increase401k"
  | "SelfEmp"
  | "Q_HSA"
  | "HSA"
  | "Q_College"
  | "College"
  | "Options"
  | "Q_Early"
  | "Early"
  | "Q_Goals"
  | "Goals";

export type NodeState = {
  completed: boolean;
  completedAt?: string;
  notes: string;
  data?: NodeDataMap[keyof NodeDataMap];
  monthlyChecks?: Record<string, boolean>;
};

export type Settings = {
  monthlyExpenses?: Cents;
  preTaxIncome?: Cents;
  iraAnnualLimit: Cents;
  hsaSelfLimit: Cents;
  hsaFamilyLimit: Cents;
};

// ---------------------------------------------------------------------------
// Budget book (v2): the zero-based envelope core.
//
// Money is integer `Cents` in memory and on the wire (v4). Every sum below is
// exact integer arithmetic — there is no rounding step left to forget, and no
// representable value the iOS mirror can read differently.

export type AccountKind = "checking" | "savings" | "cash" | "credit" | "loan" | "tracking";

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  /** Annual rate, for credit/loan accounts. NOT money — never converted. */
  apr?: number;
  minPayment?: Cents;
  closed?: boolean;
  source: Source;
  plaidAccountId?: string;
  /** Flowchart node this account reports into, if any (debt nodes, College). */
  nodeId?: NodeId;
};

/**
 * A single ledger line. Outflows are negative, inflows positive. Income
 * enters the budget categorized as `RTA_CATEGORY_ID`. Transfers carry
 * `transferAccountId` on both paired rows and no category — except transfers
 * to an off-budget account, which must be categorized because the money
 * leaves the budget.
 */
export type Txn = {
  id: string;
  accountId: string;
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  payee?: string;
  amount: Cents;
  categoryId?: string;
  transferAccountId?: string;
  /** The other row of a transfer pair, so the pair can be edited/deleted atomically. */
  transferPairId?: string;
  memo?: string;
  source: Source;
  plaidTxnId?: string;
};

export type CategoryGroup = {
  id: string;
  name: string;
  order: number;
};

export type Category = {
  id: string;
  groupId: string;
  name: string;
  order: number;
  /** Needed-for-spending target per month. */
  monthlyTarget?: Cents;
  /** Save-a-total target (purchase goals, EF buckets). */
  balanceTarget?: Cents;
  targetDate?: string;
  hidden?: boolean;
  /** Flowchart node this category reports into, if any. */
  nodeId?: NodeId;
};

/** "YYYY-MM", local time — the same convention as `monthlyChecks`. */
export type MonthKey = string;

/** Reserved category id for inflows that fund Ready-to-Assign. */
export const RTA_CATEGORY_ID = "rta";

/** The group that holds envelopes the app owns rather than the user. */
export const SYSTEM_GROUP_ID = "g:system";
/**
 * The catch-all envelope. Every on-budget outflow has to land somewhere: money
 * with no envelope leaves the accounts without leaving any category, which is
 * exactly the leak `bookIntegrity`'s `unbudgetedSpending` residual measures.
 * This is a real, visible, assignable category — it just carries no `nodeId`,
 * so `linkedCategories` keeps it out of every flowchart node's math.
 */
export const UNCATEGORIZED_CATEGORY_ID = "cat:uncategorized";
/**
 * Sorts the system group and its envelope after anything the user makes.
 * Exported because planners that materialize the system envelope as *ops*
 * rather than by mutating a book (see `planPlaidImport`) have to spell the
 * same order, and a second literal is a second thing to drift.
 */
export const SYSTEM_ORDER = 999_999;

/**
 * Materialize the system group + Uncategorized envelope if they aren't there
 * yet, returning the book unchanged when they are. Created lazily on first
 * need (a delete that reassigns into it, a transaction saved into it) so an
 * untouched book stays free of rows the user never asked for — which is also
 * why this needs no schema version bump or migration.
 */
export function ensureUncategorized(book: BudgetBook): BudgetBook {
  const hasGroup = book.groups.some((g) => g.id === SYSTEM_GROUP_ID);
  const hasCategory = book.categories.some((c) => c.id === UNCATEGORIZED_CATEGORY_ID);
  if (hasGroup && hasCategory) return book;
  return {
    ...book,
    groups: hasGroup
      ? book.groups
      : [...book.groups, { id: SYSTEM_GROUP_ID, name: "System", order: SYSTEM_ORDER }],
    categories: hasCategory
      ? book.categories
      : [
          ...book.categories,
          {
            id: UNCATEGORIZED_CATEGORY_ID,
            groupId: SYSTEM_GROUP_ID,
            name: "Uncategorized",
            order: SYSTEM_ORDER,
          },
        ],
  };
}

export type BudgetBook = {
  accounts: Account[];
  transactions: Txn[];
  groups: CategoryGroup[];
  categories: Category[];
  /** assignments[month][categoryId] = cents assigned to that envelope in that month. */
  assignments: Record<MonthKey, Record<string, Cents>>;
};

export function emptyBudgetBook(): BudgetBook {
  return { accounts: [], transactions: [], groups: [], categories: [], assignments: {} };
}

/** Short random id — the same alphabet/length as the iOS `ShortID.make()`. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export type AppState = {
  version: 4;
  settings: Settings;
  decisions: Decisions;
  nodes: Record<NodeId, NodeState>;
  budget: BudgetBook;
  shownCelebrations?: NodeId[];
  earnedMedals?: number[];
};

export const DEFAULT_SETTINGS: Settings = {
  monthlyExpenses: undefined,
  preTaxIncome: undefined,
  iraAnnualLimit: cents(700_000),
  hsaSelfLimit: cents(430_000),
  hsaFamilyLimit: cents(855_000),
};

export function emptyNodeState(): NodeState {
  return { completed: false, notes: "" };
}

/**
 * Every `NodeId`, in flowchart order — the web mirror of Swift's
 * `NodeId.allCases`. Anything that materializes a full node table (a fresh
 * document, the v3→v4 migration's backfill) walks this list, so the two
 * platforms cannot disagree about which nodes a document contains.
 */
export const NODE_IDS: readonly NodeId[] = [
  "Start", "Rent", "Food", "Essential", "Income", "Health", "MinDebt",
  "SmallEF", "NonEssential", "BigEF",
  "Q_Match", "Match",
  "Q_HighDebt", "HighDebt", "Q_ModDebt", "ModDebt",
  "IRA", "Q_Purchase", "SavePurchase",
  "Q_15pct", "Q_401k", "Increase401k", "SelfEmp",
  "Q_HSA", "HSA", "Q_College", "College", "Options",
  "Q_Early", "Early", "Q_Goals", "Goals",
];

export function makeInitialState(): AppState {
  const nodes = {} as Record<NodeId, NodeState>;
  for (const id of NODE_IDS) nodes[id] = emptyNodeState();
  return {
    version: 4,
    settings: { ...DEFAULT_SETTINGS },
    budget: emptyBudgetBook(),
    shownCelebrations: [],
    earnedMedals: [],
    decisions: {
      Q_Match: null,
      Q_HighDebt: null,
      Q_ModDebt: null,
      Q_Purchase: null,
      Q_15pct: null,
      Q_401k: null,
      Q_HSA: null,
      Q_College: null,
      Q_Early: null,
      Q_Goals: null,
    },
    nodes,
  };
}

/** The $1,000 starter gate, in cents. */
const SMALL_EF_FLOOR = 100_000;

export function emergencyFundTarget(monthlyExpenses?: Cents): Cents {
  if (!monthlyExpenses || monthlyExpenses <= 0) return cents(SMALL_EF_FLOOR);
  return cents(Math.max(SMALL_EF_FLOOR, monthlyExpenses));
}

// `months` is a small whole number and `monthlyExpenses` is already an
// integer, so the product is integer-exact with no rounding step.
export function bigEmergencyFundTarget(months: number, monthlyExpenses?: Cents): Cents {
  if (!monthlyExpenses || monthlyExpenses <= 0) return cents(0);
  return cents(months * monthlyExpenses);
}
