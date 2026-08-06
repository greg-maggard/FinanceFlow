import Foundation

// MARK: - Budget book (v2): the zero-based envelope core.
//
// Mirrors the `BudgetBook` types in `src/state/schema.ts`. Money is `Money`
// (integer cents — see Money.swift for why) in memory and a bare JSON integer on
// the wire, byte-compatible with the web. All envelope math lives in
// `Domain/Ledger.swift`, and from v4 every bit of it is exact integer
// arithmetic with no rounding step to forget.

public enum AccountKind: String, Codable, Sendable {
    case checking
    case savings
    case cash
    case credit
    case loan
    case tracking

    /// Forward-compatible decode: an unrecognized kind is treated as
    /// off-budget (`tracking`) so it can never inflate Ready-to-Assign.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AccountKind(rawValue: raw) ?? .tracking
    }
}

public struct Account: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var kind: AccountKind
    /// Annual rate, for credit/loan accounts. NOT money — never converted.
    public var apr: Decimal?
    public var minPayment: Money?
    public var closed: Bool?
    public var source: Source
    public var plaidAccountId: String?
    /// Flowchart node this account reports into, if any (debt nodes, College).
    public var nodeId: NodeId?

    public init(
        id: String = ShortID.make(),
        name: String = "",
        kind: AccountKind,
        apr: Decimal? = nil,
        minPayment: Money? = nil,
        closed: Bool? = nil,
        source: Source = .manual,
        plaidAccountId: String? = nil,
        nodeId: NodeId? = nil
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.apr = apr
        self.minPayment = minPayment
        self.closed = closed
        self.source = source
        self.plaidAccountId = plaidAccountId
        self.nodeId = nodeId
    }
}

/// A single ledger line. Outflows are negative, inflows positive. Income
/// enters the budget categorized as `Ledger.rtaCategoryID`. Transfers carry
/// `transferAccountId` on both paired rows and no category — except transfers
/// to an off-budget account, which must be categorized because the money
/// leaves the budget.
public struct Txn: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var accountId: String
    /// Local calendar date, "YYYY-MM-DD".
    public var date: String
    public var payee: String?
    public var amount: Money
    public var categoryId: String?
    public var transferAccountId: String?
    /// The other row of a transfer pair, so the pair can be edited/deleted atomically.
    public var transferPairId: String?
    public var memo: String?
    public var source: Source
    public var plaidTxnId: String?

    public init(
        id: String = ShortID.make(),
        accountId: String,
        date: String,
        payee: String? = nil,
        amount: Money,
        categoryId: String? = nil,
        transferAccountId: String? = nil,
        transferPairId: String? = nil,
        memo: String? = nil,
        source: Source = .manual,
        plaidTxnId: String? = nil
    ) {
        self.id = id
        self.accountId = accountId
        self.date = date
        self.payee = payee
        self.amount = amount
        self.categoryId = categoryId
        self.transferAccountId = transferAccountId
        self.transferPairId = transferPairId
        self.memo = memo
        self.source = source
        self.plaidTxnId = plaidTxnId
    }
}

public struct CategoryGroup: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var order: Int

    public init(id: String = ShortID.make(), name: String = "", order: Int = 0) {
        self.id = id
        self.name = name
        self.order = order
    }
}

public struct BudgetCategory: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var groupId: String
    public var name: String
    public var order: Int
    /// Needed-for-spending target per month.
    public var monthlyTarget: Money?
    /// Save-a-total target (purchase goals, EF buckets).
    public var balanceTarget: Money?
    public var targetDate: String?
    public var hidden: Bool?
    /// Flowchart node this category reports into, if any.
    public var nodeId: NodeId?

    public init(
        id: String = ShortID.make(),
        groupId: String,
        name: String = "",
        order: Int = 0,
        monthlyTarget: Money? = nil,
        balanceTarget: Money? = nil,
        targetDate: String? = nil,
        hidden: Bool? = nil,
        nodeId: NodeId? = nil
    ) {
        self.id = id
        self.groupId = groupId
        self.name = name
        self.order = order
        self.monthlyTarget = monthlyTarget
        self.balanceTarget = balanceTarget
        self.targetDate = targetDate
        self.hidden = hidden
        self.nodeId = nodeId
    }
}

public struct BudgetBook: Codable, Equatable, Sendable {
    public var accounts: [Account]
    public var transactions: [Txn]
    public var groups: [CategoryGroup]
    public var categories: [BudgetCategory]
    /// assignments[month]["categoryId"] = cents assigned to that envelope in
    /// that "YYYY-MM" month (the same key convention as `monthlyChecks`).
    public var assignments: [String: [String: Money]]

    public init(
        accounts: [Account] = [],
        transactions: [Txn] = [],
        groups: [CategoryGroup] = [],
        categories: [BudgetCategory] = [],
        assignments: [String: [String: Money]] = [:]
    ) {
        self.accounts = accounts
        self.transactions = transactions
        self.groups = groups
        self.categories = categories
        self.assignments = assignments
    }
}

// MARK: - The system catch-all envelope (mirrors schema.ts)

extension BudgetBook {
    /// The group that holds envelopes the app owns rather than the user.
    public static let systemGroupID = "g:system"
    /// The catch-all envelope. Every on-budget outflow has to land somewhere:
    /// money with no envelope leaves the accounts without leaving any category,
    /// which is exactly the leak `Ledger.bookIntegrity`'s `unbudgetedSpending`
    /// residual measures. This is a real, visible, assignable category — it
    /// just carries no `nodeId`, so `NodeLedger.linkedCategories` keeps it out
    /// of every flowchart node's math.
    public static let uncategorizedCategoryID = "cat:uncategorized"
    /// Sorts the system group and its envelope after anything the user makes.
    public static let systemOrder = 999_999

    /// Materialize the system group + Uncategorized envelope if they aren't
    /// there yet, leaving the book alone when they are. Created lazily on first
    /// need (a delete that reassigns into it, a transaction saved into it) so an
    /// untouched book stays free of rows the user never asked for — which is
    /// also why this needs no schema version bump or migration.
    public mutating func ensureUncategorized() {
        if !groups.contains(where: { $0.id == Self.systemGroupID }) {
            groups.append(CategoryGroup(id: Self.systemGroupID, name: "System", order: Self.systemOrder))
        }
        if !categories.contains(where: { $0.id == Self.uncategorizedCategoryID }) {
            categories.append(BudgetCategory(
                id: Self.uncategorizedCategoryID,
                groupId: Self.systemGroupID,
                name: "Uncategorized",
                order: Self.systemOrder
            ))
        }
    }
}
