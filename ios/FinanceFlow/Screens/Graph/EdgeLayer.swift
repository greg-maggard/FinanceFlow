import SwiftUI
import FinanceFlowKit

// `Path` and `Edge` exist in both SwiftUI and FinanceFlowKit; alias here so
// the drawing code uses SwiftUI's drawing path without qualifying every site.
private typealias Path = SwiftUI.Path

/// Draws all graph edges behind the node cards. Edge color follows the source
/// node's status; decision branches not taken are muted/dashed; the two
/// retirement loop-backs bow out to the right.
struct EdgeLayer: View {
    @Environment(\.theme) private var theme
    let state: AppState
    let status: [NodeId: Status]

    var body: some View {
        Canvas { context, _ in
            var loopIndex = 0
            for node in Flowchart.graph {
                for edge in node.edges {
                    let style = edgeStyle(from: node, edge: edge)
                    if GraphLayout.isLoopBack(from: node.id, to: edge.to) {
                        drawLoopBack(context: context, from: node.id, to: edge.to, style: style, index: loopIndex)
                        loopIndex += 1
                    } else {
                        drawDownward(context: context, from: node.id, to: edge.to, style: style)
                        drawLabel(context: context, from: node.id, to: edge.to, when: edge.when, color: style.color)
                    }
                }
            }
        }
        .frame(width: GraphLayout.canvasSize.width, height: GraphLayout.canvasSize.height)
    }

    private struct EdgeStroke {
        var color: Color
        var width: CGFloat
        var dashed: Bool
    }

    private func edgeStyle(from node: GraphNode, edge: FinanceFlowKit.Edge) -> EdgeStroke {
        let phase = theme.phaseColor(node.phase)
        let srcStatus = status[node.id] ?? .upcoming

        // A decision branch that was answered the other way is "not taken".
        var notTaken = false
        if node.kind == .decision, let when = edge.when, let answer = state.decisions[node.decisionId!] {
            notTaken = when != answer
        }

        switch srcStatus {
        case _ where notTaken:
            return EdgeStroke(color: theme.colors.textTertiary.opacity(0.5), width: 1, dashed: true)
        case .done:
            return EdgeStroke(color: phase.base.opacity(0.85), width: 2, dashed: false)
        case .current:
            return EdgeStroke(color: phase.base, width: 2.5, dashed: false)
        case .skipped:
            return EdgeStroke(color: theme.colors.textTertiary.opacity(0.3), width: 1, dashed: true)
        case .upcoming:
            return EdgeStroke(color: theme.colors.stroke, width: 1.5, dashed: false)
        }
    }

    private func drawDownward(context: GraphicsContext, from: NodeId, to: NodeId, style: EdgeStroke) {
        let start = anchor(from, .bottom)
        let end = anchor(to, .top)
        let midY = (start.y + end.y) / 2
        var path = Path()
        path.move(to: start)
        path.addCurve(
            to: end,
            control1: CGPoint(x: start.x, y: midY),
            control2: CGPoint(x: end.x, y: midY)
        )
        stroke(context: context, path: path, style: style)
        drawArrow(context: context, at: end, angle: .pi / 2, color: style.color)
    }

    private func drawLoopBack(context: GraphicsContext, from: NodeId, to: NodeId, style: EdgeStroke, index: Int) {
        let start = anchor(from, .right)
        let end = anchor(to, .right)
        let bulge = max(start.x, end.x) + 60 + CGFloat(index) * 34
        var path = Path()
        path.move(to: start)
        path.addCurve(
            to: end,
            control1: CGPoint(x: bulge, y: start.y),
            control2: CGPoint(x: bulge, y: end.y)
        )
        stroke(context: context, path: path, style: style)
        drawArrow(context: context, at: end, angle: .pi, color: style.color)
    }

    private func drawLabel(context: GraphicsContext, from: NodeId, to: NodeId, when: Decision?, color: Color) {
        guard let when else { return }
        let start = anchor(from, .bottom)
        let end = anchor(to, .top)
        let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)

        // Small rounded chip behind the label for legibility over edges.
        let chip = CGRect(x: mid.x - 16, y: mid.y - 9, width: 32, height: 18)
        context.fill(
            Path(roundedRect: chip, cornerRadius: 6),
            with: .color(theme.colors.background.opacity(0.85))
        )

        var resolved = context.resolve(Text(when.rawValue).font(theme.typography.overline))
        resolved.shading = .color(color)
        context.draw(resolved, at: mid, anchor: .center)
    }

    private func stroke(context: GraphicsContext, path: Path, style: EdgeStroke) {
        let strokeStyle = StrokeStyle(
            lineWidth: style.width,
            lineCap: .round,
            dash: style.dashed ? [4, 5] : []
        )
        context.stroke(path, with: .color(style.color), style: strokeStyle)
    }

    private func drawArrow(context: GraphicsContext, at point: CGPoint, angle: CGFloat, color: Color) {
        let size: CGFloat = 6
        var path = Path()
        path.move(to: point)
        path.addLine(to: CGPoint(x: point.x - size * cos(angle - .pi / 7), y: point.y - size * sin(angle - .pi / 7)))
        path.addLine(to: CGPoint(x: point.x - size * cos(angle + .pi / 7), y: point.y - size * sin(angle + .pi / 7)))
        path.closeSubpath()
        context.fill(path, with: .color(color))
    }

    private enum Side { case top, bottom, right }

    private func anchor(_ id: NodeId, _ side: Side) -> CGPoint {
        let c = GraphLayout.position(id)
        let h = GraphLayout.nodeSize.height / 2
        let w = GraphLayout.nodeSize.width / 2
        switch side {
        case .top: return CGPoint(x: c.x, y: c.y - h)
        case .bottom: return CGPoint(x: c.x, y: c.y + h)
        case .right: return CGPoint(x: c.x + w, y: c.y)
        }
    }
}
