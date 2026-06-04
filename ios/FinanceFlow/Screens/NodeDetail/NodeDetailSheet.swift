import SwiftUI
import FinanceFlowKit

/// Per-node detail + editing. Header, decision answer or completion controls,
/// the node-specific form, monthly check-in, and notes.
struct NodeDetailSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(CelebrationCenter.self) private var celebration
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let nodeId: NodeId

    private var graphNode: GraphNode { Flowchart.node(nodeId) }

    var body: some View {
        let node = graphNode
        let phase = theme.phaseColor(node.phase)
        let status = store.status(of: nodeId)

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.lg) {
                    header(node: node, phase: phase, status: status)

                    if node.kind == .decision {
                        decisionControl(node: node, phase: phase)
                    } else {
                        taskBody(node: node, phase: phase)
                    }
                }
                .padding(theme.spacing.lg)
            }
            .background(theme.materials.sheet)
            .scrollContentBackground(.hidden)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(theme.colors.primary)
                }
            }
        }
    }

    // MARK: - Header

    private func header(node: GraphNode, phase: PhaseColor, status: Status) -> some View {
        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            HStack {
                Chip(text: Flowchart.phaseLabels[node.phase]?.components(separatedBy: ":").first ?? "", color: phase.base)
                StatusPill(status: status, phase: phase)
            }
            Text(node.label)
                .font(theme.typography.title)
                .foregroundStyle(theme.colors.textPrimary)
            if let sub = node.sublabel {
                Text(sub)
                    .font(theme.typography.callout)
                    .foregroundStyle(theme.colors.textSecondary)
            }
            if store.state.node(nodeId).completed, let affirmation = nodeIdentity[nodeId] {
                Text(affirmation)
                    .font(theme.typography.callout)
                    .foregroundStyle(phase.text)
                    .padding(.top, theme.spacing.xs)
            }
        }
    }

    // MARK: - Decision

    private func decisionControl(node: GraphNode, phase: PhaseColor) -> some View {
        let id = node.decisionId
        let current = id.flatMap { store.state.decisions[$0] }
        return VStack(alignment: .leading, spacing: theme.spacing.md) {
            FieldLabel(text: "Your answer")
            HStack(spacing: theme.spacing.md) {
                ForEach(Decision.allCases, id: \.self) { option in
                    Button {
                        if let id { store.setDecision(id, current == option ? nil : option) }
                    } label: {
                        Text(option.rawValue.capitalized)
                            .font(theme.typography.callout)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, theme.spacing.md)
                            .background(
                                current == option ? AnyShapeStyle(phase.tint) : AnyShapeStyle(theme.colors.surface),
                                in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous)
                                    .strokeBorder(current == option ? phase.base : theme.colors.stroke, lineWidth: current == option ? 2 : 1)
                            )
                            .foregroundStyle(current == option ? phase.text : theme.colors.textSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            notesEditor
        }
    }

    // MARK: - Task

    private func taskBody(node: GraphNode, phase: PhaseColor) -> some View {
        let progress = progressOf(store.state, nodeId)
        return VStack(alignment: .leading, spacing: theme.spacing.lg) {
            if case let .goal(value, max, ready) = progress, max > 0 {
                VStack(alignment: .leading, spacing: theme.spacing.xs) {
                    GoalBar(value: value, max: max, color: phase.base)
                    if ready {
                        Text("Goal reached — ready to mark complete.")
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.success)
                    }
                }
            }

            NodeForm(nodeId: nodeId)

            if recurringNodes.contains(nodeId) {
                MonthlyCheckInRow(nodeId: nodeId)
            }

            notesEditor
            completeButton(phase: phase)
        }
    }

    private func completeButton(phase: PhaseColor) -> some View {
        let completed = store.state.node(nodeId).completed
        return GlassButton(
            title: completed ? "Completed" : "Mark complete",
            systemImage: completed ? "checkmark.circle.fill" : "circle",
            tint: completed ? theme.colors.success : phase.base,
            filled: completed
        ) {
            store.toggleComplete(nodeId)
            Celebrations.handleCompletion(of: nodeId, store: store, center: celebration)
        }
    }

    private var notesEditor: some View {
        LabeledField(label: "Notes") {
            TextField(
                "Add a note…",
                text: Binding(
                    get: { store.state.node(nodeId).notes },
                    set: { store.setNotes(nodeId, $0) }
                ),
                axis: .vertical
            )
            .lineLimit(2...5)
            .font(theme.typography.body)
            .foregroundStyle(theme.colors.textPrimary)
            .padding(theme.spacing.md)
            .background(theme.colors.surface, in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous).strokeBorder(theme.colors.stroke, lineWidth: 1))
        }
    }
}

private struct StatusPill: View {
    @Environment(\.theme) private var theme
    let status: Status
    let phase: PhaseColor

    var body: some View {
        let (label, color): (String, Color) = {
            switch status {
            case .current: return ("Current", phase.base)
            case .done: return ("Done", theme.colors.success)
            case .upcoming: return ("Upcoming", theme.colors.textSecondary)
            case .skipped: return ("Skipped", theme.colors.textTertiary)
            }
        }()
        return Chip(text: label, color: color)
    }
}
