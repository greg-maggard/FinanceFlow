import Foundation

/// The node ↔ ledger view layer: how each flowchart node reads its money from
/// the budget book, and pure "planners" that turn node edits into book
/// operations. Mirrors `src/budget/nodeLedger.ts`; `NodeLedgerTests` pins the
/// two engines to the same numbers.
///
/// Nothing here touches the store — planners return `BookOps`, applied
/// atomically by `AppStore.apply(_:)`.
public enum NodeLedger {
    public static let groupBills = "g:bills"
    public static let groupEF = "g:ef"
    public static let groupGoals = "g:goals"

    public static let adjustAccountID = "acct:adjust"
    public static let collegeAccountID = "acct:college"

    /// One real-world fund, two flowchart milestones.
    public static let efNodes: Set<NodeId> = [.SmallEF, .BigEF]

    private static let groupNames: [String: String] = [
        groupBills: "Bills",
        groupEF: "Emergency Fund",
        groupGoals: "Savings Goals",
    ]

    public static func groupForNode(_ nodeId: NodeId) -> String {
        if recurringNodes.contains(nodeId) { return groupBills }
        if efNodes.contains(nodeId) { return groupEF }
        return groupGoals
    }

    /// Deterministic id of an account's opening-balance transaction.
    public static func startingTxnID(_ accountID: String) -> String {
        "txn:start:\(accountID)"
    }

    /// Deterministic id of a balance-adjustment transaction, keyed per target
    /// (category or account) per day so keystroke-by-keystroke edits coalesce
    /// into a single row instead of spawning one per digit.
    public static func adjustmentTxnID(_ targetID: String, date: String) -> String {
        "txn:adjust:\(targetID):\(date)"
    }

    // MARK: - Reads

    public static func linkedCategories(_ book: BudgetBook, _ nodeId: NodeId) -> [BudgetCategory] {
        book.categories.filter { $0.nodeId == nodeId }
    }

    public static func efCategories(_ book: BudgetBook) -> [BudgetCategory] {
        book.categories.filter { category in
            guard let nodeId = category.nodeId else { return false }
            return efNodes.contains(nodeId)
        }
    }

    public static func linkedAccounts(_ book: BudgetBook, _ nodeId: NodeId) -> [Account] {
        book.accounts.filter { $0.nodeId == nodeId }
    }

    public struct NodeRow: Equatable, Sendable {
        public var category: BudgetCategory
        public var assigned: Money
        public var activity: Money
        public var available: Money
    }

    /// The node's envelopes joined with the month snapshot (EF nodes see the union).
    public static func nodeRows(
        _ book: BudgetBook,
        _ snap: Ledger.MonthSnapshot,
        _ nodeId: NodeId
    ) -> [NodeRow] {
        let cats = efNodes.contains(nodeId) ? efCategories(book) : linkedCategories(book, nodeId)
        return cats.map { category in
            let m = snap.categories[category.id] ?? .zero
            return NodeRow(
                category: category,
                assigned: m.assigned,
                activity: m.activity,
                available: m.available
            )
        }
    }

    /// Recurring node: target = Σ monthly targets, funded = Σ what each
    /// envelope actually held for the month, capped at that envelope's target.
    ///
    /// A bills node asks "is this month's bill covered?", and money that
    /// already left the envelope paying that bill still counts. Since
    /// `available = carryIn + assigned + activity`, the money that sat in the
    /// envelope during the month is `available - activity` — which counts a
    /// carried-over balance, so budgeting a month ahead (assign in July, spend
    /// in August) no longer reads as unfunded. Clamped at zero so an envelope
    /// already in the hole before the month started can't lend negative
    /// funding.
    ///
    /// The per-category `min(target, …)` matters because target and funded are
    /// both summed across the node's categories: without it one over-stuffed
    /// envelope would mask an empty sibling inside the same node.
    public static func recurringTotals(
        _ book: BudgetBook,
        _ snap: Ledger.MonthSnapshot,
        _ nodeId: NodeId
    ) -> (target: Money, funded: Money) {
        var target = Money.zero
        var funded = Money.zero
        for row in nodeRows(book, snap, nodeId) {
            let catTarget = row.category.monthlyTarget ?? .zero
            let held = max(.zero, row.available - row.activity)
            target += catTarget
            funded += min(catTarget, held)
        }
        return (target, funded)
    }

    /// Emergency fund balance: Σ available over the SmallEF/BigEF union.
    public static func efBalance(_ book: BudgetBook, _ snap: Ledger.MonthSnapshot) -> Money {
        var total = Money.zero
        for cat in efCategories(book) {
            total += snap.categories[cat.id]?.available ?? .zero
        }
        return total
    }

    /// EF target per milestone: SmallEF keeps the computed starter gate;
    /// BigEF's bucket targets may grow the terminal goal beyond
    /// months × expenses but can never shrink it.
    public static func efTarget(_ book: BudgetBook, _ nodeId: NodeId, computed: Money) -> Money {
        guard nodeId == .BigEF else { return computed }
        var buckets = Money.zero
        for cat in efCategories(book) {
            buckets += cat.balanceTarget ?? .zero
        }
        return max(computed, buckets)
    }

    /// SavePurchase / Goals: saved = Σ available, target = Σ balance targets.
    public static func purchaseTotals(
        _ book: BudgetBook,
        _ snap: Ledger.MonthSnapshot,
        _ nodeId: NodeId
    ) -> (saved: Money, target: Money) {
        var saved = Money.zero
        var target = Money.zero
        for row in nodeRows(book, snap, nodeId) {
            saved += row.available
            target += row.category.balanceTarget ?? .zero
        }
        return (saved, target)
    }

    public struct DebtRow: Equatable, Sendable {
        public var account: Account
        /// What's still owed (0 once cleared).
        public var outstanding: Money
        /// Original principal, read from the account's starting transaction.
        public var principal: Money
        public var paid: Bool
    }

    /// The node's open (non-closed) linked debt accounts.
    public static func debtRows(_ book: BudgetBook, _ nodeId: NodeId) -> [DebtRow] {
        linkedAccounts(book, nodeId)
            .filter { $0.closed != true }
            .map { account in
                let balance = Ledger.accountBalance(book, account.id)
                let start = book.transactions.first { $0.id == startingTxnID(account.id) }
                let outstanding = max(.zero, -balance)
                let principal = start.map { max(.zero, -$0.amount) } ?? outstanding
                return DebtRow(
                    account: account,
                    outstanding: outstanding,
                    principal: principal,
                    paid: balance >= .zero
                )
            }
    }

    /// Debt progress: continuous payoff bar. `paid` climbs as outstanding
    /// shrinks against original principal; `allPaid` (every open account
    /// cleared) gates readiness; no linked accounts means not set up yet.
    public static func debtTotals(
        _ book: BudgetBook,
        _ nodeId: NodeId
    ) -> (paid: Money, total: Money, allPaid: Bool, hasAny: Bool) {
        let rows = debtRows(book, nodeId)
        var total = Money.zero
        var outstanding = Money.zero
        for row in rows {
            total += row.principal
            outstanding += row.outstanding
        }
        let paid = min(max(total - outstanding, .zero), total)
        return (paid, total, !rows.isEmpty && rows.allSatisfy(\.paid), !rows.isEmpty)
    }

    public static func collegeBalance(_ book: BudgetBook) -> Money {
        Ledger.accountBalance(book, collegeAccountID)
    }

    // MARK: - Write planners

    public struct AssignmentSet: Equatable, Sendable {
        public var month: String
        public var categoryID: String
        /// Absolute amount, `AppStore.assign` semantics (<= 0 clears).
        public var amount: Money

        public init(month: String, categoryID: String, amount: Money) {
            self.month = month
            self.categoryID = categoryID
            self.amount = amount
        }
    }

    /// A batch of book operations, applied atomically by `AppStore.apply(_:)`.
    public struct BookOps: Equatable, Sendable {
        public var addGroups: [CategoryGroup] = []
        public var addAccounts: [Account] = []
        public var updateAccounts: [Account] = []
        public var addCategories: [BudgetCategory] = []
        public var updateCategories: [BudgetCategory] = []
        public var addTxns: [Txn] = []
        public var updateTxns: [Txn] = []
        public var deleteTxnIDs: [String] = []
        public var setAssignments: [AssignmentSet] = []

        public init() {}
    }

    public static func ensureGroup(_ book: BudgetBook, _ groupID: String) -> CategoryGroup? {
        guard !book.groups.contains(where: { $0.id == groupID }) else { return nil }
        return CategoryGroup(id: groupID, name: groupNames[groupID] ?? groupID, order: book.groups.count)
    }

    public static func ensureAdjustmentAccount(_ book: BudgetBook) -> Account? {
        guard !book.accounts.contains(where: { $0.id == adjustAccountID }) else { return nil }
        return Account(id: adjustAccountID, name: "Adjustments", kind: .cash)
    }

    public static func ensureCollegeAccount(_ book: BudgetBook) -> Account? {
        guard !book.accounts.contains(where: { $0.id == collegeAccountID }) else { return nil }
        return Account(id: collegeAccountID, name: "529 Plan", kind: .tracking, nodeId: .College)
    }

    /// The envelope's outstanding write-offs for a month, newest first.
    ///
    /// Total order is `(date DESC, id DESC)` and must be implemented
    /// identically here and in `nodeLedger.ts`: the two engines have to unwind
    /// the SAME row or a book that round-trips through export/import diverges
    /// between platforms. `.literal` keeps the string comparison code-unit
    /// exact, matching JavaScript's `<`.
    private static func outstandingAdjustments(
        _ book: BudgetBook,
        month: String,
        categoryID: String
    ) -> [Txn] {
        book.transactions
            .filter {
                $0.accountId == adjustAccountID
                    && $0.categoryId == categoryID
                    && Ledger.monthOf(date: $0.date) == month
                    // Matching `t.amount < 0` in `nodeLedger.ts`. Both engines
                    // compare the same integer, so both select the same rows —
                    // before v4 this needed a rounding step each side had to
                    // remember, and a sub-half-cent row was the boundary.
                    && $0.amount < .zero
            }
            .sorted { a, b in
                if a.date != b.date {
                    return a.date.compare(b.date, options: .literal) == .orderedDescending
                }
                return a.id.compare(b.id, options: .literal) == .orderedDescending
            }
    }

    /// Make an envelope's available equal `newAvailable`, expressed in honest
    /// ledger operations. Raising first unwinds this month's outstanding
    /// write-offs newest-first — correcting yesterday's typo today must give
    /// the money back, not burn a second helping of Ready to Assign — and only
    /// the residual assigns more this month. Unwinding stops at the month
    /// boundary: a prior-month write-off crosses the carry clamp, where the
    /// effect on this month's available is no longer 1:1. Lowering un-assigns
    /// toward zero first; the remainder becomes ONE coalesced same-day
    /// "Balance adjustment" transaction on the Adjustments account, keyed by
    /// deterministic txn id so per-keystroke edits self-correct.
    public static func planBalanceEdit(
        _ book: BudgetBook,
        month: String,
        categoryID: String,
        newAvailable: Money,
        today: String
    ) -> BookOps {
        let snap = Ledger.snapshot(book, month: month)
        let entry = snap.categories[categoryID] ?? .zero
        var delta = newAvailable - entry.available
        var ops = BookOps()
        if delta == .zero { return ops }

        let adjID = adjustmentTxnID(categoryID, date: today)
        let existingAdj = book.transactions.first { $0.id == adjID }
        let assigned = entry.assigned

        if delta > .zero {
            for adj in outstandingAdjustments(book, month: month, categoryID: categoryID) {
                if delta <= .zero { break }
                let unwind = min(delta, -adj.amount)
                if adj.amount + unwind == .zero {
                    ops.deleteTxnIDs.append(adj.id)
                } else {
                    var updated = adj
                    updated.amount += unwind
                    ops.updateTxns.append(updated)
                }
                delta -= unwind
            }
            if delta > .zero {
                ops.setAssignments = [AssignmentSet(month: month, categoryID: categoryID, amount: assigned + delta)]
            }
            return ops
        }

        let fromAssign = min(-delta, assigned)
        if fromAssign > .zero {
            ops.setAssignments = [AssignmentSet(month: month, categoryID: categoryID, amount: assigned - fromAssign)]
        }
        let remainder = -delta - fromAssign
        if remainder > .zero {
            if let account = ensureAdjustmentAccount(book) {
                ops.addAccounts = [account]
            }
            let base = existingAdj?.amount ?? .zero
            let txn = Txn(
                id: adjID,
                accountId: adjustAccountID,
                date: today,
                payee: "Balance adjustment",
                amount: base - remainder,
                categoryId: categoryID
            )
            if existingAdj != nil {
                ops.updateTxns = [txn]
            } else {
                ops.addTxns = [txn]
            }
        }
        return ops
    }

    /// One targeted envelope the month's Ready to Assign could not fill.
    public struct FundShortfall: Equatable, Sendable {
        public var categoryID: String
        public var name: String
        /// Cents still needed to reach the monthly target.
        public var short: Money

        public init(categoryID: String, name: String, short: Money) {
            self.categoryID = categoryID
            self.name = name
            self.short = short
        }
    }

    /// What one tap of "Fund this month" would do — described as a *plan*,
    /// before anything is applied. Every count here answers "what is about to
    /// happen", which is what a confirmation dialog has to state out loud.
    public struct FundMonthPlan: Equatable, Sendable {
        public var ops: BookOps
        /// Envelopes carrying a positive monthly target.
        public var targeted: Int
        /// Of those, how many this plan actually moves money into.
        public var funding: Int
        /// Cents this plan moves out of Ready to Assign — Σ of the ops'
        /// increases.
        public var total: Money
        /// Envelopes the money ran out before filling, in book order.
        public var underfunded: [FundShortfall]
        /// Σ of `underfunded[].short`.
        public var shortfall: Money
    }

    /// Fill this month's monthly targets from Ready to Assign, in one batch.
    ///
    /// Assignments are keyed per month, so a new month starts with every
    /// Assigned field at zero — without this, funding ~15 envelopes is ~15
    /// manual number entries on the 1st of every month, forever.
    ///
    /// The need is measured against what the envelope HELD for the month —
    /// `available - activity`, i.e. carryover + assigned — which is the same
    /// quantity `recurringTotals` calls funded. One definition of "funded for
    /// month M", used by both, so the Focus card and this button can never
    /// disagree:
    ///
    /// - Money carried in from last month already covers the target, so a
    ///   month-ahead user is never asked to fund the same envelope twice.
    /// - Spending *from* an envelope during the month does not re-open its
    ///   need. This is a once-a-month contribution, not a refill-to-target
    ///   that stays armed all month and quietly re-funds every dollar spent.
    /// - An envelope overspent this month asks for its target and no more; the
    ///   overspend is the sweep's business (a negative available never
    ///   carries), not something to top up past target out of Ready to Assign.
    ///
    /// Categories are walked in the book's declared order — `book.categories`
    /// as stored, which is a deterministic total order on both platforms —
    /// each taking `min(need, what's left)`. Ready to Assign is the hard
    /// ceiling: it starts at the month's figure (clamped at zero, since a book
    /// already overspent has nothing to hand out) and this action can never
    /// drive it negative. Whatever the money ran out before reaching is
    /// reported, not silently skipped.
    ///
    /// Idempotent for the rest of the month: once an envelope has held its
    /// target, its need is 0 and it emits no op — running this again does
    /// nothing, whatever has been spent since.
    ///
    /// `snap` is an optional precomputed `Ledger.snapshot(book, month:)` —
    /// callers that already have one can pass it through to skip a second
    /// full ledger pass (web parity: BudgetScreen.tsx finding 8). `nil`
    /// (the default) computes it exactly as before.
    public static func planFundMonth(
        _ book: BudgetBook,
        month: String,
        snap precomputed: Ledger.MonthSnapshot? = nil
    ) -> FundMonthPlan {
        let snap = precomputed ?? Ledger.snapshot(book, month: month)
        var remaining = max(.zero, snap.readyToAssign)

        var ops = BookOps()
        var underfunded: [FundShortfall] = []
        var targeted = 0
        var shortfall = Money.zero
        var total = Money.zero

        for cat in book.categories {
            let target = cat.monthlyTarget ?? .zero
            guard target > .zero else { continue }
            targeted += 1
            let m = snap.categories[cat.id] ?? .zero
            // What the envelope held for the month: carryover + assigned.
            // Carryover is never negative (`snapshot` sweeps a month-end hole
            // into Ready to Assign instead of carrying it), so this is >= 0
            // and needs no clamp.
            let held = m.available - m.activity
            let need = max(.zero, target - held)
            if need == .zero { continue }
            let give = min(need, remaining)
            if give > .zero {
                ops.setAssignments.append(
                    AssignmentSet(month: month, categoryID: cat.id, amount: m.assigned + give)
                )
                remaining -= give
                total += give
            }
            if give < need {
                underfunded.append(
                    FundShortfall(categoryID: cat.id, name: cat.name, short: need - give)
                )
                shortfall += need - give
            }
        }

        return FundMonthPlan(
            ops: ops,
            targeted: targeted,
            funding: ops.setAssignments.count,
            total: total,
            underfunded: underfunded,
            shortfall: shortfall
        )
    }

    /// Drive an account's derived balance to `target` via a coalesced
    /// same-day adjustment.
    private static func planAccountBalance(
        _ book: BudgetBook,
        accountID: String,
        target: Money,
        today: String,
        memo: String? = nil
    ) -> BookOps {
        let delta = target - Ledger.accountBalance(book, accountID)
        var ops = BookOps()
        if delta == .zero { return ops }
        let adjID = adjustmentTxnID(accountID, date: today)
        let existing = book.transactions.first { $0.id == adjID }
        let newAmount = (existing?.amount ?? .zero) + delta
        if existing != nil, newAmount == .zero {
            ops.deleteTxnIDs = [adjID]
            return ops
        }
        let txn = Txn(
            id: adjID,
            accountId: accountID,
            date: today,
            payee: "Balance adjustment",
            amount: newAmount,
            memo: memo
        )
        if existing != nil {
            ops.updateTxns = [txn]
        } else {
            ops.addTxns = [txn]
        }
        return ops
    }

    /// Set what's owed on a debt account (its balance is the negative of that).
    public static func planDebtBalanceEdit(
        _ book: BudgetBook,
        accountID: String,
        newOwed: Money,
        today: String
    ) -> BookOps {
        planAccountBalance(book, accountID: accountID, target: -newOwed.magnitude, today: today)
    }

    public static func planCollegeBalanceEdit(
        _ book: BudgetBook,
        newBalance: Money,
        today: String
    ) -> BookOps {
        var ops = planAccountBalance(book, accountID: collegeAccountID, target: newBalance, today: today)
        if let account = ensureCollegeAccount(book) {
            ops.addAccounts.insert(account, at: 0)
        }
        return ops
    }

    public static func planMarkDebtPaid(_ book: BudgetBook, accountID: String, today: String) -> BookOps {
        planAccountBalance(book, accountID: accountID, target: .zero, today: today, memo: "Marked paid")
    }

    /// Create an envelope linked to a node, ensuring its well-known group exists.
    public static func planCreateLinkedCategory(
        _ book: BudgetBook,
        nodeId: NodeId,
        name: String,
        monthlyTarget: Money? = nil,
        balanceTarget: Money? = nil,
        targetDate: String? = nil
    ) -> (ops: BookOps, categoryID: String) {
        let groupID = groupForNode(nodeId)
        let category = BudgetCategory(
            id: ShortID.make(),
            groupId: groupID,
            name: name,
            order: book.categories.count,
            monthlyTarget: monthlyTarget,
            balanceTarget: balanceTarget,
            targetDate: targetDate,
            nodeId: nodeId
        )
        var ops = BookOps()
        ops.addCategories = [category]
        if let group = ensureGroup(book, groupID) {
            ops.addGroups = [group]
        }
        return (ops, category.id)
    }

    /// Create a debt account under a node, with its opening-balance transaction.
    public static func planCreateDebtAccount(
        _ book: BudgetBook,
        nodeId: NodeId,
        name: String,
        balance: Money,
        apr: Decimal,
        minPayment: Money,
        today: String
    ) -> (ops: BookOps, accountID: String) {
        let account = Account(
            id: ShortID.make(),
            name: name,
            kind: .loan,
            apr: apr,
            minPayment: minPayment,
            nodeId: nodeId
        )
        var ops = BookOps()
        ops.addAccounts = [account]
        if balance != .zero {
            ops.addTxns = [
                Txn(
                    id: startingTxnID(account.id),
                    accountId: account.id,
                    date: today,
                    payee: "Starting balance",
                    amount: -balance.magnitude
                ),
            ]
        }
        return (ops, account.id)
    }
}
