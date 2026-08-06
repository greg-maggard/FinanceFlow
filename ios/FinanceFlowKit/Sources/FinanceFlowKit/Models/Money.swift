import Foundation

/// Integer cents — the v4 money representation, on the wire and in memory.
///
/// Before v4, money was `Decimal` here and dollars-as-`number` on the web, and
/// each platform defended itself against float drift differently: the web
/// rounded every operand to cents at each arithmetic site, iOS compared exact
/// `Decimal`s. Nothing stopped either input field from persisting a sub-cent
/// amount, so one document could legitimately produce different `ready` flags
/// on the two platforms (`33.33 >= 33.333` is false in exact decimal, true once
/// both sides are rounded to cents). Integer cents make sub-cent states
/// unrepresentable: the platforms agree by construction rather than by
/// discipline. See `Docs/money-migration-v4.md`.
///
/// Codable as a **bare JSON integer** (`3333`), byte-identical to what the
/// web's `Cents` fields produce — see `JSONWireFormatTests`.
///
/// Deliberately NOT `ExpressibleByIntegerLiteral`: `let target: Money = 1000`
/// reads as a thousand dollars and means ten. Every construction is explicit.
public struct Money: Hashable, Codable, Comparable, AdditiveArithmetic, Sendable {
    public var cents: Int

    public init(cents: Int) {
        self.cents = cents
    }

    // MARK: Codable — a bare integer, not an object.

    public init(from decoder: Decoder) throws {
        cents = try decoder.singleValueContainer().decode(Int.self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(cents)
    }

    // MARK: Arithmetic
    //
    // Money + Money and Money - Money are meaningful; Money × Money is not, so
    // there is deliberately no `*` or `/` on two amounts. Scaling by a plain
    // count (months × monthly expenses) goes through `scaled(by:)`.

    public static let zero = Money(cents: 0)

    public static func + (a: Money, b: Money) -> Money { Money(cents: a.cents + b.cents) }
    public static func - (a: Money, b: Money) -> Money { Money(cents: a.cents - b.cents) }
    public static prefix func - (m: Money) -> Money { Money(cents: -m.cents) }
    public static func < (a: Money, b: Money) -> Bool { a.cents < b.cents }

    /// `self` repeated `count` times — integer-exact, no rounding.
    public func scaled(by count: Int) -> Money { Money(cents: cents * count) }

    public var magnitude: Money { Money(cents: abs(cents)) }

    /// True when the amount is a whole number of dollars (formatting hook).
    public var isWholeDollars: Bool { cents % 100 == 0 }

    // MARK: Display

    /// Exact dollar value, for formatters only — never for arithmetic.
    public var decimalDollars: Decimal { Decimal(cents) / 100 }

    /// Lossy dollar value for views that animate or draw in `Double`.
    public var doubleDollars: Double { Double(cents) / 100 }

    // MARK: The one rounding rule (money-migration-v4.md §4)

    /// `cents(d) = floor(d * 100 + 0.5)`, evaluated in **IEEE-754 double**.
    ///
    /// Double, not `Decimal`, and that is the whole point. The web can only ever
    /// see the double image of a JSON number, and JSON-number → nearest-double
    /// is identical on every platform. Rounding the exact `Decimal` here instead
    /// would diverge on values sitting near a half cent, which is precisely the
    /// class of value this migration exists to eliminate. Routing both platforms
    /// through double makes the conversion bit-identical by construction.
    ///
    /// A half cent goes toward +infinity on both platforms, so -12.345 dollars
    /// becomes -1234 cents, not -1235. Do NOT substitute
    /// `NSDecimalRound(.plain)` or `.toNearestOrAwayFromZero`, which round half
    /// away from zero. `MigrationTests` and the shared §7 fixture pin this.
    public static func fromDollars(_ dollars: Double) -> Money {
        let scaled = (dollars * 100 + 0.5).rounded(.down)
        // A JSON document cannot spell NaN or Infinity, but it CAN spell a
        // literal too large for a double (`1e400` parses as Infinity), and an
        // unguarded `Int(...)` conversion TRAPS on those — a crash loop at
        // launch on a document we are contractually not allowed to destroy.
        // Clamp instead; the web mirror clamps to the same zero.
        guard scaled.isFinite, scaled >= Double(Int.min), scaled <= Double(Int.max) else {
            return .zero
        }
        return Money(cents: Int(scaled))
    }

    /// The same rule, entered from an exact `Decimal` (a typed input field, or a
    /// dollars-denominated value read out of a pre-v4 document).
    public static func fromDollars(_ dollars: Decimal) -> Money {
        fromDollars(NSDecimalNumber(decimal: dollars).doubleValue)
    }

    /// What a number field commits. Named for the call site so the parse
    /// boundary is greppable; identical rule to the migration by construction.
    public static func fromUserInput(_ dollars: Decimal) -> Money {
        fromDollars(dollars)
    }
}
