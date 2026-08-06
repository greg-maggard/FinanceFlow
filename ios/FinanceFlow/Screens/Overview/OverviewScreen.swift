import SwiftUI
import FinanceFlowKit

/// Progress dashboard: overall ring, per-phase bars, and a "next up" CTA.
/// Mirrors `src/components/OverviewSheet.tsx`.
struct OverviewScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    private var currentNode: GraphNode? {
        let status = store.status
        return Flowchart.graph.first { status[$0.id] == .current }
    }

    var body: some View {
        let progress = store.progress

        NavigationStack {
            ScrollView {
                VStack(spacing: theme.spacing.xl) {
                    overallCard(progress: progress)
                    if store.budget.target > .zero { budgetCard(store.budget) }
                    if let node = currentNode { nextUpCard(node) }
                    phasesCard
                }
                .padding(theme.spacing.lg)
            }
            .background(theme.materials.sheet)
            .scrollContentBackground(.hidden)
            .navigationTitle("Overview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(theme.colors.primary)
                }
            }
        }
    }

    private func overallCard(progress: Derive.Progress) -> some View {
        GlassCard {
            HStack(spacing: theme.spacing.xl) {
                ZStack {
                    ProgressRing(fraction: Double(progress.pct) / 100, color: theme.colors.primary, lineWidth: 6)
                        .frame(width: 84, height: 84)
                    Text("\(progress.pct)%")
                        .font(theme.typography.headline)
                        .foregroundStyle(theme.colors.textPrimary)
                }
                VStack(alignment: .leading, spacing: theme.spacing.xs) {
                    Text("Your journey")
                        .font(theme.typography.headline)
                        .foregroundStyle(theme.colors.textPrimary)
                    Text("\(progress.done) of \(progress.total) steps complete")
                        .font(theme.typography.callout)
                        .foregroundStyle(theme.colors.textSecondary)
                }
                Spacer()
            }
        }
    }

    private func budgetCard(_ budget: BudgetSummary) -> some View {
        let c = theme.phaseColor(.foundations)
        return GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                Text("Monthly budget")
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)
                GoalBar(value: Double(budget.funded.cents), max: Double(budget.target.cents), color: c.base)
                Text("Funded \(CurrencyFormat.string(budget.funded)) of \(CurrencyFormat.string(budget.target)) this month")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
            }
        }
    }

    private func nextUpCard(_ node: GraphNode) -> some View {
        let c = theme.phaseColor(node.phase)
        return GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                Chip(text: "Next up", color: c.base)
                Text(node.label)
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)
                if let sub = node.sublabel {
                    Text(sub)
                        .font(theme.typography.callout)
                        .foregroundStyle(theme.colors.textSecondary)
                }
            }
        }
    }

    private var phasesCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.md) {
                Text("Phases")
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)
                ForEach(Phase.allCases, id: \.self) { phase in
                    let c = theme.phaseColor(phase)
                    let p = Derive.phaseProgress(store.state, phase)
                    VStack(alignment: .leading, spacing: theme.spacing.xs) {
                        HStack {
                            Text(Flowchart.phaseLabels[phase] ?? "")
                                .font(theme.typography.callout)
                                .foregroundStyle(p.complete ? c.text : theme.colors.textSecondary)
                            Spacer()
                            Text(p.complete ? "✓" : "\(p.done)/\(p.total)")
                                .font(theme.typography.caption)
                                .foregroundStyle(c.text)
                        }
                        GoalBar(value: Double(p.done), max: Double(Swift.max(p.total, 1)), color: c.base, unit: .count)
                    }
                }
            }
        }
    }
}
