import Testing
@testable import FinanceFlowKit

/// Guards the invariants that make `Flowchart.node(_:)`'s `byID[id]!` and the
/// views' `decisionId` access safe. If the graph and the `NodeId`/`DecisionId`
/// enums ever drift, these fail at test time rather than crashing on-device.
@Suite("Graph integrity")
struct GraphIntegrityTests {
    @Test("every NodeId maps to exactly one GraphNode")
    func everyNodeMapped() {
        #expect(Flowchart.byID.count == NodeId.allCases.count)
        for id in NodeId.allCases {
            #expect(Flowchart.byID[id] != nil, "missing graph node for \(id)")
        }
    }

    @Test("every edge target is a defined node")
    func edgesResolve() {
        for node in Flowchart.graph {
            for edge in node.edges {
                #expect(Flowchart.byID[edge.to] != nil, "\(node.id) → undefined \(edge.to)")
            }
        }
    }

    @Test("decision nodes carry a decisionId; task nodes do not")
    func decisionIdInvariant() {
        for node in Flowchart.graph {
            switch node.kind {
            case .decision:
                #expect(node.decisionId != nil, "decision \(node.id) is missing a decisionId")
            case .task:
                #expect(node.decisionId == nil, "task \(node.id) unexpectedly has a decisionId")
            }
        }
    }

    @Test("Flowchart.node(_:) resolves every id without trapping")
    func nodeLookupTotal() {
        for id in NodeId.allCases { _ = Flowchart.node(id) }
    }
}
