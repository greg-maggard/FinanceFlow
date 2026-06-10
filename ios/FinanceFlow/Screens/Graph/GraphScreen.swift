import SwiftUI
import UIKit
import FinanceFlowKit

/// The interactive flowchart board: a pannable, zoomable canvas of edges + node
/// cards. Tapping a node opens its detail sheet.
///
/// Zoom + pan are delegated to a `UIScrollView` (see `ZoomableScrollView`) so a
/// pinch zooms toward the gesture's focal point and pan-while-zoomed feels
/// native — the way Photos behaves. A pure SwiftUI `ScrollView` + `scaleEffect`
/// can only scale from a *fixed* anchor, so every pinch jumps to that corner
/// (here, the top-left) and forces the user to swipe back.
///
/// Node taps are handled by a tap recognizer on the scroll view (hit-testing
/// `GraphLayout`), not by per-node SwiftUI `Button`s. A `Button`'s gesture
/// recognizer would claim a finger that lands on a node and starve the scroll
/// view's two-finger pinch, so pinch-to-zoom failed whenever a finger was on a
/// card.
struct GraphScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let onSelect: (NodeId) -> Void

    private let minZoom: CGFloat = 0.5
    private let maxZoom: CGFloat = 2.5
    private let initialZoom: CGFloat = 0.85

    var body: some View {
        let status = store.status

        ZoomableScrollView(
            contentSize: GraphLayout.canvasSize,
            minZoom: minZoom,
            maxZoom: maxZoom,
            initialZoom: initialZoom,
            // Match the old `.padding`: clear the floating top bar and bottom.
            // Insets are in screen points (unscaled), like the original padding
            // which sat outside the `scaleEffect`.
            insets: UIEdgeInsets(top: 96, left: 0, bottom: 80, right: 0),
            onTap: { point in
                if let id = GraphLayout.node(at: point) { onSelect(id) }
            }
        ) {
            ZStack(alignment: .topLeading) {
                EdgeLayer(state: store.state, status: status)

                ForEach(Flowchart.graph, id: \.id) { node in
                    NodeCard(
                        node: node,
                        status: status[node.id] ?? .upcoming,
                        completed: store.state.node(node.id).completed,
                        answer: node.decisionId.flatMap { store.state.decisions[$0] }
                    )
                    // Touch taps go through the scroll view's recognizer; expose an
                    // accessibility action so VoiceOver can still open the node.
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { onSelect(node.id) }
                    .position(GraphLayout.position(node.id))
                }
            }
            .frame(width: GraphLayout.canvasSize.width, height: GraphLayout.canvasSize.height)
            // The hosted content is a fresh SwiftUI tree (UIHostingController), so
            // it does not inherit this screen's environment — re-inject the theme
            // that NodeCard/EdgeLayer read.
            .environment(\.theme, theme)
        }
    }
}

/// Hosts fixed-size SwiftUI `content` inside a `UIScrollView` to get native
/// focal-point pinch zoom and pan-while-zoomed. The hosted view is sized to
/// `contentSize`; zoom is applied by the scroll view's own transform, so the
/// content under the user's fingers stays put as they pinch. A tap recognizer
/// reports tap locations (in content coordinates) via `onTap`.
private struct ZoomableScrollView<Content: View>: UIViewRepresentable {
    let contentSize: CGSize
    let minZoom: CGFloat
    let maxZoom: CGFloat
    let initialZoom: CGFloat
    var insets: UIEdgeInsets = .zero
    var onTap: (CGPoint) -> Void
    @ViewBuilder var content: Content

    func makeCoordinator() -> Coordinator {
        Coordinator(host: UIHostingController(rootView: AnyView(content)), onTap: onTap)
    }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = minZoom
        scroll.maximumZoomScale = maxZoom
        scroll.bouncesZoom = true
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.contentInset = insets
        scroll.backgroundColor = .clear
        scroll.clipsToBounds = false        // match the old `.scrollClipDisabled()`

        let host = context.coordinator.host
        host.view.backgroundColor = .clear
        host.view.frame = CGRect(origin: .zero, size: contentSize)
        host.safeAreaRegions = []           // the canvas is absolutely positioned; ignore safe area
        scroll.addSubview(host.view)
        scroll.contentSize = contentSize

        // Single-tap selects a node. It coexists with pinch/pan (a discrete tap
        // fails the moment the gesture turns into a drag/pinch) and does not
        // swallow touches the scroll view needs.
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        host.view.addGestureRecognizer(tap)

        scroll.zoomScale = initialZoom
        // Start at the top-left of the board (Start node), just below the top bar.
        scroll.contentOffset = CGPoint(x: 0, y: -insets.top)

        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        // Re-render the hosted SwiftUI tree on state changes (status/decisions);
        // zoom + offset live on the scroll view and are preserved across updates.
        context.coordinator.host.rootView = AnyView(content)
        context.coordinator.onTap = onTap
        scroll.minimumZoomScale = minZoom
        scroll.maximumZoomScale = maxZoom
        scroll.contentInset = insets
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        let host: UIHostingController<AnyView>
        var onTap: (CGPoint) -> Void

        init(host: UIHostingController<AnyView>, onTap: @escaping (CGPoint) -> Void) {
            self.host = host
            self.onTap = onTap
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { host.view }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            // Keep the board centered while it's smaller than the viewport so a
            // zoomed-out canvas doesn't pin to a corner.
            guard let canvas = host.view else { return }
            let content = scrollView.contentSize
            let bounds = scrollView.bounds.size
            var frame = canvas.frame
            frame.origin.x = content.width < bounds.width ? (bounds.width - content.width) / 2 : 0
            frame.origin.y = content.height < bounds.height ? (bounds.height - content.height) / 2 : 0
            canvas.frame = frame
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard gesture.state == .ended, let canvas = host.view else { return }
            // `location(in:)` resolves through the zoom transform, so this is a
            // point in the canvas's own (unzoomed) coordinate space.
            onTap(gesture.location(in: canvas))
        }
    }
}
