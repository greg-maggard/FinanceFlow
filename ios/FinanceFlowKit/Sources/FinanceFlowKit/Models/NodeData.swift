import Foundation

/// The node-specific payload. This is the Swift mirror of the TS discriminated
/// type `NodeDataMap[NodeId]` in `src/state/schema.ts`.
///
/// Each case carries the same shape the web stores. Because the web JSON has no
/// discriminator field — the *node id* determines the shape — we cannot decode a
/// payload without knowing its node. So `NodeData` is encoded inline (raw shape,
/// matching the web byte-for-byte) and decoded via `init(from:kind:)`, where the
/// `kind` is supplied by `NodeId.dataKind`. `AppState`'s decoder wires this up.
public enum NodeData: Equatable, Sendable {
    case recurring(RecurringData)                                   // Rent, Food, Essential, Income, Health, MinDebt, NonEssential
    case smallEF(SmallEFData)                                       // SmallEF
    case bigEF(BigEFData)                                           // BigEF
    case match(matchPct: Decimal, currentContribPct: Decimal)       // Match
    case debts([Debt])                                              // HighDebt, ModDebt
    case ira(IRAData)                                               // IRA
    case savePurchase(SavePurchaseData)                             // SavePurchase
    case increase401k(currentPct: Decimal, targetPct: Decimal)      // Increase401k
    case hsa(HSAData)                                               // HSA
    case college(CollegeData)                                       // College
    case goals([Goal])                                             // Goals
}

/// The shape of payload a node carries, derived purely from its id.
public enum NodeDataKind {
    case recurring
    case smallEF
    case bigEF
    case match
    case debts
    case ira
    case savePurchase
    case increase401k
    case hsa
    case college
    case goals
    case none
}

public extension NodeId {
    /// Which `NodeData` case (if any) this node stores. `.none` for nodes that
    /// carry no structured data (Start, decisions, SelfEmp, Options, Early).
    var dataKind: NodeDataKind {
        switch self {
        case .Rent, .Food, .Essential, .Income, .Health, .MinDebt, .NonEssential:
            return .recurring
        case .SmallEF: return .smallEF
        case .BigEF: return .bigEF
        case .Match: return .match
        case .HighDebt, .ModDebt: return .debts
        case .IRA: return .ira
        case .SavePurchase: return .savePurchase
        case .Increase401k: return .increase401k
        case .HSA: return .hsa
        case .College: return .college
        case .Goals: return .goals
        default: return .none
        }
    }
}

// MARK: - Inline keyed shapes
//
// Cases whose payload is a small object (rather than a single Codable struct or
// array) need explicit keys so the encoded JSON matches the web exactly.

private enum MatchKeys: String, CodingKey { case matchPct, currentContribPct }
private enum DebtsKeys: String, CodingKey { case debts }
private enum Increase401kKeys: String, CodingKey { case currentPct, targetPct }
private enum GoalsKeys: String, CodingKey { case items }

extension NodeData {
    /// Decode a payload given the kind dictated by its node id.
    /// Returns `nil` for `.none` (the node carries no structured data).
    init?(from decoder: Decoder, kind: NodeDataKind) throws {
        switch kind {
        case .recurring:
            self = .recurring(try RecurringData(from: decoder))
        case .smallEF:
            self = .smallEF(try SmallEFData(from: decoder))
        case .bigEF:
            self = .bigEF(try BigEFData(from: decoder))
        case .match:
            let c = try decoder.container(keyedBy: MatchKeys.self)
            self = .match(
                matchPct: try c.decode(Decimal.self, forKey: .matchPct),
                currentContribPct: try c.decode(Decimal.self, forKey: .currentContribPct)
            )
        case .debts:
            let c = try decoder.container(keyedBy: DebtsKeys.self)
            self = .debts(try c.decode([Debt].self, forKey: .debts))
        case .ira:
            self = .ira(try IRAData(from: decoder))
        case .savePurchase:
            self = .savePurchase(try SavePurchaseData(from: decoder))
        case .increase401k:
            let c = try decoder.container(keyedBy: Increase401kKeys.self)
            self = .increase401k(
                currentPct: try c.decode(Decimal.self, forKey: .currentPct),
                targetPct: try c.decode(Decimal.self, forKey: .targetPct)
            )
        case .hsa:
            self = .hsa(try HSAData(from: decoder))
        case .college:
            self = .college(try CollegeData(from: decoder))
        case .goals:
            let c = try decoder.container(keyedBy: GoalsKeys.self)
            self = .goals(try c.decode([Goal].self, forKey: .items))
        case .none:
            return nil
        }
    }

    /// Encode the raw payload shape (no discriminator) to match the web JSON.
    func encode(to encoder: Encoder) throws {
        switch self {
        case let .recurring(data):
            try data.encode(to: encoder)
        case let .smallEF(data):
            try data.encode(to: encoder)
        case let .bigEF(data):
            try data.encode(to: encoder)
        case let .match(matchPct, currentContribPct):
            var c = encoder.container(keyedBy: MatchKeys.self)
            try c.encode(matchPct, forKey: .matchPct)
            try c.encode(currentContribPct, forKey: .currentContribPct)
        case let .debts(debts):
            var c = encoder.container(keyedBy: DebtsKeys.self)
            try c.encode(debts, forKey: .debts)
        case let .ira(data):
            try data.encode(to: encoder)
        case let .savePurchase(data):
            try data.encode(to: encoder)
        case let .increase401k(currentPct, targetPct):
            var c = encoder.container(keyedBy: Increase401kKeys.self)
            try c.encode(currentPct, forKey: .currentPct)
            try c.encode(targetPct, forKey: .targetPct)
        case let .hsa(data):
            try data.encode(to: encoder)
        case let .college(data):
            try data.encode(to: encoder)
        case let .goals(items):
            var c = encoder.container(keyedBy: GoalsKeys.self)
            try c.encode(items, forKey: .items)
        }
    }
}

// MARK: - Typed accessors
//
// Convenience for views/forms to read a case without an exhaustive switch.
public extension NodeData {
    var recurring: RecurringData? { if case let .recurring(v) = self { return v } else { return nil } }
    var smallEF: SmallEFData? { if case let .smallEF(v) = self { return v } else { return nil } }
    var bigEF: BigEFData? { if case let .bigEF(v) = self { return v } else { return nil } }
    var match: (matchPct: Decimal, currentContribPct: Decimal)? {
        if case let .match(m, c) = self { return (m, c) } else { return nil }
    }
    var debts: [Debt]? { if case let .debts(v) = self { return v } else { return nil } }
    var ira: IRAData? { if case let .ira(v) = self { return v } else { return nil } }
    var savePurchase: SavePurchaseData? { if case let .savePurchase(v) = self { return v } else { return nil } }
    var increase401k: (currentPct: Decimal, targetPct: Decimal)? {
        if case let .increase401k(c, t) = self { return (c, t) } else { return nil }
    }
    var hsa: HSAData? { if case let .hsa(v) = self { return v } else { return nil } }
    var college: CollegeData? { if case let .college(v) = self { return v } else { return nil } }
    var goals: [Goal]? { if case let .goals(v) = self { return v } else { return nil } }
}
