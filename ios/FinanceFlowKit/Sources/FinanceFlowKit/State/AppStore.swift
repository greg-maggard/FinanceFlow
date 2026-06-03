import Foundation
import Observation

/// The single source of truth for the running app. Holds `AppState`, exposes
/// mutation methods mirroring `src/state/store.ts`, and autosaves (debounced)
/// through a `StorageAdapter`. Derived values (`status`, `progress`) are pure
/// functions in `Derive`, recomputed on read.
@MainActor
@Observable
public final class AppStore {
    public private(set) var state: AppState

    @ObservationIgnored private let storage: StorageAdapter
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private let saveDebounce: Duration

    public init(
        state: AppState = .makeInitial(),
        storage: StorageAdapter = FileStorageAdapter(),
        saveDebounce: Duration = .milliseconds(500)
    ) {
        self.state = state
        self.storage = storage
        self.saveDebounce = saveDebounce
    }

    /// Load persisted state if present; otherwise keep the initial state.
    public func bootstrap() async {
        if let loaded = try? await storage.load() {
            state = IO.migrate(loaded)
        }
    }

    // MARK: - Derived (pure, recomputed on read)

    public var status: [NodeId: Status] { Derive.status(state) }
    public var progress: Derive.Progress { Derive.overallProgress(state) }
    public func status(of id: NodeId) -> Status { status[id] ?? .upcoming }

    // MARK: - Mutations (mirror store.ts)

    public func setDecision(_ id: DecisionId, _ value: Decision?) {
        mutate { $0.decisions[id] = value }
    }

    public func toggleComplete(_ id: NodeId) {
        mutate {
            var node = $0.nodes[id] ?? NodeState()
            let completed = !node.completed
            node.completed = completed
            node.completedAt = completed ? Date() : nil
            $0.nodes[id] = node
        }
    }

    public func setCompleted(_ id: NodeId, _ completed: Bool) {
        mutate {
            var node = $0.nodes[id] ?? NodeState()
            node.completed = completed
            node.completedAt = completed ? Date() : nil
            $0.nodes[id] = node
        }
    }

    public func setNotes(_ id: NodeId, _ notes: String) {
        mutate { $0.nodes[id, default: NodeState()].notes = notes }
    }

    public func setNodeData(_ id: NodeId, _ data: NodeData) {
        mutate { $0.nodes[id, default: NodeState()].data = data }
    }

    public func toggleMonthlyCheck(_ id: NodeId, _ ymKey: String) {
        mutate {
            var node = $0.nodes[id] ?? NodeState()
            let current = node.monthlyChecks[ymKey] ?? false
            if current {
                node.monthlyChecks[ymKey] = nil
            } else {
                node.monthlyChecks[ymKey] = true
            }
            $0.nodes[id] = node
        }
    }

    public func updateSettings(_ patch: (inout Settings) -> Void) {
        mutate { patch(&$0.settings) }
    }

    public func setCategoryMap(_ id: NodeId, _ categoryId: String?) {
        mutate {
            if let categoryId, !categoryId.isEmpty {
                $0.categoryMap[id] = categoryId
            } else {
                $0.categoryMap[id] = nil
            }
        }
    }

    /// Mark a node's completion celebration as shown (idempotent).
    public func markCelebrationShown(_ id: NodeId) {
        mutate {
            if !$0.shownCelebrations.contains(id) { $0.shownCelebrations.append(id) }
        }
    }

    /// Record that a phase medal has been earned (idempotent).
    public func markMedalEarned(_ phase: Phase) {
        mutate {
            if !$0.earnedMedals.contains(phase.rawValue) { $0.earnedMedals.append(phase.rawValue) }
        }
    }

    public func reset() {
        mutate { $0 = .makeInitial() }
    }

    public func replaceState(_ newState: AppState) {
        mutate { $0 = IO.migrate(newState) }
    }

    // MARK: - Save

    private func mutate(_ change: (inout AppState) -> Void) {
        change(&state)
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        let debounce = saveDebounce
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled, let self else { return }
            let snapshot = self.state
            try? await self.storage.save(snapshot)
        }
    }

    /// Force an immediate save (e.g. on scene background), bypassing the debounce.
    public func flush() async {
        saveTask?.cancel()
        try? await storage.save(state)
    }
}
