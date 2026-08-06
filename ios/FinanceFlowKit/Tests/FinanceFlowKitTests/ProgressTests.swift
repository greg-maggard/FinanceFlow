import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("progressOf (money math)")
struct ProgressTests {
    private let month = "2026-06"

    private func state(_ build: (inout AppState) -> Void) -> AppState {
        var s = AppState.makeInitial(); build(&s); return s
    }

    /// A state whose book has one on-budget account and an RTA inflow, so the
    /// category availables the assignments create are real money.
    private func seeded(_ build: (inout AppState) -> Void) -> AppState {
        state { s in
            s.budget.accounts = [Account(id: "checking", name: "checking", kind: .checking)]
            s.budget.transactions = [
                Txn(id: "t:rta", accountId: "checking", date: "2026-06-01", amount: 100000, categoryId: Ledger.rtaCategoryID),
            ]
            build(&s)
        }
    }

    private func cat(
        _ id: String,
        _ nodeId: NodeId,
        group: String = "g:bills",
        monthlyTarget: Decimal? = nil,
        balanceTarget: Decimal? = nil
    ) -> BudgetCategory {
        BudgetCategory(
            id: id, groupId: group, name: id,
            monthlyTarget: monthlyTarget, balanceTarget: balanceTarget, nodeId: nodeId
        )
    }

    @Test("recurring aggregates target and funded across linked categories")
    func recurringCategories() {
        let s = seeded {
            $0.budget.categories = [
                cat("Rent:base", .Rent, monthlyTarget: 1500),
                cat("Rent:parking", .Rent, monthlyTarget: 200),
            ]
            $0.budget.assignments = [month: ["Rent:base": 1500, "Rent:parking": 100]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .Rent, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1700)
        #expect(value == 1600)
        #expect(ready == false)
    }

    @Test("exact decimal sums meet the target with no floating-point drift")
    func exactSumsAreReady() {
        // As `Double`, 0.7 + 0.1 == 0.7999999999999999 — a hair below 0.8 on
        // both sides of the comparison, so `ready` would need a tolerance to
        // not get stuck false. The ledger sums exact `Decimal`s, so target and
        // funded are both exactly 0.8 and plain `>=` is enough.
        let s = seeded {
            $0.budget.categories = [
                cat("Food:a", .Food, monthlyTarget: Decimal(string: "0.7")!),
                cat("Food:b", .Food, monthlyTarget: Decimal(string: "0.1")!),
            ]
            $0.budget.assignments = [month: ["Food:a": Decimal(string: "0.7")!, "Food:b": Decimal(string: "0.1")!]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .Food, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 0.8)
        #expect(value == 0.8)
        #expect(ready == true)
    }

    @Test("a target met entirely by carryover reads ready with nothing assigned")
    func carryoverIsReady() {
        // Month-ahead budgeting: May's assignment carries into June untouched.
        let s = seeded {
            $0.budget.transactions = [
                Txn(id: "t:rta", accountId: "checking", date: "2026-05-01", amount: 100000, categoryId: Ledger.rtaCategoryID),
            ]
            $0.budget.categories = [cat("Rent:base", .Rent, monthlyTarget: 1800)]
            $0.budget.assignments = ["2026-05": ["Rent:base": 1800]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .Rent, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1800)
        #expect(value == 1800)
        #expect(ready == true)
    }

    @Test("one over-stuffed envelope cannot cover an empty sibling in the same node")
    func clampStopsSiblingMasking() {
        let s = seeded {
            $0.budget.categories = [
                cat("Rent:base", .Rent, monthlyTarget: 1500),
                cat("Rent:parking", .Rent, monthlyTarget: 200),
            ]
            $0.budget.assignments = [month: ["Rent:base": 1700]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .Rent, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1700)
        #expect(value == 1500)
        #expect(ready == false)
    }

    @Test("recurring without targets keeps the zero-target behavior: none, ready")
    func recurringZeroTarget() {
        // No linked categories at all…
        #expect(progressOf(seeded { _ in }, .Rent, month: month) == .none(ready: true))
        // …and categories without monthly targets (even with money assigned).
        let s = seeded {
            $0.budget.categories = [cat("Food", .Food)]
            $0.budget.assignments = [month: ["Food": 200]]
        }
        #expect(progressOf(s, .Food, month: month) == .none(ready: true))
    }

    /// A Visa with its $4,200 opening balance and `paidSoFar` paid back.
    private func debtState(paidSoFar: Decimal) -> AppState {
        state {
            $0.budget.accounts = [
                Account(id: "debt:d1", name: "Visa", kind: .loan, apr: Decimal(string: "24.99")!, nodeId: .HighDebt),
            ]
            $0.budget.transactions = [
                Txn(id: NodeLedger.startingTxnID("debt:d1"), accountId: "debt:d1", date: "2026-01-05", amount: -4200),
            ]
            if paidSoFar > 0 {
                $0.budget.transactions.append(Txn(accountId: "debt:d1", date: "2026-03-01", amount: paidSoFar))
            }
        }
    }

    @Test("debts: the payoff bar climbs continuously; ready only when all cleared")
    func debts() {
        guard case let .goal(value, max, ready) = progressOf(debtState(paidSoFar: 1200), .HighDebt, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 4200)
        #expect(value == 1200)
        #expect(ready == false)

        let allPaid = debtState(paidSoFar: 4200)
        #expect(progressOf(allPaid, .HighDebt, month: month) == .goal(value: 4200, max: 4200, ready: true))
    }

    @Test("no linked debt accounts is not ready")
    func emptyDebts() {
        #expect(progressOf(.makeInitial(), .HighDebt, month: month) == .none(ready: false))
    }

    @Test("SmallEF target is max($1000, one month of expenses)")
    func smallEF() {
        let s = seeded {
            $0.settings.monthlyExpenses = 3000
            $0.budget.categories = [cat("SmallEF", .SmallEF, group: "g:ef")]
            $0.budget.assignments = [month: ["SmallEF": 3000]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .SmallEF, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 3000)
        #expect(value == 3000)
        #expect(ready == true)
    }

    @Test("SmallEF floors at $1000 when expenses are unset")
    func smallEFFloor() {
        let s = seeded {
            $0.budget.categories = [cat("SmallEF", .SmallEF, group: "g:ef")]
            $0.budget.assignments = [month: ["SmallEF": 1000]]
        }
        guard case let .goal(_, max, ready) = progressOf(s, .SmallEF, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1000)
        #expect(ready == true)
    }

    @Test("SmallEF keeps the computed gate even when bucket targets exceed it")
    func smallEFGate() {
        let s = seeded {
            $0.settings.monthlyExpenses = 3000
            $0.budget.categories = [cat("SmallEF:medical", .SmallEF, group: "g:ef", balanceTarget: 9000)]
            $0.budget.assignments = [month: ["SmallEF:medical": 800]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .SmallEF, month: month) else {
            Issue.record("expected .goal"); return
        }
        // Big bucket ambitions live on BigEF; the $1k-or-one-month starter
        // gate never inflates, so the first milestone stays reachable.
        #expect(max == 3000)
        #expect(value == 800)
        #expect(ready == false)
    }

    @Test("EF buckets: balance is the bucket sum; under-allocated buckets keep the computed target")
    func efBucketsUnderComputed() {
        let s = seeded {
            $0.settings.monthlyExpenses = 3000
            $0.budget.categories = [
                cat("SmallEF:medical", .SmallEF, group: "g:ef", balanceTarget: 1000),
                cat("SmallEF:car", .SmallEF, group: "g:ef", balanceTarget: 500),
            ]
            $0.budget.assignments = [month: ["SmallEF:medical": 800, "SmallEF:car": 500]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .SmallEF, month: month) else {
            Issue.record("expected .goal"); return
        }
        // Bucket targets (1500) are below one month of expenses (3000): the
        // flowchart milestone wins, so naming buckets never shrinks the goal.
        #expect(max == 3000)
        #expect(value == 1300)
        #expect(ready == false)
    }

    @Test("EF buckets: targets beyond the computed milestone grow the goal")
    func efBucketsOverComputed() {
        let s = seeded {
            $0.settings.monthlyExpenses = 3000
            $0.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 3))
            $0.budget.categories = [
                cat("BigEF:medical", .BigEF, group: "g:ef", balanceTarget: 6000),
                cat("BigEF:home", .BigEF, group: "g:ef", balanceTarget: 5000),
            ]
            $0.budget.assignments = [month: ["BigEF:medical": 6000, "BigEF:home": 4000]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .BigEF, month: month) else {
            Issue.record("expected .goal"); return
        }
        // Σ bucket targets (11000) exceeds 3 × 3000: the user's real goal shows.
        #expect(max == 11000)
        #expect(value == 10000)
        #expect(ready == false)
    }

    @Test("BigEF buckets define the goal when expenses are unset (computed target is 0)")
    func bigEFBucketsNoExpenses() {
        let s = seeded {
            $0.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6))
            $0.budget.categories = [cat("BigEF:car", .BigEF, group: "g:ef", balanceTarget: 4000)]
            $0.budget.assignments = [month: ["BigEF:car": 4000]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .BigEF, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 4000)
        #expect(value == 4000)
        #expect(ready == true)
    }

    @Test("BigEF without balance targets keeps the computed goal")
    func bigEFSingleBalance() {
        let s = seeded {
            $0.settings.monthlyExpenses = 3000
            $0.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6))
            $0.budget.categories = [cat("BigEF", .BigEF, group: "g:ef")]
            $0.budget.assignments = [month: ["BigEF": 18000]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .BigEF, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 18000)
        #expect(value == 18000)
        #expect(ready == true)
    }

    @Test("IRA is ready at the annual limit")
    func ira() {
        let s = state {
            $0.nodes[.IRA]?.data = .ira(IRAData(type: .roth, ytdContribution: .manual(7000), annualLimit: 7000))
        }
        #expect(progressOf(s, .IRA).ready == true)
    }

    @Test("SavePurchase aggregates saved and target across goal envelopes")
    func savePurchaseGoals() {
        let s = seeded {
            $0.budget.categories = [
                cat("SavePurchase:down", .SavePurchase, group: "g:goals", balanceTarget: 40000),
                cat("SavePurchase:car", .SavePurchase, group: "g:goals", balanceTarget: 12000),
            ]
            $0.budget.assignments = [month: ["SavePurchase:down": 15000, "SavePurchase:car": 12000]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .SavePurchase, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 52000)
        #expect(value == 27000)
        #expect(ready == false)
    }

    @Test("SavePurchase keeps the single-goal behavior with one envelope")
    func savePurchaseLegacy() {
        let s = seeded {
            $0.budget.categories = [cat("SavePurchase:car", .SavePurchase, group: "g:goals", balanceTarget: 12000)]
            $0.budget.assignments = [month: ["SavePurchase:car": 12000]]
        }
        guard case let .goal(value, max, ready) = progressOf(s, .SavePurchase, month: month) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 12000)
        #expect(value == 12000)
        #expect(ready == true)
    }

    @Test("decision nodes carry no goal progress")
    func decisionNode() {
        #expect(progressOf(.makeInitial(), .Q_Match) == .none(ready: false))
    }
}
