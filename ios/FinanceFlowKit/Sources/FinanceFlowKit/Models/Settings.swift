import Foundation

/// User-level settings that drive targets. Mirrors `Settings` in `src/state/schema.ts`.
public struct Settings: Codable, Equatable, Sendable {
    public var monthlyExpenses: Money?
    public var preTaxIncome: Money?
    public var iraAnnualLimit: Money
    public var hsaSelfLimit: Money
    public var hsaFamilyLimit: Money

    public init(
        monthlyExpenses: Money? = nil,
        preTaxIncome: Money? = nil,
        iraAnnualLimit: Money,
        hsaSelfLimit: Money,
        hsaFamilyLimit: Money
    ) {
        self.monthlyExpenses = monthlyExpenses
        self.preTaxIncome = preTaxIncome
        self.iraAnnualLimit = iraAnnualLimit
        self.hsaSelfLimit = hsaSelfLimit
        self.hsaFamilyLimit = hsaFamilyLimit
    }

    /// Mirrors `DEFAULT_SETTINGS`.
    public static let `default` = Settings(
        monthlyExpenses: nil,
        preTaxIncome: nil,
        iraAnnualLimit: Money(cents: 700_000),
        hsaSelfLimit: Money(cents: 430_000),
        hsaFamilyLimit: Money(cents: 855_000)
    )
}

/// The $1,000 starter gate, in cents.
private let smallEFFloor = Money(cents: 100_000)

/// Small emergency-fund target: max($1,000, one month expenses).
/// Mirrors `emergencyFundTarget` in `src/state/schema.ts`.
public func emergencyFundTarget(monthlyExpenses: Money?) -> Money {
    guard let monthlyExpenses, monthlyExpenses > .zero else { return smallEFFloor }
    return max(smallEFFloor, monthlyExpenses)
}

/// Big emergency-fund target: months × monthly expenses (0 if expenses unset).
/// `months` is a small whole number, so the product is integer-exact.
/// Mirrors `bigEmergencyFundTarget` in `src/state/schema.ts`.
public func bigEmergencyFundTarget(months: Int, monthlyExpenses: Money?) -> Money {
    guard let monthlyExpenses, monthlyExpenses > .zero else { return .zero }
    return monthlyExpenses.scaled(by: months)
}
