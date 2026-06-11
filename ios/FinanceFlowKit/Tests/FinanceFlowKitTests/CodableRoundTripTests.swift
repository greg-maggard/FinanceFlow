import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("Codable round-trip")
struct CodableRoundTripTests {
    @Test("initial state round-trips")
    func initialRoundTrips() throws {
        let original = AppState.makeInitial()
        let data = try JSONCoder.encode(original)
        let decoded = try JSONCoder.decode(data)
        #expect(decoded == original)
    }

    @Test("rich v3 state round-trips every surviving NodeData kind plus budget data")
    func richRoundTrips() throws {
        var s = AppState.makeInitial()
        s.settings.monthlyExpenses = 3200
        s.settings.preTaxIncome = 90000
        s.decisions[.Q_Match] = .yes
        s.decisions[.Q_HighDebt] = .no

        s.nodes[.Start]?.completed = true
        s.nodes[.Start]?.completedAt = Date(timeIntervalSince1970: 1_700_000_000)
        s.nodes[.Rent]?.notes = "renters insurance via Lemonade"
        s.nodes[.Rent]?.monthlyChecks = ["2026-05": true, "2026-04": true]
        s.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6))
        s.nodes[.Match]?.data = .match(matchPct: 5, currentContribPct: 5)
        s.nodes[.IRA]?.data = .ira(IRAData(type: .roth, ytdContribution: .manual(3500), annualLimit: 7000))
        s.nodes[.Increase401k]?.data = .increase401k(currentPct: 8, targetPct: 15)
        s.nodes[.HSA]?.data = .hsa(HSAData(coverage: .family, ytdContribution: .manual(2000), annualLimit: 8550))
        s.nodes[.College]?.data = .college(CollegeData(monthlyContribution: 200, targetAge: 18))
        s.shownCelebrations = [.Start]
        s.earnedMedals = [0]

        // v3: the money lives in the budget book.
        s.budget.accounts = [
            Account(id: "checking", name: "Checking", kind: .checking),
            // apr via Decimal(string:) — a `22.9` float literal would route through
            // Double and store 22.8999…986, which is exactly the drift we're removing.
            Account(id: "debt:d1", name: "Card", kind: .loan, apr: Decimal(string: "22.9")!, minPayment: 120, nodeId: .HighDebt),
        ]
        s.budget.transactions = [
            Txn(id: "t1", accountId: "checking", date: "2026-06-01", amount: 2500, categoryId: Ledger.rtaCategoryID),
            Txn(id: "t2", accountId: "debt:d1", date: "2026-06-01", payee: "Starting balance", amount: -4200),
        ]
        s.budget.groups = [
            CategoryGroup(id: "g:bills", name: "Bills", order: 0),
            CategoryGroup(id: "g:goals", name: "Savings Goals", order: 1),
        ]
        s.budget.categories = [
            BudgetCategory(id: "Rent:r1", groupId: "g:bills", name: "Apartment", order: 0, monthlyTarget: 1800, nodeId: .Rent),
            BudgetCategory(id: "Goals:gl1", groupId: "g:goals", name: "Vacation", order: 1, balanceTarget: 5000, targetDate: "2028-06-10", nodeId: .Goals),
        ]
        s.budget.assignments = ["2026-06": ["Rent:r1": 1800, "Goals:gl1": 250]]

        let data = try JSONCoder.encode(s)
        let decoded = try JSONCoder.decode(data)
        #expect(decoded == s)
    }

    /// v2 documents still carry the wide payload shapes (recurring items, EF
    /// buckets, purchase goals, debt lists) plus the retired `categoryMap`.
    /// They must keep decoding into the relic structs losslessly: a payload
    /// decode failure would make the AppState decoder's per-node `try?`
    /// silently discard that node's `completed`/`notes`.
    @Test("a raw v2 document decodes its wide payloads into the relic structs")
    func rawV2DocumentDecodes() throws {
        let v2JSON = """
        {
          "version": 2,
          "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": { "Q_Match": "yes" },
          "nodes": {
            "Start": { "completed": true, "notes": "kickoff" },
            "SmallEF": { "completed": false, "notes": "starter fund", "data": {
              "balance": { "value": 1000, "source": "manual" },
              "items": [
                { "id": "s1", "name": "Buffer", "target": 500.5, "balance": { "value": 250.25, "source": "manual" } }
              ]
            } }
          },
          "categoryMap": { "Rent": "ynab-cat-123" },
          "budget": { "accounts": [], "transactions": [], "groups": [], "categories": [], "assignments": {} }
        }
        """
        // Decode only — deliberately NOT migrated.
        let decoded = try JSONCoder.decode(Data(v2JSON.utf8))
        #expect(decoded.version == 2)
        #expect(decoded.node(.Start).completed == true)
        #expect(decoded.node(.Start).notes == "kickoff")
        #expect(decoded.decisions[.Q_Match] == .yes)

        #expect(decoded.node(.SmallEF).notes == "starter fund")
        let ef = try #require(decoded.node(.SmallEF).data?.smallEF)
        #expect(ef.balance.value == 1000)
        let bucket = try #require(ef.items?.first)
        #expect(bucket.id == "s1")
        #expect(bucket.target == Decimal(string: "500.5")!)
        #expect(bucket.balance.value == Decimal(string: "250.25")!)
    }

    @Test("decisions serialize as a keyed JSON object (not a flat array)")
    func decisionsShape() throws {
        let data = try JSONCoder.encode(.makeInitial())
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let decisions = object?["decisions"] as? [String: Any]
        // All ten keys present; unanswered encoded as JSON null.
        #expect(decisions?.count == DecisionId.allCases.count)
        #expect(decisions?["Q_Match"] is NSNull)
    }

    @Test("answered decision survives as a string value")
    func answeredDecisionShape() throws {
        var s = AppState.makeInitial()
        s.decisions[.Q_Match] = .yes
        let data = try JSONCoder.encode(s)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let decisions = object?["decisions"] as? [String: Any]
        #expect(decisions?["Q_Match"] as? String == "yes")
    }

    @Test("import of garbage throws instead of silently resetting")
    func importGarbage() {
        #expect(throws: (any Error).self) {
            try IO.importString("not json at all")
        }
    }

    @Test("export then import is identity")
    func exportImportIdentity() throws {
        var s = AppState.makeInitial()
        s.nodes[.Start]?.completed = true
        s.decisions[.Q_Match] = .no
        let exported = try IO.exportJSON(s)
        let imported = try IO.importJSON(exported)
        #expect(imported == s)
    }

    @Test("unsupported version throws and is never silently wiped")
    func unsupportedVersionThrows() {
        var s = AppState.makeInitial()
        s.version = 99
        #expect(throws: IO.ImportError.unsupportedVersion(99)) {
            try IO.migrate(s)
        }
    }
}
