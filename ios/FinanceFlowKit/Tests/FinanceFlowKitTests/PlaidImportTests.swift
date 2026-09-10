import Testing
import Foundation
@testable import FinanceFlowKit

/// Direct port of `src/budget/plaidImport.test.ts` — the Plaid snapshot
/// importer must agree across platforms on every row it lands, every row it
/// refuses, and every id it derives.
@Suite("PlaidImport (snapshot parse, map, dedupe)")
struct PlaidImportTests {
    private let month = "2026-08"

    /// Reference applier — the contract `AppStore.apply(_:)` implements.
    private func apply(_ book: BudgetBook, _ ops: NodeLedger.BookOps) -> BudgetBook {
        var next = book
        next.groups.append(contentsOf: ops.addGroups)
        next.accounts.append(contentsOf: ops.addAccounts)
        next.categories.append(contentsOf: ops.addCategories)
        next.transactions.append(contentsOf: ops.addTxns)
        return next
    }

    private func acct(_ id: String, _ plaidAccountID: String, _ kind: AccountKind = .checking) -> Account {
        Account(id: id, name: id, kind: kind, source: .plaid, plaidAccountId: plaidAccountID)
    }

    private func row(
        transactionID: String? = nil,
        accountID: String = "plaid-chk",
        date: String = "2026-08-01",
        name: String = "MERCHANT",
        merchantName: String? = nil,
        amount: Double = 1,
        category: String = "GENERAL_MERCHANDISE",
        pending: Bool = false
    ) -> PlaidImport.SnapshotTxn {
        PlaidImport.SnapshotTxn(
            transactionID: transactionID,
            accountID: accountID,
            date: date,
            name: name,
            merchantName: merchantName,
            amount: amount,
            category: category,
            pending: pending
        )
    }

    private func snap(_ transactions: PlaidImport.SnapshotTxn...) -> PlaidImport.Snapshot {
        PlaidImport.Snapshot(transactions: transactions)
    }

    private func bookWith(_ accounts: Account...) -> BudgetBook {
        BudgetBook(accounts: accounts)
    }

    // MARK: - Sign, mapping, categorization

    @Test("inverts Plaid's sign: a +4.50 coffee becomes a -4.50 transaction")
    func invertsOutflowSign() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let plan = PlaidImport.plan(
            book,
            snap(row(name: "COFFEE ROASTERS", merchantName: "Coffee Roasters", amount: 4.5))
        )

        #expect(plan.ops.addTxns.count == 1)
        let txn = plan.ops.addTxns[0]
        #expect(txn.amount == -450)
        #expect(txn.payee == "Coffee Roasters")
        #expect(txn.accountId == "chk")
        #expect(txn.source == .plaid)
    }

    @Test("inverts the other direction too: a Plaid -2200 deposit becomes an inflow")
    func invertsInflowSign() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let plan = PlaidImport.plan(book, snap(row(name: "PAYROLL", amount: -2200)))

        #expect(plan.ops.addTxns[0].amount == 220_000)
    }

    @Test("lands every row in Uncategorized rather than guessing from Plaid's taxonomy")
    func neverAutoCategorizes() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let plan = PlaidImport.plan(
            book,
            snap(
                row(name: "GROCERIES", amount: 20, category: "FOOD_AND_DRINK"),
                row(name: "RENT", amount: 1200, category: "RENT_AND_UTILITIES")
            )
        )

        for txn in plan.ops.addTxns {
            #expect(txn.categoryId == BudgetBook.uncategorizedCategoryID)
        }
        // ...and the envelope it categorizes into is materialized by the same
        // plan, because `AppStore.apply(_:)` applies ops verbatim.
        #expect(plan.ops.addGroups == [CategoryGroup(id: "g:system", name: "System", order: 999_999)])
        #expect(plan.ops.addCategories == [
            BudgetCategory(
                id: "cat:uncategorized",
                groupId: "g:system",
                name: "Uncategorized",
                order: 999_999
            ),
        ])
    }

    @Test("does not re-materialize Uncategorized when the book already has it")
    func reusesExistingUncategorized() {
        var book = bookWith(acct("chk", "plaid-chk"))
        book.ensureUncategorized()
        let plan = PlaidImport.plan(book, snap(row()))

        #expect(plan.ops.addGroups.isEmpty)
        #expect(plan.ops.addCategories.isEmpty)
        #expect(plan.ops.addTxns.count == 1)
    }

    @Test("excludes pending rows and counts them")
    func excludesPending() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let plan = PlaidImport.plan(
            book,
            snap(
                row(name: "POSTED", amount: 10),
                row(name: "NOT YET", amount: 96.13, pending: true),
                row(name: "ALSO NOT YET", amount: 6.75, pending: true)
            )
        )

        #expect(plan.skipped.pending == 2)
        #expect(plan.ops.addTxns.count == 1)
        #expect(plan.ops.addTxns[0].payee == "POSTED")
    }

    @Test("reports an unmapped account_id instead of dropping or guessing it")
    func reportsUnmappedAccounts() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let plan = PlaidImport.plan(
            book,
            snap(
                row(accountID: "plaid-brokerage", name: "DIVIDEND", amount: -12.44),
                row(accountID: "plaid-brokerage", name: "FEE", amount: 5),
                row(accountID: "plaid-savings", name: "INTEREST", amount: -0.87),
                row(name: "MAPPED", amount: 1)
            )
        )

        // Reported once each, in first-appearance order; no transaction attached
        // to some other account to make the row "fit".
        #expect(plan.skipped.unmappedAccounts == ["plaid-brokerage", "plaid-savings"])
        #expect(plan.ops.addTxns.count == 1)
        #expect(plan.ops.addTxns[0].accountId == "chk")
    }

    // MARK: - Dedupe

    @Test("importing the same snapshot twice adds zero duplicate rows")
    func reimportIsANoOp() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let snapshot = snap(
            row(name: "COFFEE", merchantName: "Coffee Roasters", amount: 4.5),
            row(date: "2026-08-02", name: "UTILITIES", amount: 138.42)
        )

        let first = PlaidImport.plan(book, snapshot)
        let once = apply(book, first.ops)
        #expect(once.transactions.count == 2)

        let second = PlaidImport.plan(once, snapshot)
        // A no-op is an EMPTY plan, not ops that happen to land on the same values.
        #expect(second.ops == NodeLedger.BookOps())
        #expect(second.skipped.duplicates == 2)

        let twice = apply(once, second.ops)
        #expect(twice.transactions.count == 2)
        #expect(Ledger.bookIntegrity(twice, month: month).drift == 0)
    }

    @Test("separates two genuinely identical purchases, and still dedupes them on re-import")
    func separatesIdenticalPurchases() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let coffee = row(name: "COFFEE ROASTERS #22", merchantName: "Coffee Roasters", amount: 4.5)
        let snapshot = snap(coffee, coffee)

        let first = PlaidImport.plan(book, snapshot)
        #expect(first.ops.addTxns.count == 2)
        #expect(first.ops.addTxns[0].plaidTxnId != first.ops.addTxns[1].plaidTxnId)

        let once = apply(book, first.ops)
        #expect(PlaidImport.plan(once, snapshot).skipped.duplicates == 2)
    }

    @Test("never emits two rows carrying the same id when the file repeats a transaction_id")
    func collapsesRepeatedTransactionIDs() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let dup = row(transactionID: "plaid-txn-abc", amount: 10)
        let plan = PlaidImport.plan(book, snap(dup, dup))

        #expect(plan.ops.addTxns.count == 1)
        #expect(plan.skipped.duplicates == 1)
    }

    @Test("prefers Plaid's own transaction_id, and derives the local id from it")
    func prefersPlaidTransactionID() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let plan = PlaidImport.plan(book, snap(row(transactionID: "plaid-txn-abc", amount: 10)))

        #expect(plan.ops.addTxns[0].plaidTxnId == "plaid-txn-abc")
        #expect(plan.ops.addTxns[0].id == PlaidImport.localTxnID("plaid-txn-abc"))
        #expect(plan.ops.addTxns[0].id == "txn:plaid:plaid-txn-abc")
    }

    @Test("dedupes against a row the OTHER platform imported (same plaidTxnId, any local id)")
    func dedupesOnPlaidTxnIDNotLocalID() {
        var book = bookWith(acct("chk", "plaid-chk"))
        book.transactions = [
            Txn(
                id: "some-other-id",
                accountId: "chk",
                date: "2026-08-01",
                amount: -1000,
                categoryId: BudgetBook.uncategorizedCategoryID,
                source: .plaid,
                plaidTxnId: "plaid-txn-abc"
            ),
        ]
        let plan = PlaidImport.plan(book, snap(row(transactionID: "plaid-txn-abc", amount: 10)))

        #expect(plan.ops == NodeLedger.BookOps())
        #expect(plan.skipped.duplicates == 1)
    }

    // MARK: - Degenerate input

    @Test("falls back to the raw name when Plaid has no merchant name")
    func fallsBackToRawName() {
        let book = bookWith(acct("chk", "plaid-chk"))
        let plan = PlaidImport.plan(
            book,
            snap(row(name: "PAYROLL DIRECT DEP", merchantName: nil, amount: -2200))
        )

        #expect(plan.ops.addTxns[0].payee == "PAYROLL DIRECT DEP")
    }

    @Test("survives a snapshot with no transactions and a row with nothing in it")
    func survivesEmptyInput() {
        let book = bookWith(acct("chk", "plaid-chk"))
        #expect(PlaidImport.plan(book, PlaidImport.Snapshot()).ops == NodeLedger.BookOps())
        #expect(PlaidImport.plan(book, PlaidImport.Snapshot(transactions: [])).skipped.unmappedAccounts.isEmpty)
        // A row with no account_id maps to nothing, and says so under "".
        #expect(
            PlaidImport.plan(book, PlaidImport.Snapshot(transactions: [PlaidImport.SnapshotTxn()]))
                .skipped.unmappedAccounts == [""]
        )
    }

    @Test("keeps bookIntegrity().drift at 0 after import")
    func importPreservesDrift() {
        let book = bookWith(acct("chk", "plaid-chk"), acct("visa", "plaid-visa", .credit))
        let plan = PlaidImport.plan(
            book,
            snap(
                row(amount: 4.5),
                row(amount: -2200),
                row(accountID: "plaid-visa", amount: 62.3),
                row(accountID: "plaid-visa", amount: -500)
            )
        )

        #expect(Ledger.bookIntegrity(apply(book, plan.ops), month: month).drift == 0)
    }
}

// ---------------------------------------------------------------------------

/// The cross-platform fixture: a real-shaped nightly snapshot, the book it
/// imports into, and the ops it must produce — all committed. The identical
/// assertions run in `src/budget/plaidImport.test.ts`. If both platforms turn
/// the same committed bytes into the same ops, an import that diverges between
/// them is impossible by construction.
@Suite("Cross-platform Plaid import fixture")
struct PlaidImportFixtureTests {
    private let month = "2026-08"

    /// `<repo>/fixtures/plaid/<name>` — resolved from this file's location so
    /// the test does not depend on the runner's working directory.
    private func fixture(_ name: String) throws -> Data {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return try Data(contentsOf: url.appendingPathComponent("fixtures/plaid/\(name)"))
    }

    private func book() throws -> BudgetBook {
        try JSONCoder.decoder.decode(BudgetBook.self, from: fixture("book.json"))
    }

    private func snapshot() throws -> PlaidImport.Snapshot {
        try JSONCoder.decoder.decode(PlaidImport.Snapshot.self, from: fixture("nightly-snapshot.json"))
    }

    private func apply(_ book: BudgetBook, _ ops: NodeLedger.BookOps) -> BudgetBook {
        var next = book
        next.groups.append(contentsOf: ops.addGroups)
        next.categories.append(contentsOf: ops.addCategories)
        next.transactions.append(contentsOf: ops.addTxns)
        return next
    }

    /// Every op slot, so the golden also pins what the planner must NOT emit.
    private func canonical(_ plan: PlaidImport.Plan) throws -> NSDictionary {
        let encoder = JSONEncoder()
        func json<T: Encodable>(_ value: [T]) throws -> Any {
            try JSONSerialization.jsonObject(with: encoder.encode(value))
        }
        return [
            "addGroups": try json(plan.ops.addGroups),
            "addAccounts": try json(plan.ops.addAccounts),
            "updateAccounts": try json(plan.ops.updateAccounts),
            "addCategories": try json(plan.ops.addCategories),
            "updateCategories": try json(plan.ops.updateCategories),
            "addTxns": try json(plan.ops.addTxns),
            "updateTxns": try json(plan.ops.updateTxns),
            "deleteTxnIds": plan.ops.deleteTxnIDs,
            "setAssignments": plan.ops.setAssignments.map {
                ["month": $0.month, "categoryId": $0.categoryID, "amount": $0.amount.cents] as [String: Any]
            },
            "skipped": [
                "duplicates": plan.skipped.duplicates,
                "pending": plan.skipped.pending,
                "unmappedAccounts": plan.skipped.unmappedAccounts,
            ] as [String: Any],
        ] as NSDictionary
    }

    @Test("produces the committed ops, field for field")
    func matchesTheCommittedOps() throws {
        let actual = try canonical(PlaidImport.plan(try book(), try snapshot()))
        let expected = try #require(
            try JSONSerialization.jsonObject(with: try fixture("expected-ops.json")) as? NSDictionary
        )

        #expect(actual == expected)
    }

    @Test("adds zero rows the second time the same nightly file is imported")
    func secondImportAddsNothing() throws {
        let book = try book()
        let snapshot = try snapshot()
        let once = apply(book, PlaidImport.plan(book, snapshot).ops)
        #expect(once.transactions.count == book.transactions.count + 5)

        let second = PlaidImport.plan(once, snapshot)
        #expect(second.ops == NodeLedger.BookOps())
        // The row already in the book counts once; the five just imported join it.
        #expect(second.skipped.duplicates == 6)
        #expect(apply(once, second.ops).transactions.count == once.transactions.count)
    }

    @Test("leaves every account's balance equal to the balance Plaid reported")
    func balancesMatchPlaid() throws {
        let book = try book()
        let snapshot = try snapshot()
        let once = apply(book, PlaidImport.plan(book, snapshot).ops)

        func plaidBalance(_ plaidAccountID: String) throws -> Money {
            let account = try #require(
                snapshot.accounts?.first { $0.accountID == plaidAccountID }
            )
            return Money.fromDollars(try #require(account.currentBalance))
        }

        // Checking: Plaid's balance is the balance, and the local one matches
        // only if every sign was inverted correctly on the way in.
        #expect(Ledger.accountBalance(once, "acct-chk") == (try plaidBalance("plaid-acct-chk")))
        // Credit: Plaid reports what is OWED as a positive number, so the local
        // balance is its negative.
        #expect(Ledger.accountBalance(once, "acct-visa") == -(try plaidBalance("plaid-acct-visa")))
    }

    @Test("leaves the imported book with zero drift")
    func importedFixtureHasNoDrift() throws {
        let book = try book()
        let once = apply(book, PlaidImport.plan(book, try snapshot()).ops)
        #expect(Ledger.bookIntegrity(once, month: month).drift == 0)
    }
}
