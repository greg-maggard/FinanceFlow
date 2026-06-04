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

/// Tolerance for "have we met the target?" checks. Money and percentages are
/// stored as `Double` (for byte-parity with the web), and sums of `Double` can
/// land a hair below an exact target (e.g. 999.9999999 vs 1000). Treat "within
/// half a cent" as meeting the target so the `ready` flag doesn't get stuck false.
private let readyTolerance = 0.005

/// Whether `value` meets/exceeds `target` within `readyTolerance`.
private func meets(_ value: Double, _ target: Double) -> Bool {
    value >= target - readyTolerance
}

/// Compute progress for a node. Direct port of `progressOf`.
public func progressOf(_ state: AppState, _ id: NodeId) -> ProgressInfo {
    let node = Flowchart.node(id)
    if node.kind == .decision { return .none(ready: false) }

    if recurringNodes.contains(id) {
        let data = state.node(id).data?.recurring
        if let items = data?.items, !items.isEmpty {
            let target = items.reduce(0) { $0 + $1.target.value }
            let funded = items.reduce(0) { $0 + ($1.funded?.value ?? 0) }
            if target > 0 {
                return .goal(value: funded, max: target, ready: meets(funded, target))
            }
            return .none(ready: true)
        }
        let target = data?.target.value ?? 0
        let funded = data?.funded?.value ?? 0
        if target > 0 {
            return .goal(value: funded, max: target, ready: meets(funded, target))
        }
        return .none(ready: true)
    }

    let data = state.node(id).data

    switch id {
    case .Start:
        return .none(ready: true)
    case .SmallEF:
        let balance = data?.smallEFBalance?.value ?? 0
        let target = emergencyFundTarget(monthlyExpenses: state.settings.monthlyExpenses)
        return .goal(value: balance, max: target, ready: meets(balance, target))
    case .BigEF:
        let months = Double(data?.bigEF?.targetMonths ?? 3)
        let balance = data?.bigEF?.balance.value ?? 0
        let target = bigEmergencyFundTarget(months: months, monthlyExpenses: state.settings.monthlyExpenses)
        return .goal(value: balance, max: target > 0 ? target : 1, ready: target > 0 && meets(balance, target))
    case .Match:
        let matchPct = data?.match?.matchPct ?? 0
        let cur = data?.match?.currentContribPct ?? 0
        return .goal(value: cur, max: matchPct > 0 ? matchPct : 1, ready: matchPct > 0 && meets(cur, matchPct))
    case .IRA:
        let ytd = data?.ira?.ytdContribution.value ?? 0
        let limit = data?.ira?.annualLimit ?? state.settings.iraAnnualLimit
        return .goal(value: ytd, max: limit, ready: meets(ytd, limit))
    case .HSA:
        let ytd = data?.hsa?.ytdContribution.value ?? 0
        let limit = data?.hsa?.annualLimit ?? state.settings.hsaSelfLimit
        return .goal(value: ytd, max: limit, ready: meets(ytd, limit))
    case .Increase401k:
        let cur = data?.increase401k?.currentPct ?? 0
        let target = data?.increase401k?.targetPct ?? 15
        return .goal(value: cur, max: target, ready: meets(cur, target))
    case .SavePurchase:
        let saved = data?.savePurchase?.saved.value ?? 0
        let target = data?.savePurchase?.target ?? 0
        return .goal(value: saved, max: target > 0 ? target : 1, ready: target > 0 && meets(saved, target))
    case .HighDebt, .ModDebt:
        let debts = data?.debts ?? []
        if debts.isEmpty { return .none(ready: false) }
        let total = debts.reduce(0) { $0 + $1.balance }
        let paidAmt = debts.filter(\.paid).reduce(0) { $0 + $1.balance }
        let allPaid = debts.allSatisfy(\.paid)
        return .goal(value: paidAmt, max: total > 0 ? total : 1, ready: allPaid)
    default:
        return .none(ready: true)
    }
}
