import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("progressOf (money math)")
struct ProgressTests {
    private func state(_ build: (inout AppState) -> Void) -> AppState {
        var s = AppState.makeInitial(); build(&s); return s
    }

    @Test("recurring with items aggregates target and funded")
    func recurringItems() {
        let s = state {
            $0.nodes[.Rent]?.data = .recurring(RecurringData(items: [
                RecurringItem(name: "Base", target: .manual(1500), funded: .manual(1500)),
                RecurringItem(name: "Parking", target: .manual(200), funded: .manual(100)),
            ]))
        }
        guard case let .goal(value, max, ready) = progressOf(s, .Rent) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1700)
        #expect(value == 1600)
        #expect(ready == false)
    }

    @Test("exact decimal sums meet the target with no floating-point drift")
    func exactSumsAreReady() {
        // As `Double`, funded 0.7 + 0.1 == 0.7999999999999999, a hair below the
        // target 0.4 + 0.4 == 0.8 — so `ready` needed a half-cent tolerance to not
        // get stuck false. As `Decimal` both sides sum to exactly 0.8, so plain
        // `>=` is enough and the tolerance is gone.
        let s = state {
            $0.nodes[.Food]?.data = .recurring(RecurringData(items: [
                RecurringItem(target: .manual(Decimal(string: "0.4")!), funded: .manual(Decimal(string: "0.7")!)),
                RecurringItem(target: .manual(Decimal(string: "0.4")!), funded: .manual(Decimal(string: "0.1")!)),
            ]))
        }
        guard case let .goal(value, max, ready) = progressOf(s, .Food) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 0.8)
        #expect(value == 0.8)
        #expect(ready == true)
    }

    @Test("debts: ready only when all paid; value/max aggregate balances")
    func debts() {
        let s = state {
            $0.nodes[.HighDebt]?.data = .debts([
                Debt(name: "A", balance: 1000, paid: true),
                Debt(name: "B", balance: 500, paid: false),
            ])
        }
        guard case let .goal(value, max, ready) = progressOf(s, .HighDebt) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1500)
        #expect(value == 1000)
        #expect(ready == false)

        let allPaid = state {
            $0.nodes[.HighDebt]?.data = .debts([
                Debt(name: "A", balance: 1000, paid: true),
                Debt(name: "B", balance: 500, paid: true),
            ])
        }
        #expect(progressOf(allPaid, .HighDebt).ready == true)
    }

    @Test("empty debt list is not ready")
    func emptyDebts() {
        let s = state { $0.nodes[.HighDebt]?.data = .debts([]) }
        #expect(progressOf(s, .HighDebt).ready == false)
    }

    @Test("SmallEF target is max($1000, one month of expenses)")
    func smallEF() {
        let s = state {
            $0.settings.monthlyExpenses = 3000
            $0.nodes[.SmallEF]?.data = .smallEF(SmallEFData(balance: .manual(3000)))
        }
        guard case let .goal(value, max, ready) = progressOf(s, .SmallEF) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 3000)
        #expect(value == 3000)
        #expect(ready == true)
    }

    @Test("SmallEF floors at $1000 when expenses are unset")
    func smallEFFloor() {
        let s = state { $0.nodes[.SmallEF]?.data = .smallEF(SmallEFData(balance: .manual(1000))) }
        guard case let .goal(_, max, ready) = progressOf(s, .SmallEF) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1000)
        #expect(ready == true)
    }

    @Test("EF buckets: balance is the bucket sum; under-allocated buckets keep the computed target")
    func efBucketsUnderComputed() {
        let s = state {
            $0.settings.monthlyExpenses = 3000
            $0.nodes[.SmallEF]?.data = .smallEF(SmallEFData(balance: .manual(0), items: [
                EFBucket(name: "Medical", target: 1000, balance: .manual(800)),
                EFBucket(name: "Car", target: 500, balance: .manual(500)),
            ]))
        }
        guard case let .goal(value, max, ready) = progressOf(s, .SmallEF) else {
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
        let s = state {
            $0.settings.monthlyExpenses = 3000
            $0.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 3, balance: .manual(0), items: [
                EFBucket(name: "Medical", target: 6000, balance: .manual(6000)),
                EFBucket(name: "Home", target: 5000, balance: .manual(4000)),
            ]))
        }
        guard case let .goal(value, max, ready) = progressOf(s, .BigEF) else {
            Issue.record("expected .goal"); return
        }
        // Σ bucket targets (11000) exceeds 3 × 3000: the user's real goal shows.
        #expect(max == 11000)
        #expect(value == 10000)
        #expect(ready == false)
    }

    @Test("BigEF buckets define the goal when expenses are unset (computed target is 0)")
    func bigEFBucketsNoExpenses() {
        let s = state {
            $0.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6, balance: .manual(0), items: [
                EFBucket(name: "Car", target: 4000, balance: .manual(4000)),
            ]))
        }
        guard case let .goal(value, max, ready) = progressOf(s, .BigEF) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 4000)
        #expect(value == 4000)
        #expect(ready == true)
    }

    @Test("EF without buckets keeps the single-balance behavior")
    func bigEFSingleBalance() {
        let s = state {
            $0.settings.monthlyExpenses = 3000
            $0.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6, balance: .manual(18000)))
        }
        guard case let .goal(value, max, ready) = progressOf(s, .BigEF) else {
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

    @Test("decision nodes carry no goal progress")
    func decisionNode() {
        #expect(progressOf(.makeInitial(), .Q_Match) == .none(ready: false))
    }
}
