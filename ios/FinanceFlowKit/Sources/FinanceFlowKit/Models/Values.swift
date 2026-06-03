import Foundation

/// A number with provenance. `lastSyncedAt` is set when populated from an
/// external source. Mirrors `SourcedNumber` in `src/state/schema.ts`.
public struct SourcedNumber: Codable, Equatable, Sendable {
    public var value: Double
    public var source: Source
    public var lastSyncedAt: Date?

    public init(value: Double, source: Source = .manual, lastSyncedAt: Date? = nil) {
        self.value = value
        self.source = source
        self.lastSyncedAt = lastSyncedAt
    }

    /// Convenience for the common `{ value, source: .manual }` literal.
    public static func manual(_ value: Double) -> SourcedNumber {
        SourcedNumber(value: value, source: .manual)
    }
}

/// A single debt line in the HighDebt / ModDebt payoff list.
/// Mirrors `Debt` in `src/state/schema.ts`.
public struct Debt: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var balance: Double
    public var apr: Double
    public var minPayment: Double
    public var paid: Bool

    public init(
        id: String = Self.newID(),
        name: String = "",
        balance: Double = 0,
        apr: Double = 0,
        minPayment: Double = 0,
        paid: Bool = false
    ) {
        self.id = id
        self.name = name
        self.balance = balance
        self.apr = apr
        self.minPayment = minPayment
        self.paid = paid
    }

    public static func newID() -> String { ShortID.make() }
}

/// A near-term savings goal in the final Goals node.
/// Mirrors `Goal` in `src/state/schema.ts`.
public struct Goal: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var target: Double
    public var saved: Double
    public var horizonYears: Double

    public init(
        id: String = ShortID.make(),
        name: String = "",
        target: Double = 0,
        saved: Double = 0,
        horizonYears: Double = 1
    ) {
        self.id = id
        self.name = name
        self.target = target
        self.saved = saved
        self.horizonYears = horizonYears
    }
}

/// A sub-line within a recurring budget node (e.g. "Power" under Essentials).
/// Mirrors `RecurringItem` in `src/state/schema.ts`.
public struct RecurringItem: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var target: SourcedNumber
    public var funded: SourcedNumber?

    public init(
        id: String = ShortID.make(),
        name: String = "",
        target: SourcedNumber = .manual(0),
        funded: SourcedNumber? = nil
    ) {
        self.id = id
        self.name = name
        self.target = target
        self.funded = funded
    }
}

/// Payload for the seven recurring budget nodes (Rent, Food, …, NonEssential).
/// Either a single target/funded pair, or a list of `items` that aggregate.
/// Mirrors `RecurringData` in `src/state/schema.ts`.
public struct RecurringData: Codable, Equatable, Sendable {
    public var target: SourcedNumber
    public var funded: SourcedNumber?
    public var items: [RecurringItem]?

    public init(
        target: SourcedNumber = .manual(0),
        funded: SourcedNumber? = nil,
        items: [RecurringItem]? = nil
    ) {
        self.target = target
        self.funded = funded
        self.items = items
    }
}

public enum IRAType: String, Codable, Sendable {
    case roth
    case traditional
}

/// Payload for the IRA node. Mirrors the `IRA` shape in `NodeDataMap`.
public struct IRAData: Codable, Equatable, Sendable {
    public var type: IRAType
    public var ytdContribution: SourcedNumber
    public var annualLimit: Double

    public init(type: IRAType = .roth, ytdContribution: SourcedNumber = .manual(0), annualLimit: Double) {
        self.type = type
        self.ytdContribution = ytdContribution
        self.annualLimit = annualLimit
    }
}

public enum HSACoverage: String, Codable, Sendable {
    case `self`
    case family
}

/// Payload for the HSA node. Mirrors the `HSA` shape in `NodeDataMap`.
public struct HSAData: Codable, Equatable, Sendable {
    public var coverage: HSACoverage
    public var ytdContribution: SourcedNumber
    public var annualLimit: Double

    public init(coverage: HSACoverage = .`self`, ytdContribution: SourcedNumber = .manual(0), annualLimit: Double) {
        self.coverage = coverage
        self.ytdContribution = ytdContribution
        self.annualLimit = annualLimit
    }
}

/// Payload for the SavePurchase node. Mirrors the `SavePurchase` shape in `NodeDataMap`.
public struct SavePurchaseData: Codable, Equatable, Sendable {
    public var goalName: String
    public var target: Double
    public var saved: SourcedNumber
    public var byDate: String?

    public init(goalName: String = "", target: Double = 0, saved: SourcedNumber = .manual(0), byDate: String? = nil) {
        self.goalName = goalName
        self.target = target
        self.saved = saved
        self.byDate = byDate
    }
}

/// Payload for the College (529) node. Mirrors the `College` shape in `NodeDataMap`.
public struct CollegeData: Codable, Equatable, Sendable {
    public var monthlyContribution: Double
    public var balance: SourcedNumber
    public var targetAge: Int?

    public init(monthlyContribution: Double = 0, balance: SourcedNumber = .manual(0), targetAge: Int? = nil) {
        self.monthlyContribution = monthlyContribution
        self.balance = balance
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
