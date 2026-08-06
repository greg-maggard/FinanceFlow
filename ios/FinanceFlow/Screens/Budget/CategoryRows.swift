import SwiftUI
import FinanceFlowKit

/// Category groups with their envelope rows for the displayed month, plus the
/// add-group / add-category affordances. Assigned is the number you edit here;
/// activity and available are derived by `Ledger` and only read.
struct CategoriesSection: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let book: BudgetBook
    let month: String
    let snapshot: Ledger.MonthSnapshot
    /// Row to ring after a cross-navigation jump (see BudgetScreen).
    var highlightedId: String? = nil

    /// What the single name-entry alert is creating.
    private enum AddTarget {
        case group
        case category(CategoryGroup)
    }

    @State private var addTarget: AddTarget?
    @State private var newName = ""

    private var groups: [CategoryGroup] {
        book.groups.sorted { ($0.order, $0.name) < ($1.order, $1.name) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            if groups.isEmpty {
                emptyState
            } else {
                ForEach(groups) { group in
                    groupCard(group)
                }
                GlassButton(title: "Add group", systemImage: "plus") {
                    newName = ""
                    addTarget = .group
                }
            }
        }
        .alert(alertTitle, isPresented: alertShown, presenting: addTarget) { target in
            TextField("Name", text: $newName)
            Button("Add") { commit(target) }
            Button("Cancel", role: .cancel) { }
        } message: { target in
            switch target {
            case .group:
                Text("Groups organize related envelopes — Bills, Everyday, Fun.")
            case .category:
                Text("A category is an envelope you assign dollars into.")
            }
        }
    }

    // MARK: - Group card

    private func groupCard(_ group: CategoryGroup) -> some View {
        let cats = book.categories
            .filter { $0.groupId == group.id && $0.hidden != true }
            .sorted { ($0.order, $0.name) < ($1.order, $1.name) }

        return GlassCard(padding: theme.spacing.md) {
            VStack(alignment: .leading, spacing: theme.spacing.md) {
                Text(group.name)
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)

                if cats.isEmpty {
                    Text("No categories yet.")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                } else {
                    ForEach(cats) { category in
                        CategoryRow(
                            category: category,
                            month: month,
                            entry: snapshot.categories[category.id]
                                ?? Ledger.CategoryMonth(assigned: 0, activity: 0, available: 0),
                            highlighted: category.id == highlightedId
                        )
                        // Scroll anchor for BudgetScreen's ScrollViewReader.
                        .id(category.id)
                        if category.id != cats.last?.id {
                            Rectangle()
                                .fill(theme.colors.separator)
                                .frame(height: 1)
                        }
                    }
                }

                Button {
                    newName = ""
                    addTarget = .category(group)
                } label: {
                    Label("Add category", systemImage: "plus")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.primary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add category to \(group.name)")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.sm) {
                Text("Give every dollar a job")
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)
                Text("Create your first category group — envelopes live inside groups like Bills or Everyday.")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
                GlassButton(title: "Add group", systemImage: "plus") {
                    newName = ""
                    addTarget = .group
                }
            }
        }
    }

    // MARK: - Add alert plumbing

    private var alertShown: Binding<Bool> {
        Binding(
            get: { addTarget != nil },
            set: { if !$0 { addTarget = nil } }
        )
    }

    private var alertTitle: String {
        switch addTarget {
        case .category(let group): return "New category in \(group.name)"
        default: return "New group"
        }
    }

    private func commit(_ target: AddTarget) {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        switch target {
        case .group:
            store.addGroup(name: name)
        case .category(let group):
            store.addCategory(groupID: group.id, name: name)
        }
    }
}

/// One envelope for the month: name, tappable assigned amount (edits commit
/// through `store.assign`), derived activity, the color-coded available
/// balance, and a thin progress bar once the category has a target.
private struct CategoryRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(TapAwayCenter.self) private var tapAway
    @Environment(NavigationCenter.self) private var nav
    let category: BudgetCategory
    let month: String
    let entry: Ledger.CategoryMonth
    /// Ring this row (cross-navigation just landed on it).
    var highlighted: Bool = false

    @State private var token: Int?
    @State private var showEditor = false

    private var isEditing: Bool { tapAway.isOpen(token) }

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(category.name)
                    .font(theme.typography.callout)
                    .foregroundStyle(theme.colors.textPrimary)
                if let nodeId = category.nodeId {
                    // The envelope reports into a flowchart node — jump to it.
                    Button {
                        nav.openNode(nodeId)
                    } label: {
                        Chip(text: Flowchart.node(nodeId).label, color: theme.colors.primary)
                    }
                    .buttonStyle(.plain)
                    .lineLimit(1)
                    .accessibilityLabel("Open \(Flowchart.node(nodeId).label) on the path")
                }
                Spacer()
                Text(CurrencyFormat.string(entry.available))
                    .font(theme.typography.callout)
                    .foregroundStyle(availableColor)
                Button {
                    showEditor = true
                } label: {
                    Image(systemName: "ellipsis")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Edit \(category.name)")
            }

            if isEditing {
                HStack(spacing: theme.spacing.sm) {
                    Text("Assign")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                    NumberField(value: entry.assigned) { v in
                        store.assign(month: month, categoryID: category.id, amount: v)
                    }
                    GlassIconButton(systemName: "checkmark") {
                        withAnimation(theme.motion.standard) {
                            tapAway.close(token)
                            token = nil
                        }
                    }
                    .accessibilityLabel("Done assigning to \(category.name)")
                }
            } else {
                HStack {
                    Button {
                        withAnimation(theme.motion.standard) { token = tapAway.open() }
                    } label: {
                        HStack(spacing: theme.spacing.xs) {
                            Image(systemName: "pencil")
                            Text("Assigned \(CurrencyFormat.string(entry.assigned))")
                        }
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.primary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit assigned for \(category.name)")
                    Spacer()
                    Text("Activity \(CurrencyFormat.string(entry.activity))")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                }
            }

            if let target = category.monthlyTarget ?? category.balanceTarget, target > 0 {
                targetBar(target: target)
            }
        }
        // Cross-navigation pulse: a primary ring + glow that BudgetScreen
        // raises on arrival and drops ~2s later. Non-interactive by design.
        .overlay {
            if highlighted {
                RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous)
                    .strokeBorder(theme.colors.primary, lineWidth: 1.5)
                    .shadow(color: theme.colors.primary.opacity(0.45), radius: 8)
                    .padding(-theme.spacing.sm)
                    .allowsHitTesting(false)
            }
        }
        .animation(theme.motion.standard, value: highlighted)
        .sheet(isPresented: $showEditor) {
            CategoryEditorSheet(category: category)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var availableColor: Color {
        if entry.available > 0 { return theme.colors.success }
        if entry.available < 0 { return theme.colors.danger }
        return theme.colors.textSecondary
    }

    /// Same thin capsule as RootView's budget pill row: available vs target.
    private func targetBar(target: Decimal) -> some View {
        let fraction = min(1, max(0, (entry.available / target).displayDouble))
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(theme.colors.surface)
                Capsule()
                    .fill(fraction >= 1 ? theme.colors.success : theme.colors.primary)
                    .frame(width: geo.size.width * fraction)
                    .animation(theme.motion.bar, value: fraction)
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// Delete affordance for an envelope, shared by every screen that can delete
/// one. Deleting has to move BOTH of the envelope's terms — its transactions
/// and every month's assigned dollars — to one other envelope, or the delete
/// conjures the spent money back into Ready to Assign. So a spent envelope
/// asks where they go, defaulting to Uncategorized. An envelope no transaction
/// ever touched has no activity to carry and nothing to choose: it just
/// confirms, and its assignments return to Ready to Assign.
struct DeleteCategoryButton: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let category: BudgetCategory
    /// Runs after the delete lands — e.g. to dismiss the enclosing sheet.
    var onDelete: () -> Void = {}

    @State private var confirming = false

    var body: some View {
        // The catch-all holds what other envelopes hand off; it has nowhere to go.
        if category.id != BudgetBook.uncategorizedCategoryID {
            Button {
                confirming = true
            } label: {
                Label("Delete category", systemImage: "trash")
                    .font(theme.typography.callout)
                    .foregroundStyle(theme.colors.danger)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete \(category.name)")
            .sheet(isPresented: $confirming) {
                DeleteCategorySheet(category: category, onDelete: onDelete)
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
            }
        }
    }
}

/// The confirm step: pick the envelope that receives the transactions and the
/// assigned dollars together, then commit.
private struct DeleteCategorySheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let category: BudgetCategory
    var onDelete: () -> Void

    @State private var reassignTo = BudgetBook.uncategorizedCategoryID

    private var book: BudgetBook { store.state.budget }

    private var hasTransactions: Bool {
        book.transactions.contains { $0.categoryId == category.id }
    }

    /// Every other visible envelope, plus Uncategorized — which is created
    /// lazily, so it is offered even before it exists in the book.
    private var choices: [BudgetCategory] {
        var list = book.categories
            .filter { $0.id != category.id && $0.hidden != true }
            .sorted { ($0.order, $0.name) < ($1.order, $1.name) }
        if !list.contains(where: { $0.id == BudgetBook.uncategorizedCategoryID }) {
            list.append(BudgetCategory(
                id: BudgetBook.uncategorizedCategoryID,
                groupId: BudgetBook.systemGroupID,
                name: "Uncategorized",
                order: BudgetBook.systemOrder
            ))
        }
        return list
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.lg) {
                    if hasTransactions {
                        Text("Move \(category.name)'s transactions and money to…")
                            .font(theme.typography.callout)
                            .foregroundStyle(theme.colors.textPrimary)
                        HStack {
                            FieldLabel(text: "Envelope")
                            Spacer()
                            Picker("Envelope", selection: $reassignTo) {
                                ForEach(choices) { choice in
                                    Text(choice.name).tag(choice.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(theme.colors.primary)
                            .accessibilityLabel("Move \(category.name)'s transactions and money to")
                        }
                        Text("Spending and funding move together, so Ready to Assign doesn't change.")
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textSecondary)
                    } else {
                        Text("Nothing was ever spent here — its assigned dollars return to Ready to Assign.")
                            .font(theme.typography.callout)
                            .foregroundStyle(theme.colors.textPrimary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(theme.spacing.lg)
            }
            .background(theme.materials.sheet)
            .scrollContentBackground(.hidden)
            .navigationTitle("Delete \(category.name)?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(theme.colors.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(hasTransactions ? "Move & delete" : "Delete") {
                        store.deleteCategory(
                            category.id,
                            reassignTo: hasTransactions ? reassignTo : BudgetBook.uncategorizedCategoryID
                        )
                        dismiss()
                        onDelete()
                    }
                    .foregroundStyle(theme.colors.danger)
                }
            }
        }
    }
}
