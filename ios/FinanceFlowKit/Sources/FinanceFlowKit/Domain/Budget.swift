import Foundation

// MARK: - Monthly budget rollup

/// Dollar-denominated rollup of the monthly budget across the seven recurring
/// nodes. Mirrors `monthlyBudgetSummary` in `src/graph/derive.ts`.
public struct BudgetSummary: Equatable, Sendable {
    public let target: Decimal
    public let funded: Decimal

    public init(target: Decimal, funded: Decimal) {
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
        var target: Decimal = 0
        var funded: Decimal = 0
        for id in recurringNodes {
            let totals = NodeLedger.recurringTotals(state.budget, snap, id)
            target += totals.target
            funded += totals.funded
        }
        return BudgetSummary(target: target, funded: funded)
    }
}
