import Foundation

/// Per-node tracking. Mirrors `NodeState` in `src/state/schema.ts`.
///
/// `data` cannot be decoded without knowing the node id (the payload has no
/// discriminator), so `NodeState` is `Encodable` but *not* `Decodable`; use
/// `decode(from:kind:)` instead. `AppState`'s decoder supplies the kind.
public struct NodeState: Equatable, Sendable, Encodable {
    public var completed: Bool
    public var completedAt: Date?
    public var notes: String
    public var data: NodeData?
    /// Keyed by `"YYYY-MM"`; presence of `true` marks a month checked in.
    public var monthlyChecks: [String: Bool]

    public init(
        completed: Bool = false,
        completedAt: Date? = nil,
        notes: String = "",
        data: NodeData? = nil,
        monthlyChecks: [String: Bool] = [:]
    ) {
        self.completed = completed
        self.completedAt = completedAt
        self.notes = notes
        self.data = data
        self.monthlyChecks = monthlyChecks
    }

    enum CodingKeys: String, CodingKey {
        case completed, completedAt, notes, data, monthlyChecks
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(completed, forKey: .completed)
        try c.encodeIfPresent(completedAt, forKey: .completedAt)
        try c.encode(notes, forKey: .notes)
        if !monthlyChecks.isEmpty {
            try c.encode(monthlyChecks, forKey: .monthlyChecks)
        }
        if let data {
            try data.encode(to: c.superEncoder(forKey: .data))
        }
    }

    /// Decode a node's state, using `kind` (from its `NodeId`) to interpret `data`.
    static func decode(from decoder: Decoder, kind: NodeDataKind) throws -> NodeState {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let completed = try c.decodeIfPresent(Bool.self, forKey: .completed) ?? false
        let completedAt = try c.decodeIfPresent(Date.self, forKey: .completedAt)
        let notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        let monthlyChecks = try c.decodeIfPresent([String: Bool].self, forKey: .monthlyChecks) ?? [:]

        var data: NodeData? = nil
        if c.contains(.data), try !c.decodeNil(forKey: .data) {
            data = try NodeData(from: c.superDecoder(forKey: .data), kind: kind)
        }

        return NodeState(
            completed: completed,
            completedAt: completedAt,
            notes: notes,
            data: data,
            monthlyChecks: monthlyChecks
        )
    }
}
