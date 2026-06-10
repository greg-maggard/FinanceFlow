import SwiftUI
import FinanceFlowKit

/// Add-transaction sheet with three modes. Amounts are always entered as
/// positive magnitudes: expenses are stored negated, income lands in Ready to
/// Assign (`Ledger.rtaCategoryID`), and transfers write a linked pair through
/// `store.addTransfer` (the category applies only when the move crosses the
/// budget boundary).
struct TxnFormSheet: View {
    private enum Mode: String, CaseIterable {
        case expense = "Expense"
        case income = "Income"
        case transfer = "Transfer"
    }

    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var mode: Mode = .expense
    @State private var accountID: String?
    @State private var fromID: String?
    @State private var toID: String?
    @State private var date = Date()
    @State private var payee = ""
    @State private var amount: Decimal = 0
    @State private var categoryID: String?

    private var book: BudgetBook { store.state.budget }
    private var accounts: [Account] { book.accounts.filter { $0.closed != true } }

    /// Visible categories in display order (group order, then category order).
    private var categories: [BudgetCategory] {
        let groupOrder = Dictionary(
            book.groups.map { ($0.id, $0.order) },
            uniquingKeysWith: { first, _ in first }
        )
        return book.categories
            .filter { $0.hidden != true }
            .sorted {
                (groupOrder[$0.groupId] ?? 0, $0.order, $0.name)
                    < (groupOrder[$1.groupId] ?? 0, $1.order, $1.name)
            }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.lg) {
                    if accounts.isEmpty {
                        noAccountsHint
                    } else {
                        Picker("Type", selection: $mode.animation(theme.motion.standard)) {
                            ForEach(Mode.allCases, id: \.self) { m in
                                Text(m.rawValue).tag(m)
                            }
                        }
                        .pickerStyle(.segmented)

                        fields
                    }
                }
                .padding(theme.spacing.lg)
            }
            .background(theme.materials.sheet)
            .scrollContentBackground(.hidden)
            .navigationTitle("Add transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(theme.colors.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { commit() }
                        .foregroundStyle(theme.colors.primary)
                        .disabled(!canCommit)
                }
            }
            .onAppear { seedDefaults() }
        }
    }

    // MARK: - Fields

    @ViewBuilder
    private var fields: some View {
        switch mode {
        case .expense:
            accountPicker($accountID, label: "Account")
            dateRow
            LabeledField(label: "Payee") {
                PlainTextField(placeholder: "e.g. Grocery store", text: $payee)
            }
            LabeledField(label: "Amount") {
                NumberField(value: amount) { amount = $0 }
            }
            categoryPicker
            Text("Saved as an outflow — it spends down the category's available.")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
        case .income:
            accountPicker($accountID, label: "Account")
            dateRow
            LabeledField(label: "Payee") {
                PlainTextField(placeholder: "e.g. Employer", text: $payee)
            }
            LabeledField(label: "Amount") {
                NumberField(value: amount) { amount = $0 }
            }
            LabeledField(label: "Category") {
                lockedCategoryRow
            }
            Text("Income funds Ready to Assign — give those dollars jobs from the budget.")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
        case .transfer:
            accountPicker($fromID, label: "From")
            accountPicker($toID, label: "To")
            dateRow
            LabeledField(label: "Amount") {
                NumberField(value: amount) { amount = $0 }
            }
            if crossesBudgetBoundary {
                categoryPicker
                Text("One side is off-budget, so the money leaves the budget — categorize it.")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
            }
        }
    }

    private func accountPicker(_ selection: Binding<String?>, label: String) -> some View {
        HStack {
            FieldLabel(text: label)
            Spacer()
            Picker(label, selection: selection) {
                ForEach(accounts) { account in
                    Text(account.name).tag(account.id as String?)
                }
            }
            .pickerStyle(.menu)
            .tint(theme.colors.primary)
            .accessibilityLabel("\(label) account")
        }
    }

    private var categoryPicker: some View {
        HStack {
            FieldLabel(text: "Category")
            Spacer()
            Picker("Category", selection: $categoryID) {
                Text("None").tag(nil as String?)
                ForEach(categories) { category in
                    Text(category.name).tag(category.id as String?)
                }
            }
            .pickerStyle(.menu)
            .tint(theme.colors.primary)
            .accessibilityLabel("Category")
        }
    }

    private var dateRow: some View {
        HStack {
            FieldLabel(text: "Date")
            Spacer()
            DatePicker("", selection: $date, displayedComponents: .date)
                .labelsHidden()
                .tint(theme.colors.primary)
                .accessibilityLabel("Date")
        }
    }

    /// Income always inflows to Ready to Assign; shown locked, not pickable.
    private var lockedCategoryRow: some View {
        HStack(spacing: theme.spacing.xs) {
            Image(systemName: "lock.fill")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textTertiary)
            Text("Ready to Assign")
                .font(theme.typography.body)
                .foregroundStyle(theme.colors.textSecondary)
        }
        .padding(.horizontal, theme.spacing.md)
        .padding(.vertical, theme.spacing.sm + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.colors.surface, in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous).strokeBorder(theme.colors.stroke, lineWidth: 1))
    }

    private var noAccountsHint: some View {
        VStack(alignment: .leading, spacing: theme.spacing.sm) {
            Text("No accounts yet")
                .font(theme.typography.headline)
                .foregroundStyle(theme.colors.textPrimary)
            Text("Transactions live in an account. Add one from the Accounts section first.")
                .font(theme.typography.caption)
                .foregroundStyle(theme.colors.textSecondary)
        }
    }

    // MARK: - Commit

    /// True when from/to sit on opposite sides of the budget boundary — the
    /// only case where a transfer needs a category (per `Ledger.pairTransfer`).
    private var crossesBudgetBoundary: Bool {
        guard let from = account(fromID), let to = account(toID) else { return false }
        return Ledger.isOnBudget(from.kind) != Ledger.isOnBudget(to.kind)
    }

    private func account(_ id: String?) -> Account? {
        guard let id else { return nil }
        return accounts.first { $0.id == id }
    }

    private var canCommit: Bool {
        guard amount > 0 else { return false }
        switch mode {
        case .expense, .income:
            return accountID != nil
        case .transfer:
            guard let from = fromID, let to = toID else { return false }
            return from != to
        }
    }

    private func commit() {
        let day = Ledger.isoDay(date)
        let trimmed = payee.trimmingCharacters(in: .whitespacesAndNewlines)
        let payeeOrNil = trimmed.isEmpty ? nil : trimmed
        switch mode {
        case .expense:
            guard let acct = accountID else { return }
            store.addTxn(Txn(
                accountId: acct,
                date: day,
                payee: payeeOrNil,
                amount: -amount,
                categoryId: categoryID
            ))
        case .income:
            guard let acct = accountID else { return }
            store.addTxn(Txn(
                accountId: acct,
                date: day,
                payee: payeeOrNil,
                amount: amount,
                categoryId: Ledger.rtaCategoryID
            ))
        case .transfer:
            guard let from = fromID, let to = toID else { return }
            store.addTransfer(
                from: from,
                to: to,
                amount: amount,
                date: day,
                categoryID: crossesBudgetBoundary ? categoryID : nil
            )
        }
        dismiss()
    }

    private func seedDefaults() {
        if accountID == nil { accountID = accounts.first?.id }
        if fromID == nil { fromID = accounts.first?.id }
        if toID == nil { toID = accounts.dropFirst().first?.id ?? accounts.first?.id }
        if categoryID == nil { categoryID = categories.first?.id }
    }
}
