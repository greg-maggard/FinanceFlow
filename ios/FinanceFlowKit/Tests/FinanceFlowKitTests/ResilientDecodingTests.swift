import Testing
import Foundation
@testable import FinanceFlowKit

/// Validates that a single bad field can't take down the whole document — the
/// fix for the silent-data-loss class of bug.
@Suite("Resilient decoding")
struct ResilientDecodingTests {

    @Test("an unknown enum value decodes to a safe fallback, not a failure")
    func unknownEnumFallsBack() throws {
        var s = AppState.makeInitial()
        s.nodes[.IRA]?.data = .ira(IRAData(
            type: .roth,
            ytdContribution: SourcedNumber(value: 100, source: .manual),
            annualLimit: 700_000
        ))
        let data = try JSONCoder.encode(s)

        var obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        var nodes = try #require(obj["nodes"] as? [String: Any])
        var ira = try #require(nodes["IRA"] as? [String: Any])
        var dataObj = try #require(ira["data"] as? [String: Any])
        var ytd = try #require(dataObj["ytdContribution"] as? [String: Any])
        ytd["source"] = "plaid_v2_unknown"           // a source this build doesn't know
        dataObj["ytdContribution"] = ytd
        ira["data"] = dataObj
        nodes["IRA"] = ira
        obj["nodes"] = nodes

        let mutated = try JSONSerialization.data(withJSONObject: obj)
        let decoded = try JSONCoder.decode(mutated)   // must NOT throw

        #expect(decoded.node(.IRA).data?.ira?.ytdContribution.source == .manual)   // fell back
        #expect(decoded.node(.IRA).data?.ira?.ytdContribution.value == 100)        // value preserved
    }

    @Test("one structurally-corrupt node is isolated; the rest of the document survives")
    func corruptNodeIsolated() throws {
        var s = AppState.makeInitial()
        s.nodes[.Start]?.completed = true
        s.nodes[.IRA]?.data = .ira(IRAData(type: .roth, ytdContribution: .manual(100_000), annualLimit: 700_000))
        let data = try JSONCoder.encode(s)

        var obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        var nodes = try #require(obj["nodes"] as? [String: Any])
        var ira = try #require(nodes["IRA"] as? [String: Any])
        ira["data"] = ["annualLimit": "not a number"]   // breaks IRAData decode
        nodes["IRA"] = ira
        obj["nodes"] = nodes

        let mutated = try JSONSerialization.data(withJSONObject: obj)
        let decoded = try JSONCoder.decode(mutated)     // must NOT throw

        #expect(decoded.node(.IRA).data == nil)             // corrupt node reset to default
        #expect(decoded.node(.Start).completed == true)     // unrelated good data survived
    }

    /// The v3 worry case: a full-fat v2 document (wide payloads, categoryMap,
    /// budget) must come through `IO.importString` with every node's
    /// completed/notes intact, payloads stripped to the node-only fields, and
    /// the ledger reconciled — never a silent reset.
    @Test("a full-fat v2 document migrates with node state intact and payloads stripped")
    func fullFatV2DocumentMigrates() throws {
        let v2JSON = """
        {
          "version": 2,
          "settings": { "monthlyExpenses": 4000, "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": { "Q_HighDebt": "yes" },
          "nodes": {
            "Start": { "completed": true, "notes": "kickoff" },
            "Rent": { "completed": true, "notes": "due on the 1st", "monthlyChecks": { "2026-05": true }, "data": {
              "target": { "value": 1800, "source": "manual" },
              "funded": { "value": 1800, "source": "manual" },
              "items": [{ "id": "r1", "name": "Apartment", "target": { "value": 1800, "source": "manual" }, "funded": { "value": 1800, "source": "manual" } }]
            } },
            "BigEF": { "completed": false, "notes": "fund note", "data": {
              "targetMonths": 6,
              "balance": { "value": 0, "source": "manual" },
              "items": [{ "id": "b1", "name": "Medical", "target": 3000, "balance": { "value": 1200, "source": "manual" } }]
            } },
            "HighDebt": { "completed": false, "notes": "snowball", "data": {
              "debts": [{ "id": "d1", "name": "Visa", "balance": 4200, "apr": 24.99, "minPayment": 50, "paid": false }]
            } },
            "IRA": { "completed": false, "notes": "roth first", "data": {
              "type": "roth", "ytdContribution": { "value": 2500, "source": "manual" }, "annualLimit": 7000
            } }
          },
          "categoryMap": { "Rent": "ynab-cat-123" },
          "budget": {
            "accounts": [{ "id": "acct:cash", "name": "Cash", "kind": "cash", "source": "manual" }],
            "transactions": [
              { "id": "txn:start:acct:cash", "accountId": "acct:cash", "date": "2026-06-01", "payee": "Starting balance", "amount": 3000, "categoryId": "rta", "source": "manual" }
            ],
            "groups": [{ "id": "g:bills", "name": "Bills", "order": 0 }],
            "categories": [
              { "id": "Rent:r1", "groupId": "g:bills", "name": "Apartment", "order": 0, "monthlyTarget": 1800, "nodeId": "Rent" }
            ],
            "assignments": { "2026-06": { "Rent:r1": 1800 } }
          }
        }
        """
        let out = try IO.importString(v2JSON)
        #expect(out.version == 4)

        // Every node's non-financial state survived the migration.
        #expect(out.node(.Start).completed == true)
        #expect(out.node(.Start).notes == "kickoff")
        #expect(out.node(.Rent).completed == true)
        #expect(out.node(.Rent).notes == "due on the 1st")
        #expect(out.node(.Rent).monthlyChecks == ["2026-05": true])
        #expect(out.node(.BigEF).notes == "fund note")
        #expect(out.node(.HighDebt).notes == "snowball")
        #expect(out.node(.IRA).notes == "roth first")
        #expect(out.decisions[.Q_HighDebt] == .yes)

        // Ledger-owned payloads stripped; node-only ones kept or slimmed.
        #expect(out.node(.Rent).data == nil)
        #expect(out.node(.HighDebt).data == nil)
        #expect(out.node(.BigEF).data == .bigEF(BigEFData(targetMonths: 6)))
        #expect(out.node(.IRA).data == .ira(IRAData(
            type: .roth,
            ytdContribution: .manual(250_000),
            annualLimit: 700_000
        )))

        // The ledger was reconciled: existing rows kept, missing ones created.
        #expect(out.budget.categories.map(\.id) == ["Rent:r1", "BigEF:b1"])
        #expect(out.budget.accounts.contains { $0.id == "debt:d1" && $0.nodeId == .HighDebt })
        #expect(Ledger.accountBalance(out.budget, "debt:d1") == -420_000)
        // RTA is untouched by migration: 3000 - 1800 before, (3000+1200) - (1800+1200) after.
        #expect(Ledger.snapshot(out.budget, month: "2099-12").readyToAssign == 120_000)
    }
}
