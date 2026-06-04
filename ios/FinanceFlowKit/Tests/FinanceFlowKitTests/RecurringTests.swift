import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("Recurring dates & streaks")
struct RecurringTests {
    /// Fixed UTC Gregorian calendar so results don't depend on the test machine's locale.
    private var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    private func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
        var comps = DateComponents()
        comps.year = y; comps.month = m; comps.day = d
        return utc.date(from: comps)!
    }

    @Test("ymKey is zero-padded year-month")
    func ymKeyFormat() {
        #expect(Recurring.ymKey(date(2026, 3, 9), calendar: utc) == "2026-03")
    }

    @Test("priorYm rolls January back to the prior December")
    func priorYmYearBoundary() {
        #expect(Recurring.priorYm("2026-01", calendar: utc) == "2025-12")
        #expect(Recurring.priorYm("2026-05", calendar: utc) == "2026-04")
    }

    @Test("streak counts consecutive checked months back from now")
    func streakCounts() {
        var node = NodeState()
        node.monthlyChecks = ["2026-03": true, "2026-02": true, "2026-01": true]
        #expect(Recurring.streakLength(node, now: date(2026, 3, 15), calendar: utc) == 3)
    }

    @Test("a gap breaks the streak")
    func streakGap() {
        var node = NodeState()
        node.monthlyChecks = ["2026-03": true, "2026-01": true]   // Feb missing
        #expect(Recurring.streakLength(node, now: date(2026, 3, 15), calendar: utc) == 1)
    }

    @Test("counts from last month when the current month isn't checked yet")
    func streakFromLastMonth() {
        var node = NodeState()
        node.monthlyChecks = ["2026-02": true, "2026-01": true]   // March not yet checked
        #expect(Recurring.streakLength(node, now: date(2026, 3, 15), calendar: utc) == 2)
    }

    @Test("no checks → zero streak")
    func streakZero() {
        #expect(Recurring.streakLength(NodeState(), now: date(2026, 3, 15), calendar: utc) == 0)
    }

    @Test("isCheckedThisMonth respects the injected now")
    func checkedThisMonth() {
        var node = NodeState()
        node.monthlyChecks = ["2026-03": true]
        #expect(Recurring.isCheckedThisMonth(node, now: date(2026, 3, 1), calendar: utc) == true)
        #expect(Recurring.isCheckedThisMonth(node, now: date(2026, 4, 1), calendar: utc) == false)
    }
}
