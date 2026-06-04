import Foundation

/// User-level settings that drive targets. Mirrors `Settings` in `src/state/schema.ts`.
public struct Settings: Codable, Equatable, Sendable {
    public var monthlyExpenses: Decimal?
    public var preTaxIncome: Decimal?
    public var iraAnnualLimit: Decimal
    public var hsaSelfLimit: Decimal
    public var hsaFamilyLimit: Decimal

    public init(
        monthlyExpenses: Decimal? = nil,
        preTaxIncome: Decimal? = nil,
        iraAnnualLimit: Decimal,
        hsaSelfLimit: Decimal,
        hsaFamilyLimit: Decimal
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
        iraAnnualLimit: 7000,
        hsaSelfLimit: 4300,
        hsaFamilyLimit: 8550
    )
}

/// Small emergency-fund target: max($1,000, one month expenses).
/// Mirrors `emergencyFundTarget` in `src/state/schema.ts`.
public func emergencyFundTarget(monthlyExpenses: Decimal?) -> Decimal {
    guard let monthlyExpenses, monthlyExpenses > 0 else { return 1000 }
    return max(1000, monthlyExpenses)
}

/// Big emergency-fund target: months × monthly expenses (0 if expenses unset).
/// Mirrors `bigEmergencyFundTarget` in `src/state/schema.ts`.
public func bigEmergencyFundTarget(months: Int, monthlyExpenses: Decimal?) -> Decimal {
    guard let monthlyExpenses, monthlyExpenses > 0 else { return 0 }
    return Decimal(months) * monthlyExpenses
}
