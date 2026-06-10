import SwiftUI
import FinanceFlowKit

/// Dispatches to the right editing form for a node's `NodeData` shape.
/// Each form reads the current value (with sensible defaults) and writes back
/// through `store.setNodeData`. Mirrors `FORM_BY_NODE` in the web's `forms.tsx`.
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

private struct RecurringForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let nodeId: NodeId

    private var data: RecurringData { store.state.node(nodeId).data?.recurring ?? RecurringData() }
    private var phaseColor: Color { theme.phaseColor(Flowchart.node(nodeId).phase).base }

    var body: some View {
        let items = data.items ?? []
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            if items.isEmpty {
                HStack(spacing: theme.spacing.md) {
                    LabeledField(label: "Monthly target") {
                        NumberField(value: data.target.value) { v in write { $0.target = .manual(v) } }
                    }
                    LabeledField(label: "Saved this month") {
                        NumberField(value: data.funded?.value ?? 0) { v in write { $0.funded = .manual(v) } }
                    }
                }
                GlassButton(title: "Split into items", systemImage: "list.bullet") {
                    // Seed item #1 from the single amounts so the node total carries over.
                    writeItems([RecurringItem(target: data.target, funded: data.funded)])
                }
            } else {
                itemsEditor(items)
            }
        }
    }

    private func itemsEditor(_ items: [RecurringItem]) -> some View {
        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            FieldLabel(text: "Items")
            ForEach(items) { item in
                SubGoalCard(
                    namePlaceholder: "Item (e.g. Power)",
                    name: itemBinding(item, \.name),
                    value: item.funded?.value ?? 0,
                    target: item.target.value,
                    color: phaseColor,
                    onDelete: { writeItems(items.filter { $0.id != item.id }) }
                ) {
                    HStack(spacing: theme.spacing.sm) {
                        LabeledField(label: "Target") {
                            NumberField(value: item.target.value) { v in patchItem(item.id) { $0.target = .manual(v) } }
                        }
                        LabeledField(label: "Saved") {
                            NumberField(value: item.funded?.value ?? 0) { v in patchItem(item.id) { $0.funded = .manual(v) } }
                        }
                    }
                }
            }
            Text("Total \(CurrencyFormat.string(data.effectiveFunded)) of \(CurrencyFormat.string(data.effectiveTarget))")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
            GlassButton(title: "Add item", systemImage: "plus") {
                writeItems(items + [RecurringItem()])
            }
            Button {
                // Collapse back to a single pair, keeping the totals.
                write {
                    $0.target = .manual($0.effectiveTarget)
                    $0.funded = .manual($0.effectiveFunded)
                    $0.items = nil
                }
            } label: {
                Text("Use single amount")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
            }
            .buttonStyle(.plain)
        }
    }

    private func write(_ change: (inout RecurringData) -> Void) {
        var d = data
        change(&d)
        store.setNodeData(nodeId, .recurring(d))
    }

    private func writeItems(_ items: [RecurringItem]) {
        write { $0.items = items.isEmpty ? nil : items }
    }

    private func patchItem(_ id: String, _ change: (inout RecurringItem) -> Void) {
        var items = data.items ?? []
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[idx])
        writeItems(items)
    }

    private func itemBinding(_ item: RecurringItem, _ kp: WritableKeyPath<RecurringItem, String>) -> Binding<String> {
        Binding(
            get: { (data.items?.first { $0.id == item.id })?[keyPath: kp] ?? item[keyPath: kp] },
            set: { newValue in
                var items = data.items ?? []
                guard let idx = items.firstIndex(where: { $0.id == item.id }) else { return }
                items[idx][keyPath: kp] = newValue
                writeItems(items)
            }
        )
    }
}

// MARK: - Emergency funds

private struct SmallEFForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let balance = store.state.node(.SmallEF).data?.smallEFBalance?.value ?? 0
        let target = emergencyFundTarget(monthlyExpenses: store.state.settings.monthlyExpenses)
        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            Text("Target: \(CurrencyFormat.string(target))")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
            LabeledField(label: "Current balance") {
                NumberField(value: balance) { store.setNodeData(.SmallEF, .smallEF(balance: .manual($0))) }
            }
        }
    }
}

private struct BigEFForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let current = store.state.node(.BigEF).data?.bigEF
        let months = current?.targetMonths ?? 3
        let balance = current?.balance.value ?? 0
        let target = bigEmergencyFundTarget(months: months, monthlyExpenses: store.state.settings.monthlyExpenses)

        VStack(alignment: .leading, spacing: theme.spacing.md) {
            LabeledField(label: "Target months") {
                Picker("", selection: Binding(
                    get: { months },
                    set: { store.setNodeData(.BigEF, .bigEF(targetMonths: $0, balance: .manual(balance))) }
                )) {
                    ForEach([3, 4, 5, 6], id: \.self) { Text("\($0) mo").tag($0) }
                }
                .pickerStyle(.segmented)
            }
            LabeledField(label: "Balance") {
                NumberField(value: balance) { store.setNodeData(.BigEF, .bigEF(targetMonths: months, balance: .manual($0))) }
            }
            Text(target > 0 ? "Target: \(CurrencyFormat.string(target))" : "Set monthly expenses in Settings to compute target.")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
        }
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
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let d = store.state.node(.SavePurchase).data?.savePurchase ?? SavePurchaseData()
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            LabeledField(label: "Goal name") {
                PlainTextField(placeholder: "e.g. New car", text: Binding(
                    get: { d.goalName },
                    set: { write(d, name: $0) }
                ))
            }
            HStack(spacing: theme.spacing.md) {
                LabeledField(label: "Target") {
                    NumberField(value: d.target) { write(d, target: $0) }
                }
                LabeledField(label: "Saved") {
                    NumberField(value: d.saved.value) { write(d, saved: $0) }
                }
            }
            MonthYearField(label: "By date", value: d.byDate) { write(d, byDate: $0) }
        }
    }

    private func write(_ d: SavePurchaseData, name: String? = nil, target: Decimal? = nil, saved: Decimal? = nil, byDate: String?? = nil) {
        store.setNodeData(.SavePurchase, .savePurchase(SavePurchaseData(
            goalName: name ?? d.goalName,
            target: target ?? d.target,
            saved: .manual(saved ?? d.saved.value),
            byDate: byDate ?? d.byDate
        )))
    }
}

private struct CollegeForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    var body: some View {
        let d = store.state.node(.College).data?.college ?? CollegeData()
        HStack(spacing: theme.spacing.md) {
            LabeledField(label: "Monthly") {
                NumberField(value: d.monthlyContribution) { write(d, monthly: $0) }
            }
            LabeledField(label: "Balance") {
                NumberField(value: d.balance.value) { write(d, balance: $0) }
            }
        }
    }

    private func write(_ d: CollegeData, monthly: Decimal? = nil, balance: Decimal? = nil) {
        store.setNodeData(.College, .college(CollegeData(
            monthlyContribution: monthly ?? d.monthlyContribution,
            balance: .manual(balance ?? d.balance.value),
            targetAge: d.targetAge
        )))
    }
}
