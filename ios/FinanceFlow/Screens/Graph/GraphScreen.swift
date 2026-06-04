import SwiftUI
import FinanceFlowKit

/// The interactive flowchart board: a pannable, zoomable canvas of edges + node
/// cards. Tapping a node opens its detail sheet.
struct GraphScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let onSelect: (NodeId) -> Void

    @State private var zoom: CGFloat = 0.85
    @GestureState private var pinch: CGFloat = 1

    private let minZoom: CGFloat = 0.5
    private let maxZoom: CGFloat = 2.5

    var body: some View {
        let status = store.status

        ScrollView([.horizontal, .vertical], showsIndicators: false) {
            ZStack(alignment: .topLeading) {
                EdgeLayer(state: store.state, status: status)

                ForEach(Flowchart.graph, id: \.id) { node in
                    NodeCard(
                        node: node,
                        status: status[node.id] ?? .upcoming,
                        completed: store.state.node(node.id).completed,
                        answer: node.decisionId.flatMap { store.state.decisions[$0] },
                        onTap: { onSelect(node.id) }
                    )
                    .position(GraphLayout.position(node.id))
                }
            }
            .frame(width: GraphLayout.canvasSize.width, height: GraphLayout.canvasSize.height)
            .scaleEffect(zoom * pinch, anchor: .topLeading)
            .frame(
                width: GraphLayout.canvasSize.width * zoom * pinch,
                height: GraphLayout.canvasSize.height * zoom * pinch,
                alignment: .topLeading
            )
            .padding(.top, 96)        // clear the floating top bar
            .padding(.bottom, 80)
        }
        .scrollClipDisabled()
        .gesture(
            MagnifyGesture()
                .updating($pinch) { value, state, _ in state = value.magnification }
                .onEnded { value in
                    zoom = min(maxZoom, max(minZoom, zoom * value.magnification))
                }
        )
    }
}
