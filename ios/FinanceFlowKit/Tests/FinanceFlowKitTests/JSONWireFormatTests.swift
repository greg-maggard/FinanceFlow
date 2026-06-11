import Testing
import Foundation
@testable import FinanceFlowKit

/// The web (`src/state/schema.ts`) stores every money field as a JSON `number`.
/// After migrating the Swift side from `Double` to `Decimal`, these prove the
/// on-device JSON and export/import wire shape is *unchanged*: money still
/// serializes as a bare number with the exact value, and numbers written by the
/// web decode back without binary-floating-point drift. v1/v2 documents decode
/// THROUGH the migration chain, so web-authored fixtures are asserted on the
/// resulting v3 ledger. If any of these fail, the two platforms have diverged
/// on the wire.
@Suite("JSON wire format (money stays a number)")
struct JSONWireFormatTests {

    /// A v3 state that touches a money field of every kind, with deliberately
    /// fractional values (the cases a `Double` sum would have drifted on).
    private func richMoneyState() -> AppState {
        var s = AppState.makeInitial()
        s.settings.monthlyExpenses = Decimal(string: "3200.50")!
        s.settings.preTaxIncome = 90000
        s.nodes[.Match]?.data = .match(matchPct: Decimal(string: "4.5")!, currentContribPct: 3)
        s.nodes[.IRA]?.data = .ira(IRAData(
            type: .roth,
            ytdContribution: .manual(Decimal(string: "1234.56")!),
            annualLimit: 7000
        ))
        s.budget.accounts = [
            Account(id: "debt:d1", name: "Card", kind: .loan, apr: Decimal(string: "22.9")!, minPayment: 120, nodeId: .HighDebt),
            Account(id: "acct:cash", name: "Cash", kind: .cash),
        ]
        s.budget.transactions = [
            Txn(id: "t1", accountId: "debt:d1", date: "2026-06-01", payee: "Starting balance", amount: Decimal(string: "-4200.25")!),
            Txn(id: "t2", accountId: "acct:cash", date: "2026-06-01", amount: Decimal(string: "1800.99")!, categoryId: Ledger.rtaCategoryID),
        ]
        s.budget.groups = [CategoryGroup(id: "g:goals", name: "Savings Goals", order: 0)]
        s.budget.categories = [
            BudgetCategory(id: "SavePurchase:g1", groupId: "g:goals", name: "Car", order: 0, balanceTarget: 12000, nodeId: .SavePurchase),
        ]
        s.budget.assignments = ["2026-06": ["SavePurchase:g1": Decimal(string: "0.1")!]]
        return s
    }

    @Test("every money field encodes as a JSON number, never a string or object")
    func moneyEncodesAsNumber() throws {
        let data = try JSONCoder.encode(richMoneyState())
        let obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        // Settings: a top-level money number.
        let settings = try #require(obj["settings"] as? [String: Any])
        #expect(settings["monthlyExpenses"] is NSNumber)
        #expect(!(settings["monthlyExpenses"] is NSString))
        #expect((settings["monthlyExpenses"] as? NSNumber)?.doubleValue == 3200.50)

        // Ledger: bare-struct money fields (account apr, txn amount, assignment).
        let budget = try #require(obj["budget"] as? [String: Any])
        let accounts = try #require(budget["accounts"] as? [[String: Any]])
        let debt = try #require(accounts.first { $0["id"] as? String == "debt:d1" })
        #expect(debt["apr"] is NSNumber)
        #expect((debt["apr"] as? NSNumber)?.doubleValue == 22.9)
        let txns = try #require(budget["transactions"] as? [[String: Any]])
        let start = try #require(txns.first { $0["id"] as? String == "t1" })
        #expect(start["amount"] is NSNumber)
        #expect((start["amount"] as? NSNumber)?.doubleValue == -4200.25)
        let assignments = try #require(budget["assignments"] as? [String: Any])
        let june = try #require(assignments["2026-06"] as? [String: Any])
        #expect(june["SavePurchase:g1"] is NSNumber)
        #expect(!(june["SavePurchase:g1"] is NSString))

        let nodes = try #require(obj["nodes"] as? [String: Any])

        // SourcedNumber: `value` is a number nested beside its string `source`.
        let iraData = try #require((nodes["IRA"] as? [String: Any])?["data"] as? [String: Any])
        let ytd = try #require(iraData["ytdContribution"] as? [String: Any])
        #expect(ytd["value"] is NSNumber)
        #expect((ytd["value"] as? NSNumber)?.doubleValue == 1234.56)
        #expect(ytd["source"] as? String == "manual")

        // Percentages migrated alongside money are numbers too.
        let matchData = try #require((nodes["Match"] as? [String: Any])?["data"] as? [String: Any])
        #expect(matchData["matchPct"] is NSNumber)
        #expect((matchData["matchPct"] as? NSNumber)?.doubleValue == 4.5)
    }

    @Test("web-written JSON numbers decode to exact Decimals (no Double drift)")
    func decodesWebNumbersExactly() throws {
        // Authored exactly as the web's `JSON.stringify` would emit it: money as
        // bare numbers, including values a binary `Double` cannot hold exactly.
        // Importing runs the v1 -> v3 chain, so the numbers land in the ledger.
        let webJSON = """
        {
          "version": 1,
          "settings": { "monthlyExpenses": 3200.5, "preTaxIncome": 90000, "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": {},
          "nodes": {
            "HighDebt": { "completed": false, "notes": "", "data": { "debts": [
              { "id": "d1", "name": "Card", "balance": 4200.25, "apr": 22.9, "minPayment": 120, "paid": false }
            ] } },
            "SavePurchase": { "completed": false, "notes": "", "data": {
              "goalName": "Car", "target": 12000, "saved": { "value": 0.1, "source": "manual" }
            } }
          }
        }
        """
        let decoded = try IO.importString(webJSON)
        #expect(decoded.version == 3)
        #expect(decoded.settings.monthlyExpenses == Decimal(string: "3200.5")!)

        // The debt payload became a loan account with the exact APR and balance.
        let debt = try #require(decoded.budget.accounts.first { $0.id == "debt:d1" })
        #expect(debt.apr == Decimal(string: "22.9")!)        // exact — not 22.8999…986
        #expect(debt.nodeId == .HighDebt)
        #expect(Ledger.accountBalance(decoded.budget, "debt:d1") == Decimal(string: "-4200.25")!)

        // The single purchase goal became its envelope; saved -> available.
        let cat = try #require(decoded.budget.categories.first { $0.id == "SavePurchase" })
        #expect(cat.name == "Car")
        #expect(cat.balanceTarget == 12000)
        let snap = Ledger.snapshot(decoded.budget, month: Recurring.ymKey())
        #expect(snap.categories["SavePurchase"]?.available == Decimal(string: "0.1")!)
    }

    @Test("round-trip is byte-stable: re-encoding decoded state reproduces the bytes")
    func roundTripIsByteStable() throws {
        let once = try JSONCoder.encode(richMoneyState())
        let twice = try JSONCoder.encode(JSONCoder.decode(once))
        #expect(once == twice)
    }

    @Test("web-authored purchase goals migrate into envelopes with exact Decimals")
    func decodesPurchaseGoals() throws {
        let webJSON = """
        {
          "version": 1,
          "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": {},
          "nodes": {
            "SavePurchase": { "completed": false, "notes": "", "data": {
              "goalName": "Down payment", "target": 52000, "saved": { "value": 15000.1, "source": "manual" },
              "items": [
                { "id": "g1", "name": "Down payment", "target": 40000, "saved": { "value": 15000, "source": "manual" }, "byDate": "2028-06" },
                { "id": "g2", "name": "New car", "target": 12000, "saved": { "value": 0.1, "source": "manual" } }
              ]
            } }
          }
        }
        """
        let decoded = try IO.importString(webJSON)
        #expect(decoded.node(.SavePurchase).data == nil)     // payload stripped at v3

        let byId = Dictionary(uniqueKeysWithValues: decoded.budget.categories.map { ($0.id, $0) })
        #expect(byId["SavePurchase:g1"]?.balanceTarget == 40000)
        #expect(byId["SavePurchase:g1"]?.targetDate == "2028-06")
        #expect(byId["SavePurchase:g2"]?.balanceTarget == 12000)
        #expect(byId["SavePurchase:g2"]?.targetDate == nil)

        // Each goal's saved amount became its envelope's available, exactly.
        let snap = Ledger.snapshot(decoded.budget, month: Recurring.ymKey())
        #expect(snap.categories["SavePurchase:g1"]?.available == 15000)
        #expect(snap.categories["SavePurchase:g2"]?.available == Decimal(string: "0.1")!)
        #expect(snap.readyToAssign == 0)
    }

    @Test("web-authored EF buckets migrate to exact-Decimal envelopes; the scalar mirror never materializes")
    func decodesEFBuckets() throws {
        let webJSON = """
        {
          "version": 1,
          "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": {},
          "nodes": {
            "SmallEF": { "completed": false, "notes": "", "data": {
              "balance": { "value": 1000, "source": "manual" }
            } },
            "BigEF": { "completed": false, "notes": "", "data": {
              "targetMonths": 6,
              "balance": { "value": 9000, "source": "manual" },
              "items": [
                { "id": "b1", "name": "Car", "target": 4000.25, "balance": { "value": 2500.5, "source": "manual" } }
              ]
            } }
          }
        }
        """
        let decoded = try IO.importString(webJSON)

        // BigEF holds data, so it supersedes SmallEF; its buckets win over the scalar.
        #expect(decoded.budget.categories.map(\.id) == ["BigEF:b1"])
        let bucket = try #require(decoded.budget.categories.first)
        #expect(bucket.balanceTarget == Decimal(string: "4000.25")!)
        #expect(bucket.nodeId == .BigEF)
        let snap = Ledger.snapshot(decoded.budget, month: Recurring.ymKey())
        #expect(snap.categories["BigEF:b1"]?.available == Decimal(string: "2500.5")!)

        // Payloads stripped to node-only fields.
        #expect(decoded.node(.SmallEF).data == nil)
        #expect(decoded.node(.BigEF).data == .bigEF(BigEFData(targetMonths: 6)))
    }

    @Test("a sum that drifts as Double stays exact as Decimal end-to-end")
    func exactSumSurvivesTheWire() throws {
        // 0.1 + 0.2 is the canonical Double drift (== 0.30000000000000004). Stored
        // as separate ledger amounts and summed in Decimal, the parts stay exact
        // and serialize cleanly — no float artifacts in the bytes.
        var s = AppState.makeInitial()
        s.budget.accounts = [Account(id: "a1", name: "Cash", kind: .cash)]
        s.budget.transactions = [
            Txn(id: "t1", accountId: "a1", date: "2026-06-01", amount: Decimal(string: "0.1")!),
            Txn(id: "t2", accountId: "a1", date: "2026-06-02", amount: Decimal(string: "0.2")!),
        ]
        let data = try JSONCoder.encode(s)
        let json = String(decoding: data, as: UTF8.self)
        #expect(json.contains("0.1"))
        #expect(json.contains("0.2"))
        #expect(!json.contains("0.30000000000000004"))
        #expect(!json.contains("0.0999999"))

        let decoded = try JSONCoder.decode(data)
        #expect(Ledger.accountBalance(decoded.budget, "a1") == Decimal(string: "0.3")!)  // exact, unlike 0.1 + 0.2 as Double
    }
}
