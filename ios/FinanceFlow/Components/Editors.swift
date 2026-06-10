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
    let value: Decimal
    let target: Decimal
    var color: Color
    let onDelete: () -> Void
    @ViewBuilder var fields: Fields

    var body: some View {
        GlassCard(padding: theme.spacing.md) {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                HStack {
                    PlainTextField(placeholder: namePlaceholder, text: $name)
                    Button(role: .destructive, action: onDelete) {
                        Image(systemName: "trash").foregroundStyle(theme.colors.danger)
                    }
                    .buttonStyle(.plain)
                }
                fields
                if target > 0 {
                    GoalBar(value: value.displayDouble, max: target.displayDouble, color: color)
                }
            }
        }
    }
}

/// Editable list of debts for HighDebt / ModDebt. Mirrors `DebtFields`.
struct DebtListEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let nodeId: NodeId
    let aprThreshold: Int

    private var debts: [Debt] { store.state.node(nodeId).data?.debts ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            Text("Threshold: \(aprThreshold)%+ APR. Avalanche (highest APR first) or snowball (smallest balance first).")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)

            ForEach(debts) { debt in
                debtCard(debt)
            }

            GlassButton(title: "Add debt", systemImage: "plus") {
                var next = debts
                next.append(Debt(apr: Decimal(aprThreshold)))
                write(next)
            }
        }
    }

    private func debtCard(_ debt: Debt) -> some View {
        GlassCard(padding: theme.spacing.md) {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                HStack {
                    PlainTextField(placeholder: "Name", text: binding(debt, \.name))
                    Button(role: .destructive) { remove(debt) } label: {
                        Image(systemName: "trash").foregroundStyle(theme.colors.danger)
                    }
                    .buttonStyle(.plain)
                }
                HStack(spacing: theme.spacing.sm) {
                    LabeledField(label: "Balance") {
                        NumberField(value: debt.balance) { v in update(debt.id) { $0.balance = v } }
                    }
                    LabeledField(label: "APR %") {
                        PercentField(value: debt.apr) { v in update(debt.id) { $0.apr = v } }
                    }
                    LabeledField(label: "Min pay") {
                        NumberField(value: debt.minPayment) { v in update(debt.id) { $0.minPayment = v } }
                    }
                }
                Toggle(isOn: binding(debt, \.paid)) {
                    Text("Paid off").font(theme.typography.callout).foregroundStyle(theme.colors.textSecondary)
                }
                .tint(theme.colors.success)
            }
        }
    }

    // MARK: - Mutation helpers

    private func write(_ items: [Debt]) { store.setNodeData(nodeId, .debts(items)) }

    private func remove(_ debt: Debt) { write(debts.filter { $0.id != debt.id }) }

    private func update(_ id: String, _ change: (inout Debt) -> Void) {
        var items = debts
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[idx])
        write(items)
    }

    private func binding<V>(_ debt: Debt, _ keyPath: WritableKeyPath<Debt, V>) -> Binding<V> {
        Binding(
            get: { debts.first(where: { $0.id == debt.id })?[keyPath: keyPath] ?? debt[keyPath: keyPath] },
            set: { newValue in
                var items = debts
                guard let idx = items.firstIndex(where: { $0.id == debt.id }) else { return }
                items[idx][keyPath: keyPath] = newValue
                write(items)
            }
        )
    }
}

/// Editable list of near-term goals for the Goals node. Mirrors `GoalsFields`.
struct GoalListEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme

    private var goals: [Goal] { store.state.node(.Goals).data?.goals ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            ForEach(goals) { goal in
                GlassCard(padding: theme.spacing.md) {
                    VStack(alignment: .leading, spacing: theme.spacing.sm) {
                        HStack {
                            PlainTextField(placeholder: "Goal", text: binding(goal, \.name))
                            Button(role: .destructive) { write(goals.filter { $0.id != goal.id }) } label: {
                                Image(systemName: "trash").foregroundStyle(theme.colors.danger)
                            }
                            .buttonStyle(.plain)
                        }
                        HStack(spacing: theme.spacing.sm) {
                            LabeledField(label: "Target") {
                                NumberField(value: goal.target) { v in update(goal.id) { $0.target = v } }
                            }
                            LabeledField(label: "Saved") {
                                NumberField(value: goal.saved) { v in update(goal.id) { $0.saved = v } }
                            }
                            LabeledField(label: "Years") {
                                NumberField(value: goal.horizonYears, onChange: { v in update(goal.id) { $0.horizonYears = v } }, prompt: "1")
                            }
                        }
                    }
                }
            }
            GlassButton(title: "Add goal", systemImage: "plus") {
                write(goals + [Goal()])
            }
        }
    }

    private func write(_ items: [Goal]) { store.setNodeData(.Goals, .goals(items)) }

    private func update(_ id: String, _ change: (inout Goal) -> Void) {
        var items = goals
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[idx])
        write(items)
    }

    private func binding<V>(_ goal: Goal, _ keyPath: WritableKeyPath<Goal, V>) -> Binding<V> {
        Binding(
            get: { goals.first(where: { $0.id == goal.id })?[keyPath: keyPath] ?? goal[keyPath: keyPath] },
            set: { newValue in
                var items = goals
                guard let idx = items.firstIndex(where: { $0.id == goal.id }) else { return }
                items[idx][keyPath: keyPath] = newValue
                write(items)
            }
        )
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
