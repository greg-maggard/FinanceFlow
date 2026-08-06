import Foundation
@testable import FinanceFlowKit

/// Integer literals mean CENTS inside the test target.
///
/// `Money` deliberately does not conform to `ExpressibleByIntegerLiteral` in the
/// app: `let target: Money = 1000` reads as a thousand dollars and would mean
/// ten, so every production construction is spelled `Money(cents:)`. Fixtures
/// are the opposite case — they are dense with amounts whose absolute size is
/// arbitrary (only the arithmetic between them is under test), and wrapping each
/// one buries the assertion in ceremony.
///
/// Where a test's number has to line up with a domain constant — the emergency
/// fund's `max($1,000, one month of expenses)` gate, the default IRA/HSA limits —
/// it is spelled in cents explicitly and says so.
extension Money: ExpressibleByIntegerLiteral {
    public init(integerLiteral value: Int) {
        self.init(cents: value)
    }
}
