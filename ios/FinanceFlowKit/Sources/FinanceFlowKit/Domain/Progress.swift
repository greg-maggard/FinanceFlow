import Foundation

/// What a goal's `value`/`max` are counted in. Most nodes measure money, but
/// Match and Increase401k measure percentage points of salary — both used to be
/// a bare `Double` and every display site guessed "money", which rendered a 15%
/// target as "$15". Now the unit travels with the numbers.
/// Mirrors `ProgressUnit` in `src/components/focus/progressOf.ts`.
public enum ProgressUnit: Equatable, Sendable {
    /// `value`/`max` are integer cents, carried as `Double` for the bar math.
    case cents
    /// `value`/`max` are percentage points.
    case percent
}

/// Per-node progress, used to drive goal bars and "ready to complete" hints.
/// Mirrors `ProgressInfo` in `src/components/focus/progressOf.ts`.
public enum ProgressInfo: Equatable, Sendable {
    case goal(value: Double, max: Double, unit: ProgressUnit, ready: Bool)
    case streak(months: Int, checkedThisMonth: Bool)
    case none(ready: Bool)

    public var ready: Bool {
        switch self {
        case let .goal(_, _, _, ready): return ready
        case let .streak(_, checked): return checked
        case let .none(ready): return ready
        }
    }
}

/// A money goal. Every "have we met the target?" decision below is decided in
/// exact integer `Money` FIRST; only the bar's fraction and labels are widened
/// to `Double`, so a sum landing a hair below its target — the old `Double`
/// drift — cannot happen, and neither can a sub-cent disagreement with the web.
private func goalCents(_ value: Money, _ max: Money, _ ready: Bool) -> ProgressInfo {
    .goal(value: Double(value.cents), max: Double(max.cents), unit: .cents, ready: ready)
}

/// A percentage-of-salary goal: `value`/`max` are percentage points, not money.
private func goalPercent(_ value: Decimal, _ max: Decimal, _ ready: Bool) -> ProgressInfo {
    .goal(value: value.asDouble, max: max.asDouble, unit: .percent, ready: ready)
}

/// Lossy conversion, display only.
private extension Decimal {
    var asDouble: Double { NSDecimalNumber(decimal: self).doubleValue }
}

/// Compute progress for a node. Direct port of `progressOf`. Money-bearing
/// nodes read the envelope ledger (the same book the Budget screen shows —
/// see `Domain/NodeLedger.swift`); the rest still read their node payloads.
public func progressOf(_ state: AppState, _ id: NodeId, month: String = Recurring.ymKey()) -> ProgressInfo {
    let node = Flowchart.node(id)
    if node.kind == .decision { return .none(ready: false) }

    let snap = Ledger.snapshot(state.budget, month: month)

    if recurringNodes.contains(id) {
        let totals = NodeLedger.recurringTotals(state.budget, snap, id)
        if totals.target > .zero {
            return goalCents(totals.funded, totals.target, totals.funded >= totals.target)
        }
        return .none(ready: true)
    }

    let data = state.node(id).data

    switch id {
    case .Start:
        return .none(ready: true)
    case .SmallEF:
        let computed = emergencyFundTarget(monthlyExpenses: state.settings.monthlyExpenses)
        let balance = NodeLedger.efBalance(state.budget, snap)
        let target = NodeLedger.efTarget(state.budget, .SmallEF, computed: computed)
        return goalCents(balance, target, balance >= target)
    case .BigEF:
        let months = data?.bigEF?.targetMonths ?? 3
        let computed = bigEmergencyFundTarget(months: months, monthlyExpenses: state.settings.monthlyExpenses)
        let balance = NodeLedger.efBalance(state.budget, snap)
        let target = NodeLedger.efTarget(state.budget, .BigEF, computed: computed)
        return goalCents(balance, target > .zero ? target : Money(cents: 1), target > .zero && balance >= target)
    case .Match:
        let matchPct = data?.match?.matchPct ?? 0
        let cur = data?.match?.currentContribPct ?? 0
        return goalPercent(cur, matchPct > 0 ? matchPct : 1, matchPct > 0 && cur >= matchPct)
    case .IRA:
        let ytd = data?.ira?.ytdContribution.value ?? .zero
        let limit = data?.ira?.annualLimit ?? state.settings.iraAnnualLimit
        return goalCents(ytd, limit, ytd >= limit)
    case .HSA:
        let ytd = data?.hsa?.ytdContribution.value ?? .zero
        let limit = data?.hsa?.annualLimit ?? state.settings.hsaSelfLimit
        return goalCents(ytd, limit, ytd >= limit)
    case .Increase401k:
        let cur = data?.increase401k?.currentPct ?? 0
        let target = data?.increase401k?.targetPct ?? 15
        return goalPercent(cur, target, cur >= target)
    case .SavePurchase:
        let totals = NodeLedger.purchaseTotals(state.budget, snap, .SavePurchase)
        let saved = totals.saved
        let target = totals.target
        return goalCents(saved, target > .zero ? target : Money(cents: 1), target > .zero && saved >= target)
    case .HighDebt, .ModDebt:
        let totals = NodeLedger.debtTotals(state.budget, id)
        if !totals.hasAny { return .none(ready: false) }
        return goalCents(totals.paid, totals.total > .zero ? totals.total : Money(cents: 1), totals.allPaid)
    default:
        return .none(ready: true)
    }
}
