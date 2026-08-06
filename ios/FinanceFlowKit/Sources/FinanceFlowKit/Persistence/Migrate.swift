import Foundation

/// The schema migrations. Mirrors `migrateV1`/`migrateV2` in
/// `src/state/io.ts` — including every generated id, which derives from a
/// stable payload id so both platforms migrate the same document to the same
/// book. `MigrationTests` pins the two together.
///
/// v1 -> v2 seeds the budget book from the node payloads (payloads preserved;
/// v2 -> v3 strips them). Seeding rule: each funded/saved amount becomes that
/// category's assignment in the migration month, and one starting-balance
/// inflow on a seeded Cash account covers the total — so every envelope's
/// available matches its v1 bar exactly and Ready-to-Assign lands at exactly
/// zero.
enum Migration {
    private static let recurringNodes: [NodeId] = [
        .Rent, .Food, .Essential, .Income, .Health, .MinDebt, .NonEssential,
    ]

    static func v1ToV2(_ v1: AppState, now: Date = Date()) -> AppState {
        var book = BudgetBook()
        let month = Recurring.ymKey(now)
        let today = Ledger.isoDay(now)
        var seeded: [String: Decimal] = [:]

        func addCategory(_ category: BudgetCategory, seed: Decimal) {
            var cat = category
            cat.order = book.categories.count
            book.categories.append(cat)
            if seed > 0 { seeded[cat.id] = seed }
        }

        // Bills: the recurring nodes' items (or single target/funded pair).
        book.groups.append(CategoryGroup(id: "g:bills", name: "Bills", order: 0))
        for nodeId in recurringNodes {
            guard let data = v1.node(nodeId).data?.recurring else { continue }
            if let items = data.items, !items.isEmpty {
                for item in items {
                    addCategory(
                        BudgetCategory(
                            id: "\(nodeId.rawValue):\(item.id)",
                            groupId: "g:bills",
                            name: item.name,
                            monthlyTarget: item.target.value,
                            nodeId: nodeId
                        ),
                        seed: item.funded?.value ?? 0
                    )
                }
            } else if data.target.value > 0 || (data.funded?.value ?? 0) > 0 {
                addCategory(
                    BudgetCategory(
                        id: nodeId.rawValue,
                        groupId: "g:bills",
                        name: nodeId.rawValue,
                        monthlyTarget: data.target.value,
                        nodeId: nodeId
                    ),
                    seed: data.funded?.value ?? 0
                )
            }
        }

        // Emergency fund. SmallEF grows into BigEF, so when BigEF holds any
        // data it is treated as the superset and SmallEF is not seeded twice.
        book.groups.append(CategoryGroup(id: "g:ef", name: "Emergency Fund", order: 1))
        let big = v1.node(.BigEF).data?.bigEF
        let small = v1.node(.SmallEF).data?.smallEF
        switch efPayloadNode(big, small) {
        case .BigEF:
            seedEmergencyFund(
                node: .BigEF,
                items: big?.items,
                balance: big?.balance?.value ?? 0,
                singleTarget: bigEmergencyFundTarget(
                    months: big?.targetMonths ?? 3,
                    monthlyExpenses: v1.settings.monthlyExpenses
                ),
                addCategory: addCategory
            )
        case .SmallEF:
            seedEmergencyFund(
                node: .SmallEF,
                items: small?.items,
                balance: small?.balance.value ?? 0,
                singleTarget: emergencyFundTarget(monthlyExpenses: v1.settings.monthlyExpenses),
                addCategory: addCategory
            )
        default:
            break
        }

        // Savings goals: SavePurchase goals plus the long-term Goals list.
        book.groups.append(CategoryGroup(id: "g:goals", name: "Savings Goals", order: 2))
        if let purchase = v1.node(.SavePurchase).data?.savePurchase {
            if let items = purchase.items, !items.isEmpty {
                for goal in items {
                    addCategory(
                        BudgetCategory(
                            id: "SavePurchase:\(goal.id)",
                            groupId: "g:goals",
                            name: goal.name,
                            balanceTarget: goal.target,
                            targetDate: goal.byDate,
                            nodeId: .SavePurchase
                        ),
                        seed: goal.saved.value
                    )
                }
            } else if purchase.target > 0 || purchase.saved.value > 0 {
                addCategory(
                    BudgetCategory(
                        id: "SavePurchase",
                        groupId: "g:goals",
                        name: purchase.goalName.isEmpty ? "SavePurchase" : purchase.goalName,
                        balanceTarget: purchase.target,
                        targetDate: purchase.byDate,
                        nodeId: .SavePurchase
                    ),
                    seed: purchase.saved.value
                )
            }
        }
        for goal in v1.node(.Goals).data?.goals ?? [] {
            addCategory(
                BudgetCategory(
                    id: "Goals:\(goal.id)",
                    groupId: "g:goals",
                    name: goal.name,
                    balanceTarget: goal.target,
                    nodeId: .Goals
                ),
                seed: goal.saved
            )
        }

        // Debts become off-budget loan accounts (balance, APR, minimum payment).
        for nodeId in [NodeId.HighDebt, .ModDebt] {
            for debt in v1.node(nodeId).data?.debts ?? [] {
                let account = Account(
                    id: "debt:\(debt.id)",
                    name: debt.name,
                    kind: .loan,
                    apr: debt.apr,
                    minPayment: debt.minPayment,
                    nodeId: nodeId
                )
                book.accounts.append(account)
                if debt.balance != 0 {
                    book.transactions.append(startingTxn(account.id, date: today, amount: -debt.balance))
                }
            }
        }

        // The 529 balance becomes a tracking account.
        if let collegeBalance = v1.node(.College).data?.college?.balance?.value, collegeBalance > 0 {
            book.accounts.append(Account(id: "acct:college", name: "529 Plan", kind: .tracking, nodeId: .College))
            book.transactions.append(startingTxn("acct:college", date: today, amount: collegeBalance))
        }

        // Cash account + one RTA inflow covering everything seeded, so the
        // books open balanced: every available equals its v1 bar and RTA is
        // exactly 0.
        book.accounts.append(Account(id: "acct:cash", name: "Cash", kind: .cash))
        let total = seeded.values.reduce(Decimal(0), +)
        if total > 0 {
            var inflow = startingTxn("acct:cash", date: today, amount: total)
            inflow.categoryId = Ledger.rtaCategoryID
            book.transactions.append(inflow)
        }
        if !seeded.isEmpty {
            book.assignments = [month: seeded]
        }

        var v2 = v1
        v2.version = 2
        v2.budget = book
        return v2
    }

    // MARK: - v2 -> v3: reconcile, then strip.
    //
    // Both UIs were live during v2, so payloads and ledger may have diverged.
    // The ledger wins wherever both describe the same thing (it has the
    // transaction history); payload items with no linked ledger entity are
    // created with the same deterministic ids the v1 migration used, their
    // funded/saved amounts seeded as this month's assignments and covered by
    // one RTA inflow so Ready-to-Assign is unchanged. The single payload-wins
    // case: a debt explicitly marked paid gets a zeroing adjustment, because
    // that user action had no ledger representation. Then every ledger-owned
    // payload field is stripped; nodes keep only what the ledger doesn't
    // model. Mirrors `migrateV2` in `src/state/io.ts`.

    static func v2ToV3(_ v2: AppState, now: Date = Date()) -> AppState {
        var book = v2.budget
        let month = Recurring.ymKey(now)
        let today = Ledger.isoDay(now)
        var seeded: [String: Decimal] = [:]

        func catExists(_ id: String) -> Bool {
            book.categories.contains { $0.id == id }
        }
        func accountIndex(_ id: String) -> Int? {
            book.accounts.firstIndex { $0.id == id }
        }
        func addCat(_ category: BudgetCategory, seed: Decimal) {
            if let group = NodeLedger.ensureGroup(book, category.groupId) {
                book.groups.append(group)
            }
            var cat = category
            cat.order = book.categories.count
            book.categories.append(cat)
            if seed > 0 { seeded[cat.id] = seed }
        }

        // 1. Recurring: create missing payload items; ledger wins where ids match.
        for nodeId in recurringNodes {
            guard let data = v2.node(nodeId).data?.recurring else { continue }
            if let items = data.items, !items.isEmpty {
                for item in items {
                    let id = "\(nodeId.rawValue):\(item.id)"
                    if catExists(id) { continue }
                    addCat(
                        BudgetCategory(
                            id: id,
                            groupId: NodeLedger.groupBills,
                            name: item.name,
                            monthlyTarget: item.target.value,
                            nodeId: nodeId
                        ),
                        seed: item.funded?.value ?? 0
                    )
                }
            } else if data.target.value > 0 || (data.funded?.value ?? 0) > 0 {
                if !catExists(nodeId.rawValue) {
                    addCat(
                        BudgetCategory(
                            id: nodeId.rawValue,
                            groupId: NodeLedger.groupBills,
                            name: nodeId.rawValue,
                            monthlyTarget: data.target.value,
                            nodeId: nodeId
                        ),
                        seed: data.funded?.value ?? 0
                    )
                }
            }
        }

        // 2. Emergency fund. Supersession is the same domain rule the v1
        // migration applies (`efPayloadNode`): only the superseding node's
        // payload seeds anything, so a document with items on BOTH nodes
        // doesn't get both funds' buckets. `unionExists` gates exactly one
        // thing — never create the SCALAR MIRROR when the fund is already
        // bucketed in the ledger. Bucket creation is gated by supersession
        // plus `catExists`.
        let big = v2.node(.BigEF).data?.bigEF
        let small = v2.node(.SmallEF).data?.smallEF
        let unionExists = book.categories.contains { $0.nodeId == .SmallEF || $0.nodeId == .BigEF }
        if let node = efPayloadNode(big, small) {
            let items = (node == .BigEF ? big?.items : small?.items) ?? []
            if !items.isEmpty {
                for bucket in items {
                    let id = "\(node.rawValue):\(bucket.id)"
                    if catExists(id) { continue }
                    addCat(
                        BudgetCategory(
                            id: id,
                            groupId: NodeLedger.groupEF,
                            name: bucket.name,
                            balanceTarget: bucket.target,
                            nodeId: node
                        ),
                        seed: bucket.balance.value
                    )
                }
            } else if !unionExists {
                seedEmergencyFund(
                    node: node,
                    items: nil,
                    balance: node == .BigEF ? (big?.balance?.value ?? 0) : (small?.balance.value ?? 0),
                    singleTarget: node == .BigEF
                        ? bigEmergencyFundTarget(
                            months: big?.targetMonths ?? 3,
                            monthlyExpenses: v2.settings.monthlyExpenses
                        )
                        : emergencyFundTarget(monthlyExpenses: v2.settings.monthlyExpenses),
                    addCategory: addCat
                )
            }
        }

        // 3. SavePurchase / Goals. Goals' horizonYears becomes a target date.
        let purchase = v2.node(.SavePurchase).data?.savePurchase
        if let items = purchase?.items, !items.isEmpty {
            for goal in items {
                let id = "SavePurchase:\(goal.id)"
                if catExists(id) { continue }
                addCat(
                    BudgetCategory(
                        id: id,
                        groupId: NodeLedger.groupGoals,
                        name: goal.name,
                        balanceTarget: goal.target,
                        targetDate: goal.byDate,
                        nodeId: .SavePurchase
                    ),
                    seed: goal.saved.value
                )
            }
        } else if let purchase, purchase.target > 0 || purchase.saved.value > 0 {
            if !catExists("SavePurchase") {
                addCat(
                    BudgetCategory(
                        id: "SavePurchase",
                        groupId: NodeLedger.groupGoals,
                        name: purchase.goalName.isEmpty ? "SavePurchase" : purchase.goalName,
                        balanceTarget: purchase.target,
                        targetDate: purchase.byDate,
                        nodeId: .SavePurchase
                    ),
                    seed: purchase.saved.value
                )
            }
        }
        for goal in v2.node(.Goals).data?.goals ?? [] {
            let id = "Goals:\(goal.id)"
            if let index = book.categories.firstIndex(where: { $0.id == id }) {
                if (book.categories[index].targetDate ?? "").isEmpty {
                    book.categories[index].targetDate = horizonDate(now, years: goal.horizonYears)
                }
                continue
            }
            addCat(
                BudgetCategory(
                    id: id,
                    groupId: NodeLedger.groupGoals,
                    name: goal.name,
                    balanceTarget: goal.target,
                    targetDate: horizonDate(now, years: goal.horizonYears),
                    nodeId: .Goals
                ),
                seed: goal.saved
            )
        }

        // 4. Debts: backfill nodeId on matched accounts; create missing ones;
        // honor an explicit paid flag the ledger couldn't represent.
        for nodeId in [NodeId.HighDebt, .ModDebt] {
            for debt in v2.node(nodeId).data?.debts ?? [] {
                let id = "debt:\(debt.id)"
                if let index = accountIndex(id) {
                    if book.accounts[index].nodeId == nil {
                        book.accounts[index].nodeId = nodeId
                    }
                    let balance = Ledger.accountBalance(book, id)
                    if debt.paid, balance < 0 {
                        book.transactions.append(Txn(
                            id: "txn:adjust:v3:debt:\(debt.id)",
                            accountId: id,
                            date: today,
                            payee: "Balance adjustment",
                            amount: -balance,
                            memo: "Marked paid"
                        ))
                    }
                } else {
                    book.accounts.append(Account(
                        id: id,
                        name: debt.name,
                        kind: .loan,
                        apr: debt.apr,
                        minPayment: debt.minPayment,
                        nodeId: nodeId
                    ))
                    if debt.balance != 0 {
                        book.transactions.append(startingTxn(id, date: today, amount: -debt.balance))
                    }
                }
            }
        }

        // 5. College: ensure/backfill the tracking account.
        if let college = v2.node(.College).data?.college {
            if let index = accountIndex(NodeLedger.collegeAccountID) {
                if book.accounts[index].nodeId == nil {
                    book.accounts[index].nodeId = .College
                }
            } else if let balance = college.balance?.value, balance > 0 {
                book.accounts.append(Account(
                    id: NodeLedger.collegeAccountID,
                    name: "529 Plan",
                    kind: .tracking,
                    nodeId: .College
                ))
                book.transactions.append(
                    startingTxn(NodeLedger.collegeAccountID, date: today, amount: balance)
                )
            }
        }

        // 6. Seed cover: created categories' amounts become this month's
        // assignments, balanced by one RTA inflow — migration never moves RTA.
        let total = seeded.values.reduce(Decimal(0), +)
        if !seeded.isEmpty {
            book.assignments[month] = (book.assignments[month] ?? [:])
                .merging(seeded) { _, seededValue in seededValue }
        }
        if total > 0 {
            if accountIndex("acct:cash") == nil {
                book.accounts.append(Account(id: "acct:cash", name: "Cash", kind: .cash))
            }
            book.transactions.append(Txn(
                id: "txn:start:v3",
                accountId: "acct:cash",
                date: today,
                payee: "Starting balance",
                amount: total,
                categoryId: Ledger.rtaCategoryID
            ))
        }

        // Phase 2 — strip: nodes keep only what the ledger doesn't model.
        var nodes: [NodeId: NodeState] = [:]
        for (id, legacy) in v2.nodes {
            var node = legacy
            node.data = nil
            if let data = legacy.data {
                switch id {
                case .BigEF:
                    if let months = data.bigEF?.targetMonths {
                        node.data = .bigEF(BigEFData(
                            targetMonths: (months == 4 || months == 5 || months == 6) ? months : 3
                        ))
                    }
                case .College:
                    if let college = data.college {
                        node.data = .college(CollegeData(
                            monthlyContribution: college.monthlyContribution,
                            targetAge: college.targetAge
                        ))
                    }
                case .Match, .IRA, .HSA, .Increase401k:
                    node.data = data
                default:
                    // Everything else (recurring, EFs, SavePurchase, Goals,
                    // debts) is ledger-owned now — the payload is dropped.
                    break
                }
            }
            nodes[id] = node
        }

        var out = v2
        out.version = 3
        out.nodes = nodes
        out.budget = book
        return out
    }

    /// `now` shifted by a (possibly fractional) number of years, as a local
    /// day. Mirrors `horizonDate` in `src/state/io.ts`, which shifts by
    /// `Math.round(years * 12)` whole months.
    private static func horizonDate(_ now: Date, years: Decimal) -> String {
        var months = years * 12
        var rounded = Decimal()
        NSDecimalRound(&rounded, &months, 0, .plain)
        let shift = NSDecimalNumber(decimal: rounded).intValue
        let shifted = Calendar.current.date(byAdding: .month, value: shift, to: now) ?? now
        return Ledger.isoDay(shifted)
    }

    /// Which EF payload node supersedes the other. SmallEF grows into BigEF —
    /// one real-world fund — so when BigEF holds any data it is the superset
    /// and SmallEF is not seeded a second time. This is a DOMAIN rule, not a
    /// v1 rule: it has to hold wherever payload-to-ledger seeding happens, or
    /// a v2 document carrying items on both nodes gets both funds' buckets and
    /// two starting inflows for one fund's worth of cash. Mirrors
    /// `efPayloadNode` in `src/state/io.ts`.
    private static func efPayloadNode(_ big: BigEFData?, _ small: SmallEFData?) -> NodeId? {
        if let big, (big.balance?.value ?? 0) > 0 || !(big.items ?? []).isEmpty { return .BigEF }
        if small != nil { return .SmallEF }
        return nil
    }

    private static func seedEmergencyFund(
        node: NodeId,
        items: [EFBucket]?,
        balance: Decimal,
        singleTarget: Decimal,
        addCategory: (BudgetCategory, Decimal) -> Void
    ) {
        if let items, !items.isEmpty {
            for bucket in items {
                addCategory(
                    BudgetCategory(
                        id: "\(node.rawValue):\(bucket.id)",
                        groupId: "g:ef",
                        name: bucket.name,
                        balanceTarget: bucket.target,
                        nodeId: node
                    ),
                    bucket.balance.value
                )
            }
        } else if balance > 0 {
            addCategory(
                BudgetCategory(
                    id: node.rawValue,
                    groupId: "g:ef",
                    name: "Emergency Fund",
                    balanceTarget: singleTarget > 0 ? singleTarget : nil,
                    nodeId: node
                ),
                balance
            )
        }
    }

    private static func startingTxn(_ accountID: String, date: String, amount: Decimal) -> Txn {
        Txn(
            id: "txn:start:\(accountID)",
            accountId: accountID,
            date: date,
            payee: "Starting balance",
            amount: amount
        )
    }
}
