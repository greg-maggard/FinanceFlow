import Testing
import Foundation
@testable import FinanceFlowKit

/// The `Money.fromDollars` clamp at the `Int` boundary.
///
/// The guard exists so a hostile or corrupt document can never trap the
/// process — a trap is not catchable, so it would bypass every `catch` in
/// `AppStore.bootstrap` and crash-loop the app at launch on a document we are
/// contractually not allowed to destroy. It used to have a hole at exactly its
/// own upper bound: `Double(Int.max)` rounds UP to 2⁶³, so `scaled <=
/// Double(Int.max)` admitted a value `Int(_:)` cannot represent.
@Suite("Money.fromDollars bounds")
struct MoneyBoundsTests {

    /// The premise, stated as an assertion so the fix can't silently rot if
    /// the conversion's rounding ever changes: `Double(Int.max)` is NOT
    /// `Int.max`.
    @Test("Double(Int.max) rounds up past Int.max; Double(Int.min) is exact")
    func boundaryDoublesAreAsymmetric() {
        #expect(Double(Int.max) == 9_223_372_036_854_775_808.0)   // 2⁶³, one past Int.max
        #expect(Double(Int.max) > Double(Int.max).nextDown)
        #expect(Double(Int.min) == -9_223_372_036_854_775_808.0)  // exactly Int.min
        #expect(Int(Double(Int.min)) == Int.min)                  // and convertible
    }

    /// The reviewer's repro. `92233720368547758.08 * 100 + 0.5` lands on
    /// exactly 2⁶³ in IEEE-754 double — inside the old `<=` guard, outside
    /// `Int`. This must clamp, not trap.
    @Test("the 2⁶³ boundary dollar amount clamps to zero instead of trapping")
    func exactlyTwoToTheSixtyThirdClamps() {
        let scaled = (92_233_720_368_547_758.08 * 100 + 0.5).rounded(.down)
        #expect(scaled == Double(Int.max))                        // the hole, reproduced
        #expect(Money.fromDollars(92_233_720_368_547_758.08) == .zero)
    }

    @Test("values on both sides of the boundary clamp or convert as appropriate")
    func neighboursOfTheBoundary() {
        // Everything at or beyond 2⁶³ cents clamps.
        #expect(Money.fromDollars(Double.infinity) == .zero)
        #expect(Money.fromDollars(-Double.infinity) == .zero)
        #expect(Money.fromDollars(Double.nan) == .zero)
        #expect(Money.fromDollars(1e17) == .zero)                 // 1e19 cents
        #expect(Money.fromDollars(-1e17) == .zero)

        // A huge amount that still lands inside Int is NOT clamped — the
        // tightened bound narrows the guard by one value, not by a range.
        // 9e16 dollars is 9e18 cents, exactly representable and < 2⁶³.
        #expect(Money.fromDollars(9e16) == Money(cents: 9_000_000_000_000_000_000))

        // Ordinary amounts are untouched by the tightened bound.
        #expect(Money.fromDollars(12.34) == Money(cents: 1234))
        #expect(Money.fromDollars(-12.345) == Money(cents: -1234))
    }

    /// End-to-end: the same value inside a v3 document has to come out of the
    /// real import/migrate path as a normal (clamped) value. Before the fix
    /// this killed the process with SIGTRAP *before* `bootstrap`'s catch.
    @Test("a v3 document carrying the boundary amount imports instead of trapping")
    func hostileV3DocumentImports() throws {
        let raw = """
        {
          "version": 3,
          "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": {},
          "nodes": {},
          "budget": {
            "accounts": [{ "id": "checking", "name": "Checking", "kind": "checking", "source": "manual" }],
            "transactions": [
              { "id": "t1", "accountId": "checking", "date": "2026-06-01",
                "amount": 92233720368547758.08, "categoryId": "rta", "source": "manual" }
            ],
            "groups": [], "categories": [], "assignments": {}
          }
        }
        """
        let state = try IO.importString(raw)
        #expect(state.version == 4)
        #expect(state.budget.transactions.first?.amount == .zero)
        #expect(Ledger.accountBalance(state.budget, "checking") == .zero)
    }

    /// The same hostile document through `AppStore.bootstrap`: it must reach a
    /// normal, catchable outcome (here: a clean boot with the amount clamped)
    /// rather than killing the process before any handler runs.
    @MainActor
    @Test("bootstrap survives the boundary amount")
    func bootstrapSurvives() async throws {
        let raw = """
        {"version": 3,
         "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
         "decisions": {}, "nodes": {},
         "budget": { "accounts": [], "categories": [], "groups": [],
           "transactions": [],
           "assignments": { "2026-06": { "food": 92233720368547758.08 } } }}
        """
        let store = AppStore(storage: MemoryStorageAdapter(rawJSON: raw), saveDebounce: .milliseconds(10))
        await store.bootstrap()
        #expect(store.state.version == 4)
        #expect(store.state.budget.assignments["2026-06"]?["food"] == .zero)
    }
}
