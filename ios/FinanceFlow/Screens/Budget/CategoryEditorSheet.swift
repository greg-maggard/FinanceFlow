import SwiftUI
import FinanceFlowKit

/// Edit a category: rename it, set or clear its goal, or delete it. Deleting
/// hands the category's transactions and every month's assigned dollars to one
/// other envelope, together, so no money is invented or lost.
struct CategoryEditorSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let category: BudgetCategory

    private enum GoalKind: String, CaseIterable {
        case none = "No goal"
        case monthly = "Monthly"
        case total = "Total"
    }

    @State private var name = ""
    @State private var goalKind: GoalKind = .none
    @State private var goalAmount: Decimal = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.lg) {
                    LabeledField(label: "Name") {
                        PlainTextField(placeholder: "Category name", text: $name)
                    }

                    VStack(alignment: .leading, spacing: theme.spacing.sm) {
                        FieldLabel(text: "Goal")
                        Picker("Goal", selection: $goalKind) {
                            ForEach(GoalKind.allCases, id: \.self) { kind in
                                Text(kind.rawValue).tag(kind)
                            }
                        }
                        .pickerStyle(.segmented)
                        if goalKind != .none {
                            NumberField(value: goalAmount) { goalAmount = $0 }
                        }
                        Text(goalHint)
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textSecondary)
                    }

                    DeleteCategoryButton(category: category) { dismiss() }
                }
                .padding(theme.spacing.lg)
            }
            .background(theme.materials.sheet)
            .scrollContentBackground(.hidden)
            .navigationTitle(category.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(theme.colors.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { commit() }
                        .foregroundStyle(theme.colors.primary)
                        .disabled(trimmedName.isEmpty)
                }
            }
            .onAppear(perform: seed)
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var goalHint: String {
        switch goalKind {
        case .none: return "No bar — the envelope just holds what you assign."
        case .monthly: return "Needed every month — the bar tracks available vs. this amount."
        case .total: return "Save up to a total — the bar fills as the balance grows."
        }
    }

    private func seed() {
        name = category.name
        if let monthly = category.monthlyTarget, monthly > 0 {
            goalKind = .monthly
            goalAmount = monthly
        } else if let total = category.balanceTarget, total > 0 {
            goalKind = .total
            goalAmount = total
        } else {
            goalKind = .none
            goalAmount = 0
        }
    }

    private func commit() {
        var updated = category
        updated.name = trimmedName
        updated.monthlyTarget = goalKind == .monthly && goalAmount > 0 ? goalAmount : nil
        updated.balanceTarget = goalKind == .total && goalAmount > 0 ? goalAmount : nil
        store.updateCategory(updated)
        dismiss()
    }
}
