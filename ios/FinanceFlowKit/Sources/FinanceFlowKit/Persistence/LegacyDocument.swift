import Foundation

// MARK: - Pre-v4 documents (v1 / v2 / v3), decode-and-migrate only.
//
// EVERY money value in this file is DOLLARS-as-`Decimal`. It has to live in its
// own type tree rather than reusing the live models, because v3 and v4 spell the
// same field name with different units: `"amount": 33.335` is thirty-three
// dollars in a v3 document and would decode as thirty-three CENTS (or fail
// outright — `Money` is an integer) against the live `Txn`. One decode type per
// unit is the only way that stays honest.
//
// The v1 and v2 migrations are deliberately left running in dollars (D6): they
// are pinned by tests against documents that exist nowhere else, and re-deriving
// them in cents would change their output for no gain. The chain is
// v1 -> v2 -> v3 -> v4, and `Migration.v3ToV4` is the single place units change.
//
// Mirrors the `V3State` family in `src/state/io.ts`.

/// Dollars, as they appear in a v1/v2/v3 document. Never `Money`.
typealias LegacyDollars = Decimal

// MARK: Values

/// A number with provenance, in dollars. Mirrors the live `SourcedNumber`.
struct LegacySourcedNumber: Codable, Equatable, Sendable {
    var value: LegacyDollars
    var source: Source
    var lastSyncedAt: Date?

    init(value: LegacyDollars, source: Source = .manual, lastSyncedAt: Date? = nil) {
        self.value = value
        self.source = source
        self.lastSyncedAt = lastSyncedAt
    }

    static func manual(_ value: LegacyDollars) -> LegacySourcedNumber {
        LegacySourcedNumber(value: value, source: .manual)
    }
}

/// A single debt line in the pre-v3 HighDebt / ModDebt payoff list.
struct LegacyDebt: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var balance: LegacyDollars
    var apr: Decimal
    var minPayment: LegacyDollars
    var paid: Bool

    init(
        id: String = ShortID.make(),
        name: String = "",
        balance: LegacyDollars = 0,
        apr: Decimal = 0,
        minPayment: LegacyDollars = 0,
        paid: Bool = false
    ) {
        self.id = id
        self.name = name
        self.balance = balance
        self.apr = apr
        self.minPayment = minPayment
        self.paid = paid
    }
}

/// A near-term savings goal in the pre-v3 Goals node.
struct LegacyGoal: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var target: LegacyDollars
    var saved: LegacyDollars
    /// A horizon in years — a duration, not money.
    var horizonYears: Decimal

    init(
        id: String = ShortID.make(),
        name: String = "",
        target: LegacyDollars = 0,
        saved: LegacyDollars = 0,
        horizonYears: Decimal = 1
    ) {
        self.id = id
        self.name = name
        self.target = target
        self.saved = saved
        self.horizonYears = horizonYears
    }
}

/// A sub-line within a recurring budget node (e.g. "Power" under Essentials).
struct LegacyRecurringItem: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var target: LegacySourcedNumber
    var funded: LegacySourcedNumber?

    init(
        id: String = ShortID.make(),
        name: String = "",
        target: LegacySourcedNumber = .manual(0),
        funded: LegacySourcedNumber? = nil
    ) {
        self.id = id
        self.name = name
        self.target = target
        self.funded = funded
    }
}

/// Payload for the seven recurring budget nodes. Either a single target/funded
/// pair, or a list of `items` that aggregate.
struct LegacyRecurringData: Codable, Equatable, Sendable {
    var target: LegacySourcedNumber
    var funded: LegacySourcedNumber?
    var items: [LegacyRecurringItem]?

    init(
        target: LegacySourcedNumber = .manual(0),
        funded: LegacySourcedNumber? = nil,
        items: [LegacyRecurringItem]? = nil
    ) {
        self.target = target
        self.funded = funded
        self.items = items
    }
}

/// A named sub-goal within an emergency fund (e.g. "Medical", "Car", "Home").
struct LegacyEFBucket: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var target: LegacyDollars
    var balance: LegacySourcedNumber

    init(
        id: String = ShortID.make(),
        name: String = "",
        target: LegacyDollars = 0,
        balance: LegacySourcedNumber = .manual(0)
    ) {
        self.id = id
        self.name = name
        self.target = target
        self.balance = balance
    }
}

struct LegacySmallEFData: Codable, Equatable, Sendable {
    var balance: LegacySourcedNumber
    var items: [LegacyEFBucket]?

    init(balance: LegacySourcedNumber = .manual(0), items: [LegacyEFBucket]? = nil) {
        self.balance = balance
        self.items = items
    }
}

struct LegacyBigEFData: Codable, Equatable, Sendable {
    /// A month count, not money.
    var targetMonths: Int
    var balance: LegacySourcedNumber?
    var items: [LegacyEFBucket]?

    init(targetMonths: Int = 3, balance: LegacySourcedNumber? = nil, items: [LegacyEFBucket]? = nil) {
        self.targetMonths = targetMonths
        self.balance = balance
        self.items = items
    }
}

struct LegacyPurchaseGoal: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var target: LegacyDollars
    var saved: LegacySourcedNumber
    var byDate: String?

    init(
        id: String = ShortID.make(),
        name: String = "",
        target: LegacyDollars = 0,
        saved: LegacySourcedNumber = .manual(0),
        byDate: String? = nil
    ) {
        self.id = id
        self.name = name
        self.target = target
        self.saved = saved
        self.byDate = byDate
    }
}

struct LegacySavePurchaseData: Codable, Equatable, Sendable {
    var goalName: String
    var target: LegacyDollars
    var saved: LegacySourcedNumber
    var byDate: String?
    var items: [LegacyPurchaseGoal]?

    init(
        goalName: String = "",
        target: LegacyDollars = 0,
        saved: LegacySourcedNumber = .manual(0),
        byDate: String? = nil,
        items: [LegacyPurchaseGoal]? = nil
    ) {
        self.goalName = goalName
        self.target = target
        self.saved = saved
        self.byDate = byDate
        self.items = items
    }
}

struct LegacyIRAData: Codable, Equatable, Sendable {
    var type: IRAType
    var ytdContribution: LegacySourcedNumber
    var annualLimit: LegacyDollars
}

struct LegacyHSAData: Codable, Equatable, Sendable {
    var coverage: HSACoverage
    var ytdContribution: LegacySourcedNumber
    var annualLimit: LegacyDollars
}

struct LegacyCollegeData: Codable, Equatable, Sendable {
    var monthlyContribution: LegacyDollars
    var balance: LegacySourcedNumber?
    /// An age in years, not money.
    var targetAge: Int?
}

// MARK: Node payloads

/// The pre-v4 node payload union. Carries the wide v1/v2 shapes as well as the
/// six that survive into v3, all in dollars.
enum LegacyNodeData: Equatable, Sendable {
    case recurring(LegacyRecurringData)
    case smallEF(LegacySmallEFData)
    case bigEF(LegacyBigEFData)
    case match(matchPct: Decimal, currentContribPct: Decimal)
    case debts([LegacyDebt])
    case ira(LegacyIRAData)
    case savePurchase(LegacySavePurchaseData)
    case increase401k(currentPct: Decimal, targetPct: Decimal)
    case hsa(LegacyHSAData)
    case college(LegacyCollegeData)
    case goals([LegacyGoal])

    var recurring: LegacyRecurringData? { if case let .recurring(v) = self { return v } else { return nil } }
    var smallEF: LegacySmallEFData? { if case let .smallEF(v) = self { return v } else { return nil } }
    var bigEF: LegacyBigEFData? { if case let .bigEF(v) = self { return v } else { return nil } }
    var match: (matchPct: Decimal, currentContribPct: Decimal)? {
        if case let .match(m, c) = self { return (m, c) } else { return nil }
    }
    var debts: [LegacyDebt]? { if case let .debts(v) = self { return v } else { return nil } }
    var ira: LegacyIRAData? { if case let .ira(v) = self { return v } else { return nil } }
    var savePurchase: LegacySavePurchaseData? { if case let .savePurchase(v) = self { return v } else { return nil } }
    var increase401k: (currentPct: Decimal, targetPct: Decimal)? {
        if case let .increase401k(c, t) = self { return (c, t) } else { return nil }
    }
    var hsa: LegacyHSAData? { if case let .hsa(v) = self { return v } else { return nil } }
    var college: LegacyCollegeData? { if case let .college(v) = self { return v } else { return nil } }
    var goals: [LegacyGoal]? { if case let .goals(v) = self { return v } else { return nil } }
}

private enum LegacyMatchKeys: String, CodingKey { case matchPct, currentContribPct }
private enum LegacyDebtsKeys: String, CodingKey { case debts }
private enum LegacyIncrease401kKeys: String, CodingKey { case currentPct, targetPct }
private enum LegacyGoalsKeys: String, CodingKey { case items }

extension LegacyNodeData {
    /// The web JSON carries no discriminator — the node id dictates the shape —
    /// so decoding needs the kind supplied from outside, exactly as the live
    /// `NodeData` does.
    init?(from decoder: Decoder, kind: NodeDataKind) throws {
        switch kind {
        case .recurring:
            self = .recurring(try LegacyRecurringData(from: decoder))
        case .smallEF:
            self = .smallEF(try LegacySmallEFData(from: decoder))
        case .bigEF:
            self = .bigEF(try LegacyBigEFData(from: decoder))
        case .match:
            let c = try decoder.container(keyedBy: LegacyMatchKeys.self)
            self = .match(
                matchPct: try c.decode(Decimal.self, forKey: .matchPct),
                currentContribPct: try c.decode(Decimal.self, forKey: .currentContribPct)
            )
        case .debts:
            let c = try decoder.container(keyedBy: LegacyDebtsKeys.self)
            self = .debts(try c.decode([LegacyDebt].self, forKey: .debts))
        case .ira:
            self = .ira(try LegacyIRAData(from: decoder))
        case .savePurchase:
            self = .savePurchase(try LegacySavePurchaseData(from: decoder))
        case .increase401k:
            let c = try decoder.container(keyedBy: LegacyIncrease401kKeys.self)
            self = .increase401k(
                currentPct: try c.decode(Decimal.self, forKey: .currentPct),
                targetPct: try c.decode(Decimal.self, forKey: .targetPct)
            )
        case .hsa:
            self = .hsa(try LegacyHSAData(from: decoder))
        case .college:
            self = .college(try LegacyCollegeData(from: decoder))
        case .goals:
            let c = try decoder.container(keyedBy: LegacyGoalsKeys.self)
            self = .goals(try c.decode([LegacyGoal].self, forKey: .items))
        case .none:
            return nil
        }
    }
}

struct LegacyNodeState: Equatable, Sendable {
    var completed: Bool = false
    var completedAt: Date?
    var notes: String = ""
    var data: LegacyNodeData?
    var monthlyChecks: [String: Bool]?

    private enum CodingKeys: String, CodingKey {
        case completed, completedAt, notes, data, monthlyChecks
    }

    /// Decoded with the node's payload kind, mirroring `NodeState.decode`.
    static func decode(from decoder: Decoder, kind: NodeDataKind) throws -> LegacyNodeState {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var node = LegacyNodeState()
        node.completed = (try? c.decodeIfPresent(Bool.self, forKey: .completed)) as? Bool ?? false
        node.completedAt = (try? c.decodeIfPresent(Date.self, forKey: .completedAt)) as? Date
        node.notes = (try? c.decodeIfPresent(String.self, forKey: .notes)) as? String ?? ""
        node.monthlyChecks = (try? c.decodeIfPresent([String: Bool].self, forKey: .monthlyChecks)) as? [String: Bool]
        if c.contains(.data), (try? c.decodeNil(forKey: .data)) == false {
            // A single unreadable payload is dropped rather than failing the
            // whole document — same resilience the live decoder has.
            node.data = try? LegacyNodeData(from: c.superDecoder(forKey: .data), kind: kind)
        }
        return node
    }
}

// MARK: Budget book

struct LegacyAccount: Equatable, Sendable, Codable, Identifiable {
    var id: String
    var name: String
    var kind: AccountKind
    /// A rate, not money — never converted (D8).
    var apr: Decimal?
    var minPayment: LegacyDollars?
    var closed: Bool?
    var source: Source
    var plaidAccountId: String?
    var nodeId: NodeId?

    init(
        id: String,
        name: String = "",
        kind: AccountKind,
        apr: Decimal? = nil,
        minPayment: LegacyDollars? = nil,
        closed: Bool? = nil,
        source: Source = .manual,
        plaidAccountId: String? = nil,
        nodeId: NodeId? = nil
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.apr = apr
        self.minPayment = minPayment
        self.closed = closed
        self.source = source
        self.plaidAccountId = plaidAccountId
        self.nodeId = nodeId
    }
}

struct LegacyTxn: Equatable, Sendable, Codable, Identifiable {
    var id: String
    var accountId: String
    var date: String
    var payee: String?
    var amount: LegacyDollars
    var categoryId: String?
    var transferAccountId: String?
    var transferPairId: String?
    var memo: String?
    var source: Source
    var plaidTxnId: String?

    init(
        id: String = ShortID.make(),
        accountId: String,
        date: String,
        payee: String? = nil,
        amount: LegacyDollars,
        categoryId: String? = nil,
        transferAccountId: String? = nil,
        transferPairId: String? = nil,
        memo: String? = nil,
        source: Source = .manual,
        plaidTxnId: String? = nil
    ) {
        self.id = id
        self.accountId = accountId
        self.date = date
        self.payee = payee
        self.amount = amount
        self.categoryId = categoryId
        self.transferAccountId = transferAccountId
        self.transferPairId = transferPairId
        self.memo = memo
        self.source = source
        self.plaidTxnId = plaidTxnId
    }
}

struct LegacyCategory: Equatable, Sendable, Codable, Identifiable {
    var id: String
    var groupId: String
    var name: String
    var order: Int
    var monthlyTarget: LegacyDollars?
    var balanceTarget: LegacyDollars?
    var targetDate: String?
    var hidden: Bool?
    var nodeId: NodeId?

    init(
        id: String,
        groupId: String,
        name: String = "",
        order: Int = 0,
        monthlyTarget: LegacyDollars? = nil,
        balanceTarget: LegacyDollars? = nil,
        targetDate: String? = nil,
        hidden: Bool? = nil,
        nodeId: NodeId? = nil
    ) {
        self.id = id
        self.groupId = groupId
        self.name = name
        self.order = order
        self.monthlyTarget = monthlyTarget
        self.balanceTarget = balanceTarget
        self.targetDate = targetDate
        self.hidden = hidden
        self.nodeId = nodeId
    }
}

struct LegacyBudgetBook: Codable, Equatable, Sendable {
    var accounts: [LegacyAccount] = []
    var transactions: [LegacyTxn] = []
    var groups: [CategoryGroup] = []
    var categories: [LegacyCategory] = []
    var assignments: [String: [String: LegacyDollars]] = [:]
}

struct LegacySettings: Codable, Equatable, Sendable {
    var monthlyExpenses: LegacyDollars?
    var preTaxIncome: LegacyDollars?
    var iraAnnualLimit: LegacyDollars
    var hsaSelfLimit: LegacyDollars
    var hsaFamilyLimit: LegacyDollars

    static let `default` = LegacySettings(
        monthlyExpenses: nil,
        preTaxIncome: nil,
        iraAnnualLimit: 7000,
        hsaSelfLimit: 4300,
        hsaFamilyLimit: 8550
    )
}

// MARK: The document

/// A v1, v2 or v3 document. Decoding mirrors `AppState`'s custom coding
/// (keyed `decisions`/`nodes` containers, resilient per-node decode) so the same
/// files that used to load still load.
struct LegacyState: Equatable, Sendable {
    var version: Int
    var settings: LegacySettings
    var decisions: [DecisionId: Decision]
    var nodes: [NodeId: LegacyNodeState]
    var budget: LegacyBudgetBook
    var shownCelebrations: [NodeId]
    var earnedMedals: [Int]

    func node(_ id: NodeId) -> LegacyNodeState {
        nodes[id] ?? LegacyNodeState()
    }
}

extension LegacyState: Decodable {
    enum CodingKeys: String, CodingKey {
        case version, settings, decisions, nodes, budget, shownCelebrations, earnedMedals
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        settings = try c.decodeIfPresent(LegacySettings.self, forKey: .settings) ?? .default
        // Absent on v1 documents; a present-but-malformed book is a hard error
        // (the quarantine path preserves the file) rather than silent data loss.
        budget = try c.decodeIfPresent(LegacyBudgetBook.self, forKey: .budget) ?? LegacyBudgetBook()

        var decisions: [DecisionId: Decision] = [:]
        if c.contains(.decisions) {
            let dc = try c.nestedContainer(keyedBy: DecisionId.self, forKey: .decisions)
            for id in DecisionId.allCases where dc.contains(id) {
                if (try? dc.decodeNil(forKey: id)) == false,
                   let answer = try? dc.decode(Decision.self, forKey: id) {
                    decisions[id] = answer
                }
            }
        }
        self.decisions = decisions

        var nodes: [NodeId: LegacyNodeState] = [:]
        if c.contains(.nodes) {
            let nc = try c.nestedContainer(keyedBy: NodeId.self, forKey: .nodes)
            for id in NodeId.allCases where nc.contains(id) {
                if (try? nc.decodeNil(forKey: id)) == false,
                   let node = try? LegacyNodeState.decode(from: nc.superDecoder(forKey: id), kind: id.dataKind) {
                    nodes[id] = node
                }
            }
        }
        for id in NodeId.allCases where nodes[id] == nil { nodes[id] = LegacyNodeState() }
        self.nodes = nodes

        shownCelebrations = try c.decodeIfPresent([NodeId].self, forKey: .shownCelebrations) ?? []
        earnedMedals = try c.decodeIfPresent([Int].self, forKey: .earnedMedals) ?? []
        // v2 documents may still carry a `categoryMap` (retired with YNAB);
        // unknown keys are ignored on decode, so it simply drops here.
    }
}
