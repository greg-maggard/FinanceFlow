import Testing
import Foundation
@testable import FinanceFlowKit

/// Direct port of the v1 -> v2 migration cases in `src/state/io.test.ts`:
/// both platforms must migrate the same document to the same budget book
/// (deterministic ids, identical seeds, RTA exactly zero).
@Suite("v1 -> v2 migration")
struct MigrationTests {

    /// 2026-06-10 local, mirroring the web tests' `NOW`.
    private var june10: Date {
        Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 10, hour: 12))!
    }

    private func makeV1() -> AppState {
        var s = AppState.makeInitial()
        s.version = 1
        return s
    }

    private func makeRichV1() -> AppState {
        var s = makeV1()
        s.settings.monthlyExpenses = 4000
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
        s.nodes[.College]?.data = .college(CollegeData(monthlyContribution: 100, balance: .manual(2500)))
        return s
    }

    @Test("passes a version-2 document through")
    func passthroughV2() throws {
        let s = AppState.makeInitial()
        #expect(try IO.migrate(s) == s)
    }

    @Test("upgrades an empty v1 document to balanced empty books")
    func emptyV1() throws {
        let out = try IO.migrate(makeV1(), now: june10)
        #expect(out.version == 2)
        #expect(out.budget.categories.isEmpty)
        #expect(out.budget.accounts.map(\.id) == ["acct:cash"])
        #expect(out.budget.transactions.isEmpty)
        #expect(out.budget.assignments.isEmpty)
    }

    @Test("preserves every v1 field untouched")
    func preservesV1Fields() throws {
        let v1 = makeRichV1()
        let out = try IO.migrate(v1, now: june10)
        #expect(out.nodes == v1.nodes)
        #expect(out.settings == v1.settings)
        #expect(out.decisions == v1.decisions)
    }

    @Test("seeds categories from items with deterministic ids")
    func deterministicCategories() throws {
        let out = try IO.migrate(makeRichV1(), now: june10)
        let ids = out.budget.categories.map(\.id)
        #expect(ids == ["Rent:r1", "Food", "BigEF:b1", "BigEF:b2", "SavePurchase:p1", "Goals:gl1"])

        let byId = Dictionary(uniqueKeysWithValues: out.budget.categories.map { ($0.id, $0) })
        #expect(byId["Rent:r1"]?.groupId == "g:bills")
        #expect(byId["Rent:r1"]?.monthlyTarget == 1800)
        #expect(byId["Rent:r1"]?.nodeId == .Rent)
        #expect(byId["Food"]?.monthlyTarget == 600)
        #expect(byId["BigEF:b1"]?.groupId == "g:ef")
        #expect(byId["BigEF:b1"]?.name == "Medical")
        #expect(byId["BigEF:b1"]?.balanceTarget == 3000)
        #expect(byId["SavePurchase:p1"]?.balanceTarget == 20000)
        #expect(byId["SavePurchase:p1"]?.targetDate == "2027-01-01")
        #expect(byId["Goals:gl1"]?.balanceTarget == 3000)
        #expect(out.budget.groups.map(\.id) == ["g:bills", "g:ef", "g:goals"])
    }

    @Test("seeds the emergency fund from BigEF only when BigEF has data")
    func bigEFWins() throws {
        let out = try IO.migrate(makeRichV1(), now: june10)
        #expect(!out.budget.categories.contains { $0.id.hasPrefix("SmallEF") })

        var v1 = makeV1()
        v1.nodes[.SmallEF]?.data = .smallEF(SmallEFData(balance: .manual(700)))
        let small = try IO.migrate(v1, now: june10)
        #expect(small.budget.categories.map(\.id) == ["SmallEF"])
        #expect(small.budget.categories.first?.name == "Emergency Fund")
        #expect(small.budget.categories.first?.balanceTarget == 1000)
    }

    @Test("turns debts into loan accounts and the 529 into a tracking account")
    func debtAndTrackingAccounts() throws {
        let out = try IO.migrate(makeRichV1(), now: june10)
        let byId = Dictionary(uniqueKeysWithValues: out.budget.accounts.map { ($0.id, $0) })
        #expect(byId["debt:d1"]?.kind == .loan)
        #expect(byId["debt:d1"]?.apr == Decimal(string: "24.99")!)
        #expect(byId["debt:d1"]?.minPayment == 50)
        #expect(byId["acct:college"]?.kind == .tracking)
        #expect(Ledger.accountBalance(out.budget, "debt:d1") == -4200)
        #expect(Ledger.accountBalance(out.budget, "acct:college") == 2500)
    }

    @Test("opens the books balanced: bars preserved and RTA exactly zero")
    func balancedBooks() throws {
        let out = try IO.migrate(makeRichV1(), now: june10)
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
        #expect(june.categories["Rent:r1"]?.available == 1800)
        #expect(june.categories["BigEF:b1"]?.available == 1200)
        #expect(june.categories["SavePurchase:p1"]?.available == 5000)
    }

    @Test("a v2 export with budget data round-trips byte-stably")
    func v2RoundTrip() throws {
        var s = AppState.makeInitial()
        s.budget.accounts.append(Account(id: "a1", name: "Checking", kind: .checking))
        s.budget.assignments["2026-06"] = ["groceries": Decimal(string: "12.34")!]
        let once = try JSONCoder.encode(s)
        let decoded = try JSONCoder.decode(once)
        #expect(decoded == s)
        #expect(try JSONCoder.encode(decoded) == once)
    }

    @Test("web-authored v2 budget JSON decodes to exact Decimals")
    func decodesWebBudget() throws {
        let webJSON = """
        {
          "version": 2,
          "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": {},
          "nodes": {},
          "budget": {
            "accounts": [
              { "id": "c1", "name": "Checking", "kind": "checking", "source": "manual" }
            ],
            "transactions": [
              { "id": "t1", "accountId": "c1", "date": "2026-06-01", "amount": 1000.25, "categoryId": "rta", "source": "manual" }
            ],
            "groups": [{ "id": "g:bills", "name": "Bills", "order": 0 }],
            "categories": [
              { "id": "Food", "groupId": "g:bills", "name": "Food", "order": 0, "monthlyTarget": 600.5, "nodeId": "Food" }
            ],
            "assignments": { "2026-06": { "Food": 12.34 } }
          }
        }
        """
        let decoded = try IO.importString(webJSON)
        #expect(decoded.budget.transactions.first?.amount == Decimal(string: "1000.25")!)
        #expect(decoded.budget.categories.first?.monthlyTarget == Decimal(string: "600.5")!)
        #expect(decoded.budget.categories.first?.nodeId == .Food)
        #expect(decoded.budget.assignments["2026-06"]?["Food"] == Decimal(string: "12.34")!)

        let june = Ledger.snapshot(decoded.budget, month: "2026-06")
        #expect(june.readyToAssign == Decimal(string: "987.91")!) // 1000.25 - 12.34, exactly
    }
}
