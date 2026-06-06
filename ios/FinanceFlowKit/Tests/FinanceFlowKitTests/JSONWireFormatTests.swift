import Testing
import Foundation
@testable import FinanceFlowKit

/// The web (`src/state/schema.ts`) stores every money field as a JSON `number`.
/// After migrating the Swift side from `Double` to `Decimal`, these prove the
/// on-device JSON and export/import wire shape is *unchanged*: money still
/// serializes as a bare number with the exact value, and numbers written by the
/// web decode back without binary-floating-point drift. If any of these fail, the
/// two platforms have diverged on the wire.
@Suite("JSON wire format (money stays a number)")
struct JSONWireFormatTests {

    /// A state that touches a money field of every kind, with deliberately
    /// fractional values (the cases a `Double` sum would have drifted on).
    private func richMoneyState() -> AppState {
        var s = AppState.makeInitial()
        s.settings.monthlyExpenses = Decimal(string: "3200.50")!
        s.settings.preTaxIncome = 90000
        s.nodes[.Rent]?.data = .recurring(RecurringData(
            target: .manual(Decimal(string: "1800.99")!),
            funded: .manual(Decimal(string: "1234.56")!)
        ))
        s.nodes[.SmallEF]?.data = .smallEF(balance: .manual(1000))
        s.nodes[.Match]?.data = .match(matchPct: Decimal(string: "4.5")!, currentContribPct: 3)
        s.nodes[.HighDebt]?.data = .debts([
            Debt(name: "Card", balance: Decimal(string: "4200.25")!, apr: Decimal(string: "22.9")!, minPayment: 120, paid: false),
        ])
        s.nodes[.SavePurchase]?.data = .savePurchase(
            SavePurchaseData(goalName: "Car", target: 12000, saved: .manual(Decimal(string: "0.1")!))
        )
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

        let nodes = try #require(obj["nodes"] as? [String: Any])

        // Debt: a bare-struct money field (balance/apr/minPayment).
        let debtData = try #require((nodes["HighDebt"] as? [String: Any])?["data"] as? [String: Any])
        let debts = try #require(debtData["debts"] as? [[String: Any]])
        #expect(debts[0]["apr"] is NSNumber)
        #expect((debts[0]["apr"] as? NSNumber)?.doubleValue == 22.9)
        #expect((debts[0]["balance"] as? NSNumber)?.doubleValue == 4200.25)

        // SourcedNumber: `value` is a number nested beside its string `source`.
        let rentData = try #require((nodes["Rent"] as? [String: Any])?["data"] as? [String: Any])
        let target = try #require(rentData["target"] as? [String: Any])
        #expect(target["value"] is NSNumber)
        #expect(target["source"] as? String == "manual")

        // Percentages migrated alongside money are numbers too.
        let matchData = try #require((nodes["Match"] as? [String: Any])?["data"] as? [String: Any])
        #expect(matchData["matchPct"] is NSNumber)
        #expect((matchData["matchPct"] as? NSNumber)?.doubleValue == 4.5)
    }

    @Test("web-written JSON numbers decode to exact Decimals (no Double drift)")
    func decodesWebNumbersExactly() throws {
        // Authored exactly as the web's `JSON.stringify` would emit it: money as
        // bare numbers, including values a binary `Double` cannot hold exactly.
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

        #expect(decoded.settings.monthlyExpenses == Decimal(string: "3200.5")!)
        let debt = try #require(decoded.node(.HighDebt).data?.debts?.first)
        #expect(debt.apr == Decimal(string: "22.9")!)        // exact — not 22.8999…986
        #expect(debt.balance == Decimal(string: "4200.25")!)
        #expect(decoded.node(.SavePurchase).data?.savePurchase?.saved.value == Decimal(string: "0.1")!)
    }

    @Test("round-trip is byte-stable: re-encoding decoded state reproduces the bytes")
    func roundTripIsByteStable() throws {
        let once = try JSONCoder.encode(richMoneyState())
        let twice = try JSONCoder.encode(JSONCoder.decode(once))
        #expect(once == twice)
    }

    @Test("a sum that drifts as Double stays exact as Decimal end-to-end")
    func exactSumSurvivesTheWire() throws {
        // 0.1 + 0.2 is the canonical Double drift (== 0.30000000000000004). Stored
        // as separate SourcedNumbers and summed in Decimal, the parts stay exact
        // and serialize cleanly — no float artifacts in the bytes.
        var s = AppState.makeInitial()
        s.nodes[.Rent]?.data = .recurring(RecurringData(items: [
            RecurringItem(target: .manual(Decimal(string: "0.1")!), funded: .manual(Decimal(string: "0.1")!)),
            RecurringItem(target: .manual(Decimal(string: "0.2")!), funded: .manual(Decimal(string: "0.2")!)),
        ]))
        let data = try JSONCoder.encode(s)
        let json = String(decoding: data, as: UTF8.self)
        #expect(json.contains("0.1"))
        #expect(json.contains("0.2"))
        #expect(!json.contains("0.30000000000000004"))
        #expect(!json.contains("0.0999999"))

        let decoded = try JSONCoder.decode(data)
        let items = try #require(decoded.node(.Rent).data?.recurring?.items)
        let funded = items.reduce(Decimal(0)) { $0 + ($1.funded?.value ?? 0) }
        #expect(funded == Decimal(string: "0.3")!)            // exact, unlike 0.1 + 0.2 as Double
    }
}
