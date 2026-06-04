import SwiftUI
import Observation
import FinanceFlowKit

/// Drives the celebration overlay. Mirrors the `pendingCelebration` /
/// `pendingMedal` state in the web's `uiStore`.
@MainActor
@Observable
final class CelebrationCenter {
    var pendingNode: NodeId?
    var pendingNodeOnPath: Bool = false
    var pendingMedal: Phase?

    func celebrateNode(_ id: NodeId, onPath: Bool) {
        pendingNode = id
        pendingNodeOnPath = onPath
    }

    func celebrateMedal(_ phase: Phase) {
        pendingMedal = phase
    }

    func clearNode() { pendingNode = nil }
    func clearMedal() { pendingMedal = nil }
}

enum Celebrations {
    /// Run completion side-effects: fire the per-node bloom (once) and a phase
    /// medal when a phase's reachable tasks all finish. Call after a node's
    /// `completed` flips to true.
    @MainActor
    static func handleCompletion(of id: NodeId, store: AppStore, center: CelebrationCenter) {
        guard store.state.node(id).completed else { return }

        if !store.state.shownCelebrations.contains(id) {
            let onPath = store.status(of: id) == .done
            center.celebrateNode(id, onPath: onPath)
            store.markCelebrationShown(id)
        }

        let phase = Flowchart.node(id).phase
        let progress = Derive.phaseProgress(store.state, phase)
        if progress.complete, !store.state.earnedMedals.contains(phase.rawValue) {
            store.markMedalEarned(phase)
            center.celebrateMedal(phase)
        }
    }
}
