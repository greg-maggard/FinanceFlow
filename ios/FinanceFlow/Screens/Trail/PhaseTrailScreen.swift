import SwiftUI
import FinanceFlowKit

/// Vertical, phase-grouped list view — the accessible / small-screen alternative
/// to the graph board. Mirrors `src/components/PhaseTrail.tsx`'s grouping.
struct PhaseTrailScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let onSelect: (NodeId) -> Void

    var body: some View {
        let status = store.status

        ScrollView {
            VStack(spacing: theme.spacing.xl) {
                ForEach(Phase.allCases, id: \.self) { phase in
                    phaseSection(phase, status: status)
                }
            }
            .padding(.horizontal, theme.spacing.lg)
            .padding(.top, 112)
            .padding(.bottom, 60)
        }
    }

    @ViewBuilder
    private func phaseSection(_ phase: Phase, status: [NodeId: Status]) -> some View {
        let c = theme.phaseColor(phase)
        let progress = Derive.phaseProgress(store.state, phase)
        let nodes = Flowchart.graph.filter { $0.phase == phase && status[$0.id] != .skipped }

        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            HStack {
                Chip(text: "Step \(phase.rawValue)", color: c.base)
                Text(Flowchart.phaseLabels[phase]?.components(separatedBy: ": ").last ?? "")
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)
                Spacer()
                if progress.total > 0 {
                    Text("\(progress.done)/\(progress.total)")
                        .font(theme.typography.caption)
                        .foregroundStyle(c.text)
                }
            }

            ForEach(nodes, id: \.id) { node in
                trailRow(node, status: status[node.id] ?? .upcoming, phase: c)
            }
        }
    }

    private func trailRow(_ node: GraphNode, status: Status, phase: PhaseColor) -> some View {
        let s = theme.style(for: status, phase: node.phase)
        let progress = progressOf(store.state, node.id)

        return Button { onSelect(node.id) } label: {
            GlassCard(padding: theme.spacing.md) {
                VStack(alignment: .leading, spacing: theme.spacing.sm) {
                    HStack(spacing: theme.spacing.sm) {
                        statusIcon(status, phase: phase)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(node.label)
                                .font(theme.typography.callout)
                                .foregroundStyle(s.text)
                                .multilineTextAlignment(.leading)
                            if node.kind == .decision, let decisionId = node.decisionId, let answer = store.state.decisions[decisionId] {
                                Text("Answered: \(answer.rawValue)")
                                    .font(theme.typography.caption)
                                    .foregroundStyle(theme.colors.textSecondary)
                            } else if let sub = node.sublabel {
                                Text(sub)
                                    .font(theme.typography.caption)
                                    .foregroundStyle(theme.colors.textTertiary)
                                    .lineLimit(1)
                            }
                        }
                        Spacer()
                    }
                    if case let .goal(value, max, unit, _) = progress {
                        GoalBar(value: value, max: max, color: phase.base, unit: .init(unit))
                    }
                }
            }
            .opacity(s.opacity)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func statusIcon(_ status: Status, phase: PhaseColor) -> some View {
        switch status {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(phase.base)
        case .current: Image(systemName: "circle.dotted").foregroundStyle(phase.base)
        case .upcoming: Image(systemName: "circle").foregroundStyle(theme.colors.textTertiary)
        case .skipped: Image(systemName: "minus.circle").foregroundStyle(theme.colors.textTertiary)
        }
    }
}
