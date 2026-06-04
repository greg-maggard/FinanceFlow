import Foundation

/// Answer to a flowchart decision. Absence from the decisions map means "unanswered".
/// Mirrors the TS `Decision = "yes" | "no" | null` where `null`/absent == unanswered.
public enum Decision: String, Codable, Sendable, Hashable, CaseIterable {
    case yes
    case no
}

/// The ten yes/no questions that branch the flowchart.
/// Mirrors `DecisionId` in `src/state/schema.ts`.
public enum DecisionId: String, Codable, Sendable, Hashable, CaseIterable {
    case Q_Match
    case Q_HighDebt
    case Q_ModDebt
    case Q_Purchase
    case Q_15pct
    case Q_401k
    case Q_HSA
    case Q_College
    case Q_Early
    case Q_Goals
}

/// Provenance for a numeric value. `manual` is the only producer in MVP;
/// `plaid` / `ynab` exist so a future `BalanceProvider` can populate fields
/// without a schema change. Mirrors `Source` in `src/state/schema.ts`.
public enum Source: String, Codable, Sendable, Hashable {
    case manual
    case plaid
    case ynab

    /// Forward-compatible decode: an unrecognized source (e.g. a provider added in
    /// a newer build) falls back to `.manual` instead of throwing and failing the
    /// entire document load.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Source(rawValue: raw) ?? .manual
    }
}

/// Every node in the prime-directive flowchart. 22 tasks + 10 decisions.
/// Mirrors `NodeId` in `src/state/schema.ts` and the graph in `src/graph/flowchart.ts`.
public enum NodeId: String, Codable, Sendable, Hashable, CaseIterable {
    case Start
    case Rent
    case Food
    case Essential
    case Income
    case Health
    case MinDebt
    case SmallEF
    case NonEssential
    case BigEF
    case Q_Match
    case Match
    case Q_HighDebt
    case HighDebt
    case Q_ModDebt
    case ModDebt
    case IRA
    case Q_Purchase
    case SavePurchase
    case Q_15pct
    case Q_401k
    case Increase401k
    case SelfEmp
    case Q_HSA
    case HSA
    case Q_College
    case College
    case Options
    case Q_Early
    case Early
    case Q_Goals
    case Goals
}

// MARK: - CodingKey conformance
//
// Swift encodes `[Enum: Value]` dictionaries as a flat `[key, value, ...]`
// array unless the key type is `String`/`Int`. To round-trip the web's JSON
// object shape (`{ "Q_Match": "yes", ... }`, `{ "Rent": { ... } }`) we make
// these string enums usable as keyed-container coding keys.

extension NodeId: CodingKey {
    public var stringValue: String { rawValue }
    public init?(stringValue: String) { self.init(rawValue: stringValue) }
    public var intValue: Int? { nil }
    public init?(intValue: Int) { nil }
}

extension DecisionId: CodingKey {
    public var stringValue: String { rawValue }
    public init?(stringValue: String) { self.init(rawValue: stringValue) }
    public var intValue: Int? { nil }
    public init?(intValue: Int) { nil }
}
