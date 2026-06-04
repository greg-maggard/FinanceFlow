import Foundation

/// One of the seven phases of the prime-directive flowchart.
public enum Phase: Int, CaseIterable, Codable, Sendable, Comparable {
    case foundations = 0   // Budget & Essentials
    case emergency = 1     // Emergency Fund
    case match = 2         // Employer Match
    case debt = 3          // Debt Payoff
    case ira = 4           // IRA & Near-Term Goals
    case retirement = 5    // More Retirement
    case advanced = 6      // Advanced Goals

    public static func < (lhs: Phase, rhs: Phase) -> Bool { lhs.rawValue < rhs.rawValue }
}

public enum NodeKind: Sendable {
    case task
    case decision
}

/// A directed edge. `when` gates it on a decision answer (nil == unconditional).
public struct Edge: Sendable {
    public let to: NodeId
    public let when: Decision?

    public init(to: NodeId, when: Decision? = nil) {
        self.to = to
        self.when = when
    }
}

/// A node in the static graph. Mirrors `GraphNode` in `src/graph/flowchart.ts`.
public struct GraphNode: Sendable {
    public let id: NodeId
    public let label: String
    public let sublabel: String?
    public let phase: Phase
    public let kind: NodeKind
    public let decisionId: DecisionId?
    public let edges: [Edge]

    init(
        _ id: NodeId,
        label: String,
        sublabel: String? = nil,
        phase: Phase,
        kind: NodeKind,
        decisionId: DecisionId? = nil,
        edges: [Edge]
    ) {
        self.id = id
        self.label = label
        self.sublabel = sublabel
        self.phase = phase
        self.kind = kind
        self.decisionId = decisionId
        self.edges = edges
    }
}

public enum Flowchart {
    /// The 32-node graph. Direct port of `GRAPH` in `src/graph/flowchart.ts`.
    public static let graph: [GraphNode] = [
        // Step 0 — Budget & Essentials
        GraphNode(.Start, label: "Create Budget", sublabel: "Just being here is the first step.", phase: .foundations, kind: .task, edges: [Edge(to: .Rent)]),
        GraphNode(.Rent, label: "Pay Rent/Mortgage", sublabel: "incl. renters or homeowners insurance", phase: .foundations, kind: .task, edges: [Edge(to: .Food)]),
        GraphNode(.Food, label: "Buy Food/Groceries", phase: .foundations, kind: .task, edges: [Edge(to: .Essential)]),
        GraphNode(.Essential, label: "Pay Essential Items", sublabel: "power, water, heat, toiletries", phase: .foundations, kind: .task, edges: [Edge(to: .Income)]),
        GraphNode(.Income, label: "Pay Income-Earning Expenses", sublabel: "transportation, internet, phone", phase: .foundations, kind: .task, edges: [Edge(to: .Health)]),
        GraphNode(.Health, label: "Pay Health Care", sublabel: "insurance and medical expenses", phase: .foundations, kind: .task, edges: [Edge(to: .MinDebt)]),
        GraphNode(.MinDebt, label: "Make Minimum Payments on All Debts and Loans", phase: .foundations, kind: .task, edges: [Edge(to: .SmallEF)]),

        // Step 1 — Emergency Fund
        GraphNode(.SmallEF, label: "Build Small Emergency Fund", sublabel: "$1,000 or 1 month expenses, whichever is greater", phase: .emergency, kind: .task, edges: [Edge(to: .NonEssential)]),
        GraphNode(.NonEssential, label: "Pay Non-Essential Bills in Full", sublabel: "cable, internet, phone, etc.", phase: .emergency, kind: .task, edges: [Edge(to: .Q_Match)]),
        GraphNode(.BigEF, label: "Grow Emergency Fund to 3-6 Months Living Expenses", phase: .emergency, kind: .task, edges: [Edge(to: .Q_ModDebt)]),

        // Step 2 — Employer Match
        GraphNode(.Q_Match, label: "Employer offers retirement match?", phase: .match, kind: .decision, decisionId: .Q_Match, edges: [
            Edge(to: .Match, when: .yes),
            Edge(to: .Q_HighDebt, when: .no),
        ]),
        GraphNode(.Match, label: "Contribute just enough to get the full employer match", phase: .match, kind: .task, edges: [Edge(to: .Q_HighDebt)]),

        // Step 3 — Debt Payoff
        GraphNode(.Q_HighDebt, label: "High-interest debt?", sublabel: "10%+ APR", phase: .debt, kind: .decision, decisionId: .Q_HighDebt, edges: [
            Edge(to: .HighDebt, when: .yes),
            Edge(to: .BigEF, when: .no),
        ]),
        GraphNode(.HighDebt, label: "Use Avalanche or Snowball method to pay off", phase: .debt, kind: .task, edges: [Edge(to: .BigEF)]),
        GraphNode(.Q_ModDebt, label: "Moderate-interest debt?", sublabel: "4-5%+, excluding mortgage", phase: .debt, kind: .decision, decisionId: .Q_ModDebt, edges: [
            Edge(to: .ModDebt, when: .yes),
            Edge(to: .IRA, when: .no),
        ]),
        GraphNode(.ModDebt, label: "Use Avalanche or Snowball method to pay off", phase: .debt, kind: .task, edges: [Edge(to: .IRA)]),

        // Step 4 — IRA & Near-Term Goals
        GraphNode(.IRA, label: "Evaluate Roth vs Traditional IRA and max yearly contributions", phase: .ira, kind: .task, edges: [Edge(to: .Q_Purchase)]),
        GraphNode(.Q_Purchase, label: "Large required purchases coming up?", sublabel: "college, car, certifications", phase: .ira, kind: .decision, decisionId: .Q_Purchase, edges: [
            Edge(to: .SavePurchase, when: .yes),
            Edge(to: .Q_15pct, when: .no),
        ]),
        GraphNode(.SavePurchase, label: "Save the amount needed in a savings or checking account", phase: .ira, kind: .task, edges: [Edge(to: .Q_15pct)]),

        // Step 5 — More Retirement
        GraphNode(.Q_15pct, label: "Saving at least 15% of pre-tax income for retirement?", phase: .retirement, kind: .decision, decisionId: .Q_15pct, edges: [
            Edge(to: .Q_HSA, when: .yes),
            Edge(to: .Q_401k, when: .no),
        ]),
        GraphNode(.Q_401k, label: "Employer offers 401k, 403b, or similar?", phase: .retirement, kind: .decision, decisionId: .Q_401k, edges: [
            Edge(to: .Increase401k, when: .yes),
            Edge(to: .SelfEmp, when: .no),
        ]),
        GraphNode(.Increase401k, label: "Increase contributions until 15% pre-tax saved", phase: .retirement, kind: .task, edges: [Edge(to: .Q_15pct)]),
        GraphNode(.SelfEmp, label: "If self-employed: Individual 401k, SEP-IRA, or SIMPLE IRA. Otherwise: taxable account", phase: .retirement, kind: .task, edges: [Edge(to: .Q_15pct)]),

        // Step 6 — Advanced Goals
        GraphNode(.Q_HSA, label: "HDHP? Eligible for an investable HSA?", phase: .advanced, kind: .decision, decisionId: .Q_HSA, edges: [
            Edge(to: .HSA, when: .yes),
            Edge(to: .Q_College, when: .no),
        ]),
        GraphNode(.HSA, label: "Max yearly HSA contributions", phase: .advanced, kind: .task, edges: [Edge(to: .Q_College)]),
        GraphNode(.Q_College, label: "Kids - want to help with college costs?", phase: .advanced, kind: .decision, decisionId: .Q_College, edges: [
            Edge(to: .College, when: .yes),
            Edge(to: .Options, when: .no),
        ]),
        GraphNode(.College, label: "Evaluate 529 plan and contribute accordingly", phase: .advanced, kind: .task, edges: [Edge(to: .Options)]),
        GraphNode(.Options, label: "You have options now - up to your personal goals", phase: .advanced, kind: .task, edges: [Edge(to: .Q_Early), Edge(to: .Q_Goals)]),
        GraphNode(.Q_Early, label: "Retire early?", phase: .advanced, kind: .decision, decisionId: .Q_Early, edges: [Edge(to: .Early, when: .yes)]),
        GraphNode(.Early, label: "Max 401k/403b, consider mega backdoor Roth IRA, then a taxable account", phase: .advanced, kind: .task, edges: []),
        GraphNode(.Q_Goals, label: "More immediate goals?", phase: .advanced, kind: .decision, decisionId: .Q_Goals, edges: [Edge(to: .Goals, when: .yes)]),
        GraphNode(.Goals, label: "Savings for goals under 3 years; conservative stock/bond mix for 3-5 year goals", sublabel: "down payment, vehicle, vacation", phase: .advanced, kind: .task, edges: []),
    ]

    /// O(1) lookup by id.
    public static let byID: [NodeId: GraphNode] = Dictionary(
        uniqueKeysWithValues: graph.map { ($0.id, $0) }
    )

    public static func node(_ id: NodeId) -> GraphNode { byID[id]! }

    /// Mirrors `PHASE_LABELS`.
    public static let phaseLabels: [Phase: String] = [
        .foundations: "Step 0: Budget & Essentials",
        .emergency: "Step 1: Emergency Fund",
        .match: "Step 2: Employer Match",
        .debt: "Step 3: Debt Payoff",
        .ira: "Step 4: IRA & Near-Term Goals",
        .retirement: "Step 5: More Retirement",
        .advanced: "Step 6: Advanced Goals",
    ]
}
