import SwiftUI
import FinanceFlowKit

/// Dispatches to the right editing form for a node. Money-bearing forms edit
/// the envelope ledger directly — the same book the Budget screen shows (see
/// `Domain/NodeLedger.swift`) — so node and Budget edits are bilateral by
/// construction. Percent/YTD nodes still write their payloads through
/// `store.setNodeData`. Mirrors `FORM_BY_NODE` in the web's `forms.tsx`.
struct NodeForm: View {
    let nodeId: NodeId

    var body: some View {
        switch nodeId {
        case .Rent, .Food, .Essential, .Income, .Health, .MinDebt, .NonEssential:
            RecurringForm(nodeId: nodeId)
        case .SmallEF: SmallEFForm()
        case .BigEF: BigEFForm()
        case .Match: MatchForm()
        case .IRA: IRAForm()
        case .HSA: HSAForm()
        case .Increase401k: Increase401kForm()
        case .SavePurchase: SavePurchaseForm()
        case .College: CollegeForm()
        case .HighDebt: DebtListEditor(nodeId: .HighDebt, aprThreshold: 10)
        case .ModDebt: DebtListEditor(nodeId: .ModDebt, aprThreshold: 4)
        case .Goals: GoalListEditor()
        default: EmptyView()
        }
    }
}

// MARK: - Recurring

/// Editor over the node's linked envelopes: Target edits the category's
/// monthly goal, "Saved this month" edits the current month's assignment —
/// the same numbers the Budget screen shows for those categories.
private struct RecurringForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let nodeId: NodeId

    @State private var pendingDelete: BudgetCategory?

    private var phaseColor: Color { theme.phaseColor(Flowchart.node(nodeId).phase).base }

    var body: some View {
        let book = store.state.budget
        let snap = Ledger.snapshot(book, month: Recurring.ymKey())
        let rows = NodeLedger.nodeRows(book, snap, nodeId)
        let totals = NodeLedger.recurringTotals(book, snap, nodeId)

        VStack(alignment: .leading, spacing: theme.spacing.md) {
            if rows.isEmpty {
                firstWritePair
            } else {
                itemsEditor(rows, totals: totals)
            }
        }
        .confirmationDialog(
            deleteTitle,
            isPresented: deleteShown,
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { category in
            Button("Delete", role: .destructive) { store.deleteCategory(category.id) }
        } message: { _ in
            Text("Its transactions stay, uncategorized, and assigned dollars return to Ready to Assign.")
        }
    }

    /// No envelopes yet: a plain pair whose first keystroke creates the node's
    /// single category (named after the node) and writes through it.
    private var firstWritePair: some View {
        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            HStack(spacing: theme.spacing.md) {
                LabeledField(label: "Monthly target") {
                    NumberField(value: 0) { v in
                        patchCategory(ensureFirstCategory()) { $0.monthlyTarget = v > 0 ? v : nil }
                    }
                }
                LabeledField(label: "Saved this month") {
                    NumberField(value: 0) { v in
                        store.assign(month: Recurring.ymKey(), categoryID: ensureFirstCategory(), amount: v)
                    }
                }
            }
            Text("Add an item to set this month's goal.")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
        }
    }

    private func itemsEditor(_ rows: [NodeLedger.NodeRow], totals: (target: Decimal, funded: Decimal)) -> some View {
        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            FieldLabel(text: "Items")
            ForEach(rows, id: \.category.id) { row in
                SubGoalCard(
                    namePlaceholder: "Item (e.g. Power)",
                    name: nameBinding(row.category),
                    value: row.assigned,
                    target: row.category.monthlyTarget ?? 0,
                    color: phaseColor,
                    onDelete: { pendingDelete = row.category }
                ) {
                    HStack(spacing: theme.spacing.sm) {
                        LabeledField(label: "Target") {
                            NumberField(value: row.category.monthlyTarget ?? 0) { v in
                                patchCategory(row.category.id) { $0.monthlyTarget = v > 0 ? v : nil }
                            }
                        }
                        LabeledField(label: "Saved this month") {
                            NumberField(value: row.assigned) { v in
                                store.assign(month: Recurring.ymKey(), categoryID: row.category.id, amount: v)
                            }
                        }
                    }
                }
            }
            Text("Total \(CurrencyFormat.string(totals.funded)) of \(CurrencyFormat.string(totals.target))")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
            GlassButton(title: "Add item", systemImage: "plus") {
                store.apply(NodeLedger.planCreateLinkedCategory(store.state.budget, nodeId: nodeId, name: "").ops)
            }
        }
    }

    /// The node's single envelope for first writes — reused if it already
    /// exists, created (named after the node) if not.
    private func ensureFirstCategory() -> String {
        if let existing = NodeLedger.linkedCategories(store.state.budget, nodeId).first {
            return existing.id
        }
        let plan = NodeLedger.planCreateLinkedCategory(
            store.state.budget,
            nodeId: nodeId,
            name: Flowchart.node(nodeId).label
        )
        store.apply(plan.ops)
        return plan.categoryID
    }

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
        guard let name = pendingDelete?.name, !name.isEmpty else { return "Delete this item?" }
        return "Delete \(name)?"
    }
}

// MARK: - Emergency funds

private struct SmallEFForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let book = store.state.budget
        let snap = Ledger.snapshot(book, month: Recurring.ymKey())
        let rows = NodeLedger.nodeRows(book, snap, .SmallEF)
        let computed = emergencyFundTarget(monthlyExpenses: store.state.settings.monthlyExpenses)
        let target = NodeLedger.efTarget(book, .SmallEF, computed: computed)

        VStack(alignment: .leading, spacing: theme.spacing.md) {
            Text("Target: \(CurrencyFormat.string(target))")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
            if rows.isEmpty {
                EFFirstBalanceField(nodeId: .SmallEF, computedTarget: computed)
            } else {
                EFBucketEditor(nodeId: .SmallEF, rows: rows, computedTarget: computed)
            }
        }
    }
}

private struct BigEFForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let book = store.state.budget
        let snap = Ledger.snapshot(book, month: Recurring.ymKey())
        let rows = NodeLedger.nodeRows(book, snap, .BigEF)
        let months = store.state.node(.BigEF).data?.bigEF?.targetMonths ?? 3
        let computed = bigEmergencyFundTarget(months: months, monthlyExpenses: store.state.settings.monthlyExpenses)
        let target = NodeLedger.efTarget(book, .BigEF, computed: computed)

        VStack(alignment: .leading, spacing: theme.spacing.md) {
            LabeledField(label: "Target months") {
                Picker("", selection: Binding(
                    get: { months },
                    set: { store.setNodeData(.BigEF, .bigEF(BigEFData(targetMonths: $0))) }
                )) {
                    ForEach([3, 4, 5, 6], id: \.self) { Text("\($0) mo").tag($0) }
                }
                .pickerStyle(.segmented)
            }
            if rows.isEmpty {
                EFFirstBalanceField(nodeId: .BigEF, computedTarget: computed)
            } else {
                EFBucketEditor(nodeId: .BigEF, rows: rows, computedTarget: computed)
            }
            Text(target > 0 ? "Target: \(CurrencyFormat.string(target))" : "Set monthly expenses in Settings to compute target.")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
        }
    }
}

/// Empty fund: one "Current balance" field whose first keystroke creates the
/// single "Emergency Fund" envelope (target = the computed milestone, when it
/// has one) and then plans the balance edit against it.
private struct EFFirstBalanceField: View {
    @Environment(AppStore.self) private var store
    /// Host milestone — the created envelope reports into this node.
    let nodeId: NodeId
    let computedTarget: Decimal

    var body: some View {
        LabeledField(label: "Current balance") {
            NumberField(value: 0) { v in writeFirstBalance(v) }
        }
    }

    private func writeFirstBalance(_ v: Decimal) {
        let categoryID: String
        if let existing = NodeLedger.efCategories(store.state.budget).first {
            categoryID = existing.id
        } else {
            let plan = NodeLedger.planCreateLinkedCategory(
                store.state.budget,
                nodeId: nodeId,
                name: "Emergency Fund",
                balanceTarget: computedTarget > 0 ? computedTarget : nil
            )
            store.apply(plan.ops)
            categoryID = plan.categoryID
        }
        store.apply(NodeLedger.planBalanceEdit(
            store.state.budget,
            month: Recurring.ymKey(),
            categoryID: categoryID,
            newAvailable: v,
            today: Ledger.isoDay()
        ))
    }
}

/// Bucket editor shared by the two emergency-fund forms, over the SmallEF ∪
/// BigEF envelope union: name/target edit the category, balance plans honest
/// ledger operations, and new buckets report into the host milestone.
private struct EFBucketEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    /// Host milestone — new buckets get this node's id.
    let nodeId: NodeId
    let rows: [NodeLedger.NodeRow]
    let computedTarget: Decimal

    @State private var pendingDelete: BudgetCategory?

    var body: some View {
        let bucketTargets = rows.reduce(Decimal(0)) { $0 + ($1.category.balanceTarget ?? 0) }
        let color = theme.phaseColor(Flowchart.node(nodeId).phase).base
        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            FieldLabel(text: "Buckets")
            ForEach(rows, id: \.category.id) { row in
                SubGoalCard(
                    namePlaceholder: "Bucket (e.g. Medical)",
                    name: nameBinding(row.category),
                    value: row.available,
                    target: row.category.balanceTarget ?? 0,
                    color: color,
                    onDelete: { pendingDelete = row.category }
                ) {
                    HStack(spacing: theme.spacing.sm) {
                        LabeledField(label: "Target") {
                            NumberField(value: row.category.balanceTarget ?? 0) { v in
                                patchCategory(row.category.id) { $0.balanceTarget = v > 0 ? v : nil }
                            }
                        }
                        LabeledField(label: "Balance") {
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
                }
            }
            if bucketTargets < computedTarget {
                Text("Buckets cover \(CurrencyFormat.string(bucketTargets)) of your \(CurrencyFormat.string(computedTarget)) target — \(CurrencyFormat.string(computedTarget - bucketTargets)) unallocated.")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
            }
            GlassButton(title: "Add bucket", systemImage: "plus") {
                store.apply(NodeLedger.planCreateLinkedCategory(store.state.budget, nodeId: nodeId, name: "").ops)
            }
        }
        .confirmationDialog(
            deleteTitle,
            isPresented: deleteShown,
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { category in
            Button("Delete", role: .destructive) { store.deleteCategory(category.id) }
        } message: { _ in
            Text("Its transactions stay, uncategorized, and assigned dollars return to Ready to Assign.")
        }
    }

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
        guard let name = pendingDelete?.name, !name.isEmpty else { return "Delete this bucket?" }
        return "Delete \(name)?"
    }
}

// MARK: - Match / 401k

private struct MatchForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let d = store.state.node(.Match).data?.match ?? (matchPct: 0, currentContribPct: 0)
        HStack(spacing: theme.spacing.md) {
            LabeledField(label: "Match cap %") {
                PercentField(value: d.matchPct) { store.setNodeData(.Match, .match(matchPct: $0, currentContribPct: d.currentContribPct)) }
            }
            LabeledField(label: "Your %") {
                PercentField(value: d.currentContribPct) { store.setNodeData(.Match, .match(matchPct: d.matchPct, currentContribPct: $0)) }
            }
        }
    }
}

private struct Increase401kForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let d = store.state.node(.Increase401k).data?.increase401k ?? (currentPct: 0, targetPct: 15)
        HStack(spacing: theme.spacing.md) {
            LabeledField(label: "Your %") {
                PercentField(value: d.currentPct) { store.setNodeData(.Increase401k, .increase401k(currentPct: $0, targetPct: d.targetPct)) }
            }
            LabeledField(label: "Target %") {
                PercentField(value: d.targetPct) { store.setNodeData(.Increase401k, .increase401k(currentPct: d.currentPct, targetPct: $0)) }
            }
        }
    }
}

// MARK: - IRA / HSA

private struct IRAForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let d = store.state.node(.IRA).data?.ira
            ?? IRAData(type: .roth, ytdContribution: .manual(0), annualLimit: store.state.settings.iraAnnualLimit)
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            LabeledField(label: "Type") {
                Picker("", selection: Binding(
                    get: { d.type },
                    set: { write(d, type: $0) }
                )) {
                    Text("Roth IRA").tag(IRAType.roth)
                    Text("Traditional").tag(IRAType.traditional)
                }
                .pickerStyle(.segmented)
            }
            HStack(spacing: theme.spacing.md) {
                LabeledField(label: "YTD") {
                    NumberField(value: d.ytdContribution.value) { write(d, ytd: $0) }
                }
                LabeledField(label: "Annual limit") {
                    NumberField(value: d.annualLimit) { write(d, limit: $0) }
                }
            }
        }
    }

    private func write(_ d: IRAData, type: IRAType? = nil, ytd: Decimal? = nil, limit: Decimal? = nil) {
        store.setNodeData(.IRA, .ira(IRAData(
            type: type ?? d.type,
            ytdContribution: .manual(ytd ?? d.ytdContribution.value),
            annualLimit: limit ?? d.annualLimit
        )))
    }
}

private struct HSAForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = store.state.settings
        let d = store.state.node(.HSA).data?.hsa
            ?? HSAData(coverage: .`self`, ytdContribution: .manual(0), annualLimit: settings.hsaSelfLimit)
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            LabeledField(label: "Coverage") {
                Picker("", selection: Binding(
                    get: { d.coverage },
                    set: { cov in
                        let limit = cov == .`self` ? settings.hsaSelfLimit : settings.hsaFamilyLimit
                        store.setNodeData(.HSA, .hsa(HSAData(coverage: cov, ytdContribution: d.ytdContribution, annualLimit: limit)))
                    }
                )) {
                    Text("Self-only").tag(HSACoverage.`self`)
                    Text("Family").tag(HSACoverage.family)
                }
                .pickerStyle(.segmented)
            }
            HStack(spacing: theme.spacing.md) {
                LabeledField(label: "YTD") {
                    NumberField(value: d.ytdContribution.value) {
                        store.setNodeData(.HSA, .hsa(HSAData(coverage: d.coverage, ytdContribution: .manual($0), annualLimit: d.annualLimit)))
                    }
                }
                LabeledField(label: "Annual limit") {
                    NumberField(value: d.annualLimit) {
                        store.setNodeData(.HSA, .hsa(HSAData(coverage: d.coverage, ytdContribution: d.ytdContribution, annualLimit: $0)))
                    }
                }
            }
        }
    }
}

// MARK: - SavePurchase / College

private struct SavePurchaseForm: View {
    var body: some View {
        GoalCategoryEditor(nodeId: .SavePurchase)
    }
}

private struct CollegeForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let d = store.state.node(.College).data?.college ?? CollegeData()
        let balance = NodeLedger.collegeBalance(store.state.budget)
        HStack(spacing: theme.spacing.md) {
            LabeledField(label: "Monthly") {
                NumberField(value: d.monthlyContribution) { v in
                    store.setNodeData(.College, .college(CollegeData(
                        monthlyContribution: v,
                        balance: d.balance,
                        targetAge: d.targetAge
                    )))
                }
            }
            LabeledField(label: "Balance") {
                NumberField(value: balance) { v in
                    store.apply(NodeLedger.planCollegeBalanceEdit(
                        store.state.budget,
                        newBalance: v,
                        today: Ledger.isoDay()
                    ))
                }
            }
        }
    }
}
