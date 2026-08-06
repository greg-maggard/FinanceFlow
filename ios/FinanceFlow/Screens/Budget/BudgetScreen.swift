import SwiftUI
import Foundation
import FinanceFlowKit

/// The zero-based envelope budget board: month switcher, Ready-to-Assign,
/// category envelopes, accounts, and the transaction ledger. Everything is
/// derived live from `store.state.budget` via `Ledger.snapshot` — bars fill
/// when dollars are ASSIGNED (funded), not when they're spent, and there is
/// no refresh step.
struct BudgetScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationCenter.self) private var nav
    @Environment(\.theme) private var theme
    /// Clearance under the floating top bar (RootView passes this, Trail-style).
    var topInset: CGFloat = 112

    /// The "YYYY-MM" month on display; the chevrons move it.
    @State private var month: String = Recurring.ymKey()
    /// Row ringed after a cross-navigation jump; cleared ~2s later.
    @State private var highlightedId: String?

    var body: some View {
        let book = store.state.budget
        let snapshot = Ledger.snapshot(book, month: month)

        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: theme.spacing.xl) {
                    monthHeader
                    readyToAssignCard(
                        snapshot.readyToAssign,
                        assignedAhead: Ledger.assignedAfter(book, month: month)
                    )
                    CategoriesSection(
                        book: book,
                        month: month,
                        snapshot: snapshot,
                        highlightedId: highlightedId
                    )
                    AccountsSection(book: book, highlightedId: highlightedId)
                    TransactionsSection(book: book)
                }
                .padding(.horizontal, theme.spacing.lg)
                .padding(.top, topInset)
                .padding(.bottom, 60)
            }
            // onAppear covers arrival via RootView's mode switch; onChange
            // covers a jump requested while the board is already showing.
            .onAppear { landPendingFocus(proxy) }
            .onChange(of: nav.pendingBudgetFocus) { _, _ in landPendingFocus(proxy) }
        }
    }

    /// Lands a cross-navigation jump: scroll to the requested envelope or
    /// account row, ring it for ~2s, and consume the request so revisits
    /// stay put. Rows that no longer exist make both steps no-ops.
    private func landPendingFocus(_ proxy: ScrollViewProxy) {
        guard let focus = nav.pendingBudgetFocus else { return }
        nav.consumeBudgetFocus()
        guard let id = focus.categoryId ?? focus.accountId else { return }
        withAnimation(theme.motion.standard) { proxy.scrollTo(id, anchor: .center) }
        withAnimation(theme.motion.standard) { highlightedId = id }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            // Only clear our own pulse — a newer jump may have re-rung.
            if highlightedId == id {
                withAnimation(theme.motion.standard) { highlightedId = nil }
            }
        }
    }

    // MARK: - Month header

    private var monthHeader: some View {
        HStack(spacing: theme.spacing.md) {
            GlassIconButton(systemName: "chevron.left") {
                withAnimation(theme.motion.standard) { month = BudgetMonth.shift(month, by: -1) }
            }
            .accessibilityLabel("Previous month")
            Spacer()
            Text(BudgetMonth.label(month))
                .font(theme.typography.headline)
                .foregroundStyle(theme.colors.textPrimary)
            Spacer()
            GlassIconButton(systemName: "chevron.right") {
                withAnimation(theme.motion.standard) { month = BudgetMonth.shift(month, by: 1) }
            }
            .accessibilityLabel("Next month")
        }
    }

    // MARK: - Ready to Assign

    /// `assignedAhead` is what `Ledger.assignedAfter` reports for months
    /// strictly after the one on display. Ready-to-Assign deliberately ignores
    /// those dollars, so name them here — otherwise money parked in September
    /// looks unspent from August and gets assigned twice. Mirrors the sub-label
    /// under the web RTA pill (`src/components/budget/BudgetScreen.tsx`).
    private func readyToAssignCard(_ rta: Decimal, assignedAhead: Decimal) -> some View {
        let (color, caption): (Color, String) = {
            if rta > 0 { return (theme.colors.success, "Ready to assign — fund your envelopes") }
            if rta < 0 { return (theme.colors.danger, "Overassigned — pull money back from a category") }
            return (theme.colors.textSecondary, "All assigned")
        }()
        return GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.xs) {
                FieldLabel(text: "Ready to Assign")
                Text(CurrencyFormat.string(rta))
                    .font(theme.typography.display)
                    .foregroundStyle(color)
                Text(caption)
                    .font(theme.typography.caption)
                    .foregroundStyle(color)
                if assignedAhead != 0 {
                    Text("\(CurrencyFormat.string(assignedAhead)) assigned in future months")
                        .font(theme.typography.caption)
                        .foregroundStyle(theme.colors.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Tiny "YYYY-MM" arithmetic for the month chevrons. String-based on purpose so
/// it can never drift from the `Recurring.ymKey()` key convention.
enum BudgetMonth {
    /// The key `delta` months away from `key` (rolls across year boundaries).
    static func shift(_ key: String, by delta: Int) -> String {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return key }
        let zeroBased = parts[0] * 12 + (parts[1] - 1) + delta
        guard zeroBased >= 0 else { return key }
        return String(format: "%04d-%02d", zeroBased / 12, zeroBased % 12 + 1)
    }

    /// Human label for a key — e.g. "June 2026".
    static func label(_ key: String) -> String {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, (1...12).contains(parts[1]) else { return key }
        return "\(Calendar.current.monthSymbols[parts[1] - 1]) \(parts[0])"
    }
}
