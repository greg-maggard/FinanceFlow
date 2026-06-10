import SwiftUI
import FinanceFlowKit

/// A single node on the graph board. Styling is entirely derived from the theme's
/// `statusStyle` so a reskin needs no change here.
///
/// Purely visual — it installs no tap gesture. Taps are handled by the graph's
/// `UIScrollView` host (see `GraphScreen`), which hit-tests node frames so a
/// finger landing on a node never blocks the scroll view's pinch-to-zoom.
struct NodeCard: View {
    @Environment(\.theme) private var theme
    let node: GraphNode
    let status: Status
    let completed: Bool
    let answer: Decision?

    var body: some View {
        let phase = theme.phaseColor(node.phase)
        let s = theme.style(for: status, phase: node.phase)

        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: theme.spacing.xs) {
                glyph(style: s, phase: phase)
                Text(node.label)
                    .font(theme.typography.nodeLabel)
                    .foregroundStyle(s.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            if node.kind == .decision, let answer {
                Text(answer.rawValue.uppercased())
                    .font(theme.typography.overline)
                    .foregroundStyle(phase.base)
            } else if let sub = node.sublabel {
                Text(sub)
                    .font(theme.typography.overline)
                    .foregroundStyle(s.text.opacity(0.6))
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, theme.spacing.md)
        .padding(.vertical, theme.spacing.sm)
        .frame(width: GraphLayout.nodeSize.width, height: GraphLayout.nodeSize.height, alignment: .leading)
        .background(s.fill, in: shape)
        .overlay(
            shape.strokeBorder(
                s.stroke,
                style: StrokeStyle(lineWidth: s.lineWidth, dash: s.dashed ? [4, 4] : [])
            )
        )
        .shadow(color: s.glow, radius: status == .current ? 14 : 0)
        .opacity(s.opacity)
        .contentShape(Rectangle())
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(
            cornerRadius: node.kind == .decision ? theme.radii.pill : theme.radii.md,
            style: .continuous
        )
    }

    @ViewBuilder
    private func glyph(style: NodeStyle, phase: PhaseColor) -> some View {
        switch status {
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(phase.base)
        case .current:
            Image(systemName: node.kind == .decision ? "questionmark.circle.fill" : "circle.dotted")
                .foregroundStyle(phase.base)
        case .skipped:
            Image(systemName: "minus.circle").foregroundStyle(style.text)
        case .upcoming:
            Image(systemName: node.kind == .decision ? "questionmark.circle" : "circle")
                .foregroundStyle(style.text)
        }
    }
}
