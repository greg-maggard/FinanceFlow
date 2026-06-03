import Foundation

/// Per-node traversal status. Mirrors `Status` in `src/graph/derive.ts`.
public enum Status: String, Sendable {
    case done
    case current
    case upcoming
    case skipped
}

public enum Derive {
    /// Walk the graph from `Start`, following completed tasks and answered
    /// decisions. The first unanswered/uncompleted node is `current`; everything
    /// reachable from the frontier is `upcoming`; everything unreachable is
    /// `skipped`. Direct port of `deriveStatus` in `src/graph/derive.ts`.
    public static func status(_ state: AppState) -> [NodeId: Status] {
        var status: [NodeId: Status] = [:]
        var visited: Set<NodeId> = []
        var frontier: [NodeId] = []
        var cur: NodeId? = .Start

        while let node = cur {
            if visited.contains(node) {
                status[node] = .current
                frontier = [node]
                break
            }
            visited.insert(node)
            let g = Flowchart.node(node)

            if g.kind == .task {
                if !state.node(node).completed {
                    status[node] = .current
                    frontier = [node]
                    break
                }
                status[node] = .done
                if g.edges.count == 1 {
                    cur = g.edges[0].to
                } else if g.edges.isEmpty {
                    frontier = []
                    cur = nil
                } else {
                    frontier = g.edges.map(\.to)
                    cur = nil
                }
            } else {
                let answer = state.decisions[g.decisionId!]
                if answer == nil {
                    status[node] = .current
                    frontier = [node]
                    break
                }
                status[node] = .done
                if let branch = g.edges.first(where: { $0.when == answer }) {
                    cur = branch.to
                } else {
                    frontier = []
                    cur = nil
                }
            }
        }

        // Everything reachable from the frontier is upcoming; the rest skipped.
        var reachable: Set<NodeId> = []
        var queue = frontier
        while !queue.isEmpty {
            let id = queue.removeFirst()
            if reachable.contains(id) { continue }
            reachable.insert(id)
            let g = Flowchart.node(id)
            if g.kind == .task {
                queue.append(contentsOf: g.edges.map(\.to))
            } else {
                let answer = state.decisions[g.decisionId!]
                if answer == nil {
                    queue.append(contentsOf: g.edges.map(\.to))
                } else if let branch = g.edges.first(where: { $0.when == answer }) {
                    queue.append(branch.to)
                }
            }
        }

        for node in Flowchart.graph {
            if status[node.id] != nil { continue }
            if reachable.contains(node.id) {
                status[node.id] = state.node(node.id).completed ? .done : .upcoming
            } else {
                status[node.id] = .skipped
            }
        }

        return status
    }

    public struct Progress: Equatable, Sendable {
        public let done: Int
        public let total: Int
        public let pct: Int
    }

    /// Completed task count over reachable (non-skipped, non-decision) nodes.
    /// Direct port of `overallProgress`.
    public static func overallProgress(_ state: AppState) -> Progress {
        let status = status(state)
        var done = 0
        var total = 0
        for node in Flowchart.graph {
            if status[node.id] == .skipped { continue }
            if node.kind == .decision { continue }
            total += 1
            if state.node(node.id).completed { done += 1 }
        }
        let pct = total == 0 ? 0 : Int((Double(done) / Double(total) * 100).rounded())
        return Progress(done: done, total: total, pct: pct)
    }
}
