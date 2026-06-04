import Foundation

public extension Derive {
    struct PhaseProgress: Equatable, Sendable {
        public let phase: Phase
        public let done: Int
        public let total: Int
        public let complete: Bool
        public var fraction: Double { total == 0 ? 0 : Double(done) / Double(total) }
    }

    /// Completion of the *reachable* (non-skipped) tasks in a phase.
    /// Mirrors the `phaseProgress` computation in `src/components/PhaseTrail.tsx`.
    static func phaseProgress(_ state: AppState, _ phase: Phase) -> PhaseProgress {
        let status = status(state)
        let tasks = Flowchart.graph.filter { $0.phase == phase && $0.kind == .task }
        let reachable = tasks.filter { status[$0.id] != .skipped }
        let done = reachable.filter { state.node($0.id).completed }.count
        let total = reachable.count
        return PhaseProgress(
            phase: phase,
            done: done,
            total: total,
            complete: total > 0 && done == total
        )
    }

    static func allPhaseProgress(_ state: AppState) -> [PhaseProgress] {
        Phase.allCases.map { phaseProgress(state, $0) }
    }
}
