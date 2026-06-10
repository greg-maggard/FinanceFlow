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
    goalName: string;
    target: number;
    saved: SourcedNumber;
    byDate?: string;
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

export type AppState = {
  version: 1;
  settings: Settings;
  decisions: Decisions;
  nodes: Record<NodeId, NodeState>;
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
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
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
