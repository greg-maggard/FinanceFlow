import Testing
import Foundation
@testable import FinanceFlowKit

/// Direct port of the migration cases in `src/state/io.test.ts`: both platforms
/// must migrate the same document to the same v4 state (deterministic ids,
/// identical seeds, RTA unchanged, payloads stripped to the node-only fields,
/// every amount an integer number of cents).
///
/// Pre-v4 documents are DOLLARS, so they are built as `LegacyState`. The v4
/// goldens below are the same numbers the v1 -> v2 migration always produced,
/// times 100.

/// 2026-06-10 local, mirroring the web tests' `NOW`.
private let june10 = Calendar.current.date(
    from: DateComponents(year: 2026, month: 6, day: 10, hour: 12)
)!

/// A version-1 document (no meaningful `budget`), as written by pre-v2 builds.
private func makeV1() -> LegacyState {
    var nodes: [NodeId: LegacyNodeState] = [:]
    for id in NodeId.allCases { nodes[id] = LegacyNodeState() }
    return LegacyState(
        version: 1,
        settings: .default,
        decisions: [:],
        nodes: nodes,
        budget: LegacyBudgetBook(),
        shownCelebrations: [],
        earnedMedals: []
    )
}

private func makeRichV1() -> LegacyState {
    var s = makeV1()
    s.settings.monthlyExpenses = 4000
    s.nodes[.Start]?.completed = true
    s.nodes[.Rent]?.notes = "due on the 1st"
    s.nodes[.Rent]?.monthlyChecks = ["2026-05": true]
    s.nodes[.Rent]?.data = .recurring(LegacyRecurringData(
        target: .manual(1800),
        funded: .manual(1800),
        items: [LegacyRecurringItem(id: "r1", name: "Apartment", target: .manual(1800), funded: .manual(1800))]
    ))
    s.nodes[.Food]?.data = .recurring(LegacyRecurringData(target: .manual(600), funded: .manual(450)))
    s.nodes[.BigEF]?.data = .bigEF(LegacyBigEFData(targetMonths: 6, balance: .manual(0), items: [
        LegacyEFBucket(id: "b1", name: "Medical", target: 3000, balance: .manual(1200)),
        LegacyEFBucket(id: "b2", name: "Car", target: 2000, balance: .manual(800)),
    ]))
    s.nodes[.SmallEF]?.data = .smallEF(LegacySmallEFData(balance: .manual(1000)))
    s.nodes[.SavePurchase]?.data = .savePurchase(LegacySavePurchaseData(
        goalName: "House",
        target: 20000,
        saved: .manual(5000),
        items: [LegacyPurchaseGoal(id: "p1", name: "House", target: 20000, saved: .manual(5000), byDate: "2027-01-01")]
    ))
    s.nodes[.Goals]?.data = .goals([
        LegacyGoal(id: "gl1", name: "Vacation", target: 3000, saved: 500, horizonYears: 2),
    ])
    s.nodes[.HighDebt]?.data = .debts([
        LegacyDebt(id: "d1", name: "Visa", balance: 4200, apr: Decimal(string: "24.99")!, minPayment: 50, paid: false),
    ])
    s.nodes[.IRA]?.data = .ira(LegacyIRAData(
        type: .roth,
        ytdContribution: .manual(2500),
        annualLimit: 7000
    ))
    s.nodes[.College]?.data = .college(LegacyCollegeData(
        monthlyContribution: 100,
        balance: .manual(2500),
        targetAge: nil
    ))
    return s
}

/// A version-2 document: budget present, payloads still wide.
private func makeV2(_ budget: LegacyBudgetBook = LegacyBudgetBook()) -> LegacyState {
    var s = makeV1()
    s.version = 2
    s.budget = budget
    return s
}

@Suite("migrate")
struct MigrateTests {

    @Test("passes a version-4 document through")
    func passthroughV4() throws {
        let s = AppState.makeInitial()
        #expect(try IO.importJSON(IO.exportJSON(s)) == s)
    }

    @Test("throws on a newer version instead of silently resetting")
    func newerVersionThrows() throws {
        var s = makeV1()
        s.version = 5
        #expect(throws: IO.ImportError.unsupportedVersion(5)) {
            try IO.migrate(s)
        }
    }
}

@Suite("v1 -> v4 chain")
struct V1ToV4ChainTests {

    @Test("books match the old v1->v2 goldens (times 100) and payloads are stripped")
    func richChain() throws {
        let v1 = makeRichV1()
        let out = try IO.migrate(v1, now: june10)
        #expect(out.version == 4)

        #expect(out.budget.categories.map(\.id) == [
            "Rent:r1", "Food", "BigEF:b1", "BigEF:b2", "SavePurchase:p1", "Goals:gl1",
        ])
        #expect(out.budget.assignments == ["2026-06": [
            "Rent:r1": 180_000,
            "Food": 45_000,
            "BigEF:b1": 120_000,
            "BigEF:b2": 80_000,
            "SavePurchase:p1": 500_000,
            "Goals:gl1": 50_000,
        ]])
        let inflow = out.budget.transactions.first { $0.categoryId == Ledger.rtaCategoryID }
        #expect(inflow?.accountId == "acct:cash")
        #expect(inflow?.amount == 975_000)
        let june = Ledger.snapshot(out.budget, month: "2026-06")
        #expect(june.readyToAssign == 0)
        #expect(june.categories["BigEF:b1"]?.available == 120_000)

        // v3 additions: account backlinks and horizon -> target date.
        let debt = out.budget.accounts.first { $0.id == "debt:d1" }
        #expect(debt?.nodeId == .HighDebt)
        // APR is a rate, not money (D8) — it must NOT be scaled.
        #expect(debt?.apr == Decimal(string: "24.99")!)
        #expect(debt?.minPayment == 5_000)
        #expect(Ledger.accountBalance(out.budget, "debt:d1") == -420_000)
        #expect(out.budget.accounts.first { $0.id == "acct:college" }?.nodeId == .College)
        #expect(out.budget.categories.first { $0.id == "Goals:gl1" }?.targetDate == "2028-06-10")

        // Payloads: ledger-owned ones gone, node-only ones kept or slimmed.
        #expect(out.node(.Rent).data == nil)
        #expect(out.node(.SmallEF).data == nil)
        #expect(out.node(.SavePurchase).data == nil)
        #expect(out.node(.Goals).data == nil)
        #expect(out.node(.HighDebt).data == nil)
        #expect(out.node(.BigEF).data == .bigEF(BigEFData(targetMonths: 6)))
        #expect(out.node(.College).data == .college(CollegeData(monthlyContribution: 10_000)))
        #expect(out.node(.IRA).data == .ira(IRAData(
            type: .roth,
            ytdContribution: .manual(250_000),
            annualLimit: 700_000
        )))

        // Non-financial node state is preserved.
        #expect(out.node(.Start).completed == true)
        #expect(out.node(.Rent).notes == "due on the 1st")
        #expect(out.node(.Rent).monthlyChecks == ["2026-05": true])
        #expect(out.decisions == v1.decisions)

        // The whole point: the book balances to the cent, with nothing left
        // outside the envelope system.
        let integrity = Ledger.bookIntegrity(out.budget, month: "2026-06")
        #expect(integrity.drift == 0)
        #expect(integrity.unbudgetedSpending == 0)
    }

    // Bug 1: supersession ("SmallEF grows into BigEF; one real-world fund") is
    // a DOMAIN rule, so it has to survive the v2 leg of the chain too. Before
    // the fix, v1ToV2 seeded only BigEF's bucket but left both payloads
    // intact, and v2ToV3's unionExists branch then resurrected SmallEF's
    // bucket with a SECOND starting inflow — $2,200 of cash for a $1,200 fund.
    @Test("supersedes SmallEF even when BOTH emergency-fund nodes carry items")
    func supersedesSmallEFWithItemsOnBothNodes() throws {
        var v1 = makeV1()
        v1.settings.monthlyExpenses = 4000
        v1.nodes[.BigEF]?.data = .bigEF(LegacyBigEFData(targetMonths: 6, balance: .manual(0), items: [
            LegacyEFBucket(id: "b1", name: "Medical", target: 3000, balance: .manual(1200)),
        ]))
        v1.nodes[.SmallEF]?.data = .smallEF(LegacySmallEFData(balance: .manual(1000), items: [
            LegacyEFBucket(id: "s1", name: "Starter", target: 1000, balance: .manual(1000)),
        ]))

        let out = try IO.migrate(v1, now: june10)
        #expect(out.budget.categories.map(\.id) == ["BigEF:b1"])
        #expect(out.budget.assignments == ["2026-06": ["BigEF:b1": 120_000]])

        let inflows = out.budget.transactions.filter { $0.categoryId == Ledger.rtaCategoryID }
        #expect(inflows.count == 1)
        #expect(inflows.first?.accountId == "acct:cash")
        #expect(inflows.first?.amount == 120_000)
        #expect(Ledger.accountBalance(out.budget, "acct:cash") == 120_000)

        let june = Ledger.snapshot(out.budget, month: "2026-06")
        #expect(june.readyToAssign == 0)
        #expect(june.categories["BigEF:b1"]?.available == 120_000)
        #expect(Ledger.bookIntegrity(out.budget, month: "2026-06").drift == 0)
    }
}

@Suite("v2 -> v3 reconcile")
struct V2ToV3ReconcileTests {

    @Test("ledger wins where payload and book describe the same envelope")
    func ledgerWins() throws {
        var v2 = makeV2(LegacyBudgetBook(
            accounts: [LegacyAccount(id: "acct:cash", name: "Cash", kind: .cash)],
            transactions: [LegacyTxn(
                id: "txn:start:acct:cash",
                accountId: "acct:cash",
                date: "2026-06-01",
                payee: "Starting balance",
                amount: 500,
                categoryId: Ledger.rtaCategoryID
            )],
            groups: [CategoryGroup(id: "g:bills", name: "Bills", order: 0)],
            categories: [LegacyCategory(
                id: "Rent:r1",
                groupId: "g:bills",
                name: "Apartment",
                order: 0,
                monthlyTarget: 1900,
                nodeId: .Rent
            )],
            assignments: ["2026-06": ["Rent:r1": 500]]
        ))
        // Payload diverged after the budget UI edited the ledger.
        v2.nodes[.Rent]?.data = .recurring(LegacyRecurringData(
            target: .manual(1800),
            funded: .manual(450),
            items: [LegacyRecurringItem(id: "r1", name: "Apartment", target: .manual(1800), funded: .manual(450))]
        ))

        let out = try IO.migrate(v2, now: june10)
        #expect(out.budget.categories.first { $0.id == "Rent:r1" }?.monthlyTarget == 190_000)
        #expect(out.budget.assignments["2026-06"] == ["Rent:r1": 50_000])
        #expect(out.budget.transactions.count == 1)
        #expect(out.budget.categories.count == 1)
        #expect(out.node(.Rent).data == nil)
    }

    @Test("creates payload-only items without moving Ready-to-Assign")
    func payloadOnlyCreation() throws {
        var v2 = makeV2()
        v2.nodes[.Food]?.data = .recurring(LegacyRecurringData(target: .manual(600), funded: .manual(450)))

        let out = try IO.migrate(v2, now: june10)
        #expect(out.budget.categories.map(\.id) == ["Food"])
        #expect(out.budget.assignments["2026-06"] == ["Food": 45_000])
        let june = Ledger.snapshot(out.budget, month: "2026-06")
        #expect(june.readyToAssign == 0)
        #expect(june.categories["Food"]?.available == 45_000)
    }

    @Test("is idempotent: migrating the migrated document changes nothing")
    func idempotent() throws {
        let out = try IO.migrate(makeRichV1(), now: june10)
        #expect(try IO.importJSON(IO.exportJSON(out)) == out)
    }

    @Test("honors an explicit paid flag the ledger couldn't represent")
    func paidFlagHonored() throws {
        var v2 = makeV2(LegacyBudgetBook(
            accounts: [LegacyAccount(
                id: "debt:d1",
                name: "Visa",
                kind: .loan,
                apr: Decimal(string: "24.99")!,
                minPayment: 50
            )],
            transactions: [LegacyTxn(
                id: "txn:start:debt:d1",
                accountId: "debt:d1",
                date: "2026-01-05",
                payee: "Starting balance",
                amount: -4200
            )]
        ))
        v2.nodes[.HighDebt]?.data = .debts([
            LegacyDebt(id: "d1", name: "Visa", balance: 4200, apr: Decimal(string: "24.99")!, minPayment: 50, paid: true),
        ])

        let out = try IO.migrate(v2, now: june10)
        #expect(out.budget.accounts.first { $0.id == "debt:d1" }?.nodeId == .HighDebt)
        let adjust = out.budget.transactions.first { $0.id == "txn:adjust:v3:debt:d1" }
        #expect(adjust?.amount == 420_000)
        #expect(adjust?.memo == "Marked paid")
        #expect(Ledger.accountBalance(out.budget, "debt:d1") == 0)
    }

    @Test("never resurrects the EF scalar mirror once the union is ledger-managed")
    func noScalarResurrection() throws {
        var v2 = makeV2(LegacyBudgetBook(
            groups: [CategoryGroup(id: "g:ef", name: "Emergency Fund", order: 0)],
            categories: [LegacyCategory(
                id: "BigEF:b1",
                groupId: "g:ef",
                name: "Medical",
                order: 0,
                balanceTarget: 3000,
                nodeId: .BigEF
            )]
        ))
        // Stale scalar mirror left over from normalized() days.
        v2.nodes[.BigEF]?.data = .bigEF(LegacyBigEFData(targetMonths: 6, balance: .manual(9999)))
        v2.nodes[.SmallEF]?.data = .smallEF(LegacySmallEFData(balance: .manual(1000)))

        let out = try IO.migrate(v2, now: june10)
        #expect(out.budget.categories.map(\.id) == ["BigEF:b1"])
        #expect(out.node(.BigEF).data == .bigEF(BigEFData(targetMonths: 6)))
    }

    @Test("drops categoryMap")
    func dropsCategoryMap() throws {
        let v2JSON = """
        {
          "version": 2,
          "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": {},
          "nodes": {},
          "categoryMap": { "Rent": "some-ynab-id" },
          "budget": { "accounts": [], "transactions": [], "groups": [], "categories": [], "assignments": {} }
        }
        """
        let out = try IO.importString(v2JSON)
        #expect(out.version == 4)
        let encoded = try JSONCoder.encode(out)
        let obj = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(obj["categoryMap"] == nil)
    }
}

// MARK: - v3 -> v4

@Suite("v3 -> v4: integer cents on the wire")
struct V3ToV4Tests {

    /// A structurally minimal v3 document with one on-budget account.
    private func v3(
        accounts: [LegacyAccount] = [LegacyAccount(id: "checking", name: "Checking", kind: .checking)],
        transactions: [LegacyTxn] = [],
        categories: [LegacyCategory] = [],
        assignments: [String: [String: LegacyDollars]] = [:]
    ) -> LegacyState {
        var s = makeV1()
        s.version = 3
        s.budget = LegacyBudgetBook(
            accounts: accounts,
            transactions: transactions,
            groups: [],
            categories: categories,
            assignments: assignments
        )
        return s
    }

    @Test("applies the §4 rule: floor(d * 100 + 0.5) in IEEE-754 double")
    func roundingRule() throws {
        // Each of these is a case the two platforms have to agree on exactly.
        // The value on the right is what `Math.floor(d * 100 + 0.5)` yields in
        // JavaScript, computed on the SAME double the JSON parser produces.
        let cases: [(Decimal, Int)] = [
            (Decimal(string: "0.1")!, 10),
            (Decimal(string: "0.2")!, 20),
            (Decimal(string: "33.333")!, 3333),
            // The nearest double to 33.335 sits fractionally ABOVE the decimal
            // value, so d * 100 lands on exactly 3333.5 and the half rounds up.
            (Decimal(string: "33.335")!, 3334),
            // Exactly-representable halves, positive and negative: the rule
            // takes both toward +infinity, so -0.125 is -12 and NOT -13.
            (Decimal(string: "0.125")!, 13),
            (Decimal(string: "-0.125")!, -12),
            (Decimal(string: "-12.345")!, -1234),
            (Decimal(string: "-1234.5")!, -123_450),
            (Decimal(string: "1234567.89")!, 123_456_789),
            (Decimal(string: "0.004")!, 0),
            (Decimal(string: "-0.004")!, 0),
            (0, 0),
        ]
        for (dollars, cents) in cases {
            #expect(Money.fromDollars(dollars) == Money(cents: cents), "\(dollars)")
        }
    }

    @Test("converts every money field and leaves rates, counts and ages alone")
    func fieldInventory() throws {
        var s = v3(
            accounts: [LegacyAccount(
                id: "debt",
                name: "Visa",
                kind: .loan,
                apr: Decimal(string: "24.99")!,
                minPayment: Decimal(string: "50.005")!
            )],
            transactions: [LegacyTxn(id: "t1", accountId: "debt", date: "2026-06-01", amount: 12.34)],
            categories: [LegacyCategory(
                id: "food",
                groupId: "g",
                name: "Food",
                order: 0,
                monthlyTarget: 33.333,
                balanceTarget: 0
            )],
            assignments: ["2026-06": ["food": Decimal(string: "1800.005")!]]
        )
        s.settings = LegacySettings(
            monthlyExpenses: 4000,
            preTaxIncome: 120_000,
            iraAnnualLimit: 7000,
            hsaSelfLimit: 4300,
            hsaFamilyLimit: 8550
        )
        s.nodes[.College]?.data = .college(LegacyCollegeData(
            monthlyContribution: Decimal(string: "100.005")!,
            balance: nil,
            targetAge: 18
        ))
        s.nodes[.Match]?.data = .match(matchPct: Decimal(string: "4.5")!, currentContribPct: Decimal(string: "3.25")!)
        s.nodes[.Increase401k]?.data = .increase401k(currentPct: Decimal(string: "6.5")!, targetPct: 15)
        s.nodes[.BigEF]?.data = .bigEF(LegacyBigEFData(targetMonths: 6))

        let out = try IO.migrate(s)

        // Money.
        #expect(out.budget.transactions.first?.amount == 1234)
        #expect(out.budget.categories.first?.monthlyTarget == 3333)
        #expect(out.budget.categories.first?.balanceTarget == 0)
        #expect(out.budget.assignments["2026-06"]?["food"] == 180_001)
        #expect(out.budget.accounts.first?.minPayment == 5001)
        #expect(out.settings.monthlyExpenses == 400_000)
        #expect(out.settings.preTaxIncome == 12_000_000)
        #expect(out.settings.iraAnnualLimit == 700_000)
        #expect(out.settings.hsaSelfLimit == 430_000)
        #expect(out.settings.hsaFamilyLimit == 855_000)
        #expect(out.node(.College).data?.college?.monthlyContribution == 10_001)

        // NOT money: rates, percentages, counts, ages.
        #expect(out.budget.accounts.first?.apr == Decimal(string: "24.99")!)
        #expect(out.node(.College).data?.college?.targetAge == 18)
        #expect(out.node(.Match).data?.match?.matchPct == Decimal(string: "4.5")!)
        #expect(out.node(.Match).data?.match?.currentContribPct == Decimal(string: "3.25")!)
        #expect(out.node(.Increase401k).data?.increase401k?.currentPct == Decimal(string: "6.5")!)
        #expect(out.node(.Increase401k).data?.increase401k?.targetPct == 15)
        #expect(out.node(.BigEF).data?.bigEF?.targetMonths == 6)
    }

    // The one extra rewrite v4 rides along with. w1-bug3 made an uncategorized
    // on-budget outflow unreachable from the UI, but deliberately did not
    // rewrite history; v4 is the one document rewrite where that gets fixed.
    @Test("back-fills uncategorized on-budget spending onto cat:uncategorized")
    func backfillsUncategorized() throws {
        let s = v3(
            transactions: [
                LegacyTxn(id: "in", accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: Ledger.rtaCategoryID),
                LegacyTxn(id: "out", accountId: "checking", date: "2026-06-02", amount: -49.99),
            ]
        )
        let out = try IO.migrate(s)

        let row = out.budget.transactions.first { $0.id == "out" }
        #expect(row?.categoryId == BudgetBook.uncategorizedCategoryID)
        #expect(row?.amount == -4999)
        #expect(out.budget.groups.contains { $0.id == BudgetBook.systemGroupID })
        #expect(out.budget.categories.contains { $0.id == BudgetBook.uncategorizedCategoryID })

        // The point of the exercise: the residual term is gone for good.
        let integrity = Ledger.bookIntegrity(out.budget, month: "2026-06")
        #expect(integrity.unbudgetedSpending == 0)
        #expect(integrity.drift == 0)
    }

    @Test("back-fills the on-budget leg of a transfer OUT of the budget, but never an on-budget pair")
    func backfillsOnlyMoneyThatLeaves() throws {
        let s = v3(
            accounts: [
                LegacyAccount(id: "checking", name: "Checking", kind: .checking),
                LegacyAccount(id: "card", name: "Card", kind: .credit),
                LegacyAccount(id: "loan", name: "Loan", kind: .loan),
            ],
            transactions: [
                // on-budget -> off-budget: the money really leaves.
                LegacyTxn(id: "outOff", accountId: "checking", date: "2026-06-01", amount: -100, transferAccountId: "loan"),
                LegacyTxn(id: "inOff", accountId: "loan", date: "2026-06-01", amount: 100, transferAccountId: "checking"),
                // on-budget -> on-budget: cancels in the cash total, so giving
                // it an envelope would invent activity that never happened.
                LegacyTxn(id: "outOn", accountId: "checking", date: "2026-06-02", amount: -25, transferAccountId: "card"),
                LegacyTxn(id: "inOn", accountId: "card", date: "2026-06-02", amount: 25, transferAccountId: "checking"),
            ]
        )
        let out = try IO.migrate(s)
        func categoryOf(_ id: String) -> String? {
            out.budget.transactions.first { $0.id == id }?.categoryId
        }
        #expect(categoryOf("outOff") == BudgetBook.uncategorizedCategoryID)
        #expect(categoryOf("inOff") == nil)     // off-budget account: not ours to categorize
        #expect(categoryOf("outOn") == nil)
        #expect(categoryOf("inOn") == nil)
        #expect(Ledger.bookIntegrity(out.budget, month: "2026-06").unbudgetedSpending == 0)
    }

    @Test("a clean book gains no rows the user never asked for")
    func noGratuitousEnvelope() throws {
        let s = v3(
            transactions: [
                LegacyTxn(id: "in", accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: Ledger.rtaCategoryID),
            ]
        )
        let out = try IO.migrate(s)
        #expect(!out.budget.categories.contains { $0.id == BudgetBook.uncategorizedCategoryID })
        #expect(!out.budget.groups.contains { $0.id == BudgetBook.systemGroupID })
    }
}

@Suite("export/import")
struct ExportImportTests {

    @Test("is identity for a version-4 state")
    func identityForV4() throws {
        var s = AppState.makeInitial()
        s.nodes[.Start]?.completed = true
        s.budget.accounts.append(Account(id: "a1", name: "Checking", kind: .checking))
        s.budget.assignments["2026-06"] = ["groceries": 1234]
        #expect(try IO.importString(IO.exportString(s)) == s)
    }

    @Test("migrates a v1 export on import")
    func migratesV1Export() throws {
        let imported = try IO.migrate(makeRichV1(), now: june10)
        #expect(imported.version == 4)
        #expect(!imported.budget.categories.isEmpty)
    }
}
