import Foundation
import Observation
import FinanceFlowKit

/// Where a cross-navigation jump into the Budget screen should land:
/// an envelope row, an account row, or (both nil) just the screen.
struct BudgetFocus: Equatable {
    var categoryId: String?
    var accountId: String?
}

/// House pattern (see `TapAwayCenter`): one `@MainActor @Observable` center
/// owned by RootView and handed down through the environment. Rows request a
/// jump with `open*`; RootView reacts (dismissing the node sheet, switching
/// board mode, presenting the detail sheet); the destination screen consumes
/// the pending value once it has scrolled/highlighted. Keeping the pending
/// state here — not in the row — lets a request made inside a sheet survive
/// that sheet's dismissal.
@MainActor
@Observable
final class NavigationCenter {
    /// Budget jump waiting for the Budget screen to land it.
    private(set) var pendingBudgetFocus: BudgetFocus?
    /// Node waiting for RootView to present its detail sheet.
    private(set) var pendingNode: NodeId?

    func openBudget(categoryId: String? = nil, accountId: String? = nil) {
        pendingBudgetFocus = BudgetFocus(categoryId: categoryId, accountId: accountId)
    }

    func openNode(_ id: NodeId) {
        pendingNode = id
    }

    func consumeBudgetFocus() {
        pendingBudgetFocus = nil
    }

    func consumeNode() {
        pendingNode = nil
    }
}
