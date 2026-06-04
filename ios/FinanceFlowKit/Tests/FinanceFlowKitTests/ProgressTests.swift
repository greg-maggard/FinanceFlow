import Testing
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

    @Test("ready tolerates floating-point drift just below target")
    func readyEpsilon() {
        // target sums to 0.8; funded sums to 0.7999999… — must still read ready.
        let s = state {
            $0.nodes[.Food]?.data = .recurring(RecurringData(items: [
                RecurringItem(target: .manual(0.4), funded: .manual(0.7)),
                RecurringItem(target: .manual(0.4), funded: .manual(0.1)),
            ]))
        }
        #expect(progressOf(s, .Food).ready == true)
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
            $0.nodes[.SmallEF]?.data = .smallEF(balance: .manual(3000))
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
        let s = state { $0.nodes[.SmallEF]?.data = .smallEF(balance: .manual(1000)) }
        guard case let .goal(_, max, ready) = progressOf(s, .SmallEF) else {
            Issue.record("expected .goal"); return
        }
        #expect(max == 1000)
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
