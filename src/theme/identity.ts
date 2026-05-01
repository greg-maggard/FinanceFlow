import type { NodeId } from "../state/schema";
import type { Phase } from "../graph/flowchart";

export const IDENTITY: Partial<Record<NodeId, string>> = {
  Start: "You're someone who plans.",
  Rent: "Your shelter is secure this month.",
  Food: "You're nourished and ready.",
  Essential: "Your essentials are handled.",
  Income: "You're set up to earn.",
  Health: "You're protected by your coverage.",
  MinDebt: "Your minimums are paid — no late fees, no setbacks.",
  SmallEF: "You're protected from the small surprises.",
  NonEssential: "Your fixed costs are clean.",
  BigEF: "You're insured against the unexpected.",
  Match: "You're capturing every dollar your employer offers.",
  HighDebt: "You broke free from high-interest debt.",
  ModDebt: "You eliminated the debt drag on your savings.",
  IRA: "You're building tax-advantaged wealth.",
  SavePurchase: "You're funding what's coming.",
  Increase401k: "You're saving 15% of pre-tax income.",
  SelfEmp: "Your self-employed retirement is set up.",
  HSA: "You've maxed the triple-tax-advantaged account.",
  College: "You're investing in their future.",
  Options: "You've earned options.",
  Early: "Early retirement is on the table.",
  Goals: "Your near-term life is funded.",
};

export type Medal = {
  phase: Phase;
  title: string;
  subtitle: string;
};

export const MEDALS: Record<Phase, Medal> = {
  0: { phase: 0, title: "Stable Foundations", subtitle: "Every month begins from a steady place." },
  1: { phase: 1, title: "Emergency Buffer", subtitle: "Three to six months of breathing room, banked." },
  2: { phase: 2, title: "Match Captured", subtitle: "Free money, claimed." },
  3: { phase: 3, title: "Debt-Free", subtitle: "Nothing eating your savings from behind." },
  4: { phase: 4, title: "Tax-Advantaged", subtitle: "Your future self thanks you." },
  5: { phase: 5, title: "Retirement-Funded", subtitle: "15% of pre-tax income, working for you." },
  6: { phase: 6, title: "Optimized", subtitle: "On the other side of the chart." },
};

export const RECURRING: Set<NodeId> = new Set<NodeId>([
  "Rent",
  "Food",
  "Essential",
  "Income",
  "Health",
  "MinDebt",
  "NonEssential",
]);
