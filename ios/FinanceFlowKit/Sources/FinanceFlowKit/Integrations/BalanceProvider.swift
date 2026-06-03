import Foundation

/// A request for an externally-sourced balance. Mirrors `BalanceQuery` in
/// `src/integrations/balanceProvider.ts`.
public enum BalanceQuery: Sendable, Equatable {
    case emergencyFund
    case debt(id: String)
    case iraYtd
    case hsaYtd
    case collegeBalance      // "529Balance" in the web
    case purchaseSaved(goalId: String)
}

/// Source of truth for balances. MVP ships only `ManualProvider`; a future
/// Plaid/YNAB provider conforms here and is keyed by `Source`.
/// Mirrors `BalanceProvider` in `src/integrations/balanceProvider.ts`.
public protocol BalanceProvider: Sendable {
    var id: Source { get }
    func read(_ query: BalanceQuery) async throws -> Double?
}

/// The only provider in MVP — manual entry, so reads return nil.
public struct ManualProvider: BalanceProvider {
    public let id: Source = .manual
    public init() {}
    public func read(_ query: BalanceQuery) async throws -> Double? { nil }
}
