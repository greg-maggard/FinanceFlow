import Testing
@testable import FinanceFlowKit

/// Direct port of `src/graph/derive.test.ts`. These traversal cases are the
/// load-bearing contract: the graph must route identically to the web app.

private func completing(_ ids: [NodeId], from base: AppState = .makeInitial()) -> AppState {
    var s = base
    for id in ids {
        s.nodes[id, default: NodeState()].completed = true
    }
    return s
}

@Suite("deriveStatus")
struct DeriveStatusTests {
    @Test("starts with Start as current and rest reachable or skipped")
    func startState() {
        let d = Derive.status(.makeInitial())
        #expect(d[.Start] == .current)
        #expect(d[.Rent] == .upcoming)
        // Both branches of unanswered decisions are reachable.
        #expect(d[.Match] == .upcoming)
        #expect(d[.Q_HighDebt] == .upcoming)
    }

    @Test("advances to next task when current is completed")
    func advances() {
        let d = Derive.status(completing([.Start]))
        #expect(d[.Start] == .done)
        #expect(d[.Rent] == .current)
    }

    @Test("walks through Step 0 linearly")
    func stepZero() {
        let d = Derive.status(completing([.Start, .Rent, .Food, .Essential, .Income, .Health]))
        #expect(d[.MinDebt] == .current)
        #expect(d[.SmallEF] == .upcoming)
    }

    @Test("stops at unanswered decision and marks it current")
    func stopsAtDecision() {
        let d = Derive.status(completing([
            .Start, .Rent, .Food, .Essential, .Income, .Health, .MinDebt,
            .SmallEF, .NonEssential,
        ]))
        #expect(d[.Q_Match] == .current)
        #expect(d[.Match] == .upcoming)
        #expect(d[.Q_HighDebt] == .upcoming)
    }

    @Test("skips Match when Q_Match=no")
    func skipsMatch() {
        var s = completing([
            .Start, .Rent, .Food, .Essential, .Income, .Health, .MinDebt,
            .SmallEF, .NonEssential,
        ])
        s.decisions[.Q_Match] = .no
        let d = Derive.status(s)
        #expect(d[.Q_Match] == .done)
        #expect(d[.Match] == .skipped)
        #expect(d[.Q_HighDebt] == .current)
    }

    @Test("includes Match in path when Q_Match=yes")
    func includesMatch() {
        var s = completing([
            .Start, .Rent, .Food, .Essential, .Income, .Health, .MinDebt,
            .SmallEF, .NonEssential,
        ])
        s.decisions[.Q_Match] = .yes
        let d = Derive.status(s)
        #expect(d[.Match] == .current)
    }

    @Test("detects 15% retirement loop and surfaces Q_15pct as current")
    func detectsLoop() {
        var s = completing([
            .Start, .Rent, .Food, .Essential, .Income, .Health, .MinDebt,
            .SmallEF, .NonEssential, .Match, .BigEF, .IRA, .Increase401k,
        ])
        s.decisions[.Q_Match] = .yes
        s.decisions[.Q_HighDebt] = .no
        s.decisions[.Q_ModDebt] = .no
        s.decisions[.Q_Purchase] = .no
        s.decisions[.Q_15pct] = .no
        s.decisions[.Q_401k] = .yes
        let d = Derive.status(s)
        #expect(d[.Q_15pct] == .current)
        #expect(d[.Increase401k] == .done)
    }

    @Test("Q_15pct=yes routes to Q_HSA")
    func routesToHSA() {
        var s = completing([
            .Start, .Rent, .Food, .Essential, .Income, .Health, .MinDebt,
            .SmallEF, .NonEssential, .Match, .BigEF, .IRA,
        ])
        s.decisions[.Q_Match] = .yes
        s.decisions[.Q_HighDebt] = .no
        s.decisions[.Q_ModDebt] = .no
        s.decisions[.Q_Purchase] = .no
        s.decisions[.Q_15pct] = .yes
        let d = Derive.status(s)
        #expect(d[.Q_15pct] == .done)
        #expect(d[.Q_HSA] == .current)
        #expect(d[.Q_401k] == .skipped)
    }
}
