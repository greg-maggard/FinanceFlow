import SwiftUI
import FinanceFlowKit

/// Badge showing a value's provenance. Manual is muted; external sources stand out.
struct SourceBadge: View {
    @Environment(\.theme) private var theme
    let source: Source

    var body: some View {
        if source != .manual {
            Chip(text: source.rawValue, color: theme.colors.primary)
        } else {
            Chip(text: "manual", color: theme.colors.textTertiary)
        }
    }
}

/// Card chrome shared by sub-goal list editors (recurring items, EF buckets,
/// purchase goals): a name + delete header, caller-supplied fields, and a mini
/// goal bar once the sub-goal has a target.
struct SubGoalCard<Fields: View>: View {
    @Environment(\.theme) private var theme
    let namePlaceholder: String
    @Binding var name: String
    let value: Money
    let target: Money
    var color: Color
    /// Cross-navigation: jump to this row's envelope on the Budget screen.
    var onOpenBudget: (() -> Void)? = nil
    let onDelete: () -> Void
    @ViewBuilder var fields: Fields

    var body: some View {
        GlassCard(padding: theme.spacing.md) {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                HStack {
                    PlainTextField(placeholder: namePlaceholder, text: $name)
                    if let onOpenBudget {
                        // No dismiss() here — RootView's pendingBudgetFocus
                        // onChange closes the node sheet for us.
                        Button(action: onOpenBudget) {
                            Image(systemName: "arrow.up.forward.square")
                                .font(theme.typography.caption)
                                .foregroundStyle(theme.colors.textSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open in Budget")
                    }
                    Button(role: .destructive, action: onDelete) {
                        Image(systemName: "trash").foregroundStyle(theme.colors.danger)
                    }
                    .buttonStyle(.plain)
                }
                fields
                if target > .zero {
                    GoalBar(value: Double(value.cents), max: Double(target.cents), color: color)
                }
            }
        }
    }
}

/// Editable list of debts for HighDebt / ModDebt, over the node's linked loan
/// accounts (`NodeLedger.debtRows`): name/APR/min payment edit the account,
/// the balance field drives what's owed via a coalesced adjustment, and paid
/// is derived from the account ledger. Removing closes the account — history
/// is preserved, never deleted. Mirrors the web `DebtEditor`.
struct DebtListEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(NavigationCenter.self) private var nav
    let nodeId: NodeId
    let aprThreshold: Int

    @State private var pendingRemove: Account?

    var body: some View {
        let rows = NodeLedger.debtRows(store.state.budget, nodeId)

        VStack(alignment: .leading, spacing: theme.spacing.md) {
            Text("Threshold: \(aprThreshold)%+ APR. Avalanche (highest APR first) or snowball (smallest balance first).")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)

            ForEach(rows, id: \.account.id) { row in
                debtCard(row)
            }

            GlassButton(title: "Add debt", systemImage: "plus") {
                store.apply(NodeLedger.planCreateDebtAccount(
                    store.state.budget,
                    nodeId: nodeId,
                    name: "",
                    balance: .zero,
                    apr: Decimal(aprThreshold),
                    minPayment: .zero,
                    today: Ledger.isoDay()
                ).ops)
            }
        }
        .confirmationDialog(
            removeTitle,
            isPresented: removeShown,
            titleVisibility: .visible,
            presenting: pendingRemove
        ) { account in
            Button("Remove", role: .destructive) {
                patchAccount(account.id) { $0.closed = true }
            }
        } message: { _ in
            Text("The account closes; its history stays in Accounts.")
        }
    }

    private func debtCard(_ row: NodeLedger.DebtRow) -> some View {
        GlassCard(padding: theme.spacing.md) {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                HStack {
                    PlainTextField(placeholder: "Name", text: nameBinding(row.account))
                    // No dismiss() here — RootView's pendingBudgetFocus
                    // onChange closes the node sheet for us.
                    Button {
                        nav.openBudget(accountId: row.account.id)
                    } label: {
                        Image(systemName: "arrow.up.forward.square")
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textSecondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open in Budget")
                    Button(role: .destructive) { pendingRemove = row.account } label: {
                        Image(systemName: "trash").foregroundStyle(theme.colors.danger)
                    }
                    .buttonStyle(.plain)
                }
                HStack(spacing: theme.spacing.sm) {
                    LabeledField(label: "Balance") {
                        NumberField(value: row.outstanding) { v in
                            store.apply(NodeLedger.planDebtBalanceEdit(
                                store.state.budget,
                                accountID: row.account.id,
                                newOwed: v,
                                today: Ledger.isoDay()
                            ))
                        }
                    }
                    LabeledField(label: "APR %") {
                        PercentField(value: row.account.apr ?? 0) { v in
                            patchAccount(row.account.id) { $0.apr = v > 0 ? v : nil }
                        }
                    }
                    LabeledField(label: "Min pay") {
                        NumberField(value: row.account.minPayment ?? .zero) { v in
                            patchAccount(row.account.id) { $0.minPayment = v > .zero ? v : nil }
                        }
                    }
                }
                if row.paid {
                    Chip(text: "Paid", color: theme.colors.success)
                } else {
                    GlassButton(title: "Mark paid", systemImage: "checkmark", tint: theme.colors.success) {
                        store.apply(NodeLedger.planMarkDebtPaid(
                            store.state.budget,
                            accountID: row.account.id,
                            today: Ledger.isoDay()
                        ))
                    }
                }
            }
        }
    }

    // MARK: - Mutation helpers

    private func patchAccount(_ id: String, _ change: (inout Account) -> Void) {
        guard var account = store.state.budget.accounts.first(where: { $0.id == id }) else { return }
        change(&account)
        store.updateAccount(account)
    }

    private func nameBinding(_ account: Account) -> Binding<String> {
        Binding(
            get: { store.state.budget.accounts.first { $0.id == account.id }?.name ?? account.name },
            set: { v in patchAccount(account.id) { $0.name = v } }
        )
    }

    private var removeShown: Binding<Bool> {
        Binding(get: { pendingRemove != nil }, set: { if !$0 { pendingRemove = nil } })
    }

    private var removeTitle: String {
        guard let name = pendingRemove?.name, !name.isEmpty else { return "Remove this debt?" }
        return "Remove \(name)?"
    }
}

/// Editable list of near-term goals for the Goals node — the same linked-
/// category editor SavePurchase uses.
struct GoalListEditor: View {
    var body: some View {
        GoalCategoryEditor(nodeId: .Goals)
    }
}

/// Editor over a node's linked savings envelopes (SavePurchase and Goals):
/// name/target/by-date edit the category's goal, "Saved" plans honest ledger
/// operations so the envelope's available matches what's typed. Mirrors the
/// web `GoalEditor`.
struct GoalCategoryEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(NavigationCenter.self) private var nav
    let nodeId: NodeId

    @State private var pendingDelete: BudgetCategory?

    var body: some View {
        let book = store.state.budget
        let snap = Ledger.snapshot(book, month: Recurring.ymKey())
        let rows = NodeLedger.nodeRows(book, snap, nodeId)
        let color = theme.phaseColor(Flowchart.node(nodeId).phase).base

        VStack(alignment: .leading, spacing: theme.spacing.md) {
            if !rows.isEmpty {
                FieldLabel(text: rows.count > 1 ? "Goals" : "Goal")
            }
            ForEach(rows, id: \.category.id) { row in
                SubGoalCard(
                    namePlaceholder: "Goal (e.g. New car)",
                    name: nameBinding(row.category),
                    value: row.available,
                    target: row.category.balanceTarget ?? .zero,
                    color: color,
                    onOpenBudget: { nav.openBudget(categoryId: row.category.id) },
                    onDelete: { pendingDelete = row.category }
                ) {
                    VStack(spacing: theme.spacing.sm) {
                        HStack(spacing: theme.spacing.sm) {
                            LabeledField(label: "Target") {
                                NumberField(value: row.category.balanceTarget ?? .zero) { v in
                                    patchCategory(row.category.id) { $0.balanceTarget = v > .zero ? v : nil }
                                }
                            }
                            LabeledField(label: "Saved") {
                                NumberField(value: row.available) { v in
                                    store.apply(NodeLedger.planBalanceEdit(
                                        store.state.budget,
                                        month: Recurring.ymKey(),
                                        categoryID: row.category.id,
                                        newAvailable: v,
                                        today: Ledger.isoDay()
                                    ))
                                }
                            }
                        }
                        MonthYearField(label: "By date", value: row.category.targetDate) { v in
                            patchCategory(row.category.id) { $0.targetDate = v }
                        }
                    }
                }
            }
            if rows.count > 1 {
                let totals = NodeLedger.purchaseTotals(book, snap, nodeId)
                Text("Total \(CurrencyFormat.string(totals.saved)) of \(CurrencyFormat.string(totals.target))")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
            }
            GlassButton(title: "Add goal", systemImage: "plus") {
                store.apply(NodeLedger.planCreateLinkedCategory(store.state.budget, nodeId: nodeId, name: "").ops)
            }
        }
        .confirmationDialog(
            deleteTitle,
            isPresented: deleteShown,
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { category in
            Button("Delete", role: .destructive) {
                store.deleteCategory(category.id, reassignTo: BudgetBook.uncategorizedCategoryID)
            }
        } message: { category in
            // Spending and funding have to move together, or the delete
            // conjures the spent dollars back into Ready to Assign.
            Text(
                store.state.budget.transactions.contains { $0.categoryId == category.id }
                    ? "Its transactions and its assigned dollars both move to Uncategorized — Ready to Assign doesn't change."
                    : "Nothing was ever spent here — its assigned dollars return to Ready to Assign."
            )
        }
    }

    // MARK: - Mutation helpers

    private func patchCategory(_ id: String, _ change: (inout BudgetCategory) -> Void) {
        guard var category = store.state.budget.categories.first(where: { $0.id == id }) else { return }
        change(&category)
        store.updateCategory(category)
    }

    private func nameBinding(_ category: BudgetCategory) -> Binding<String> {
        Binding(
            get: { store.state.budget.categories.first { $0.id == category.id }?.name ?? category.name },
            set: { v in patchCategory(category.id) { $0.name = v } }
        )
    }

    private var deleteShown: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    private var deleteTitle: String {
        guard let name = pendingDelete?.name, !name.isEmpty else { return "Delete this goal?" }
        return "Delete \(name)?"
    }
}

/// Monthly check-in row for recurring nodes: a toggle for the current month plus
/// a streak indicator and the last few months as dots. Mirrors `StreakBadge` +
/// the `monthlyChecks` flow.
struct MonthlyCheckInRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let nodeId: NodeId

    private var node: NodeState { store.state.node(nodeId) }

    var body: some View {
        let streak = Recurring.streakLength(node)
        let key = Recurring.ymKey()
        let checked = node.monthlyChecks[key] == true

        GlassCard(padding: theme.spacing.md) {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Monthly check-in")
                            .font(theme.typography.callout)
                            .foregroundStyle(theme.colors.textPrimary)
                        Text(streak > 0 ? "\(streak)-month streak 🔥" : "Mark this month paid")
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textSecondary)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { checked },
                        set: { _ in store.toggleMonthlyCheck(nodeId, key) }
                    ))
                    .labelsHidden()
                    .tint(theme.colors.success)
                }
                HStack(spacing: theme.spacing.xs) {
                    ForEach(recentKeys(), id: \.self) { k in
                        Circle()
                            .fill(node.monthlyChecks[k] == true ? theme.colors.success : theme.colors.surfaceElevated)
                            .frame(width: 8, height: 8)
                    }
                }
            }
        }
    }

    private func recentKeys() -> [String] {
        var keys: [String] = []
        var k = Recurring.ymKey()
        for _ in 0..<6 {
            keys.append(k)
            k = Recurring.priorYm(k)
        }
        return keys.reversed()
    }
}
