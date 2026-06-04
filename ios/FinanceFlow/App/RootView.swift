import SwiftUI
import FinanceFlowKit

enum BoardMode: String, CaseIterable {
    case graph
    case trail

    var icon: String { self == .graph ? "point.3.connected.trianglepath.dotted" : "list.bullet.indent" }
    var label: String { self == .graph ? "Map" : "Trail" }
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
                    GraphScreen(onSelect: { selectedNode = $0 })
                case .trail:
                    PhaseTrailScreen(onSelect: { selectedNode = $0 })
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

    private var topBar: some View {
        let progress = store.progress
        return HStack(spacing: theme.spacing.sm) {
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
                        Text("\(progress.done)/\(progress.total) · \(progress.pct)%")
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textSecondary)
                    }
                }
            }
            .buttonStyle(.plain)

            Spacer()

            Picker("View", selection: $mode.animation(theme.motion.standard)) {
                ForEach(BoardMode.allCases, id: \.self) { m in
                    Image(systemName: m.icon).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 110)

            GlassIconButton(systemName: "gearshape.fill") { showSettings = true }
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
}

// NodeId conforms to Identifiable for `.sheet(item:)`.
extension NodeId: @retroactive Identifiable {
    public var id: String { rawValue }
}
