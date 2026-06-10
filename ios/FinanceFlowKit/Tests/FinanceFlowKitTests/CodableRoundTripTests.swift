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

    @Test("rich state round-trips every NodeData case")
    func richRoundTrips() throws {
        var s = AppState.makeInitial()
        s.settings.monthlyExpenses = 3200
        s.settings.preTaxIncome = 90000
        s.decisions[.Q_Match] = .yes
        s.decisions[.Q_HighDebt] = .no

        s.nodes[.Start]?.completed = true
        s.nodes[.Start]?.completedAt = Date(timeIntervalSince1970: 1_700_000_000)
        s.nodes[.Rent]?.notes = "renters insurance via Lemonade"
        s.nodes[.Rent]?.data = .recurring(RecurringData(
            target: .manual(1800),
            funded: SourcedNumber(value: 1800, source: .manual),
            items: [RecurringItem(name: "Base rent", target: .manual(1500), funded: .manual(1500))]
        ))
        s.nodes[.Rent]?.monthlyChecks = ["2026-05": true, "2026-04": true]
        s.nodes[.SmallEF]?.data = .smallEF(SmallEFData(balance: .manual(1000)))
        s.nodes[.BigEF]?.data = .bigEF(BigEFData(targetMonths: 6, balance: .manual(9000), items: [
            EFBucket(name: "Car", target: 4000, balance: .manual(2500)),
            EFBucket(name: "Medical", target: 5000, balance: .manual(6500)),
        ]))
        s.nodes[.Match]?.data = .match(matchPct: 5, currentContribPct: 5)
        s.nodes[.HighDebt]?.data = .debts([
            // apr via Decimal(string:) — a `22.9` float literal would route through
            // Double and store 22.8999…986, which is exactly the drift we're removing.
            Debt(name: "Card", balance: 4200, apr: Decimal(string: "22.9")!, minPayment: 120, paid: false),
        ])
        s.nodes[.IRA]?.data = .ira(IRAData(type: .roth, ytdContribution: .manual(3500), annualLimit: 7000))
        s.nodes[.SavePurchase]?.data = .savePurchase(SavePurchaseData(goalName: "Car", target: 12000, saved: .manual(4000), byDate: "2027-01"))
        s.nodes[.Increase401k]?.data = .increase401k(currentPct: 8, targetPct: 15)
        s.nodes[.HSA]?.data = .hsa(HSAData(coverage: .family, ytdContribution: .manual(2000), annualLimit: 8550))
        s.nodes[.College]?.data = .college(CollegeData(monthlyContribution: 200, balance: .manual(5000), targetAge: 18))
        s.nodes[.Goals]?.data = .goals([Goal(name: "Vacation", target: 5000, saved: 1200, horizonYears: 2)])
        s.shownCelebrations = [.Start]
        s.earnedMedals = [0]
        s.categoryMap[.Rent] = "ynab-cat-123"

        let data = try JSONCoder.encode(s)
        let decoded = try JSONCoder.decode(data)
        #expect(decoded == s)
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
