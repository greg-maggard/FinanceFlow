import Testing
import Foundation
@testable import FinanceFlowKit

/// Direct port of the migration cases in `src/state/io.test.ts`: both
/// platforms must migrate the same document to the same v3 state
/// (deterministic ids, identical seeds, RTA unchanged, payloads stripped to
/// the node-only fields).

/// 2026-06-10 local, mirroring the web tests' `NOW`.
private let june10 = Calendar.current.date(
    from: DateComponents(year: 2026, month: 6, day: 10, hour: 12)
)!

/// A version-1 document (no meaningful `budget`), as written by pre-v2 builds.
private func makeV1() -> AppState {
    var s = AppState.makeInitial()
    s.version = 1
    return s
}

private func makeRichV1() -> AppState {
    var s = makeV1()
    s.settings.monthlyExpenses = 4000
    s.nodes[.Start]?.completed = true
    s.nodes[.Rent]?.notes = "due on the 1st"
    s.nodes[.Rent]?.monthlyChecks = ["2026-05": true]
    s.nodes[.Rent]?.data = .recurring(RecurringData(
        target: .manual(1800),
        funded: .manual(1800),
        items: [RecurringItem(id: "r1", name: "Apartment", target: .manual(1800), funded: .manual(1800))]
    ))
    s.nodes[.Food]?.data = .recurring(RecurringData(target: .manual(600), funded: .manual(450)))
    s.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6, balance: .manual(0), items: [
        EFBucket(id: "b1", name: "Medical", target: 3000, balance: .manual(1200)),
        EFBucket(id: "b2", name: "Car", target: 2000, balance: .manual(800)),
    ]))
    s.nodes[.SmallEF]?.data = .smallEF(SmallEFData(balance: .manual(1000)))
    s.nodes[.SavePurchase]?.data = .savePurchase(SavePurchaseData(
        goalName: "House",
        target: 20000,
        saved: .manual(5000),
        items: [PurchaseGoal(id: "p1", name: "House", target: 20000, saved: .manual(5000), byDate: "2027-01-01")]
    ))
    s.nodes[.Goals]?.data = .goals([Goal(id: "gl1", name: "Vacation", target: 3000, saved: 500, horizonYears: 2)])
    s.nodes[.HighDebt]?.data = .debts([
        Debt(id: "d1", name: "Visa", balance: 4200, apr: Decimal(string: "24.99")!, minPayment: 50, paid: false),
    ])
    s.nodes[.IRA]?.data = .ira(IRAData(type: .roth, ytdContribution: .manual(2500), annualLimit: 7000))
    s.nodes[.College]?.data = .college(CollegeData(monthlyContribution: 100, balance: .manual(2500)))
    return s
}

/// A version-2 document: budget present, payloads still wide.
private func makeV2(_ budget: BudgetBook = BudgetBook()) -> AppState {
    var s = makeV1()
    s.version = 2
    s.budget = budget
    return s
}

@Suite("migrate")
struct MigrateTests {

    @Test("passes a version-3 document through")
    func passthroughV3() throws {
        let s = AppState.makeInitial()
        #expect(try IO.migrate(s) == s)
    }

    @Test("throws on a newer version instead of silently resetting")
    func newerVersionThrows() {
        var s = AppState.makeInitial()
        s.version = 4
        #expect(throws: IO.ImportError.unsupportedVersion(4)) {
            try IO.migrate(s)
        }
    }
}

@Suite("v1 -> v3 chain")
struct V1ToV3ChainTests {

    @Test("books match the old v1->v2 goldens and payloads are stripped")
    func richChain() throws {
        let v1 = makeRichV1()
        let out = try IO.migrate(v1, now: june10)
        #expect(out.version == 3)

        // Ledger goldens (same numbers the v1->v2 migration always produced).
        #expect(out.budget.categories.map(\.id) == [
            "Rent:r1", "Food", "BigEF:b1", "BigEF:b2", "SavePurchase:p1", "Goals:gl1",
        ])
        #expect(out.budget.assignments == ["2026-06": [
            "Rent:r1": 1800,
            "Food": 450,
            "BigEF:b1": 1200,
            "BigEF:b2": 800,
            "SavePurchase:p1": 5000,
            "Goals:gl1": 500,
        ]])
        let inflow = out.budget.transactions.first { $0.categoryId == Ledger.rtaCategoryID }
        #expect(inflow?.accountId == "acct:cash")
        #expect(inflow?.amount == 9750)
        let june = Ledger.snapshot(out.budget, month: "2026-06")
        #expect(june.readyToAssign == 0)
        #expect(june.categories["BigEF:b1"]?.available == 1200)

        // v3 additions: account backlinks and horizon -> target date.
        let debt = out.budget.accounts.first { $0.id == "debt:d1" }
        #expect(debt?.nodeId == .HighDebt)
        #expect(debt?.apr == Decimal(string: "24.99")!)
        #expect(Ledger.accountBalance(out.budget, "debt:d1") == -4200)
        #expect(out.budget.accounts.first { $0.id == "acct:college" }?.nodeId == .College)
        #expect(out.budget.categories.first { $0.id == "Goals:gl1" }?.targetDate == "2028-06-10")

        // Payloads: ledger-owned ones gone, node-only ones kept or slimmed.
        #expect(out.node(.Rent).data == nil)
        #expect(out.node(.SmallEF).data == nil)
        #expect(out.node(.SavePurchase).data == nil)
        #expect(out.node(.Goals).data == nil)
        #expect(out.node(.HighDebt).data == nil)
        #expect(out.node(.BigEF).data == .bigEF(BigEFData(targetMonths: 6)))
        #expect(out.node(.College).data == .college(CollegeData(monthlyContribution: 100)))
        #expect(out.node(.IRA).data == .ira(IRAData(
            type: .roth,
            ytdContribution: .manual(2500),
            annualLimit: 7000
        )))

        // Non-financial node state is preserved.
        #expect(out.node(.Start).completed == true)
        #expect(out.node(.Rent).notes == "due on the 1st")
        #expect(out.node(.Rent).monthlyChecks == ["2026-05": true])
        #expect(out.decisions == v1.decisions)
    }
}

@Suite("v2 -> v3 reconcile")
struct V2ToV3ReconcileTests {

    @Test("ledger wins where payload and book describe the same envelope")
    func ledgerWins() throws {
        var v2 = makeV2(BudgetBook(
            accounts: [Account(id: "acct:cash", name: "Cash", kind: .cash)],
            transactions: [Txn(
                id: "txn:start:acct:cash",
                accountId: "acct:cash",
                date: "2026-06-01",
                payee: "Starting balance",
                amount: 500,
                categoryId: Ledger.rtaCategoryID
            )],
            groups: [CategoryGroup(id: "g:bills", name: "Bills", order: 0)],
            categories: [BudgetCategory(
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
        v2.nodes[.Rent]?.data = .recurring(RecurringData(
            target: .manual(1800),
            funded: .manual(450),
            items: [RecurringItem(id: "r1", name: "Apartment", target: .manual(1800), funded: .manual(450))]
        ))

        let out = try IO.migrate(v2, now: june10)
        #expect(out.budget.categories.first { $0.id == "Rent:r1" }?.monthlyTarget == 1900)
        #expect(out.budget.assignments["2026-06"] == ["Rent:r1": 500])
        #expect(out.budget.transactions.count == 1)
        #expect(out.budget.categories.count == 1)
        #expect(out.node(.Rent).data == nil)
    }

    @Test("creates payload-only items without moving Ready-to-Assign")
    func payloadOnlyCreation() throws {
        var v2 = makeV2()
        v2.nodes[.Food]?.data = .recurring(RecurringData(target: .manual(600), funded: .manual(450)))
        #expect(Ledger.snapshot(makeV2().budget, month: "2026-06").readyToAssign == 0)

        let out = try IO.migrate(v2, now: june10)
        #expect(out.budget.categories.map(\.id) == ["Food"])
        #expect(out.budget.assignments["2026-06"] == ["Food": 450])
        let june = Ledger.snapshot(out.budget, month: "2026-06")
        #expect(june.readyToAssign == 0)
        #expect(june.categories["Food"]?.available == 450)
    }

    @Test("is idempotent: migrating the migrated document changes nothing")
    func idempotent() throws {
        let out = try IO.migrate(makeRichV1(), now: june10)
        let roundTripped = try JSONCoder.decode(JSONCoder.encode(out))
        #expect(try IO.migrate(roundTripped, now: june10) == out)
    }

    @Test("honors an explicit paid flag the ledger couldn't represent")
    func paidFlagHonored() throws {
        var v2 = makeV2(BudgetBook(
            accounts: [Account(
                id: "debt:d1",
                name: "Visa",
                kind: .loan,
                apr: Decimal(string: "24.99")!,
                minPayment: 50
            )],
            transactions: [Txn(
                id: "txn:start:debt:d1",
                accountId: "debt:d1",
                date: "2026-01-05",
                payee: "Starting balance",
                amount: -4200
            )]
        ))
        v2.nodes[.HighDebt]?.data = .debts([
            Debt(id: "d1", name: "Visa", balance: 4200, apr: Decimal(string: "24.99")!, minPayment: 50, paid: true),
        ])

        let out = try IO.migrate(v2, now: june10)
        #expect(out.budget.accounts.first { $0.id == "debt:d1" }?.nodeId == .HighDebt)
        let adjust = out.budget.transactions.first { $0.id == "txn:adjust:v3:debt:d1" }
        #expect(adjust?.amount == 4200)
        #expect(adjust?.memo == "Marked paid")
        #expect(Ledger.accountBalance(out.budget, "debt:d1") == 0)
    }

    @Test("never resurrects the EF scalar mirror once the union is ledger-managed")
    func noScalarResurrection() throws {
        var v2 = makeV2(BudgetBook(
            groups: [CategoryGroup(id: "g:ef", name: "Emergency Fund", order: 0)],
            categories: [BudgetCategory(
                id: "BigEF:b1",
                groupId: "g:ef",
                name: "Medical",
                order: 0,
                balanceTarget: 3000,
                nodeId: .BigEF
            )]
        ))
        // Stale scalar mirror left over from normalized() days.
        v2.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6, balance: .manual(9999)))
        v2.nodes[.SmallEF]?.data = .smallEF(SmallEFData(balance: .manual(1000)))

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
        #expect(out.version == 3)
        let encoded = try JSONCoder.encode(out)
        let obj = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(obj["categoryMap"] == nil)
    }
}

@Suite("export/import")
struct ExportImportTests {

    @Test("is identity for a version-3 state")
    func identityForV3() throws {
        var s = AppState.makeInitial()
        s.nodes[.Start]?.completed = true
        s.budget.accounts.append(Account(id: "a1", name: "Checking", kind: .checking))
        s.budget.assignments["2026-06"] = ["groceries": Decimal(string: "12.34")!]
        #expect(try IO.importString(IO.exportString(s)) == s)
    }

    @Test("migrates a v1 export on import")
    func migratesV1Export() throws {
        let imported = try IO.importJSON(IO.exportJSON(makeRichV1()))
        #expect(imported.version == 3)
        #expect(!imported.budget.categories.isEmpty)
    }
}
