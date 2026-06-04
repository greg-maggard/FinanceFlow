import Foundation

public enum Path {
    /// The single straight-line path through the graph given current answers.
    /// Unanswered decisions optimistically follow their "yes" branch.
    /// Direct port of `linearPath` in `src/graph/path.ts`.
    public static func linearPath(_ state: AppState) -> [NodeId] {
        var out: [NodeId] = []
        var visited: Set<NodeId> = []
        var cur: NodeId? = .Start

        while let node = cur {
            if visited.contains(node) { break }
            visited.insert(node)
            out.append(node)
            let g = Flowchart.node(node)
            if g.kind == .decision {
                let answer = state.decisions[g.decisionId!]
                if let answer {
                    cur = g.edges.first(where: { $0.when == answer })?.to
                } else {
                    cur = g.edges.first(where: { $0.when == .yes })?.to ?? g.edges.first?.to
                }
            } else {
                cur = g.edges.first?.to
            }
        }
        return out
    }

    /// Previous / next node along the linear path (with a topology fallback for
    /// off-path nodes). Direct port of `neighbors` in `src/graph/path.ts`.
    public static func neighbors(_ state: AppState, of id: NodeId) -> (prev: NodeId?, next: NodeId?) {
        let path = linearPath(state)
        if let idx = path.firstIndex(of: id) {
            return (
                prev: idx > 0 ? path[idx - 1] : nil,
                next: idx < path.count - 1 ? path[idx + 1] : nil
            )
        }

        // Off-path fallback: graph topology only.
        let g = Flowchart.node(id)
        let next: NodeId?
        if g.kind == .decision {
            let answer = state.decisions[g.decisionId!] ?? .yes
            next = g.edges.first(where: { $0.when == answer })?.to ?? g.edges.first?.to
        } else {
            next = g.edges.first?.to
        }
        let prev = Flowchart.graph.first(where: { $0.edges.contains(where: { $0.to == id }) })?.id
        return (prev, next)
    }
}
