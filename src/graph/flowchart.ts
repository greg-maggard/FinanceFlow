import type { DecisionId, NodeId } from "../state/schema";

export type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type NodeKind = "task" | "decision";

export type Edge = { to: NodeId; when?: "yes" | "no" };

export type GraphNode = {
  id: NodeId;
  label: string;
  sublabel?: string;
  phase: Phase;
  kind: NodeKind;
  decisionId?: DecisionId;
  edges: Edge[];
};

export const GRAPH: GraphNode[] = [
  // Step 0
  { id: "Start", label: "Create Budget", phase: 0, kind: "task", edges: [{ to: "Rent" }] },
  { id: "Rent", label: "Pay Rent/Mortgage", sublabel: "incl. renters or homeowners insurance", phase: 0, kind: "task", edges: [{ to: "Food" }] },
  { id: "Food", label: "Buy Food/Groceries", phase: 0, kind: "task", edges: [{ to: "Essential" }] },
  { id: "Essential", label: "Pay Essential Items", sublabel: "power, water, heat, toiletries", phase: 0, kind: "task", edges: [{ to: "Income" }] },
  { id: "Income", label: "Pay Income-Earning Expenses", sublabel: "transportation, internet, phone", phase: 0, kind: "task", edges: [{ to: "Health" }] },
  { id: "Health", label: "Pay Health Care", sublabel: "insurance and medical expenses", phase: 0, kind: "task", edges: [{ to: "MinDebt" }] },
  { id: "MinDebt", label: "Make Minimum Payments on All Debts and Loans", phase: 0, kind: "task", edges: [{ to: "SmallEF" }] },

  // Step 1
  { id: "SmallEF", label: "Build Small Emergency Fund", sublabel: "$1,000 or 1 month expenses, whichever is greater", phase: 1, kind: "task", edges: [{ to: "NonEssential" }] },
  { id: "NonEssential", label: "Pay Non-Essential Bills in Full", sublabel: "cable, internet, phone, etc.", phase: 1, kind: "task", edges: [{ to: "Q_Match" }] },
  { id: "BigEF", label: "Grow Emergency Fund to 3-6 Months Living Expenses", phase: 1, kind: "task", edges: [{ to: "Q_ModDebt" }] },

  // Step 2
  {
    id: "Q_Match",
    label: "Employer offers retirement match?",
    phase: 2,
    kind: "decision",
    decisionId: "Q_Match",
    edges: [
      { to: "Match", when: "yes" },
      { to: "Q_HighDebt", when: "no" },
    ],
  },
  { id: "Match", label: "Contribute just enough to get the full employer match", phase: 2, kind: "task", edges: [{ to: "Q_HighDebt" }] },

  // Step 3
  {
    id: "Q_HighDebt",
    label: "High-interest debt?",
    sublabel: "10%+ APR",
    phase: 3,
    kind: "decision",
    decisionId: "Q_HighDebt",
    edges: [
      { to: "HighDebt", when: "yes" },
      { to: "BigEF", when: "no" },
    ],
  },
  { id: "HighDebt", label: "Use Avalanche or Snowball method to pay off", phase: 3, kind: "task", edges: [{ to: "BigEF" }] },
  {
    id: "Q_ModDebt",
    label: "Moderate-interest debt?",
    sublabel: "4-5%+, excluding mortgage",
    phase: 3,
    kind: "decision",
    decisionId: "Q_ModDebt",
    edges: [
      { to: "ModDebt", when: "yes" },
      { to: "IRA", when: "no" },
    ],
  },
  { id: "ModDebt", label: "Use Avalanche or Snowball method to pay off", phase: 3, kind: "task", edges: [{ to: "IRA" }] },

  // Step 4
  { id: "IRA", label: "Evaluate Roth vs Traditional IRA and max yearly contributions", phase: 4, kind: "task", edges: [{ to: "Q_Purchase" }] },
  {
    id: "Q_Purchase",
    label: "Large required purchases coming up?",
    sublabel: "college, car, certifications",
    phase: 4,
    kind: "decision",
    decisionId: "Q_Purchase",
    edges: [
      { to: "SavePurchase", when: "yes" },
      { to: "Q_15pct", when: "no" },
    ],
  },
  { id: "SavePurchase", label: "Save the amount needed in a savings or checking account", phase: 4, kind: "task", edges: [{ to: "Q_15pct" }] },

  // Step 5
  {
    id: "Q_15pct",
    label: "Saving at least 15% of pre-tax income for retirement?",
    phase: 5,
    kind: "decision",
    decisionId: "Q_15pct",
    edges: [
      { to: "Q_HSA", when: "yes" },
      { to: "Q_401k", when: "no" },
    ],
  },
  {
    id: "Q_401k",
    label: "Employer offers 401k, 403b, or similar?",
    phase: 5,
    kind: "decision",
    decisionId: "Q_401k",
    edges: [
      { to: "Increase401k", when: "yes" },
      { to: "SelfEmp", when: "no" },
    ],
  },
  { id: "Increase401k", label: "Increase contributions until 15% pre-tax saved", phase: 5, kind: "task", edges: [{ to: "Q_15pct" }] },
  { id: "SelfEmp", label: "If self-employed: Individual 401k, SEP-IRA, or SIMPLE IRA. Otherwise: taxable account", phase: 5, kind: "task", edges: [{ to: "Q_15pct" }] },

  // Step 6
  {
    id: "Q_HSA",
    label: "HDHP? Eligible for an investable HSA?",
    phase: 6,
    kind: "decision",
    decisionId: "Q_HSA",
    edges: [
      { to: "HSA", when: "yes" },
      { to: "Q_College", when: "no" },
    ],
  },
  { id: "HSA", label: "Max yearly HSA contributions", phase: 6, kind: "task", edges: [{ to: "Q_College" }] },
  {
    id: "Q_College",
    label: "Kids - want to help with college costs?",
    phase: 6,
    kind: "decision",
    decisionId: "Q_College",
    edges: [
      { to: "College", when: "yes" },
      { to: "Options", when: "no" },
    ],
  },
  { id: "College", label: "Evaluate 529 plan and contribute accordingly", phase: 6, kind: "task", edges: [{ to: "Options" }] },
  { id: "Options", label: "You have options now - up to your personal goals", phase: 6, kind: "task", edges: [{ to: "Q_Early" }, { to: "Q_Goals" }] },
  {
    id: "Q_Early",
    label: "Retire early?",
    phase: 6,
    kind: "decision",
    decisionId: "Q_Early",
    edges: [{ to: "Early", when: "yes" }],
  },
  { id: "Early", label: "Max 401k/403b, consider mega backdoor Roth IRA, then a taxable account", phase: 6, kind: "task", edges: [] },
  {
    id: "Q_Goals",
    label: "More immediate goals?",
    phase: 6,
    kind: "decision",
    decisionId: "Q_Goals",
    edges: [{ to: "Goals", when: "yes" }],
  },
  { id: "Goals", label: "Savings for goals under 3 years; conservative stock/bond mix for 3-5 year goals", sublabel: "down payment, vehicle, vacation", phase: 6, kind: "task", edges: [] },
];

export const GRAPH_BY_ID: Record<NodeId, GraphNode> = Object.fromEntries(
  GRAPH.map((n) => [n.id, n]),
) as Record<NodeId, GraphNode>;

export const PHASE_LABELS: Record<Phase, string> = {
  0: "Step 0: Budget & Essentials",
  1: "Step 1: Emergency Fund",
  2: "Step 2: Employer Match",
  3: "Step 3: Debt Payoff",
  4: "Step 4: IRA & Near-Term Goals",
  5: "Step 5: More Retirement",
  6: "Step 6: Advanced Goals",
};
