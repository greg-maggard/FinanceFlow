import Foundation
import Observation

/// House rule: transient chrome — the expanded mode switcher, a swiped-open
/// delete reveal, an inline assign editor — dismisses when the user interacts
/// anywhere else. The center enforces a single open transient app-wide:
/// opening one displaces whatever was open, and RootView backs the top-bar
/// switcher with a tap-away scrim that swallows the dismissing tap.
///
/// Usage: hold a `@State private var token: Int?`, treat
/// `tapAway.isOpen(token)` as the open flag, claim with `token = tapAway.open()`,
/// and release with `tapAway.close(token)`.
@MainActor
@Observable
final class TapAwayCenter {
    private(set) var openToken: Int?
    private var nextToken = 0

    /// Claim the open slot, displacing whatever held it. Returns the token.
    func open() -> Int {
        nextToken += 1
        openToken = nextToken
        return nextToken
    }

    /// Release the slot, but only if `token` still holds it.
    func close(_ token: Int?) {
        if let token, openToken == token { openToken = nil }
    }

    /// An outside tap: release the slot no matter who holds it.
    func dismiss() {
        openToken = nil
    }

    func isOpen(_ token: Int?) -> Bool {
        token != nil && token == openToken
    }
}
