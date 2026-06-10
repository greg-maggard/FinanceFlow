import SwiftUI
import FinanceFlowKit

enum BoardMode: String, CaseIterable {
    case graph
    case trail
    case budget

    var icon: String {
        switch self {
        case .graph: return "point.3.connected.trianglepath.dotted"
        case .trail: return "list.bullet.indent"
        case .budget: return "dollarsign.circle"
        }
    }

    var label: String {
        switch self {
        case .graph: return "Map"
        case .trail: return "Trail"
        case .budget: return "Budget"
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(CelebrationCenter.self) private var celebration
    @Environment(\.theme) private var theme

    @State private var mode: BoardMode = .graph
    @State private var selectedNode: NodeId?
    @State private var showOverview = false
    @State private var showSettings = false

    private var activePhase: Phase {
        let status = store.status
        return Flowchart.graph.first { status[$0.id] == .current }?.phase ?? .foundations
    }

    var body: some View {
        ZStack {
            AmbientBackground(phase: activePhase)
                .ignoresSafeArea()

            Group {
                switch mode {
                case .graph:
                    // The pill grows a row when a budget is set; keep the board clear of it.
                    GraphScreen(topInset: showBudgetRow ? 128 : 96, onSelect: { selectedNode = $0 })
                case .trail:
                    PhaseTrailScreen(onSelect: { selectedNode = $0 })
                case .budget:
                    // Mirror Trail's 112pt clearance under the floating bar, plus
                    // the same +32 the graph gets when the budget pill row shows.
                    BudgetScreen(topInset: showBudgetRow ? 144 : 112)
                }
            }
            .transition(.opacity)

            VStack {
                topBar
                Spacer()
            }
        }
        .sheet(item: $selectedNode) { id in
            NodeDetailSheet(nodeId: id)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showOverview) {
            OverviewScreen()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showSettings) {
            SettingsScreen()
                .presentationDragIndicator(.visible)
        }
        .overlay {
            CelebrationOverlay()
                .allowsHitTesting(celebration.pendingMedal != nil)
        }
        .alert("Couldn’t load saved data", isPresented: Binding(
            get: { store.loadError != nil },
            set: { if !$0 { store.dismissLoadError() } }
        )) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(store.loadError ?? "")
        }
    }

    private var showBudgetRow: Bool { store.budget.target > 0 }

    private var topBar: some View {
        let progress = store.progress
        return VStack(spacing: theme.spacing.sm) {
            HStack(spacing: theme.spacing.sm) {
                Button {
                    showOverview = true
                } label: {
                    HStack(spacing: theme.spacing.sm) {
                        ProgressRing(fraction: Double(progress.pct) / 100, color: theme.phaseColor(activePhase).base)
                            .frame(width: 26, height: 26)
                        VStack(alignment: .leading, spacing: 0) {
                            Text("FinanceFlow")
                                .font(theme.typography.headline)
                                .foregroundStyle(theme.colors.textPrimary)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                            Text("\(progress.done)/\(progress.total) · \(progress.pct)%")
                                .font(theme.typography.caption)
                                .foregroundStyle(theme.colors.textSecondary)
                        }
                    }
                }
                .buttonStyle(.plain)

                Spacer()

                ModeSwitcher(mode: $mode)

                GlassIconButton(systemName: "gearshape.fill") { showSettings = true }
            }
            if showBudgetRow {
                budgetRow(store.budget)
            }
        }
        .padding(.horizontal, theme.spacing.lg)
        .padding(.vertical, theme.spacing.md)
        .background(
            theme.materials.overlay,
            in: RoundedRectangle(cornerRadius: theme.radii.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.radii.lg, style: .continuous)
                .strokeBorder(theme.colors.stroke, lineWidth: 1)
        )
        .padding(.horizontal, theme.spacing.md)
    }

    /// Compact dollar rollup of the monthly budget (the seven recurring nodes).
    private func budgetRow(_ budget: BudgetSummary) -> some View {
        let fraction = budget.target > 0 ? min(1, (budget.funded / budget.target).displayDouble) : 0
        return VStack(alignment: .leading, spacing: theme.spacing.xs) {
            HStack {
                Text("Monthly budget")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
                Spacer()
                Text("\(CurrencyFormat.string(budget.funded)) of \(CurrencyFormat.string(budget.target))")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textPrimary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.colors.surface)
                    Capsule()
                        .fill(theme.phaseColor(.foundations).base)
                        .frame(width: geo.size.width * fraction)
                        .animation(theme.motion.bar, value: fraction)
                }
            }
            .frame(height: 4)
        }
    }
}

/// Collapsed-by-default board switcher: shows only the current screen's icon
/// (sized and styled like its `GlassIconButton` siblings), unfolds to reveal
/// the alternatives on tap, and folds back once one is chosen.
private struct ModeSwitcher: View {
    @Environment(\.theme) private var theme
    @Binding var mode: BoardMode
    @State private var expanded = false

    var body: some View {
        HStack(spacing: 0) {
            ForEach(visibleModes, id: \.self) { m in
                Button {
                    withAnimation(theme.motion.standard) {
                        if expanded { mode = m }
                        expanded.toggle()
                    }
                } label: {
                    Image(systemName: m.icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(m == mode ? theme.colors.textPrimary : theme.colors.textSecondary)
                        .frame(width: 38, height: 38)
                        .background {
                            if expanded && m == mode {
                                Circle().fill(theme.colors.surfaceElevated)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(expanded ? m.label : "Switch screen, current: \(m.label)")
                .transition(.opacity.combined(with: .scale(scale: 0.6)))
            }
        }
        .background(theme.colors.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(theme.colors.stroke, lineWidth: 1))
    }

    private var visibleModes: [BoardMode] {
        expanded ? BoardMode.allCases : [mode]
    }
}

// NodeId conforms to Identifiable for `.sheet(item:)`.
extension NodeId: @retroactive Identifiable {
    public var id: String { rawValue }
}
