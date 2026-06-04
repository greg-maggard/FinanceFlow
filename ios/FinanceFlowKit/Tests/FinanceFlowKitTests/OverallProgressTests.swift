import Testing
@testable import FinanceFlowKit

@Suite("overallProgress")
struct OverallProgressTests {
    @Test("fresh state is 0% with no tasks done")
    func fresh() {
        let p = Derive.overallProgress(.makeInitial())
        #expect(p.done == 0)
        #expect(p.pct == 0)
        #expect(p.total > 0)
    }

    @Test("decisions are excluded from totals")
    func decisionsExcluded() {
        var s = AppState.makeInitial()
        s.decisions[.Q_Match] = .yes   // answering a decision is not "progress"
        let p = Derive.overallProgress(s)
        #expect(p.done == 0)
    }

    @Test("skipped tasks are excluded from totals")
    func skippedExcluded() {
        // Q_Match=no skips the Match task; total must not count it.
        var withMatch = AppState.makeInitial()
        withMatch.decisions[.Q_Match] = .yes
        let totalWithMatch = Derive.overallProgress(withMatch).total

        var withoutMatch = AppState.makeInitial()
        withoutMatch.decisions[.Q_Match] = .no
        let totalWithoutMatch = Derive.overallProgress(withoutMatch).total

        #expect(totalWithoutMatch == totalWithMatch - 1)
    }

    @Test("completing a task raises done count")
    func completingRaisesDone() {
        var s = AppState.makeInitial()
        s.nodes[.Start]?.completed = true
        let p = Derive.overallProgress(s)
        #expect(p.done == 1)
    }
}
