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

export type SourcedNumber = {
  value: number;
  source: Source;
  lastSyncedAt?: string;
};

export type Debt = {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  paid: boolean;
};

export type Goal = {
  id: string;
  name: string;
  target: number;
  saved: number;
  horizonYears: number;
};

export type RecurringItem = {
  id: string;
  name: string;
  target: SourcedNumber;
  funded?: SourcedNumber;
};

export type EFBucket = {
  id: string;
  name: string;
  target: number;
  balance: SourcedNumber;
};

export type PurchaseGoal = {
  id: string;
  name: string;
  target: number;
  saved: SourcedNumber;
  byDate?: string;
};

export type RecurringData = {
  target: SourcedNumber;
  funded?: SourcedNumber;
  items?: RecurringItem[];
};

export type NodeDataMap = {
  Rent: RecurringData;
  Food: RecurringData;
  Essential: RecurringData;
  Income: RecurringData;
  Health: RecurringData;
  MinDebt: RecurringData;
  NonEssential: RecurringData;
  SmallEF: { balance: SourcedNumber; items?: EFBucket[] };
  BigEF: { targetMonths: 3 | 4 | 5 | 6; balance: SourcedNumber; items?: EFBucket[] };
  Match: { matchPct: number; currentContribPct: number };
  HighDebt: { debts: Debt[] };
  ModDebt: { debts: Debt[] };
  IRA: {
    type: "roth" | "traditional";
    ytdContribution: SourcedNumber;
    annualLimit: number;
  };
  SavePurchase: {
    // When items is present the scalar fields are legacy mirrors maintained on
    // write (first goal's name/date, summed target/saved) for older readers.
    goalName: string;
    target: number;
    saved: SourcedNumber;
    byDate?: string;
    items?: PurchaseGoal[];
  };
  Increase401k: { currentPct: number; targetPct: number };
  HSA: {
    coverage: "self" | "family";
    ytdContribution: SourcedNumber;
    annualLimit: number;
  };
  College: {
    monthlyContribution: number;
    balance: SourcedNumber;
    targetAge?: number;
  };
  Goals: { items: Goal[] };
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
  monthlyExpenses?: number;
  preTaxIncome?: number;
  iraAnnualLimit: number;
  hsaSelfLimit: number;
  hsaFamilyLimit: number;
};

// ---------------------------------------------------------------------------
// Budget book (v2): the zero-based envelope core.
//
// Money stays dollars-as-`number` on the wire (matching every other field);
// all arithmetic must go through the cents-exact helpers in
// `src/budget/ledger.ts` so float drift can never corrupt envelope math.

export type AccountKind = "checking" | "savings" | "cash" | "credit" | "loan" | "tracking";

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  /** Annual rate, for credit/loan accounts. */
  apr?: number;
  minPayment?: number;
  closed?: boolean;
  source: Source;
  plaidAccountId?: string;
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
  amount: number;
  categoryId?: string;
  transferAccountId?: string;
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
  monthlyTarget?: number;
  /** Save-a-total target (purchase goals, EF buckets). */
  balanceTarget?: number;
  targetDate?: string;
  hidden?: boolean;
  /** Flowchart node this category reports into, if any. */
  nodeId?: NodeId;
};

/** "YYYY-MM", local time — the same convention as `monthlyChecks`. */
export type MonthKey = string;

/** Reserved category id for inflows that fund Ready-to-Assign. */
export const RTA_CATEGORY_ID = "rta";

export type BudgetBook = {
  accounts: Account[];
  transactions: Txn[];
  groups: CategoryGroup[];
  categories: Category[];
  /** assignments[month][categoryId] = dollars assigned to that envelope in that month. */
  assignments: Record<MonthKey, Record<string, number>>;
};

export function emptyBudgetBook(): BudgetBook {
  return { accounts: [], transactions: [], groups: [], categories: [], assignments: {} };
}

export type AppState = {
  version: 2;
  settings: Settings;
  decisions: Decisions;
  nodes: Record<NodeId, NodeState>;
  budget: BudgetBook;
  shownCelebrations?: NodeId[];
  earnedMedals?: number[];
  categoryMap?: Partial<Record<NodeId, string>>;
};

export const DEFAULT_SETTINGS: Settings = {
  monthlyExpenses: undefined,
  preTaxIncome: undefined,
  iraAnnualLimit: 7000,
  hsaSelfLimit: 4300,
  hsaFamilyLimit: 8550,
};

export function emptyNodeState(): NodeState {
  return { completed: false, notes: "" };
}

export function makeInitialState(): AppState {
  const ids: NodeId[] = [
    "Start", "Rent", "Food", "Essential", "Income", "Health", "MinDebt",
    "SmallEF", "NonEssential", "BigEF",
    "Q_Match", "Match",
    "Q_HighDebt", "HighDebt", "Q_ModDebt", "ModDebt",
    "IRA", "Q_Purchase", "SavePurchase",
    "Q_15pct", "Q_401k", "Increase401k", "SelfEmp",
    "Q_HSA", "HSA", "Q_College", "College", "Options",
    "Q_Early", "Early", "Q_Goals", "Goals",
  ];
  const nodes = {} as Record<NodeId, NodeState>;
  for (const id of ids) nodes[id] = emptyNodeState();
  return {
    version: 2,
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

export function emergencyFundTarget(monthlyExpenses?: number): number {
  if (!monthlyExpenses || monthlyExpenses <= 0) return 1000;
  return Math.max(1000, monthlyExpenses);
}

export function bigEmergencyFundTarget(months: number, monthlyExpenses?: number): number {
  if (!monthlyExpenses || monthlyExpenses <= 0) return 0;
  return months * monthlyExpenses;
}
