import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("monthly budget rollup")
struct BudgetTests {
    private func state(_ build: (inout AppState) -> Void) -> AppState {
        var s = AppState.makeInitial(); build(&s); return s
    }

    @Test("effective totals use the single pair when there are no items")
    func effectiveSingle() {
        let d = RecurringData(target: .manual(500), funded: .manual(200))
        #expect(d.effectiveTarget == 500)
        #expect(d.effectiveFunded == 200)
    }

    @Test("effective totals sum the items when present, ignoring the top-level pair")
    func effectiveItems() {
        let d = RecurringData(target: .manual(999), funded: .manual(999), items: [
            RecurringItem(name: "Power", target: .manual(100), funded: .manual(80)),
            RecurringItem(name: "Water", target: .manual(50)),
        ])
        #expect(d.effectiveTarget == 150)
        #expect(d.effectiveFunded == 80)
    }

    @Test("an empty items array behaves like no items")
    func effectiveEmptyItems() {
        let d = RecurringData(target: .manual(500), funded: .manual(100), items: [])
        #expect(d.effectiveTarget == 500)
        #expect(d.effectiveFunded == 100)
    }

    @Test("summary is zero on an untouched state")
    func summaryEmpty() {
        #expect(Derive.monthlyBudgetSummary(.makeInitial()) == BudgetSummary(target: 0, funded: 0))
    }

    @Test("summary sums single and itemized nodes across the recurring set")
    func summaryMixed() {
        let s = state {
            $0.nodes[.Rent]?.data = .recurring(RecurringData(target: .manual(1800), funded: .manual(1800)))
            $0.nodes[.Essential]?.data = .recurring(RecurringData(items: [
                RecurringItem(name: "Power", target: .manual(120), funded: .manual(90)),
                RecurringItem(name: "Water", target: .manual(40), funded: .manual(40)),
            ]))
        }
        let summary = Derive.monthlyBudgetSummary(s)
        #expect(summary.target == 1960)
        #expect(summary.funded == 1930)
    }

    @Test("summary sums stay exact across fractional amounts")
    func summaryExactDecimals() {
        let s = state {
            $0.nodes[.Food]?.data = .recurring(RecurringData(items: [
                RecurringItem(target: .manual(Decimal(string: "0.1")!), funded: .manual(Decimal(string: "0.1")!)),
                RecurringItem(target: .manual(Decimal(string: "0.2")!), funded: .manual(Decimal(string: "0.2")!)),
            ]))
        }
        let summary = Derive.monthlyBudgetSummary(s)
        #expect(summary.target == Decimal(string: "0.3")!)
        #expect(summary.funded == Decimal(string: "0.3")!)
    }
}
