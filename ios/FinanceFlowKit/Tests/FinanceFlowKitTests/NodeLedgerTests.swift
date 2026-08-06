import Testing
import Foundation
@testable import FinanceFlowKit

/// Direct port of `src/budget/nodeLedger.test.ts` — the node↔ledger view layer
/// must agree across platforms on every number.
@Suite("NodeLedger (node ↔ ledger views and planners)")
struct NodeLedgerTests {
    private let month = "2026-06"
    private let today = "2026-06-10"

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

    private func txn(_ account: String, _ date: String, _ amount: Decimal, category: String? = nil, id: String? = nil) -> Txn {
        Txn(id: id ?? ShortID.make(), accountId: account, date: date, amount: amount, categoryId: category)
    }

    /// Reference applier — the contract `AppStore.apply(_:)` implements.
    private func apply(_ book: BudgetBook, _ ops: NodeLedger.BookOps) -> BudgetBook {
        var next = book
        next.groups.append(contentsOf: ops.addGroups)
        next.accounts.append(contentsOf: ops.addAccounts)
        for a in ops.updateAccounts {
            if let i = next.accounts.firstIndex(where: { $0.id == a.id }) { next.accounts[i] = a }
        }
        next.categories.append(contentsOf: ops.addCategories)
        for c in ops.updateCategories {
            if let i = next.categories.firstIndex(where: { $0.id == c.id }) { next.categories[i] = c }
        }
        next.transactions.append(contentsOf: ops.addTxns)
        for t in ops.updateTxns {
            if let i = next.transactions.firstIndex(where: { $0.id == t.id }) { next.transactions[i] = t }
        }
        if !ops.deleteTxnIDs.isEmpty {
            next.transactions.removeAll { ops.deleteTxnIDs.contains($0.id) }
        }
        for s in ops.setAssignments {
            var table = next.assignments[s.month] ?? [:]
            if s.amount > 0 { table[s.categoryID] = s.amount } else { table[s.categoryID] = nil }
            next.assignments[s.month] = table.isEmpty ? nil : table
        }
        return next
    }

    private func fundedBook() -> BudgetBook {
        BudgetBook(
            accounts: [Account(id: "checking", name: "checking", kind: .checking)],
            transactions: [txn("checking", "2026-06-01", 5000, category: Ledger.rtaCategoryID)]
        )
    }

    // MARK: - Reads

    @Test("recurring totals: Σ monthly targets vs Σ assigned this month")
    func recurringTotals() {
        var book = fundedBook()
        book.categories = [
            cat("Rent:r1", .Rent, monthlyTarget: 1800),
            cat("Rent:r2", .Rent, monthlyTarget: Decimal(string: "0.1")!),
            cat("Food", .Food, monthlyTarget: 600),
        ]
        book.assignments = [month: ["Rent:r1": 1800, "Rent:r2": Decimal(string: "0.2")!, "Food": 450]]
        let snap = Ledger.snapshot(book, month: month)
        let rent = NodeLedger.recurringTotals(book, snap, .Rent)
        #expect(rent.target == Decimal(string: "1800.1")!)
        #expect(rent.funded == Decimal(string: "1800.2")!)
        let food = NodeLedger.recurringTotals(book, snap, .Food)
        #expect(food.target == 600)
        #expect(food.funded == 450)
        let essential = NodeLedger.recurringTotals(book, snap, .Essential)
        #expect(essential.target == 0)
        #expect(essential.funded == 0)
    }

    @Test("EF balance is the SmallEF/BigEF union; only BigEF's target grows with buckets")
    func efUnion() {
        var book = fundedBook()
        book.categories = [
            cat("SmallEF", .SmallEF, group: "g:ef", balanceTarget: 1000),
            cat("BigEF:b1", .BigEF, group: "g:ef", balanceTarget: 9000),
            cat("Goals:g1", .Goals, group: "g:goals", balanceTarget: 500),
        ]
        book.assignments = [month: ["SmallEF": 700, "BigEF:b1": 1200, "Goals:g1": 100]]
        let snap = Ledger.snapshot(book, month: month)
        #expect(NodeLedger.efBalance(book, snap) == 1900)
        #expect(NodeLedger.efTarget(book, .SmallEF, computed: 1000) == 1000)
        #expect(NodeLedger.efTarget(book, .BigEF, computed: 6000) == 10000)
        #expect(NodeLedger.efTarget(book, .BigEF, computed: 24000) == 24000)
    }

    @Test("purchase totals: saved = Σ available, target = Σ balance targets")
    func purchaseTotals() {
        var book = fundedBook()
        book.categories = [
            cat("SavePurchase:p1", .SavePurchase, group: "g:goals", balanceTarget: 20000),
            cat("SavePurchase:p2", .SavePurchase, group: "g:goals", balanceTarget: 3000),
        ]
        book.assignments = [
            "2026-05": ["SavePurchase:p1": 4000],
            month: ["SavePurchase:p2": 250],
        ]
        let snap = Ledger.snapshot(book, month: month)
        let totals = NodeLedger.purchaseTotals(book, snap, .SavePurchase)
        #expect(totals.saved == 4250)
        #expect(totals.target == 23000)
    }

    @Test("debt rows derive principal, outstanding, and paid from the account ledger")
    func debtDerivation() {
        var book = BudgetBook()
        book.accounts = [
            Account(id: "debt:d1", name: "Visa", kind: .loan, apr: Decimal(string: "24.99")!, nodeId: .HighDebt),
            Account(id: "debt:d2", name: "Old", kind: .loan, closed: true, nodeId: .HighDebt),
        ]
        book.transactions = [
            txn("debt:d1", "2026-01-05", -4200, id: NodeLedger.startingTxnID("debt:d1")),
            txn("debt:d1", "2026-03-01", 1200),
        ]
        let rows = NodeLedger.debtRows(book, .HighDebt)
        #expect(rows.count == 1)
        #expect(rows[0].outstanding == 3000)
        #expect(rows[0].principal == 4200)
        #expect(rows[0].paid == false)

        let totals = NodeLedger.debtTotals(book, .HighDebt)
        #expect(totals.paid == 1200)
        #expect(totals.total == 4200)
        #expect(totals.allPaid == false)
        #expect(totals.hasAny == true)

        let none = NodeLedger.debtTotals(book, .ModDebt)
        #expect(none.hasAny == false)
        #expect(none.allPaid == false)
    }

    @Test("college balance reads the tracking account, zero when absent")
    func collegeBalance() {
        #expect(NodeLedger.collegeBalance(BudgetBook()) == 0)
        var book = BudgetBook()
        book.accounts = [Account(id: NodeLedger.collegeAccountID, name: "529", kind: .tracking)]
        book.transactions = [txn(NodeLedger.collegeAccountID, "2026-01-01", 2500)]
        #expect(NodeLedger.collegeBalance(book) == 2500)
    }

    // MARK: - planBalanceEdit

    private func efBook() -> BudgetBook {
        var book = fundedBook()
        book.categories = [cat("BigEF:b1", .BigEF, group: "g:ef", balanceTarget: 3000)]
        book.assignments = [month: ["BigEF:b1": 1200]]
        return book
    }

    @Test("raising a balance assigns more this month")
    func raiseAssigns() {
        let book = efBook()
        let next = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: 1500, today: today))
        #expect(next.assignments[month]?["BigEF:b1"] == 1500)
        #expect(next.transactions.count == book.transactions.count)
        #expect(Ledger.snapshot(next, month: month).categories["BigEF:b1"]?.available == 1500)
    }

    @Test("lowering within the assignment just un-assigns")
    func lowerUnassigns() {
        let book = efBook()
        let next = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: 900, today: today))
        #expect(next.assignments[month]?["BigEF:b1"] == 900)
        let snap = Ledger.snapshot(next, month: month)
        #expect(snap.categories["BigEF:b1"]?.available == 900)
        #expect(snap.readyToAssign == 4100)
    }

    @Test("lowering past the assignment writes one coalesced adjustment transaction")
    func lowerPastAssignment() {
        var book = efBook()
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: -300, today: today))
        #expect(book.assignments[month]?["BigEF:b1"] == nil)
        let adjustments = book.transactions.filter { $0.accountId == NodeLedger.adjustAccountID }
        #expect(adjustments.count == 1)
        #expect(adjustments.first?.amount == -300)
        #expect(adjustments.first?.categoryId == "BigEF:b1")
        #expect(book.accounts.contains { $0.id == NodeLedger.adjustAccountID })
        #expect(Ledger.snapshot(book, month: month).categories["BigEF:b1"]?.available == -300)
    }

    @Test("keystroke sequence converges: 5 → 50 → 500 ends exact with no adjustment")
    func keystrokesConverge() {
        var book = efBook()
        for v: Decimal in [5, 50, 500] {
            book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: v, today: today))
        }
        #expect(Ledger.snapshot(book, month: month).categories["BigEF:b1"]?.available == 500)
        #expect(book.transactions.filter { $0.accountId == NodeLedger.adjustAccountID }.isEmpty)
        #expect(book.assignments[month]?["BigEF:b1"] == 500)
    }

    @Test("raising after a same-day lowering unwinds the adjustment before assigning")
    func raiseUnwindsAdjustment() {
        var book = efBook()
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: -300, today: today))
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: 250, today: today))
        #expect(book.transactions.filter { $0.accountId == NodeLedger.adjustAccountID }.isEmpty)
        #expect(book.assignments[month]?["BigEF:b1"] == 250)
        #expect(Ledger.snapshot(book, month: month).categories["BigEF:b1"]?.available == 250)
    }

    @Test("raising the next day unwinds the write-off instead of burning RTA")
    func raiseNextDayUnwinds() {
        let before = efBook()
        let rtaBefore = Ledger.snapshot(before, month: month).readyToAssign
        // Day 10: fat-finger the balance down past the assignment. Day 11: fix it.
        var book = apply(before, NodeLedger.planBalanceEdit(before, month: month, categoryID: "BigEF:b1", newAvailable: -300, today: "\(month)-10"))
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: 1200, today: "\(month)-11"))

        #expect(book.transactions.filter { $0.accountId == NodeLedger.adjustAccountID }.isEmpty)
        #expect(book.assignments == before.assignments)
        let snap = Ledger.snapshot(book, month: month)
        #expect(snap.categories["BigEF:b1"]?.available == 1200)
        #expect(snap.readyToAssign == rtaBefore)
        #expect(Ledger.bookIntegrity(book, month: month).drift == 0)
    }

    @Test("raising past the write-offs clears them, then assigns the residual")
    func raisePastWriteOffs() {
        var book = efBook()
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: -300, today: "\(month)-10"))
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: 500, today: "\(month)-11"))

        #expect(book.transactions.filter { $0.accountId == NodeLedger.adjustAccountID }.isEmpty)
        #expect(book.assignments[month]?["BigEF:b1"] == 500)
        #expect(Ledger.snapshot(book, month: month).categories["BigEF:b1"]?.available == 500)
        #expect(Ledger.bookIntegrity(book, month: month).drift == 0)
    }

    @Test("a partial raise unwinds the NEWEST write-off first")
    func partialRaiseUnwindsNewestFirst() {
        var book = efBook()
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: -300, today: "\(month)-10"))
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: -800, today: "\(month)-12"))
        book = apply(book, NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: -600, today: "\(month)-13"))

        let byDate = Dictionary(
            uniqueKeysWithValues: book.transactions
                .filter { $0.accountId == NodeLedger.adjustAccountID }
                .map { ($0.date, $0.amount) }
        )
        // The 12th's −500 absorbs the whole +200; the 10th's −300 is untouched.
        #expect(byDate == ["\(month)-10": -300, "\(month)-12": -300])
        #expect(Ledger.snapshot(book, month: month).categories["BigEF:b1"]?.available == -600)
        #expect(Ledger.bookIntegrity(book, month: month).drift == 0)
    }

    @Test("does not treat a sub-half-cent row as an outstanding write-off")
    func subCentRowIsNotAWriteOff() {
        // Both engines select unwind candidates on the CENTS-rounded amount, so
        // a row that rounds to zero is invisible to both. Pinned on each
        // platform: if the two disagree here, an imported book unwinds a
        // different row. Mirrors `src/budget/nodeLedger.test.ts`.
        var book = efBook()
        book.accounts.append(
            Account(id: NodeLedger.adjustAccountID, name: "Adjustments", kind: .cash)
        )
        book.transactions.append(
            txn(
                NodeLedger.adjustAccountID, "\(month)-09", Decimal(string: "-0.004")!,
                category: "BigEF:b1", id: "txn:adjust:BigEF:b1:\(month)-09"
            )
        )
        let ops = NodeLedger.planBalanceEdit(book, month: month, categoryID: "BigEF:b1", newAvailable: 1500, today: today)
        #expect(ops.deleteTxnIDs.isEmpty)
        #expect(ops.updateTxns.isEmpty)
        #expect(ops.setAssignments.count == 1)
        #expect(ops.setAssignments.first?.categoryID == "BigEF:b1")
    }

    // MARK: - Account planners

    @Test("debt balance edits upsert one adjustment and delete it at net zero")
    func debtBalanceUpsert() {
        var book = BudgetBook()
        book.accounts = [Account(id: "debt:d1", name: "Visa", kind: .loan, nodeId: .HighDebt)]
        book.transactions = [txn("debt:d1", "2026-01-05", -4200, id: NodeLedger.startingTxnID("debt:d1"))]

        book = apply(book, NodeLedger.planDebtBalanceEdit(book, accountID: "debt:d1", newOwed: 4000, today: today))
        book = apply(book, NodeLedger.planDebtBalanceEdit(book, accountID: "debt:d1", newOwed: 3500, today: today))
        let adjustments = book.transactions.filter { $0.id.hasPrefix("txn:adjust:") }
        #expect(adjustments.count == 1)
        #expect(adjustments.first?.amount == 700)
        #expect(NodeLedger.debtRows(book, .HighDebt).first?.outstanding == 3500)

        book = apply(book, NodeLedger.planDebtBalanceEdit(book, accountID: "debt:d1", newOwed: 4200, today: today))
        #expect(book.transactions.filter { $0.id.hasPrefix("txn:adjust:") }.isEmpty)
    }

    @Test("mark paid zeroes the account and derives paid")
    func markPaid() {
        var book = BudgetBook()
        book.accounts = [Account(id: "debt:d1", name: "Visa", kind: .loan, nodeId: .HighDebt)]
        book.transactions = [txn("debt:d1", "2026-01-05", -4200, id: NodeLedger.startingTxnID("debt:d1"))]
        book = apply(book, NodeLedger.planMarkDebtPaid(book, accountID: "debt:d1", today: today))
        let rows = NodeLedger.debtRows(book, .HighDebt)
        #expect(rows.first?.paid == true)
        #expect(rows.first?.outstanding == 0)
        let totals = NodeLedger.debtTotals(book, .HighDebt)
        #expect(totals.paid == 4200)
        #expect(totals.total == 4200)
        #expect(totals.allPaid == true)
        #expect(totals.hasAny == true)
    }

    @Test("college balance edits create the tracking account on first use")
    func collegeCreation() {
        var book = BudgetBook()
        book = apply(book, NodeLedger.planCollegeBalanceEdit(book, newBalance: 2500, today: today))
        #expect(book.accounts.map(\.id) == [NodeLedger.collegeAccountID])
        #expect(book.accounts.first?.nodeId == .College)
        #expect(NodeLedger.collegeBalance(book) == 2500)
    }

    // MARK: - Creation planners

    @Test("creates a linked category and its well-known group exactly once")
    func createLinkedCategory() {
        var book = BudgetBook()
        let first = NodeLedger.planCreateLinkedCategory(book, nodeId: .Rent, name: "Apartment", monthlyTarget: 1800)
        book = apply(book, first.ops)
        #expect(book.groups.map(\.id) == ["g:bills"])
        #expect(book.categories.first?.id == first.categoryID)
        #expect(book.categories.first?.groupId == "g:bills")
        #expect(book.categories.first?.name == "Apartment")
        #expect(book.categories.first?.monthlyTarget == 1800)
        #expect(book.categories.first?.nodeId == .Rent)

        let second = NodeLedger.planCreateLinkedCategory(book, nodeId: .Food, name: "Groceries", monthlyTarget: 600)
        #expect(second.ops.addGroups.isEmpty)
    }

    @Test("creates a debt account with its opening-balance transaction")
    func createDebtAccount() {
        let book = BudgetBook()
        let result = NodeLedger.planCreateDebtAccount(
            book, nodeId: .HighDebt,
            name: "Visa", balance: 4200, apr: Decimal(string: "24.99")!, minPayment: 50,
            today: today
        )
        let next = apply(book, result.ops)
        #expect(next.accounts.first?.id == result.accountID)
        #expect(next.accounts.first?.kind == .loan)
        #expect(next.accounts.first?.apr == Decimal(string: "24.99")!)
        #expect(next.accounts.first?.nodeId == .HighDebt)
        let start = next.transactions.first { $0.id == NodeLedger.startingTxnID(result.accountID) }
        #expect(start?.amount == -4200)
        let row = NodeLedger.debtRows(next, .HighDebt).first
        #expect(row?.principal == 4200)
        #expect(row?.outstanding == 4200)
        #expect(row?.paid == false)
    }
}
