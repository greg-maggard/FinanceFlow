import Foundation

/// Plaid snapshot import: parse, map, dedupe — as a pure planner.
///
/// The source is the nightly JSON snapshot the local `plaid-mcp` server writes
/// to Google Drive (`~/projects/plaid-mcp`, `get_accounts` + `get_transactions`).
/// Nothing here fetches anything: this takes the already-read document and the
/// current book and returns `NodeLedger.BookOps` plus an honest account of what
/// it refused to do. Mirrors `src/budget/plaidImport.ts`; `PlaidImportTests` on
/// both sides pin the two engines to the same ops for the same committed
/// fixture.
///
/// Three properties this file exists to guarantee:
///
/// 1. **Sign.** Plaid's convention is INVERTED relative to this app: a positive
///    `amount` is money OUT. Every amount is negated on the way in, so a Plaid
///    +4.50 coffee lands as a -4.50 transaction.
/// 2. **Idempotence.** Re-importing the same file — on either platform, any
///    number of times — adds nothing. That rests on `plaidTxnId` being a
///    function of the row alone, computed identically on both platforms.
/// 3. **No guessing.** A row whose account isn't linked is reported, never
///    attached to some other account; and nothing is auto-categorized from
///    Plaid's taxonomy. Envelope names are personal, and a confidently wrong
///    envelope is worse than a blank one because it silently misstates a
///    balance the user is making decisions against. Everything lands in
///    `cat:uncategorized` for the user to sort.
public enum PlaidImport {

    // MARK: - The snapshot document
    //
    // Every field is optional because this is JSON that arrived from another
    // process: Plaid itself returns `merchant_name: null` routinely, and the
    // emitter passes `t.get(...)` straight through. A missing field must
    // degrade to a defined default, never throw — a single odd row cannot be
    // allowed to cost the user the whole night's import.

    public struct SnapshotTxn: Codable, Equatable, Sendable {
        /// Plaid's own stable id, when the emitter carries it. See `plaidTxnID`.
        public var transactionID: String?
        public var accountID: String?
        /// "YYYY-MM-DD".
        public var date: String?
        public var name: String?
        public var merchantName: String?
        /// Dollars, Plaid sign convention: POSITIVE = money OUT.
        public var amount: Double?
        /// Plaid's personal-finance-category primary. Deliberately unused — see above.
        public var category: String?
        public var pending: Bool?

        enum CodingKeys: String, CodingKey {
            case transactionID = "transaction_id"
            case accountID = "account_id"
            case date
            case name
            case merchantName = "merchant_name"
            case amount
            case category
            case pending
        }

        public init(
            transactionID: String? = nil,
            accountID: String? = nil,
            date: String? = nil,
            name: String? = nil,
            merchantName: String? = nil,
            amount: Double? = nil,
            category: String? = nil,
            pending: Bool? = nil
        ) {
            self.transactionID = transactionID
            self.accountID = accountID
            self.date = date
            self.name = name
            self.merchantName = merchantName
            self.amount = amount
            self.category = category
            self.pending = pending
        }
    }

    public struct SnapshotAccount: Codable, Equatable, Sendable {
        public var accountID: String?
        public var name: String?
        /// Dollars. For credit accounts this is the amount OWED (a positive number).
        public var currentBalance: Double?
        public var availableBalance: Double?

        enum CodingKeys: String, CodingKey {
            case accountID = "account_id"
            case name
            case currentBalance = "current_balance"
            case availableBalance = "available_balance"
        }

        public init(
            accountID: String? = nil,
            name: String? = nil,
            currentBalance: Double? = nil,
            availableBalance: Double? = nil
        ) {
            self.accountID = accountID
            self.name = name
            self.currentBalance = currentBalance
            self.availableBalance = availableBalance
        }
    }

    public struct Snapshot: Codable, Equatable, Sendable {
        public var accounts: [SnapshotAccount]?
        public var transactions: [SnapshotTxn]?

        public init(accounts: [SnapshotAccount]? = nil, transactions: [SnapshotTxn]? = nil) {
            self.accounts = accounts
            self.transactions = transactions
        }
    }

    // MARK: - The plan

    public struct Skipped: Equatable, Sendable {
        /// Rows already in the book under the same `plaidTxnId` (or repeated in this file).
        public var duplicates: Int
        /// Rows Plaid had not posted yet.
        public var pending: Int
        /// Plaid `account_id`s with no local account, in first-appearance order.
        public var unmappedAccounts: [String]

        public init(duplicates: Int = 0, pending: Int = 0, unmappedAccounts: [String] = []) {
            self.duplicates = duplicates
            self.pending = pending
            self.unmappedAccounts = unmappedAccounts
        }
    }

    public struct Plan: Equatable, Sendable {
        public var ops: NodeLedger.BookOps
        public var skipped: Skipped

        public init(ops: NodeLedger.BookOps = NodeLedger.BookOps(), skipped: Skipped = Skipped()) {
            self.ops = ops
            self.skipped = skipped
        }
    }

    /// Prefix of the local `Txn.id` derived from a `plaidTxnId`.
    public static let localTxnIDPrefix = "txn:plaid:"

    /// The local transaction id for an imported row — a pure function of
    /// `plaidTxnId`, so both platforms produce the same id for the same row and
    /// a book that round-trips through export/import stays byte-stable.
    public static func localTxnID(_ plaidTxnID: String) -> String {
        "\(localTxnIDPrefix)\(plaidTxnID)"
    }

    /// The natural key of a row: everything about it that a nightly re-export
    /// cannot change. Deliberately excludes `merchant_name` (Plaid enriches it
    /// over time, and a row that gained a merchant name overnight is the same
    /// row) and `pending`/`category` (both change as a transaction settles).
    ///
    /// Spelled as one string with `|` separators, literally the same expression
    /// as `plaidImport.ts`. Both platforms interpolate the same integer cents
    /// and the same raw `name`, so both produce the same bytes.
    private static func naturalKey(
        _ plaidAccountID: String,
        _ date: String,
        _ amount: Money,
        _ name: String
    ) -> String {
        "\(plaidAccountID)|\(date)|\(amount.cents)|\(name)"
    }

    /// The row's dedupe identity.
    ///
    /// Plaid's real `transaction_id` is authoritative and is used whenever the
    /// snapshot carries it. The nightly emitter currently does not (`server.py`
    /// emits `{date, name, merchant_name, amount, category, account_id,
    /// pending}`), so absent one we synthesize a key from the fields that
    /// identify the transaction, plus `ordinal` — its position among rows in
    /// THIS file sharing that natural key, which is what separates two
    /// genuinely distinct $4.50 coffees bought from the same shop on the same
    /// day.
    ///
    /// The ordinal is counted over every non-pending row in file order
    /// regardless of whether it maps or dedupes, so linking an account later,
    /// or a pending row posting overnight, does not renumber rows that were
    /// already imported.
    ///
    /// Caveat, stated out loud: if the emitter starts including
    /// `transaction_id`, rows imported under a synthetic key will import once
    /// more under the real one. That is a one-time, visible duplication on a
    /// shape change, and it is the right trade against permanently ignoring the
    /// stabler id.
    private static func plaidTxnID(
        _ row: SnapshotTxn,
        natural: String,
        ordinal: Int
    ) -> String {
        if let given = row.transactionID, !given.isEmpty { return given }
        return "syn:\(natural)#\(ordinal)"
    }

    /// Plan the import of `snapshot` into `book`.
    ///
    /// Rows are classified in a fixed order — pending, then unmapped, then
    /// duplicate — and the order is observable, so it is part of the contract
    /// the web mirror implements too. Pending comes first because an unposted
    /// row is not a transaction yet whatever account it belongs to; it will be
    /// classified again, properly, once it settles.
    ///
    /// The plan is empty when nothing is importable: no ops at all, not ops
    /// that happen to be no-ops. That is what makes a second run of the same
    /// file a genuine no-op rather than a write that merely lands on the same
    /// values.
    public static func plan(_ book: BudgetBook, _ snapshot: Snapshot) -> Plan {
        let rows = snapshot.transactions ?? []

        // Plaid account id -> local account id. First mapping wins, so a book
        // that somehow linked one Plaid account twice resolves deterministically.
        var localAccountID: [String: String] = [:]
        for account in book.accounts {
            guard let plaidID = account.plaidAccountId else { continue }
            if localAccountID[plaidID] == nil { localAccountID[plaidID] = account.id }
        }

        // Seeded from the book, then extended as rows are accepted, so a file
        // that repeats a row cannot emit two transactions carrying the same id.
        var claimed = Set<String>()
        for txn in book.transactions {
            if let plaidID = txn.plaidTxnId { claimed.insert(plaidID) }
        }

        var ordinals: [String: Int] = [:]
        var addTxns: [Txn] = []
        var unmappedAccounts: [String] = []
        var unmappedSeen = Set<String>()
        var duplicates = 0
        var pending = 0

        for row in rows {
            if row.pending == true {
                pending += 1
                continue
            }

            let plaidAccountID = row.accountID ?? ""
            // `Txn.date` is "YYYY-MM-DD" by convention; take the day prefix so
            // an emitter that ever writes a full timestamp still buckets into
            // the right month instead of quietly landing a row the ledger sorts
            // differently.
            let date = String((row.date ?? "").prefix(10))
            let name = row.name ?? ""
            // Negate in DOLLARS, then apply the one rounding rule
            // (money-migration-v4 §4) once, to the value that actually lands in
            // the ledger. Rounding first and negating after would apply the
            // half-toward-+infinity rule to the Plaid-signed number instead of
            // the stored one, and the two differ on a half-cent amount.
            let amount = Money.fromDollars(-(row.amount ?? 0))

            let natural = naturalKey(plaidAccountID, date, amount, name)
            let ordinal = ordinals[natural] ?? 0
            ordinals[natural] = ordinal + 1
            let plaidID = plaidTxnID(row, natural: natural, ordinal: ordinal)

            guard let accountID = localAccountID[plaidAccountID] else {
                if unmappedSeen.insert(plaidAccountID).inserted {
                    unmappedAccounts.append(plaidAccountID)
                }
                continue
            }

            if claimed.contains(plaidID) {
                duplicates += 1
                continue
            }
            claimed.insert(plaidID)

            // `merchant_name` is Plaid's cleaned-up name ("Coffee Roasters")
            // and the raw `name` is the statement line ("COFFEE ROASTERS #22
            // SQ*"); prefer the former and fall back rather than leaving the
            // payee blank.
            let merchant = row.merchantName ?? ""
            let payee = !merchant.isEmpty ? merchant : (name.isEmpty ? nil : name)

            addTxns.append(
                Txn(
                    id: localTxnID(plaidID),
                    accountId: accountID,
                    date: date,
                    payee: payee,
                    amount: amount,
                    categoryId: BudgetBook.uncategorizedCategoryID,
                    source: .plaid,
                    plaidTxnId: plaidID
                )
            )
        }

        var ops = NodeLedger.BookOps()
        if !addTxns.isEmpty {
            // Every imported row is categorized, so the catch-all envelope has
            // to exist by the time they land. `AppStore.apply(_:)` applies ops
            // verbatim (it does not call `ensureUncategorized()`), so
            // materializing it is this planner's job — the same rows
            // `ensureUncategorized()` would create.
            if !book.groups.contains(where: { $0.id == BudgetBook.systemGroupID }) {
                ops.addGroups = [
                    CategoryGroup(
                        id: BudgetBook.systemGroupID,
                        name: "System",
                        order: BudgetBook.systemOrder
                    ),
                ]
            }
            if !book.categories.contains(where: { $0.id == BudgetBook.uncategorizedCategoryID }) {
                ops.addCategories = [
                    BudgetCategory(
                        id: BudgetBook.uncategorizedCategoryID,
                        groupId: BudgetBook.systemGroupID,
                        name: "Uncategorized",
                        order: BudgetBook.systemOrder
                    ),
                ]
            }
            ops.addTxns = addTxns
        }

        return Plan(
            ops: ops,
            skipped: Skipped(
                duplicates: duplicates,
                pending: pending,
                unmappedAccounts: unmappedAccounts
            )
        )
    }
}
