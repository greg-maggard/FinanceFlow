import Foundation

/// The zero-based envelope math, derived live from a `BudgetBook` — nothing
/// here is stored, so every number is current the moment a transaction or
/// assignment changes, with no refresh step and no cadence assumptions.
/// Mirrors `src/budget/ledger.ts`; `LedgerTests` pins the two to each other.
public enum Ledger {
    /// Reserved category id for inflows that fund Ready-to-Assign.
    public static let rtaCategoryID = "rta"

    /// Month bucket of a "YYYY-MM-DD" transaction date.
    public static func monthOf(date: String) -> String {
        String(date.prefix(7))
    }

    /// On-budget dollars are assignable; loan/tracking accounts only report.
    public static func isOnBudget(_ kind: AccountKind) -> Bool {
        switch kind {
        case .checking, .savings, .cash, .credit: return true
        case .loan, .tracking: return false
        }
    }

    public static func accountBalance(_ book: BudgetBook, _ accountID: String) -> Decimal {
        var total: Decimal = 0
        for t in book.transactions where t.accountId == accountID {
            total += t.amount
        }
        return total
    }

    public struct CategoryMonth: Equatable, Sendable {
        public var assigned: Decimal
        public var activity: Decimal
        public var available: Decimal

        public init(assigned: Decimal, activity: Decimal, available: Decimal) {
            self.assigned = assigned
            self.activity = activity
            self.available = available
        }
    }

    public struct MonthSnapshot: Equatable, Sendable {
        public var month: String
        public var readyToAssign: Decimal
        public var categories: [String: CategoryMonth]

        public init(month: String, readyToAssign: Decimal, categories: [String: CategoryMonth]) {
            self.month = month
            self.readyToAssign = readyToAssign
            self.categories = categories
        }
    }

    /// The envelope state for one month.
    ///
    /// Mechanics (YNAB-style zero-based, identical to the web engine):
    /// - available = positive carryover from the prior month + assigned + activity.
    /// - A month-end *negative* available does not follow the category: it
    ///   resets to zero and debits the next month's Ready-to-Assign instead.
    /// - Ready-to-Assign = RTA inflows through this month, minus dollars
    ///   assigned in ANY month (assigning ahead can't double-spend a dollar),
    ///   minus overspending swept from earlier months.
    public static func snapshot(_ book: BudgetBook, month: String) -> MonthSnapshot {
        let onBudget = Set(book.accounts.filter { isOnBudget($0.kind) }.map(\.id))

        var activityByMonth: [String: [String: Decimal]] = [:]
        var inflowByMonth: [String: Decimal] = [:]
        var monthSet: Set<String> = [month]
        monthSet.formUnion(book.assignments.keys)
        for t in book.transactions where onBudget.contains(t.accountId) {
            let m = monthOf(date: t.date)
            monthSet.insert(m)
            if t.categoryId == rtaCategoryID {
                inflowByMonth[m, default: 0] += t.amount
            } else if let category = t.categoryId {
                activityByMonth[m, default: [:]][category, default: 0] += t.amount
            }
        }

        var assignedAll: Decimal = 0
        for table in book.assignments.values {
            for value in table.values { assignedAll += value }
        }

        var inflowToDate: Decimal = 0
        var sweptOverspend: Decimal = 0
        var carry: [String: Decimal] = [:]
        var categories: [String: CategoryMonth] = [:]

        for m in monthSet.sorted() {
            if m > month { break }
            let assignedM = book.assignments[m] ?? [:]
            let activityM = activityByMonth[m] ?? [:]
            var ids = Set(book.categories.map(\.id))
            ids.formUnion(assignedM.keys)
            ids.formUnion(activityM.keys)
            ids.formUnion(carry.keys)

            var snap: [String: CategoryMonth] = [:]
            var overspendM: Decimal = 0
            for id in ids {
                let assigned = assignedM[id] ?? 0
                let activity = activityM[id] ?? 0
                let available = (carry[id] ?? 0) + assigned + activity
                snap[id] = CategoryMonth(assigned: assigned, activity: activity, available: available)
                if available >= 0 {
                    carry[id] = available
                } else {
                    carry[id] = 0
                    overspendM += -available
                }
            }

            inflowToDate += inflowByMonth[m] ?? 0
            if m == month {
                categories = snap
            } else {
                sweptOverspend += overspendM
            }
        }

        return MonthSnapshot(
            month: month,
            readyToAssign: inflowToDate - assignedAll - sweptOverspend,
            categories: categories
        )
    }
}
