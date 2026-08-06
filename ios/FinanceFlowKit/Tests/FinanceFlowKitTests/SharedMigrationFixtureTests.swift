import Testing
import Foundation
@testable import FinanceFlowKit

/// The cross-platform determinism test (money-migration-v4.md §7) — the keystone
/// deliverable of the v4 migration.
///
/// `fixtures/migration/v3-nasty.json` is a v3 document salted with every case
/// the two platforms could plausibly disagree on: `0.1`/`0.2` sums, `33.333`,
/// `33.335` (a value whose nearest double sits above the half), exactly
/// representable halves in both signs (`±0.125`), `-12.345` and `-1234.5`,
/// sub-cent assignments, a large balance (`1234567.89`), zero, missing
/// optionals, an uncategorized outflow, and both flavours of transfer.
///
/// `v4-expected.json` is its exact v4 image, generated once from the web
/// implementation and verified by hand against §4. THIS FILE IS THE CONTRACT:
/// the identical assertion runs in `src/state/io.test.ts`. If both platforms
/// migrate the same committed bytes to the same result, migration divergence
/// between them is impossible by construction.
@Suite("Cross-platform migration fixture (money-migration-v4.md §7)")
struct SharedMigrationFixtureTests {

    /// `<repo>/fixtures/migration/<name>` — resolved from this file's location
    /// so the test does not depend on the runner's working directory.
    private func fixture(_ name: String) throws -> Data {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }   // .../ios/FinanceFlowKit/Tests/FinanceFlowKitTests/<file>
        return try Data(contentsOf: url.appendingPathComponent("fixtures/migration/\(name)"))
    }

    @Test("migrating v3-nasty.json reproduces v4-expected.json field for field")
    func matchesTheCommittedContract() throws {
        let migrated = try IO.importJSON(try fixture("v3-nasty.json"))
        let expected = try IO.importJSON(try fixture("v4-expected.json"))

        #expect(migrated.version == 4)
        #expect(migrated == expected)
    }

    /// Model equality above compares two documents that both went through this
    /// platform's decoder. This one goes further and compares the *wire* image
    /// of the ledger — the subtree with no decoder backfill — against the bytes
    /// the web committed, so a unit slip cannot hide behind a shared decode.
    @Test("the migrated budget subtree matches the committed JSON byte-value for byte-value")
    func budgetSubtreeMatchesCommittedJSON() throws {
        let migrated = try IO.importJSON(try fixture("v3-nasty.json"))
        let encoded = try JSONCoder.encode(migrated)

        let actualDoc = try #require(
            try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        let expectedDoc = try #require(
            try JSONSerialization.jsonObject(with: try fixture("v4-expected.json")) as? [String: Any]
        )

        for key in ["budget", "settings"] {
            let actual = try #require(actualDoc[key] as? NSDictionary, "\(key)")
            let expected = try #require(expectedDoc[key] as? NSDictionary, "\(key)")
            #expect(actual == expected, "\(key) diverged from the committed v4 image")
        }
    }

    /// The §4 cases the fixture exists for, called out individually so a failure
    /// says *which* rule broke rather than "the documents differ".
    @Test("pins the hostile rounding cases the fixture was built around")
    func pinsTheHostileCases() throws {
        let out = try IO.importJSON(try fixture("v3-nasty.json"))
        let byID = Dictionary(uniqueKeysWithValues: out.budget.transactions.map { ($0.id, $0) })

        #expect(byID["t-tenth"]?.amount == Money(cents: 10))                 // 0.1
        #expect(byID["t-fifth"]?.amount == Money(cents: 20))                 // 0.2
        #expect(byID["t-third"]?.amount == Money(cents: 3333))               // 33.333
        // 33.335: the nearest double is fractionally ABOVE the decimal value,
        // so d * 100 is exactly 3333.5 and the half goes to +infinity.
        #expect(byID["t-half-below"]?.amount == Money(cents: 3334))
        // Exactly representable halves: both round toward +infinity, so the
        // negative one is -12, NOT -13 (that would be round-half-away-from-zero).
        #expect(byID["t-pos-exact-half"]?.amount == Money(cents: 13))        // 0.125
        #expect(byID["t-neg-exact-half"]?.amount == Money(cents: -12))       // -0.125
        #expect(byID["t-neg-third"]?.amount == Money(cents: -1234))          // -12.345
        #expect(byID["t-neg-big-half"]?.amount == Money(cents: -123_450))    // -1234.5
        #expect(byID["t-inflow"]?.amount == Money(cents: 123_456_789))       // 1234567.89
        #expect(byID["t-zero"]?.amount == Money.zero)

        // A sub-cent assignment becomes one cent, and can never be written again.
        #expect(out.budget.assignments["2026-05"]?["food"] == Money(cents: 1))
        #expect(out.budget.assignments["2026-06"]?["rent"] == Money(cents: 180_001))

        // Rates and counts are not money (D8) and ride through unscaled.
        #expect(out.budget.accounts.first { $0.id == "debt:visa" }?.apr == Decimal(string: "24.99")!)
        #expect(out.node(.College).data?.college?.targetAge == 18)
        #expect(out.node(.Match).data?.match?.matchPct == Decimal(string: "4.5")!)
    }

    /// The synthesis addition riding along with v4: after migration nothing is
    /// left outside the envelope system, so `drift == 0` becomes unconditional
    /// with `unbudgetedSpending` permanently zero.
    @Test("the migrated fixture has zero unbudgeted spending and zero drift")
    func integrityHoldsUnconditionally() throws {
        let out = try IO.importJSON(try fixture("v3-nasty.json"))
        for month in ["2026-05", "2026-06", "2026-07"] {
            let integrity = Ledger.bookIntegrity(out.budget, month: month)
            #expect(integrity.unbudgetedSpending == .zero, "\(month)")
            #expect(integrity.drift == .zero, "\(month)")
        }
    }
}
