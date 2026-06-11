import Foundation

/// Per-node progress, used to drive goal bars and "ready to complete" hints.
/// Mirrors `ProgressInfo` in `src/components/focus/progressOf.ts`.
public enum ProgressInfo: Equatable, Sendable {
    case goal(value: Double, max: Double, ready: Bool)
    case streak(months: Int, checkedThisMonth: Bool)
    case none(ready: Bool)

    public var ready: Bool {
        switch self {
        case let .goal(_, _, ready): return ready
        case let .streak(_, checked): return checked
        case let .none(ready): return ready
        }
    }
}

/// Lossy conversion used only to surface exact `Decimal` amounts as the `Double`
/// display values carried by `ProgressInfo` (a goal bar's fraction and labels).
/// Every "have we met the target?" decision below stays in exact `Decimal`, so a
/// sum landing a hair below its target — the old `Double` drift — can't happen,
/// and the half-cent `meets()` tolerance is no longer needed.
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
        if totals.target > 0 {
            return .goal(value: totals.funded.asDouble, max: totals.target.asDouble, ready: totals.funded >= totals.target)
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
        return .goal(value: balance.asDouble, max: target.asDouble, ready: balance >= target)
    case .BigEF:
        let months = data?.bigEF?.targetMonths ?? 3
        let computed = bigEmergencyFundTarget(months: months, monthlyExpenses: state.settings.monthlyExpenses)
        let balance = NodeLedger.efBalance(state.budget, snap)
        let target = NodeLedger.efTarget(state.budget, .BigEF, computed: computed)
        return .goal(value: balance.asDouble, max: (target > 0 ? target : 1).asDouble, ready: target > 0 && balance >= target)
    case .Match:
        let matchPct = data?.match?.matchPct ?? 0
        let cur = data?.match?.currentContribPct ?? 0
        return .goal(value: cur.asDouble, max: (matchPct > 0 ? matchPct : 1).asDouble, ready: matchPct > 0 && cur >= matchPct)
    case .IRA:
        let ytd = data?.ira?.ytdContribution.value ?? 0
        let limit = data?.ira?.annualLimit ?? state.settings.iraAnnualLimit
        return .goal(value: ytd.asDouble, max: limit.asDouble, ready: ytd >= limit)
    case .HSA:
        let ytd = data?.hsa?.ytdContribution.value ?? 0
        let limit = data?.hsa?.annualLimit ?? state.settings.hsaSelfLimit
        return .goal(value: ytd.asDouble, max: limit.asDouble, ready: ytd >= limit)
    case .Increase401k:
        let cur = data?.increase401k?.currentPct ?? 0
        let target = data?.increase401k?.targetPct ?? 15
        return .goal(value: cur.asDouble, max: target.asDouble, ready: cur >= target)
    case .SavePurchase:
        let totals = NodeLedger.purchaseTotals(state.budget, snap, .SavePurchase)
        let saved = totals.saved
        let target = totals.target
        return .goal(value: saved.asDouble, max: (target > 0 ? target : 1).asDouble, ready: target > 0 && saved >= target)
    case .HighDebt, .ModDebt:
        let totals = NodeLedger.debtTotals(state.budget, id)
        if !totals.hasAny { return .none(ready: false) }
        return .goal(value: totals.paid.asDouble, max: (totals.total > 0 ? totals.total : 1).asDouble, ready: totals.allPaid)
    default:
        return .none(ready: true)
    }
}
