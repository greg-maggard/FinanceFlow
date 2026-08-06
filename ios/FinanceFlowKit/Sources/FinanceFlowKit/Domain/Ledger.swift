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

    /// A dollar amount in whole cents, rounded exactly as `toCents` in
    /// `src/budget/ledger.ts` does it: `Math.round(n * 100)`, which is
    /// `floor(n * 100 + 0.5)` — a half cent goes toward +infinity, so −0.005
    /// rounds to 0, not −1. iOS keeps `Decimal` end to end and needs this only
    /// where a comparison has to select the same rows as the web engine.
    public static func toCents(_ amount: Decimal) -> Decimal {
        var scaled = amount * 100 + Decimal(string: "0.5")!
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .down)   // .down is floor, not truncation
        return rounded
    }

    /// On-budget dollars are assignable; loan/tracking accounts only report.
    public static func isOnBudget(_ kind: AccountKind) -> Bool {
        switch kind {
        case .checking, .savings, .cash, .credit: return true
        case .loan, .tracking: return false
        }
    }

    /// Local "YYYY-MM-DD" for a date — the convention `Txn.date` uses.
    /// Mirrors `isoDay` in `src/budget/ledger.ts`.
    public static func isoDay(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Build the two rows of a transfer of `amount` (a positive magnitude)
    /// from one account to another. A category is meaningful only where money
    /// crosses the budget boundary, so it lands on the on-budget row of an
    /// on/off pair and is stripped entirely from same-side transfers.
    /// Mirrors `pairTransfer` in `src/budget/ledger.ts`.
    public static func pairTransfer(
        accounts: [Account],
        from: String,
        to: String,
        amount: Decimal,
        date: String,
        payee: String? = nil,
        categoryID: String? = nil
    ) -> (out: Txn, inflow: Txn) {
        func kindOf(_ id: String) -> AccountKind {
            accounts.first { $0.id == id }?.kind ?? .tracking
        }
        let fromOn = isOnBudget(kindOf(from))
        let toOn = isOnBudget(kindOf(to))
        let magnitude = abs(amount)
        let outID = ShortID.make()
        let inID = ShortID.make()
        let out = Txn(
            id: outID,
            accountId: from,
            date: date,
            payee: payee,
            amount: -magnitude,
            categoryId: fromOn && !toOn ? categoryID : nil,
            transferAccountId: to,
            transferPairId: inID
        )
        let inflow = Txn(
            id: inID,
            accountId: to,
            date: date,
            payee: payee,
            amount: magnitude,
            categoryId: !fromOn && toOn ? categoryID : nil,
            transferAccountId: from,
            transferPairId: outID
        )
        return (out, inflow)
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
    /// - Ready-to-Assign is cumulative *through the viewed month*: RTA inflows
    ///   through this month, minus dollars assigned in this month and every
    ///   month before it, minus overspending swept from earlier months. All
    ///   three terms run through `month` and no further, so viewing a past
    ///   month reports the number that month actually had. Dollars parked in
    ///   future months are not subtracted here — see `assignedAfter`.
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
            for value in assignedM.values { assignedAll += value }
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

    /// Dollars assigned in months strictly after `month` — money already
    /// parked in the future. Ready-to-Assign deliberately ignores it (it
    /// belongs to those months, not this one), so surface it beside the RTA
    /// figure to keep assigning-ahead visible rather than silently
    /// double-spendable. Mirrors `assignedAfter` in `src/budget/ledger.ts`.
    public static func assignedAfter(_ book: BudgetBook, month: String) -> Decimal {
        var total: Decimal = 0
        for (m, table) in book.assignments where m > month {
            for value in table.values { total += value }
        }
        return total
    }

    public struct BookIntegrity: Equatable, Sendable {
        public var onBudgetCash: Decimal
        public var sumAvailable: Decimal
        public var readyToAssign: Decimal
        public var unbudgetedSpending: Decimal
        public var drift: Decimal

        public init(
            onBudgetCash: Decimal,
            sumAvailable: Decimal,
            readyToAssign: Decimal,
            unbudgetedSpending: Decimal,
            drift: Decimal
        ) {
            self.onBudgetCash = onBudgetCash
            self.sumAvailable = sumAvailable
            self.readyToAssign = readyToAssign
            self.unbudgetedSpending = unbudgetedSpending
            self.drift = drift
        }
    }

    /// The conservation-of-money invariant, made machine-checkable.
    ///
    /// `snapshot` builds each category's `available` from assignments plus
    /// categorized activity, and Ready-to-Assign from inflows minus
    /// assignments minus swept overspending — every term cumulative through
    /// the viewed month. Summing those definitions across all
    /// categories collapses to:
    ///
    ///     Sigma available + readyToAssign + unbudgetedSpending == Sigma
    ///     on-budget cash through the viewed month
    ///
    /// where `unbudgetedSpending` is the on-budget money that never entered an
    /// envelope (no `categoryId`, and not an RTA inflow), including the
    /// on-budget leg of a transfer OUT of the budget — only
    /// on-budget-to-on-budget pairs cancel in the cash total and are skipped.
    /// Every dollar in an on-budget account is therefore accounted for exactly
    /// once, and any non-zero `drift` is money the book conjured or destroyed.
    /// Mirrors `bookIntegrity` in `src/budget/ledger.ts`.
    public static func bookIntegrity(_ book: BudgetBook, month: String) -> BookIntegrity {
        let onBudget = Set(book.accounts.filter { isOnBudget($0.kind) }.map(\.id))

        var onBudgetCash: Decimal = 0
        var unbudgetedSpending: Decimal = 0
        for t in book.transactions where onBudget.contains(t.accountId) {
            // Every term of the identity is cumulative THROUGH the viewed
            // month, so the cash side must be too — a future-dated transaction
            // is not yet in the book the user is looking at.
            if monthOf(date: t.date) > month { continue }
            onBudgetCash += t.amount
            // Only an on-budget -> on-budget pair cancels inside
            // `onBudgetCash`; skip just that leg. An on-budget -> off-budget
            // transfer really does leave the budget, so it has to land
            // somewhere in the identity.
            if let other = t.transferAccountId, onBudget.contains(other) { continue }
            if t.categoryId != nil { continue }   // categorized (incl. RTA) money is already counted
            unbudgetedSpending += t.amount
        }

        let snap = snapshot(book, month: month)
        var sumAvailable: Decimal = 0
        for c in snap.categories.values { sumAvailable += c.available }

        return BookIntegrity(
            onBudgetCash: onBudgetCash,
            sumAvailable: sumAvailable,
            readyToAssign: snap.readyToAssign,
            unbudgetedSpending: unbudgetedSpending,
            drift: onBudgetCash - (sumAvailable + snap.readyToAssign + unbudgetedSpending)
        )
    }
}
