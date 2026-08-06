import Testing
import Foundation
@testable import FinanceFlowKit

/// The v4 wire format: every money field is a bare JSON **integer** number of
/// cents (`src/state/schema.ts`'s `Cents`), and nothing else about the document
/// shape changed. These prove the on-device JSON and export/import stay
/// byte-compatible with the web — money never becomes a string, an object, or a
/// fractional number, and pre-v4 documents decode THROUGH the migration chain,
/// so web-authored dollar fixtures are asserted on the resulting v4 ledger.
/// If any of these fail, the two platforms have diverged on the wire.
@Suite("JSON wire format (money is an integer number of cents)")
struct JSONWireFormatTests {

    /// A v4 state that touches a money field of every kind, including amounts
    /// whose dollar value is fractional (the cases a `Double` sum drifted on).
    private func richMoneyState() -> AppState {
        var s = AppState.makeInitial()
        s.settings.monthlyExpenses = Money(cents: 320_050)   // $3,200.50
        s.settings.preTaxIncome = Money(cents: 9_000_000)    // $90,000
        s.nodes[.Match]?.data = .match(matchPct: Decimal(string: "4.5")!, currentContribPct: 3)
        s.nodes[.IRA]?.data = .ira(IRAData(
            type: .roth,
            ytdContribution: .manual(Money(cents: 123_456)), // $1,234.56
            annualLimit: Money(cents: 700_000)
        ))
        s.budget.accounts = [
            Account(
                id: "debt:d1",
                name: "Card",
                kind: .loan,
                apr: Decimal(string: "22.9")!,               // a RATE — stays fractional
                minPayment: Money(cents: 12_000),
                nodeId: .HighDebt
            ),
            Account(id: "acct:cash", name: "Cash", kind: .cash),
        ]
        s.budget.transactions = [
            Txn(id: "t1", accountId: "debt:d1", date: "2026-06-01", payee: "Starting balance", amount: Money(cents: -420_025)),
            Txn(id: "t2", accountId: "acct:cash", date: "2026-06-01", amount: Money(cents: 180_099), categoryId: Ledger.rtaCategoryID),
        ]
        s.budget.groups = [CategoryGroup(id: "g:goals", name: "Savings Goals", order: 0)]
        s.budget.categories = [
            BudgetCategory(id: "SavePurchase:g1", groupId: "g:goals", name: "Car", order: 0, balanceTarget: Money(cents: 1_200_000), nodeId: .SavePurchase),
        ]
        s.budget.assignments = ["2026-06": ["SavePurchase:g1": Money(cents: 10)]]   // 10 cents
        return s
    }

    /// True when the JSON number carries no fractional part — i.e. it really is
    /// an integer on the wire, not a rounded-looking double.
    private func isIntegerNumber(_ value: Any?) throws -> Bool {
        let n = try #require(value as? NSNumber)
        return n.doubleValue == n.doubleValue.rounded()
    }

    @Test("every money field encodes as a bare integer JSON number")
    func moneyEncodesAsInteger() throws {
        let data = try JSONCoder.encode(richMoneyState())
        let obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        // Settings: a top-level money number, in cents.
        let settings = try #require(obj["settings"] as? [String: Any])
        #expect(settings["monthlyExpenses"] is NSNumber)
        #expect(!(settings["monthlyExpenses"] is NSString))
        #expect((settings["monthlyExpenses"] as? NSNumber)?.intValue == 320_050)
        #expect(try isIntegerNumber(settings["monthlyExpenses"]))

        // Ledger: txn amount, minimum payment, assignment — all integers.
        let budget = try #require(obj["budget"] as? [String: Any])
        let accounts = try #require(budget["accounts"] as? [[String: Any]])
        let debt = try #require(accounts.first { $0["id"] as? String == "debt:d1" })
        #expect((debt["minPayment"] as? NSNumber)?.intValue == 12_000)
        #expect(try isIntegerNumber(debt["minPayment"]))
        // ...but APR is a RATE, not money (D8), and keeps its fractional value.
        #expect((debt["apr"] as? NSNumber)?.doubleValue == 22.9)
        #expect(!(try isIntegerNumber(debt["apr"])))

        let txns = try #require(budget["transactions"] as? [[String: Any]])
        let start = try #require(txns.first { $0["id"] as? String == "t1" })
        #expect(start["amount"] is NSNumber)
        #expect((start["amount"] as? NSNumber)?.intValue == -420_025)
        #expect(try isIntegerNumber(start["amount"]))

        let assignments = try #require(budget["assignments"] as? [String: Any])
        let june = try #require(assignments["2026-06"] as? [String: Any])
        #expect(june["SavePurchase:g1"] is NSNumber)
        #expect(!(june["SavePurchase:g1"] is NSString))
        #expect((june["SavePurchase:g1"] as? NSNumber)?.intValue == 10)

        let categories = try #require(budget["categories"] as? [[String: Any]])
        #expect((categories.first?["balanceTarget"] as? NSNumber)?.intValue == 1_200_000)

        let nodes = try #require(obj["nodes"] as? [String: Any])

        // SourcedNumber: `value` is a bare integer beside its string `source`.
        let iraData = try #require((nodes["IRA"] as? [String: Any])?["data"] as? [String: Any])
        let ytd = try #require(iraData["ytdContribution"] as? [String: Any])
        #expect(ytd["value"] is NSNumber)
        #expect((ytd["value"] as? NSNumber)?.intValue == 123_456)
        #expect(try isIntegerNumber(ytd["value"]))
        #expect(ytd["source"] as? String == "manual")
        #expect((iraData["annualLimit"] as? NSNumber)?.intValue == 700_000)

        // Percentages are not money and keep their fractional values.
        let matchData = try #require((nodes["Match"] as? [String: Any])?["data"] as? [String: Any])
        #expect(matchData["matchPct"] is NSNumber)
        #expect((matchData["matchPct"] as? NSNumber)?.doubleValue == 4.5)
    }

    @Test("no money field ever serializes with a decimal point")
    func noFractionalMoneyOnTheWire() throws {
        let json = String(decoding: try JSONCoder.encode(richMoneyState()), as: UTF8.self)
        // The only fractional numbers left in the document are rates/percentages.
        #expect(json.contains("22.9"))
        #expect(json.contains("4.5"))
        #expect(!json.contains("3200.5"))
        #expect(!json.contains("-4200.25"))
        #expect(!json.contains("1234.56"))
    }

    @Test("web-written v1 JSON migrates to exact integer cents (no Double drift)")
    func decodesWebNumbersExactly() throws {
        // Authored exactly as the web's `JSON.stringify` would have emitted it
        // pre-v4: money as bare DOLLAR numbers, including values a binary
        // `Double` cannot hold exactly. Importing runs the v1 -> v4 chain.
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
        #expect(decoded.version == 4)
        #expect(decoded.settings.monthlyExpenses == Money(cents: 320_050))

        // The debt payload became a loan account with the exact APR and balance.
        let debt = try #require(decoded.budget.accounts.first { $0.id == "debt:d1" })
        #expect(debt.apr == Decimal(string: "22.9")!)        // exact — not 22.8999…986
        #expect(debt.nodeId == .HighDebt)
        #expect(Ledger.accountBalance(decoded.budget, "debt:d1") == Money(cents: -420_025))

        // The single purchase goal became its envelope; saved -> available.
        let cat = try #require(decoded.budget.categories.first { $0.id == "SavePurchase" })
        #expect(cat.name == "Car")
        #expect(cat.balanceTarget == Money(cents: 1_200_000))
        let snap = Ledger.snapshot(decoded.budget, month: Recurring.ymKey())
        #expect(snap.categories["SavePurchase"]?.available == Money(cents: 10))
    }

    @Test("round-trip is byte-stable: re-encoding decoded state reproduces the bytes")
    func roundTripIsByteStable() throws {
        let once = try JSONCoder.encode(richMoneyState())
        let twice = try JSONCoder.encode(JSONCoder.decode(once))
        #expect(once == twice)
    }

    @Test("web-authored purchase goals migrate into envelopes with exact cents")
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
        #expect(byId["SavePurchase:g1"]?.balanceTarget == Money(cents: 4_000_000))
        #expect(byId["SavePurchase:g1"]?.targetDate == "2028-06")
        #expect(byId["SavePurchase:g2"]?.balanceTarget == Money(cents: 1_200_000))
        #expect(byId["SavePurchase:g2"]?.targetDate == nil)

        // Each goal's saved amount became its envelope's available, exactly.
        let snap = Ledger.snapshot(decoded.budget, month: Recurring.ymKey())
        #expect(snap.categories["SavePurchase:g1"]?.available == Money(cents: 1_500_000))
        #expect(snap.categories["SavePurchase:g2"]?.available == Money(cents: 10))
        #expect(snap.readyToAssign == 0)
    }

    @Test("web-authored EF buckets migrate to exact-cent envelopes; the scalar mirror never materializes")
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
        #expect(bucket.balanceTarget == Money(cents: 400_025))
        #expect(bucket.nodeId == .BigEF)
        let snap = Ledger.snapshot(decoded.budget, month: Recurring.ymKey())
        #expect(snap.categories["BigEF:b1"]?.available == Money(cents: 250_050))

        // Payloads stripped to node-only fields.
        #expect(decoded.node(.SmallEF).data == nil)
        #expect(decoded.node(.BigEF).data == .bigEF(BigEFData(targetMonths: 6)))
    }

    @Test("the sum that drifts as Double is exact by construction in cents")
    func exactSumSurvivesTheWire() throws {
        // 0.1 + 0.2 is the canonical Double drift (== 0.30000000000000004). In
        // v4 the operands are 10 and 20 — the drifting representation cannot be
        // written down at all, so there is nothing to round away afterwards.
        var s = AppState.makeInitial()
        s.budget.accounts = [Account(id: "a1", name: "Cash", kind: .cash)]
        s.budget.transactions = [
            Txn(id: "t1", accountId: "a1", date: "2026-06-01", amount: Money(cents: 10)),
            Txn(id: "t2", accountId: "a1", date: "2026-06-02", amount: Money(cents: 20)),
        ]
        let data = try JSONCoder.encode(s)
        let json = String(decoding: data, as: UTF8.self)
        #expect(json.contains("\"amount\" : 10"))
        #expect(json.contains("\"amount\" : 20"))
        #expect(!json.contains("0.30000000000000004"))
        #expect(!json.contains("0.0999999"))

        let decoded = try JSONCoder.decode(data)
        #expect(Ledger.accountBalance(decoded.budget, "a1") == Money(cents: 30))
    }
}
