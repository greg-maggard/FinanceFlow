import Foundation

/// The whole persisted document. Mirrors `AppState` in `src/state/schema.ts`.
///
/// `decisions` and `nodes` are encoded/decoded through keyed containers
/// (rather than Swift's default `[Enum: V]` array form) so the JSON is the
/// same object shape the web reads and writes.
public struct AppState: Equatable, Sendable {
    public var version: Int
    public var settings: Settings
    /// Absence of a key == unanswered (web stores explicit `null`; we omit).
    public var decisions: [DecisionId: Decision]
    public var nodes: [NodeId: NodeState]
    /// The zero-based envelope core. Empty on documents migrated from v1
    /// builds until `IO.migrate` seeds it.
    public var budget: BudgetBook
    public var shownCelebrations: [NodeId]
    public var earnedMedals: [Int]

    public init(
        version: Int = 3,
        settings: Settings,
        decisions: [DecisionId: Decision],
        nodes: [NodeId: NodeState],
        budget: BudgetBook = BudgetBook(),
        shownCelebrations: [NodeId] = [],
        earnedMedals: [Int] = []
    ) {
        self.version = version
        self.settings = settings
        self.decisions = decisions
        self.nodes = nodes
        self.budget = budget
        self.shownCelebrations = shownCelebrations
        self.earnedMedals = earnedMedals
    }

    /// Fresh state: every node present and empty, every decision unanswered.
    /// Mirrors `makeInitialState`.
    public static func makeInitial() -> AppState {
        var nodes: [NodeId: NodeState] = [:]
        for id in NodeId.allCases { nodes[id] = NodeState() }
        return AppState(
            version: 3,
            settings: .default,
            decisions: [:],
            nodes: nodes,
            budget: BudgetBook(),
            shownCelebrations: [],
            earnedMedals: []
        )
    }

    public func node(_ id: NodeId) -> NodeState {
        nodes[id] ?? NodeState()
    }
}

// MARK: - Codable

extension AppState: Codable {
    enum CodingKeys: String, CodingKey {
        case version, settings, decisions, nodes, budget, shownCelebrations, earnedMedals
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        settings = try c.decodeIfPresent(Settings.self, forKey: .settings) ?? .default
        // Absent on v1 documents; a present-but-malformed book is a hard error
        // (the quarantine path preserves the file) rather than silent data loss.
        budget = try c.decodeIfPresent(BudgetBook.self, forKey: .budget) ?? BudgetBook()

        // decisions: { "Q_Match": "yes" | null, ... } — null/absent == unanswered.
        var decisions: [DecisionId: Decision] = [:]
        if c.contains(.decisions) {
            let dc = try c.nestedContainer(keyedBy: DecisionId.self, forKey: .decisions)
            for id in DecisionId.allCases where dc.contains(id) {
                // Unanswered (null) or an unrecognized value is left absent rather
                // than failing the entire document.
                if (try? dc.decodeNil(forKey: id)) == false,
                   let answer = try? dc.decode(Decision.self, forKey: id) {
                    decisions[id] = answer
                }
            }
        }
        self.decisions = decisions

        // nodes: each value's `data` is decoded using the node's dataKind.
        var nodes: [NodeId: NodeState] = [:]
        if c.contains(.nodes) {
            let nc = try c.nestedContainer(keyedBy: NodeId.self, forKey: .nodes)
            for id in NodeId.allCases where nc.contains(id) {
                // A single unreadable node is skipped (and backfilled below) rather
                // than failing the entire document load.
                if (try? nc.decodeNil(forKey: id)) == false,
                   let node = try? NodeState.decode(from: nc.superDecoder(forKey: id), kind: id.dataKind) {
                    nodes[id] = node
                }
            }
        }
        // Backfill any missing or unreadable nodes so the rest of the app can assume presence.
        for id in NodeId.allCases where nodes[id] == nil { nodes[id] = NodeState() }
        self.nodes = nodes

        shownCelebrations = try c.decodeIfPresent([NodeId].self, forKey: .shownCelebrations) ?? []
        earnedMedals = try c.decodeIfPresent([Int].self, forKey: .earnedMedals) ?? []
        // v2 documents may still carry a `categoryMap` (retired with YNAB);
        // unknown keys are ignored on decode, so it simply drops here.
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encode(settings, forKey: .settings)
        try c.encode(budget, forKey: .budget)

        // Write all ten decision keys (null when unanswered) to match the web.
        var dc = c.nestedContainer(keyedBy: DecisionId.self, forKey: .decisions)
        for id in DecisionId.allCases {
            if let answer = decisions[id] {
                try dc.encode(answer, forKey: id)
            } else {
                try dc.encodeNil(forKey: id)
            }
        }

        var nc = c.nestedContainer(keyedBy: NodeId.self, forKey: .nodes)
        for id in NodeId.allCases {
            let state = nodes[id] ?? NodeState()
            try state.encode(to: nc.superEncoder(forKey: id))
        }

        try c.encode(shownCelebrations, forKey: .shownCelebrations)
        try c.encode(earnedMedals, forKey: .earnedMedals)
    }
}
