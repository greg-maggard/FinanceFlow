import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("monthly budget rollup")
struct BudgetTests {
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

    private func cat(_ id: String, _ nodeId: NodeId, monthlyTarget: Decimal) -> BudgetCategory {
        BudgetCategory(id: id, groupId: "g:bills", name: id, monthlyTarget: monthlyTarget, nodeId: nodeId)
    }

    @Test("summary is zero on an untouched state")
    func summaryEmpty() {
        #expect(Derive.monthlyBudgetSummary(.makeInitial(), month: month) == BudgetSummary(target: 0, funded: 0))
    }

    @Test("summary sums targets and assignments across the recurring nodes' categories")
    func summaryMixed() {
        let s = seeded {
            $0.budget.categories = [
                cat("Rent", .Rent, monthlyTarget: 1800),
                cat("Essential:power", .Essential, monthlyTarget: 120),
                cat("Essential:water", .Essential, monthlyTarget: 40),
            ]
            $0.budget.assignments = [month: ["Rent": 1800, "Essential:power": 90, "Essential:water": 40]]
        }
        let summary = Derive.monthlyBudgetSummary(s, month: month)
        #expect(summary.target == 1960)
        #expect(summary.funded == 1930)
    }

    @Test("summary sums stay exact across fractional amounts and nodes")
    func summaryExactDecimals() {
        let s = seeded {
            $0.budget.categories = [
                cat("Rent", .Rent, monthlyTarget: Decimal(string: "0.1")!),
                cat("Food", .Food, monthlyTarget: Decimal(string: "0.2")!),
            ]
            $0.budget.assignments = [month: ["Rent": Decimal(string: "0.1")!, "Food": Decimal(string: "0.2")!]]
        }
        let summary = Derive.monthlyBudgetSummary(s, month: month)
        #expect(summary.target == Decimal(string: "0.3")!)
        #expect(summary.funded == Decimal(string: "0.3")!)
    }
}
