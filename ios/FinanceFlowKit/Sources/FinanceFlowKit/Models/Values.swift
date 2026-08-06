import Foundation

// MARK: - Money representation
//
// Money is `Money` (integer cents) end to end — see `Money.swift` for why, and
// for the single rounding rule that gets dollars into it. Rates and percentages
// (`Account.apr`, `matchPct`, `currentPct`, …) are NOT money and stay `Decimal`.
//
// Wire format: `Money` Codable-encodes as a bare JSON integer (e.g. `2290`),
// byte-identical to what the web's `Cents` fields produce — so the on-device
// JSON and export/import stay compatible with `src/state/schema.ts`. See
// `JSONWireFormatTests` for the round-trip proof.
//
// The wide pre-v3 payload shapes (recurring items, EF buckets, purchase goals,
// debt lists) are not part of the live model: they exist only to decode old
// documents, and live in `Persistence/LegacyDocument.swift` in dollars.

/// A number with provenance. `lastSyncedAt` is set when populated from an
/// external source. Mirrors `SourcedNumber` in `src/state/schema.ts`.
public struct SourcedNumber: Codable, Equatable, Sendable {
    public var value: Money
    public var source: Source
    public var lastSyncedAt: Date?

    public init(value: Money, source: Source = .manual, lastSyncedAt: Date? = nil) {
        self.value = value
        self.source = source
        self.lastSyncedAt = lastSyncedAt
    }

    /// Convenience for the common `{ value, source: .manual }` literal.
    public static func manual(_ value: Money) -> SourcedNumber {
        SourcedNumber(value: value, source: .manual)
    }
}

/// Payload for the BigEF node. Mirrors the `BigEF` shape in `NodeDataMap`:
/// a month count and nothing else — the live numbers come from the node's
/// linked ledger categories.
public struct BigEFData: Codable, Equatable, Sendable {
    public var targetMonths: Int

    public init(targetMonths: Int = 3) {
        self.targetMonths = targetMonths
    }
}

public enum IRAType: String, Codable, Sendable {
    case roth
    case traditional

    /// Forward-compatible decode: an unrecognized type falls back to `.roth`
    /// rather than failing the whole document load.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = IRAType(rawValue: raw) ?? .roth
    }
}

/// Payload for the IRA node. Mirrors the `IRA` shape in `NodeDataMap`.
public struct IRAData: Codable, Equatable, Sendable {
    public var type: IRAType
    public var ytdContribution: SourcedNumber
    public var annualLimit: Money

    public init(type: IRAType = .roth, ytdContribution: SourcedNumber = .manual(.zero), annualLimit: Money) {
        self.type = type
        self.ytdContribution = ytdContribution
        self.annualLimit = annualLimit
    }
}

public enum HSACoverage: String, Codable, Sendable {
    case `self`
    case family

    /// Forward-compatible decode: an unrecognized coverage falls back to `.self`
    /// rather than failing the whole document load.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = HSACoverage(rawValue: raw) ?? .`self`
    }
}

/// Payload for the HSA node. Mirrors the `HSA` shape in `NodeDataMap`.
public struct HSAData: Codable, Equatable, Sendable {
    public var coverage: HSACoverage
    public var ytdContribution: SourcedNumber
    public var annualLimit: Money

    public init(coverage: HSACoverage = .`self`, ytdContribution: SourcedNumber = .manual(.zero), annualLimit: Money) {
        self.coverage = coverage
        self.ytdContribution = ytdContribution
        self.annualLimit = annualLimit
    }
}

/// Payload for the College (529) node. Mirrors the `College` shape in
/// `NodeDataMap`: `monthlyContribution` is money, `targetAge` is an age.
/// The live balance is the `acct:college` tracking account.
public struct CollegeData: Codable, Equatable, Sendable {
    public var monthlyContribution: Money
    public var targetAge: Int?

    public init(monthlyContribution: Money = .zero, targetAge: Int? = nil) {
        self.monthlyContribution = monthlyContribution
        self.targetAge = targetAge
    }
}

/// Short, URL-safe random id matching the web app's `Math.random().toString(36).slice(2, 9)`.
public enum ShortID {
    public static func make() -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<7).map { _ in alphabet.randomElement()! })
    }
}
