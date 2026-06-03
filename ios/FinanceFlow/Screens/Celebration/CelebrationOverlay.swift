import SwiftUI
import FinanceFlowKit

/// Atmospheric celebration layer: a brief phase-colored bloom when a node on the
/// active path is completed, and a full-screen medal takeover when a phase
/// finishes. Mirrors `src/components/CelebrationLayer.tsx`.
struct CelebrationOverlay: View {
    @Environment(CelebrationCenter.self) private var celebration
    @Environment(\.theme) private var theme

    @State private var bloomOpacity: Double = 0

    var body: some View {
        ZStack {
            if let node = celebration.pendingNode, celebration.pendingNodeOnPath {
                let c = theme.phaseColor(Flowchart.node(node).phase)
                RadialGradient(
                    colors: [c.glow, .clear],
                    center: .init(x: 0.5, y: 0.45),
                    startRadius: 0,
                    endRadius: 420
                )
                .opacity(bloomOpacity)
                .blur(radius: 6)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .task(id: node) {
                    let unit = theme.motion.celebration
                    bloomOpacity = 0
                    withAnimation(.easeOut(duration: unit * 0.3)) { bloomOpacity = 0.55 }
                    try? await Task.sleep(for: .seconds(unit * 0.5))
                    withAnimation(.easeIn(duration: unit * 0.3)) { bloomOpacity = 0 }
                    try? await Task.sleep(for: .seconds(unit * 0.3))
                    celebration.clearNode()
                }
            }

            if let phase = celebration.pendingMedal {
                MedalTakeover(phase: phase) { celebration.clearMedal() }
                    .transition(.opacity)
            }
        }
        .animation(theme.motion.emphasized, value: celebration.pendingMedal)
    }
}

private struct MedalTakeover: View {
    @Environment(\.theme) private var theme
    let phase: Phase
    let onClose: () -> Void

    var body: some View {
        let c = theme.phaseColor(phase)
        let medal = medals[phase]

        ZStack {
            RadialGradient(
                colors: [c.glow, c.tint, theme.colors.background.opacity(0.92)],
                center: .center,
                startRadius: 0,
                endRadius: 520
            )
            .ignoresSafeArea()

            VStack(spacing: theme.spacing.md) {
                Text("Step \(phase.rawValue) unlocked")
                    .font(theme.typography.overline)
                    .tracking(3)
                    .foregroundStyle(c.text.opacity(0.7))
                Text(medal?.title ?? "Phase complete")
                    .font(theme.typography.display)
                    .foregroundStyle(c.text)
                    .multilineTextAlignment(.center)
                Text(medal?.subtitle ?? "")
                    .font(theme.typography.callout)
                    .foregroundStyle(theme.colors.textSecondary)
                    .multilineTextAlignment(.center)
                Text("Tap to continue")
                    .font(theme.typography.overline)
                    .tracking(2)
                    .foregroundStyle(theme.colors.textTertiary)
                    .padding(.top, theme.spacing.xxl)
            }
            .padding(theme.spacing.xl)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onClose)
    }
}
