import SwiftUI
import FinanceFlowKit

/// On- and off-budget accounts with live balances (`Ledger.accountBalance`),
/// plus the add-account sheet. Loan/tracking accounts only report — they can
/// never inflate Ready-to-Assign.
struct AccountsSection: View {
    @Environment(\.theme) private var theme
    @Environment(NavigationCenter.self) private var nav
    let book: BudgetBook
    /// Row to ring after a cross-navigation jump (see BudgetScreen).
    var highlightedId: String? = nil

    @State private var showAdd = false

    private var accounts: [Account] {
        book.accounts.filter { $0.closed != true }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            HStack {
                Text("Accounts")
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)
                Spacer()
                GlassIconButton(systemName: "plus") { showAdd = true }
                    .accessibilityLabel("Add account")
            }

            if accounts.isEmpty {
                GlassCard(padding: theme.spacing.md) {
                    VStack(alignment: .leading, spacing: theme.spacing.sm) {
                        Text("Add your first account — checking, savings, or a credit card — and the budget builds itself from its transactions.")
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textSecondary)
                        GlassButton(title: "Add account", systemImage: "plus") { showAdd = true }
                    }
                }
            } else {
                GlassCard(padding: theme.spacing.md) {
                    VStack(spacing: theme.spacing.md) {
                        ForEach(accounts) { account in
                            row(account)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showAdd) {
            AccountFormSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func row(_ account: Account) -> some View {
        let balance = Ledger.accountBalance(book, account.id)
        let onBudget = Ledger.isOnBudget(account.kind)
        return HStack(spacing: theme.spacing.sm) {
            VStack(alignment: .leading, spacing: theme.spacing.xs) {
                Text(account.name)
                    .font(theme.typography.callout)
                    .foregroundStyle(theme.colors.textPrimary)
                HStack(spacing: theme.spacing.xs) {
                    Text(AccountKindLabel.string(account.kind))
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                    Chip(
                        text: onBudget ? "On budget" : "Off budget",
                        color: onBudget ? theme.colors.success : theme.colors.textTertiary
                    )
                    if let nodeId = account.nodeId {
                        // The account reports into a flowchart node — jump to it.
                        Button {
                            nav.openNode(nodeId)
                        } label: {
                            Chip(text: Flowchart.node(nodeId).label, color: theme.colors.primary)
                        }
                        .buttonStyle(.plain)
                        .lineLimit(1)
                        .accessibilityLabel("Open \(Flowchart.node(nodeId).label) on the path")
                    }
                }
            }
            Spacer()
            Text(CurrencyFormat.string(balance))
                .font(theme.typography.callout)
                .foregroundStyle(balance < 0 ? theme.colors.danger : theme.colors.textPrimary)
        }
        // Keep rows one VoiceOver element unless they carry the node chip,
        // which must stay independently tappable.
        .accessibilityElement(children: account.nodeId == nil ? .combine : .contain)
        // Cross-navigation pulse: a primary ring + glow that BudgetScreen
        // raises on arrival and drops ~2s later. Non-interactive by design.
        .overlay {
            if account.id == highlightedId {
                RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous)
                    .strokeBorder(theme.colors.primary, lineWidth: 1.5)
                    .shadow(color: theme.colors.primary.opacity(0.45), radius: 8)
                    .padding(-theme.spacing.sm)
                    .allowsHitTesting(false)
            }
        }
        .animation(theme.motion.standard, value: account.id == highlightedId)
        // Scroll anchor for BudgetScreen's ScrollViewReader.
        .id(account.id)
    }
}

/// Display names + a stable picker order for `AccountKind` (the kit enum is
/// frozen and not `CaseIterable`, so the list lives here).
enum AccountKindLabel {
    static let all: [AccountKind] = [.checking, .savings, .cash, .credit, .loan, .tracking]

    static func string(_ kind: AccountKind) -> String {
        switch kind {
        case .checking: return "Checking"
        case .savings: return "Savings"
        case .cash: return "Cash"
        case .credit: return "Credit card"
        case .loan: return "Loan"
        case .tracking: return "Tracking"
        }
    }
}

/// Minimal add-account form: name + kind, with APR only where it means
/// something (credit/loan).
struct AccountFormSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var kind: AccountKind = .checking
    @State private var apr: Decimal = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.lg) {
                    LabeledField(label: "Name") {
                        PlainTextField(placeholder: "e.g. Everyday Checking", text: $name)
                    }
                    HStack {
                        FieldLabel(text: "Type")
                        Spacer()
                        Picker("Type", selection: $kind) {
                            ForEach(AccountKindLabel.all, id: \.self) { k in
                                Text(AccountKindLabel.string(k)).tag(k)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(theme.colors.primary)
                        .accessibilityLabel("Account type")
                    }
                    if kind == .credit || kind == .loan {
                        LabeledField(label: "APR %") {
                            PercentField(value: apr) { apr = $0 }
                        }
                    }
                    Text(Ledger.isOnBudget(kind)
                        ? "On budget — its dollars are assignable in the envelope budget."
                        : "Off budget — tracked for the picture only; it can't fund envelopes.")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                }
                .padding(theme.spacing.lg)
            }
            .background(theme.materials.sheet)
            .scrollContentBackground(.hidden)
            .navigationTitle("Add account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(theme.colors.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { commit() }
                        .foregroundStyle(theme.colors.primary)
                        .disabled(trimmedName.isEmpty)
                }
            }
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func commit() {
        store.addAccount(Account(
            name: trimmedName,
            kind: kind,
            apr: (kind == .credit || kind == .loan) && apr > 0 ? apr : nil
        ))
        dismiss()
    }
}
