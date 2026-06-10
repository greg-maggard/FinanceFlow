import SwiftUI
import Foundation
import FinanceFlowKit

/// The ledger, newest day first, with swipe-to-delete and the add-transaction
/// entry point. Transfer rows aren't editable — delete is the only action, and
/// `store.deleteTxn` removes the paired row atomically.
struct TransactionsSection: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    let book: BudgetBook

    @State private var showAdd = false

    private var transactions: [Txn] {
        book.transactions.sorted { ($0.date, $0.id) > ($1.date, $1.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.md) {
            HStack {
                Text("Transactions")
                    .font(theme.typography.headline)
                    .foregroundStyle(theme.colors.textPrimary)
                Spacer()
                GlassIconButton(systemName: "plus") { showAdd = true }
                    .accessibilityLabel("Add transaction")
            }

            if transactions.isEmpty {
                GlassCard(padding: theme.spacing.md) {
                    Text("No transactions yet — add income to fund Ready to Assign, then spend from your envelopes.")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ForEach(transactions) { txn in
                    TxnRow(book: book, txn: txn) { store.deleteTxn(txn.id) }
                }
            }
        }
        .sheet(isPresented: $showAdd) {
            TxnFormSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

/// One ledger row in its own glass card (so the swipe reveal reads cleanly):
/// payee or transfer arrow, category · account, signed amount, date.
private struct TxnRow: View {
    @Environment(\.theme) private var theme
    let book: BudgetBook
    let txn: Txn
    let onDelete: () -> Void

    var body: some View {
        SwipeToDeleteRow(onDelete: onDelete) {
            GlassCard(padding: theme.spacing.md) {
                HStack(spacing: theme.spacing.sm) {
                    VStack(alignment: .leading, spacing: theme.spacing.xs) {
                        Text(title)
                            .font(theme.typography.callout)
                            .foregroundStyle(theme.colors.textPrimary)
                            .lineLimit(1)
                        Text(subtitle)
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: theme.spacing.xs) {
                        Text(CurrencyFormat.string(txn.amount))
                            .font(theme.typography.callout)
                            .foregroundStyle(txn.amount > 0 ? theme.colors.success : theme.colors.textPrimary)
                        Text(TxnDate.string(txn.date))
                            .font(theme.typography.caption)
                            .foregroundStyle(theme.colors.textTertiary)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Delete") { onDelete() }
    }

    private var title: String {
        if let other = txn.transferAccountId {
            return txn.amount < 0 ? "Transfer → \(accountName(other))" : "Transfer ← \(accountName(other))"
        }
        if let payee = txn.payee, !payee.isEmpty { return payee }
        return txn.amount > 0 ? "Income" : "Spending"
    }

    private var subtitle: String {
        var parts: [String] = []
        if let categoryId = txn.categoryId {
            if categoryId == Ledger.rtaCategoryID {
                parts.append("Ready to Assign")
            } else if let category = book.categories.first(where: { $0.id == categoryId }) {
                parts.append(category.name)
            }
        }
        parts.append(accountName(txn.accountId))
        return parts.joined(separator: " · ")
    }

    private func accountName(_ id: String) -> String {
        book.accounts.first { $0.id == id }?.name ?? "Account"
    }
}

/// "YYYY-MM-DD" → a medium local date ("Jun 9, 2026") for row display.
/// Parsing is pinned to POSIX, matching how `Txn.date` strings are built.
private enum TxnDate {
    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()

    static func string(_ iso: String) -> String {
        guard let date = parser.date(from: iso) else { return iso }
        return formatter.string(from: date)
    }
}

/// ScrollView-friendly swipe-to-delete: drag a row left to reveal a themed
/// delete button. (`.swipeActions` needs a `List`, and the budget board is
/// card-based like the rest of the app.) Mostly-vertical drags are ignored so
/// the scroll view keeps them; VoiceOver gets a named action on the row above.
private struct SwipeToDeleteRow<Content: View>: View {
    @Environment(\.theme) private var theme
    let onDelete: () -> Void
    @ViewBuilder var content: Content

    @State private var offset: CGFloat = 0
    @State private var isOpen = false

    private var revealWidth: CGFloat { theme.spacing.xxl * 2 }

    var body: some View {
        content
            .offset(x: offset)
            .background(alignment: .trailing) {
                Button {
                    withAnimation(theme.motion.standard) { onDelete() }
                } label: {
                    Image(systemName: "trash")
                        .font(theme.typography.headline)
                        .foregroundStyle(theme.colors.onAccent)
                        .frame(width: revealWidth)
                        .frame(maxHeight: .infinity)
                        .background(
                            theme.colors.danger,
                            in: RoundedRectangle(cornerRadius: theme.radii.lg, style: .continuous)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete transaction")
                .opacity(offset < 0 ? 1 : 0)
            }
            .gesture(drag)
            .onTapGesture {
                guard isOpen else { return }
                withAnimation(theme.motion.standard) {
                    isOpen = false
                    offset = 0
                }
            }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: theme.spacing.lg)
            .onChanged { value in
                // Leave mostly-vertical drags to the scroll view.
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                let base: CGFloat = isOpen ? -revealWidth : 0
                offset = min(0, max(-revealWidth, base + value.translation.width))
            }
            .onEnded { value in
                let base: CGFloat = isOpen ? -revealWidth : 0
                let settled = base + value.translation.width
                withAnimation(theme.motion.standard) {
                    if settled < -revealWidth / 2 {
                        isOpen = true
                        offset = -revealWidth
                    } else {
                        isOpen = false
                        offset = 0
                    }
                }
            }
    }
}
