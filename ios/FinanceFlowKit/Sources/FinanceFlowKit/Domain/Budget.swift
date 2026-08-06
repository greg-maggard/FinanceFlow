import Foundation

// MARK: - Monthly budget rollup

/// Rollup of the monthly budget across the seven recurring nodes, in cents.
/// Mirrors `monthlyBudgetSummary` in `src/graph/derive.ts`.
public struct BudgetSummary: Equatable, Sendable {
    public let target: Money
    public let funded: Money

    public init(target: Money, funded: Money) {
        self.target = target
        self.funded = funded
    }
}

public extension Derive {
    /// Total monthly target vs. funded across the recurring budget nodes,
    /// summed from their linked ledger categories: target = Σ monthly
    /// targets, funded = Σ assigned this month.
    static func monthlyBudgetSummary(_ state: AppState, month: String = Recurring.ymKey()) -> BudgetSummary {
        let snap = Ledger.snapshot(state.budget, month: month)
        var target = Money.zero
        var funded = Money.zero
        for id in recurringNodes {
            let totals = NodeLedger.recurringTotals(state.budget, snap, id)
            target += totals.target
            funded += totals.funded
        }
        return BudgetSummary(target: target, funded: funded)
    }
}
