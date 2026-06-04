import Foundation

public enum Recurring {
    /// `"YYYY-MM"` key for a date (default now). Mirrors `ymKey` in `src/state/recurring.ts`.
    public static func ymKey(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let comps = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", comps.year ?? 0, comps.month ?? 0)
    }

    /// The month before a `"YYYY-MM"` key (rolls Jan → prior Dec). Mirrors `priorYm`.
    public static func priorYm(_ key: String, calendar: Calendar = .current) -> String {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return key }
        var comps = DateComponents()
        comps.year = parts[0]
        comps.month = parts[1]
        comps.day = 1
        guard let date = calendar.date(from: comps),
              let prior = calendar.date(byAdding: .month, value: -1, to: date) else {
            return key
        }
        return ymKey(prior, calendar: calendar)
    }

    /// Consecutive months checked in, counting back from this month (or last).
    /// `now` is injectable for deterministic tests. Mirrors `streakLength`.
    public static func streakLength(_ node: NodeState, now: Date = Date(), calendar: Calendar = .current) -> Int {
        let checks = node.monthlyChecks
        var cur = ymKey(now, calendar: calendar)
        if checks[cur] != true { cur = priorYm(cur, calendar: calendar) }
        var n = 0
        // Defensive cap: a contiguous run longer than a century is pathological
        // data, not a real streak — stop rather than walk back unboundedly.
        while checks[cur] == true && n < 1200 {
            n += 1
            cur = priorYm(cur, calendar: calendar)
        }
        return n
    }

    /// Whether this month is checked in. `now` is injectable for deterministic
    /// tests. Mirrors `isCheckedThisMonth`.
    public static func isCheckedThisMonth(_ node: NodeState, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        node.monthlyChecks[ymKey(now, calendar: calendar)] == true
    }
}
