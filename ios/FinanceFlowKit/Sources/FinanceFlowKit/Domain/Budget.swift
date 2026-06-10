import Foundation

// MARK: - Items-aware recurring totals

public extension RecurringData {
    /// The node's monthly goal: the sum of item targets when the budget is
    /// split into items, else the single top-level target.
    var effectiveTarget: Decimal {
        if let items, !items.isEmpty {
            return items.reduce(0) { $0 + $1.target.value }
        }
        return target.value
    }

    /// What's been funded toward the goal this month, items-aware like
    /// `effectiveTarget`.
    var effectiveFunded: Decimal {
        if let items, !items.isEmpty {
            return items.reduce(0) { $0 + ($1.funded?.value ?? 0) }
        }
        return funded?.value ?? 0
    }
}

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
    /// item-level goals included via the effective totals.
    static func monthlyBudgetSummary(_ state: AppState) -> BudgetSummary {
        var target: Decimal = 0
        var funded: Decimal = 0
        for id in recurringNodes {
            guard let data = state.node(id).data?.recurring else { continue }
            target += data.effectiveTarget
            funded += data.effectiveFunded
        }
        return BudgetSummary(target: target, funded: funded)
    }
}
