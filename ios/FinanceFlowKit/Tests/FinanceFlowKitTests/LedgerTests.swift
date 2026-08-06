import Testing
import Foundation
@testable import FinanceFlowKit

/// Direct port of `src/budget/ledger.test.ts` — the two engines must agree on
/// every number or the platforms' envelope math has diverged.
@Suite("Ledger (zero-based envelope math)")
struct LedgerTests {

    private func txn(
        _ account: String,
        _ date: String,
        _ amount: Decimal,
        category: String? = nil,
        transfer: String? = nil
    ) -> Txn {
        Txn(accountId: account, date: date, amount: amount, categoryId: category, transferAccountId: transfer)
    }

    private func makeBook(
        transactions: [Txn] = [],
        assignments: [String: [String: Decimal]] = [:]
    ) -> BudgetBook {
        BudgetBook(
            accounts: [
                Account(id: "checking", name: "checking", kind: .checking),
                Account(id: "savings", name: "savings", kind: .savings),
                Account(id: "card", name: "card", kind: .credit),
                Account(id: "ira", name: "ira", kind: .tracking),
            ],
            transactions: transactions,
            assignments: assignments
        )
    }

    @Test("buckets dates into months")
    func monthBuckets() {
        #expect(Ledger.monthOf(date: "2026-06-10") == "2026-06")
    }

    @Test("treats loan and tracking accounts as off-budget")
    func offBudgetKinds() {
        #expect(Ledger.isOnBudget(.checking))
        #expect(Ledger.isOnBudget(.credit))
        #expect(!Ledger.isOnBudget(.loan))
        #expect(!Ledger.isOnBudget(.tracking))
    }

    @Test("sums balances exactly")
    func exactBalances() {
        let b = makeBook(transactions: [
            txn("checking", "2026-06-01", Decimal(string: "0.1")!),
            txn("checking", "2026-06-02", Decimal(string: "0.2")!),
        ])
        #expect(Ledger.accountBalance(b, "checking") == Decimal(string: "0.3")!)
    }

    @Test("computes RTA from inflows and assignments through the viewed month")
    func rtaCountsAssignmentsThroughViewedMonth() {
        let b = makeBook(
            transactions: [txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID)],
            assignments: ["2026-06": ["groceries": 600], "2026-07": ["groceries": 50]]
        )
        let june = Ledger.snapshot(b, month: "2026-06")
        #expect(june.readyToAssign == 400)
        #expect(june.categories["groceries"] == .init(assigned: 600, activity: 0, available: 600))
    }

    @Test("carries RTA cumulatively: a balanced month reads the same viewed later")
    func rtaIsCumulativeThroughViewedMonth() {
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID),
                txn("checking", "2026-07-01", 100, category: Ledger.rtaCategoryID),
            ],
            assignments: ["2026-06": ["groceries": 100], "2026-07": ["groceries": 100]]
        )
        #expect(Ledger.snapshot(b, month: "2026-06").readyToAssign == 900)
        #expect(Ledger.snapshot(b, month: "2026-07").readyToAssign == 900)
    }

    @Test("shows a negative RTA in the month you over-assigned ahead into")
    func rtaGoesNegativeWhenYouReachAnOverAssignedMonth() {
        let b = makeBook(
            transactions: [txn("checking", "2026-06-01", 100, category: Ledger.rtaCategoryID)],
            assignments: ["2026-07": ["groceries": 250]]
        )
        #expect(Ledger.snapshot(b, month: "2026-06").readyToAssign == 100)
        #expect(Ledger.snapshot(b, month: "2026-07").readyToAssign == -150)
    }

    @Test("reports dollars parked in months after the viewed one")
    func assignedAfterSumsFutureMonths() {
        let b = makeBook(assignments: [
            "2026-06": ["groceries": 100],
            "2026-07": ["groceries": 50],
            "2026-08": ["groceries": Decimal(string: "25.50")!],
        ])
        #expect(Ledger.assignedAfter(b, month: "2026-06") == Decimal(string: "75.50")!)
        #expect(Ledger.assignedAfter(b, month: "2026-07") == Decimal(string: "25.50")!)
        #expect(Ledger.assignedAfter(b, month: "2026-08") == 0)
    }

    @Test("rolls positive available forward across months")
    func rollsForward() {
        let b = makeBook(assignments: ["2026-06": ["groceries": 100], "2026-07": ["groceries": 50]])
        let july = Ledger.snapshot(b, month: "2026-07")
        #expect(july.categories["groceries"] == .init(assigned: 50, activity: 0, available: 150))
    }

    @Test("rolls available across empty gap months")
    func rollsAcrossGaps() {
        let b = makeBook(assignments: ["2026-04": ["goal": 100]])
        #expect(Ledger.snapshot(b, month: "2026-07").categories["goal"]?.available == 100)
    }

    @Test("resets overspending and debits the following month's RTA")
    func overspendResets() {
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-15", -150, category: "groceries"),
            ],
            assignments: ["2026-06": ["groceries": 100]]
        )
        let june = Ledger.snapshot(b, month: "2026-06")
        #expect(june.categories["groceries"]?.available == -50)
        #expect(june.readyToAssign == 900)

        let july = Ledger.snapshot(b, month: "2026-07")
        #expect(july.categories["groceries"]?.available == 0)
        #expect(july.readyToAssign == 850)
    }

    @Test("ignores transfers between on-budget accounts")
    func transfersAreNeutral() {
        let b = makeBook(transactions: [
            txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID),
            txn("checking", "2026-06-05", -200, transfer: "savings"),
            txn("savings", "2026-06-05", 200, transfer: "checking"),
        ])
        let june = Ledger.snapshot(b, month: "2026-06")
        #expect(june.readyToAssign == 1000)
        #expect(june.categories.isEmpty)
        #expect(Ledger.accountBalance(b, "checking") == 800)
        #expect(Ledger.accountBalance(b, "savings") == 200)
    }

    @Test("counts a categorized transfer to an off-budget account as activity")
    func offBudgetTransferIsActivity() {
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-10", -500, category: "retirement", transfer: "ira"),
                txn("ira", "2026-06-10", 500, transfer: "checking"),
            ],
            assignments: ["2026-06": ["retirement": 500]]
        )
        let june = Ledger.snapshot(b, month: "2026-06")
        #expect(june.categories["retirement"] == .init(assigned: 500, activity: -500, available: 0))
        #expect(june.readyToAssign == 500)
        #expect(Ledger.accountBalance(b, "ira") == 500)
    }

    @Test("treats credit spending as activity but credit payments as plain transfers")
    func creditSpendingAndPayments() {
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID),
                txn("card", "2026-06-08", -80, category: "groceries"),
                txn("checking", "2026-06-20", -60, transfer: "card"),
                txn("card", "2026-06-20", 60, transfer: "checking"),
            ],
            assignments: ["2026-06": ["groceries": 80]]
        )
        let june = Ledger.snapshot(b, month: "2026-06")
        #expect(june.categories["groceries"] == .init(assigned: 80, activity: -80, available: 0))
        #expect(june.readyToAssign == 920)
        #expect(Ledger.accountBalance(b, "card") == -20)
    }

    @Test("excludes activity on off-budget accounts")
    func excludesOffBudgetActivity() {
        let b = makeBook(transactions: [txn("ira", "2026-06-15", -25, category: "fees")])
        #expect(Ledger.snapshot(b, month: "2026-06").categories["fees"] == nil)
    }

    @Test("keeps envelope math exact at the cent")
    func exactEnvelopeMath() {
        let third = Decimal(string: "33.33")!
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-03", -third, category: "phone"),
                txn("checking", "2026-06-04", -third, category: "phone"),
                txn("checking", "2026-06-05", -Decimal(string: "33.34")!, category: "phone"),
            ],
            assignments: ["2026-06": ["phone": 100]]
        )
        let june = Ledger.snapshot(b, month: "2026-06")
        #expect(june.categories["phone"]?.activity == -100)
        #expect(june.categories["phone"]?.available == 0)
    }

    @Test("builds transfer pairs: linked ids, opposite amounts, no category between on-budget accounts")
    func transferPairOnToOn() {
        let accounts = makeBook().accounts
        let pair = Ledger.pairTransfer(
            accounts: accounts, from: "checking", to: "savings",
            amount: 200, date: "2026-06-05", categoryID: "should-be-stripped"
        )
        #expect(pair.out.amount == -200)
        #expect(pair.inflow.amount == 200)
        #expect(pair.out.transferPairId == pair.inflow.id)
        #expect(pair.inflow.transferPairId == pair.out.id)
        #expect(pair.out.transferAccountId == "savings")
        #expect(pair.inflow.transferAccountId == "checking")
        #expect(pair.out.categoryId == nil)
        #expect(pair.inflow.categoryId == nil)
    }

    @Test("puts the category on the on-budget row of an on->off transfer")
    func transferPairOnToOff() {
        let pair = Ledger.pairTransfer(
            accounts: makeBook().accounts, from: "checking", to: "ira",
            amount: 500, date: "2026-06-10", categoryID: "retirement"
        )
        #expect(pair.out.categoryId == "retirement")
        #expect(pair.inflow.categoryId == nil)
    }

    @Test("puts the category on the on-budget row of an off->on transfer")
    func transferPairOffToOn() {
        let pair = Ledger.pairTransfer(
            accounts: makeBook().accounts, from: "ira", to: "checking",
            amount: 300, date: "2026-06-12", categoryID: "windfall"
        )
        #expect(pair.out.categoryId == nil)
        #expect(pair.inflow.categoryId == "windfall")
    }

    @Test("accumulates a multi-month funded-vs-spent chain")
    func multiMonthChain() {
        let months = ["2026-04", "2026-05", "2026-06"]
        let b = makeBook(
            transactions: months.map { txn("checking", "\($0)-20", -90, category: "food") },
            assignments: Dictionary(uniqueKeysWithValues: months.map { ($0, ["food": Decimal(100)]) })
        )
        #expect(Ledger.snapshot(b, month: "2026-06").categories["food"]?.available == 30)
    }

    @Test("bookIntegrity reports zero drift on a fully budgeted book")
    func integrityBalanced() {
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-05", -120, category: "food"),
            ],
            assignments: ["2026-06": ["food": 300]]
        )
        let i = Ledger.bookIntegrity(b, month: "2026-06")
        #expect(i.onBudgetCash == 880)
        #expect(i.sumAvailable == 180)
        #expect(i.readyToAssign == 700)
        #expect(i.unbudgetedSpending == 0)
        #expect(i.drift == 0)
    }

    @Test("bookIntegrity books an uncategorized on-budget expense as unbudgetedSpending, not drift")
    func integrityUnbudgetedSpending() {
        let b = makeBook(transactions: [
            txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID),
            txn("checking", "2026-06-07", -45.55),
        ])
        let i = Ledger.bookIntegrity(b, month: "2026-06")
        #expect(i.unbudgetedSpending == -45.55)
        // The residual is named, so conservation still holds exactly.
        #expect(i.drift == 0)
    }

    @Test("bookIntegrity ignores off-budget accounts on both sides of the identity")
    func integrityIgnoresOffBudget() {
        let b = makeBook(transactions: [
            txn("ira", "2026-06-02", 5000),
            txn("checking", "2026-06-02", 200, category: Ledger.rtaCategoryID),
        ])
        let i = Ledger.bookIntegrity(b, month: "2026-06")
        #expect(i.onBudgetCash == 200)
        #expect(i.drift == 0)
    }

    @Test("bookIntegrity keeps conservation exact when dollars are assigned into future months")
    func integrityWithFutureAssignments() {
        let b = makeBook(
            transactions: [txn("checking", "2026-06-01", 1000, category: Ledger.rtaCategoryID)],
            assignments: ["2026-06": ["food": 300], "2026-07": ["food": 200]]
        )
        // Assigning ahead moves no cash, so June must still balance to the cent.
        #expect(Ledger.bookIntegrity(b, month: "2026-06").drift == 0)
    }

    @Test("bookIntegrity holds across a six-month history, month by month")
    func integritySixMonthHistory() {
        let months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
        var transactions: [Txn] = []
        var assignments: [String: [String: Decimal]] = [:]
        let food = Decimal(string: "450.37")!
        for m in months {
            transactions.append(txn("checking", "\(m)-01", Decimal(string: "1650.37")!, category: Ledger.rtaCategoryID))
            transactions.append(txn("checking", "\(m)-14", -1200, category: "rent"))
            transactions.append(txn("card", "\(m)-18", -food, category: "food"))
            assignments[m] = ["rent": 1200, "food": food]
        }
        let b = makeBook(transactions: transactions, assignments: assignments)
        // Every month funds itself exactly, so RTA is zero whichever month you view.
        for m in months {
            #expect(Ledger.bookIntegrity(b, month: m).readyToAssign == 0)
        }
        #expect(Ledger.bookIntegrity(b, month: "2026-06").drift == 0)
    }

    @Test("bookIntegrity stays exact on cent-level amounts that would drift as floats")
    func integrityCentExact() {
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-01", 0.1, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-02", 0.2, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-03", -0.3, category: "food"),
            ],
            assignments: ["2026-06": ["food": 0.3]]
        )
        #expect(Ledger.bookIntegrity(b, month: "2026-06").drift == 0)
    }
}
