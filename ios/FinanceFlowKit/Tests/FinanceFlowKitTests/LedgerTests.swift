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
        _ amount: Money,
        category: String? = nil,
        transfer: String? = nil
    ) -> Txn {
        Txn(accountId: account, date: date, amount: amount, categoryId: category, transferAccountId: transfer)
    }

    private func makeBook(
        transactions: [Txn] = [],
        assignments: [String: [String: Money]] = [:]
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

    @Test("sums balances exactly — the classic 0.1 + 0.2 case, in cents")
    func exactBalances() {
        // 10c + 20c. As dollars-as-doubles the web summed this to
        // 0.30000000000000004 and only a rounding step at the boundary hid it;
        // in integer cents the dirty value is unrepresentable, not rounded away.
        let b = makeBook(transactions: [
            txn("checking", "2026-06-01", 10),
            txn("checking", "2026-06-02", 20),
        ])
        #expect(Ledger.accountBalance(b, "checking") == 30)
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
            "2026-06": ["groceries": 10_000],
            "2026-07": ["groceries": 5_000],
            "2026-08": ["groceries": 2550],
        ])
        #expect(Ledger.assignedAfter(b, month: "2026-06") == 7550)
        #expect(Ledger.assignedAfter(b, month: "2026-07") == 2550)
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
        let third = Money(cents: 3333)   // $33.33
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-03", -third, category: "phone"),
                txn("checking", "2026-06-04", -third, category: "phone"),
                txn("checking", "2026-06-05", -3334, category: "phone"),
            ],
            assignments: ["2026-06": ["phone": 10_000]]   // $100
        )
        let june = Ledger.snapshot(b, month: "2026-06")
        #expect(june.categories["phone"]?.activity == -10_000)
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
            assignments: Dictionary(uniqueKeysWithValues: months.map { ($0, ["food": Money(cents: 100)]) })
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
            txn("checking", "2026-06-07", -4555),
        ])
        let i = Ledger.bookIntegrity(b, month: "2026-06")
        #expect(i.unbudgetedSpending == -4555)
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
        var assignments: [String: [String: Money]] = [:]
        let food = Money(cents: 45_037)   // $450.37
        for m in months {
            transactions.append(txn("checking", "\(m)-01", 165_037, category: Ledger.rtaCategoryID))
            transactions.append(txn("checking", "\(m)-14", -120_000, category: "rent"))
            transactions.append(txn("card", "\(m)-18", -food, category: "food"))
            assignments[m] = ["rent": 120_000, "food": food]
        }
        let b = makeBook(transactions: transactions, assignments: assignments)
        // Every month funds itself exactly, so RTA is zero whichever month you view.
        for m in months {
            #expect(Ledger.bookIntegrity(b, month: m).readyToAssign == 0)
        }
        #expect(Ledger.bookIntegrity(b, month: "2026-06").drift == 0)
    }

    /// The six-month fixture above funds itself exactly every month, so
    /// cumulative cash is $0 at every boundary and drift reads 0 whether or not
    /// the cash side is filtered to the viewed month — it cannot see a
    /// month-filter bug. This book deliberately carries cash forward (income
    /// $3,000/mo, rent $1,200, uneven food leaving June overspent, one $80 ATM
    /// withdrawal that never gets a category) so any drift between the cash
    /// side and the envelope side shows up the moment you view an older month.
    /// Mirrors `carryForwardBook` in `src/budget/ledger.test.ts`.
    private func carryForwardBook(extra: [Txn] = []) -> BudgetBook {
        makeBook(
            transactions: [
                txn("checking", "2026-06-01", 3000, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-03", -1200, category: "rent"),
                txn("checking", "2026-06-20", -550, category: "food"),
                txn("checking", "2026-07-01", 3000, category: Ledger.rtaCategoryID),
                txn("checking", "2026-07-03", -1200, category: "rent"),
                txn("checking", "2026-07-15", -300, category: "food"),
                txn("checking", "2026-07-25", -80),   // ATM cash, never categorized
                txn("checking", "2026-08-01", 3000, category: Ledger.rtaCategoryID),
                txn("checking", "2026-08-03", -1200, category: "rent"),
            ] + extra,
            assignments: [
                "2026-06": ["rent": 1200, "food": 400],
                "2026-07": ["rent": 1200, "food": 500],
                "2026-08": ["rent": 1200],
            ]
        )
    }

    @Test("bookIntegrity holds at every month boundary of a book that carries cash forward")
    func integrityCarriesCashForward() {
        let b = carryForwardBook()
        // Hand-derived: cash is cumulative THROUGH the viewed month, like every
        // other term. June ends $150 overspent on food, which sweeps in July.
        #expect(Ledger.bookIntegrity(b, month: "2026-06") == Ledger.BookIntegrity(
            onBudgetCash: 1250, sumAvailable: -150, readyToAssign: 1400,
            unbudgetedSpending: 0, drift: 0
        ))
        #expect(Ledger.bookIntegrity(b, month: "2026-07") == Ledger.BookIntegrity(
            onBudgetCash: 2670, sumAvailable: 200, readyToAssign: 2550,
            unbudgetedSpending: -80, drift: 0
        ))
        #expect(Ledger.bookIntegrity(b, month: "2026-08") == Ledger.BookIntegrity(
            onBudgetCash: 4470, sumAvailable: 200, readyToAssign: 4350,
            unbudgetedSpending: -80, drift: 0
        ))
    }

    @Test("bookIntegrity leaves a future-dated transaction out of the viewed month's cash")
    func integrityIgnoresFutureDatedCash() {
        // A post-dated bill must not make the books "not balance" in August —
        // it isn't part of August's cash yet.
        let b = carryForwardBook(extra: [txn("checking", "2026-09-01", -250, category: "rent")])
        let aug = Ledger.bookIntegrity(b, month: "2026-08")
        #expect(aug.onBudgetCash == 4470)
        #expect(aug.drift == 0)
        // Once September is the viewed month it counts, on both sides.
        let sep = Ledger.bookIntegrity(b, month: "2026-09")
        #expect(sep.onBudgetCash == 4220)
        #expect(sep.drift == 0)
    }

    @Test("bookIntegrity books the on-budget leg of an on->off transfer as unbudgetedSpending")
    func integrityOnToOffTransferLeg() {
        // Checking -> tracking with no category: the counterpart lives off
        // budget and is never summed, so this leg has to land in the identity.
        let pair = Ledger.pairTransfer(
            accounts: makeBook().accounts,
            from: "checking", to: "ira", amount: 500, date: "2026-08-10"
        )
        let b = carryForwardBook(extra: [pair.out, pair.inflow])
        let i = Ledger.bookIntegrity(b, month: "2026-08")
        #expect(i.onBudgetCash == 3970)
        #expect(i.unbudgetedSpending == -580)
        #expect(i.drift == 0)
    }

    @Test("bookIntegrity keeps an on->on transfer pair out of unbudgetedSpending entirely")
    func integrityOnToOnTransferPair() {
        // Control: both legs are on budget, so they cancel in cash and must not
        // be counted as spending on either side.
        let pair = Ledger.pairTransfer(
            accounts: makeBook().accounts,
            from: "checking", to: "savings", amount: 500, date: "2026-08-10"
        )
        let b = carryForwardBook(extra: [pair.out, pair.inflow])
        let i = Ledger.bookIntegrity(b, month: "2026-08")
        #expect(i.onBudgetCash == 4470)
        #expect(i.unbudgetedSpending == -80)
        #expect(i.drift == 0)
    }

    // The old `Ledger.toCents` is gone: nothing rounds at an arithmetic site
    // any more, because nothing arrives in dollars. The one surviving rounding
    // rule lives on `Money` and is exercised by `MoneyTests` and the shared
    // migration fixture.

    @Test("bookIntegrity stays exact on cent-sized amounts that would drift as floats")
    func integrityCentExact() {
        // 10c + 20c - 30c: the 0.1/0.2/0.3 trio, now unrepresentable as anything
        // but exact integers.
        let b = makeBook(
            transactions: [
                txn("checking", "2026-06-01", 10, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-02", 20, category: Ledger.rtaCategoryID),
                txn("checking", "2026-06-03", -30, category: "food"),
            ],
            assignments: ["2026-06": ["food": 30]]
        )
        #expect(Ledger.bookIntegrity(b, month: "2026-06").drift == 0)
    }
}
