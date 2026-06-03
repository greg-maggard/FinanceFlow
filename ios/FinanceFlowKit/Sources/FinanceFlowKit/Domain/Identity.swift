import Foundation

/// Affirmation shown when a node is completed. Mirrors `IDENTITY` in `src/theme/identity.ts`.
public let nodeIdentity: [NodeId: String] = [
    .Start: "You're someone who plans.",
    .Rent: "Your shelter is secure this month.",
    .Food: "You're nourished and ready.",
    .Essential: "Your essentials are handled.",
    .Income: "You're set up to earn.",
    .Health: "You're protected by your coverage.",
    .MinDebt: "Your minimums are paid — no late fees, no setbacks.",
    .SmallEF: "You're protected from the small surprises.",
    .NonEssential: "Your fixed costs are clean.",
    .BigEF: "You're insured against the unexpected.",
    .Match: "You're capturing every dollar your employer offers.",
    .HighDebt: "You broke free from high-interest debt.",
    .ModDebt: "You eliminated the debt drag on your savings.",
    .IRA: "You're building tax-advantaged wealth.",
    .SavePurchase: "You're funding what's coming.",
    .Increase401k: "You're saving 15% of pre-tax income.",
    .SelfEmp: "Your self-employed retirement is set up.",
    .HSA: "You've maxed the triple-tax-advantaged account.",
    .College: "You're investing in their future.",
    .Options: "You've earned options.",
    .Early: "Early retirement is on the table.",
    .Goals: "Your near-term life is funded.",
]

/// A phase-completion award. Mirrors `Medal` in `src/theme/identity.ts`.
public struct Medal: Sendable {
    public let phase: Phase
    public let title: String
    public let subtitle: String
}

/// Mirrors `MEDALS`.
public let medals: [Phase: Medal] = [
    .foundations: Medal(phase: .foundations, title: "Stable Foundations", subtitle: "Every month begins from a steady place."),
    .emergency: Medal(phase: .emergency, title: "Emergency Buffer", subtitle: "Three to six months of breathing room, banked."),
    .match: Medal(phase: .match, title: "Match Captured", subtitle: "Free money, claimed."),
    .debt: Medal(phase: .debt, title: "Debt-Free", subtitle: "Nothing eating your savings from behind."),
    .ira: Medal(phase: .ira, title: "Tax-Advantaged", subtitle: "Your future self thanks you."),
    .retirement: Medal(phase: .retirement, title: "Retirement-Funded", subtitle: "15% of pre-tax income, working for you."),
    .advanced: Medal(phase: .advanced, title: "Optimized", subtitle: "On the other side of the chart."),
]

/// The seven recurring monthly-budget nodes. Mirrors `RECURRING`.
public let recurringNodes: Set<NodeId> = [
    .Rent, .Food, .Essential, .Income, .Health, .MinDebt, .NonEssential,
]
