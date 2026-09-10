import Foundation

/// The schema migrations. Mirrors `migrateV1`/`migrateV2`/`migrateV3` in
/// `src/state/io.ts` — including every generated id, which derives from a
/// stable payload id so both platforms migrate the same document to the same
/// book. `MigrationTests` pins the two together, and the shared
/// `fixtures/migration` pair pins the v3 -> v4 step byte-for-byte.
///
/// v1 -> v2 seeds the budget book from the node payloads (payloads preserved;
/// v2 -> v3 strips them). Seeding rule: each funded/saved amount becomes that
/// category's assignment in the migration month, and one starting-balance
/// inflow on a seeded Cash account covers the total — so every envelope's
/// available matches its v1 bar exactly and Ready-to-Assign lands at exactly
/// zero.
///
/// The v1 and v2 stages run entirely in DOLLARS over `LegacyState` (D6). v3 ->
/// v4 is the single place units change.
enum Migration {
    private static let recurringNodes: [NodeId] = [
        .Rent, .Food, .Essential, .Income, .Health, .MinDebt, .NonEssential,
    ]

    static func v1ToV2(_ v1: LegacyState, now: Date = Date()) -> LegacyState {
        var book = LegacyBudgetBook()
        let month = Recurring.ymKey(now)
        let today = Ledger.isoDay(now)
        var seeded: [String: LegacyDollars] = [:]

        func addCategory(_ category: LegacyCategory, seed: LegacyDollars) {
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
                        LegacyCategory(
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
                    LegacyCategory(
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
                singleTarget: legacyBigEmergencyFundTarget(
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
                singleTarget: legacyEmergencyFundTarget(monthlyExpenses: v1.settings.monthlyExpenses),
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
                        LegacyCategory(
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
                    LegacyCategory(
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
                LegacyCategory(
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
                let account = LegacyAccount(
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
            book.accounts.append(LegacyAccount(id: "acct:college", name: "529 Plan", kind: .tracking, nodeId: .College))
            book.transactions.append(startingTxn("acct:college", date: today, amount: collegeBalance))
        }

        // Cash account + one RTA inflow covering everything seeded, so the
        // books open balanced: every available equals its v1 bar and RTA is
        // exactly 0.
        book.accounts.append(LegacyAccount(id: "acct:cash", name: "Cash", kind: .cash))
        let total = seeded.values.reduce(LegacyDollars(0), +)
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

    static func v2ToV3(_ v2: LegacyState, now: Date = Date()) -> LegacyState {
        var book = v2.budget
        let month = Recurring.ymKey(now)
        let today = Ledger.isoDay(now)
        var seeded: [String: LegacyDollars] = [:]

        func catExists(_ id: String) -> Bool {
            book.categories.contains { $0.id == id }
        }
        func accountIndex(_ id: String) -> Int? {
            book.accounts.firstIndex { $0.id == id }
        }
        func addCat(_ category: LegacyCategory, seed: LegacyDollars) {
            if let group = legacyEnsureGroup(book, category.groupId) {
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
                        LegacyCategory(
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
                        LegacyCategory(
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
                        LegacyCategory(
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
                        ? legacyBigEmergencyFundTarget(
                            months: big?.targetMonths ?? 3,
                            monthlyExpenses: v2.settings.monthlyExpenses
                        )
                        : legacyEmergencyFundTarget(monthlyExpenses: v2.settings.monthlyExpenses),
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
                    LegacyCategory(
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
                    LegacyCategory(
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
                LegacyCategory(
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
                    let balance = legacyAccountBalance(book, id)
                    if debt.paid, balance < 0 {
                        book.transactions.append(LegacyTxn(
                            id: "txn:adjust:v3:debt:\(debt.id)",
                            accountId: id,
                            date: today,
                            payee: "Balance adjustment",
                            amount: -balance,
                            memo: "Marked paid"
                        ))
                    }
                } else {
                    book.accounts.append(LegacyAccount(
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
                book.accounts.append(LegacyAccount(
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
        let total = seeded.values.reduce(LegacyDollars(0), +)
        if !seeded.isEmpty {
            book.assignments[month] = (book.assignments[month] ?? [:])
                .merging(seeded) { _, seededValue in seededValue }
        }
        if total > 0 {
            if accountIndex("acct:cash") == nil {
                book.accounts.append(LegacyAccount(id: "acct:cash", name: "Cash", kind: .cash))
            }
            book.transactions.append(LegacyTxn(
                id: "txn:start:v3",
                accountId: "acct:cash",
                date: today,
                payee: "Starting balance",
                amount: total,
                categoryId: Ledger.rtaCategoryID
            ))
        }

        // Phase 2 — strip: nodes keep only what the ledger doesn't model.
        var nodes: [NodeId: LegacyNodeState] = [:]
        for (id, legacy) in v2.nodes {
            var node = legacy
            node.data = nil
            if let data = legacy.data {
                switch id {
                case .BigEF:
                    if let months = data.bigEF?.targetMonths {
                        node.data = .bigEF(LegacyBigEFData(
                            targetMonths: (months == 4 || months == 5 || months == 6) ? months : 3
                        ))
                    }
                case .College:
                    if let college = data.college {
                        node.data = .college(LegacyCollegeData(
                            monthlyContribution: college.monthlyContribution,
                            balance: nil,
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

    // MARK: - v3 -> v4: dollars-as-float become integer cents, everywhere at once.
    //
    // One pure function over a v3 document (money-migration-v4.md §5 step 2,
    // §6 step 3). Every money field goes through `Money.fromDollars` — the §4
    // rule, evaluated in IEEE-754 double so the web mirror produces bit-identical
    // output. Percentages and rates (`apr`, `matchPct`, `currentContribPct`,
    // `currentPct`, `targetPct`), counts (`targetMonths`, `targetAge`, `order`),
    // dates, ids and enums are NOT money and are copied through untouched.
    // Mirrors `migrateV3` in `src/state/io.ts`.

    static func v3ToV4(_ v3: LegacyState) -> AppState {
        /// Optional money: `nil` stays `nil` rather than becoming zero.
        func opt(_ d: LegacyDollars?) -> Money? {
            d.map(Money.fromDollars)
        }

        var book = BudgetBook(
            accounts: v3.budget.accounts.map { a in
                Account(
                    id: a.id,
                    name: a.name,
                    kind: a.kind,
                    // `apr` is a rate, not money (D8) — it rides through unconverted.
                    apr: a.apr,
                    minPayment: opt(a.minPayment),
                    closed: a.closed,
                    source: a.source,
                    plaidAccountId: a.plaidAccountId,
                    nodeId: a.nodeId
                )
            },
            transactions: v3.budget.transactions.map { t in
                Txn(
                    id: t.id,
                    accountId: t.accountId,
                    date: t.date,
                    payee: t.payee,
                    amount: Money.fromDollars(t.amount),
                    categoryId: t.categoryId,
                    transferAccountId: t.transferAccountId,
                    transferPairId: t.transferPairId,
                    memo: t.memo,
                    source: t.source,
                    plaidTxnId: t.plaidTxnId
                )
            },
            groups: v3.budget.groups,
            categories: v3.budget.categories.map { c in
                BudgetCategory(
                    id: c.id,
                    groupId: c.groupId,
                    name: c.name,
                    order: c.order,
                    monthlyTarget: opt(c.monthlyTarget),
                    balanceTarget: opt(c.balanceTarget),
                    targetDate: c.targetDate,
                    hidden: c.hidden,
                    nodeId: c.nodeId
                )
            },
            assignments: v3.budget.assignments.mapValues { table in
                table.mapValues(Money.fromDollars)
            }
        )

        backfillUncategorized(&book)

        var nodes: [NodeId: NodeState] = [:]
        for (id, legacy) in v3.nodes {
            var node = NodeState(
                completed: legacy.completed,
                completedAt: legacy.completedAt,
                notes: legacy.notes,
                data: nil,
                monthlyChecks: legacy.monthlyChecks ?? [:]
            )
            switch legacy.data {
            case let .bigEF(data):
                node.data = .bigEF(BigEFData(targetMonths: data.targetMonths))
            case let .match(matchPct, currentContribPct):
                node.data = .match(matchPct: matchPct, currentContribPct: currentContribPct)
            case let .increase401k(currentPct, targetPct):
                node.data = .increase401k(currentPct: currentPct, targetPct: targetPct)
            case let .ira(data):
                node.data = .ira(IRAData(
                    type: data.type,
                    ytdContribution: sourced(data.ytdContribution),
                    annualLimit: Money.fromDollars(data.annualLimit)
                ))
            case let .hsa(data):
                node.data = .hsa(HSAData(
                    coverage: data.coverage,
                    ytdContribution: sourced(data.ytdContribution),
                    annualLimit: Money.fromDollars(data.annualLimit)
                ))
            case let .college(data):
                node.data = .college(CollegeData(
                    monthlyContribution: Money.fromDollars(data.monthlyContribution),
                    targetAge: data.targetAge
                ))
            default:
                // Ledger-owned (or payload-free) — v3 already stripped these.
                break
            }
            nodes[id] = node
        }

        return AppState(
            version: 4,
            settings: Settings(
                monthlyExpenses: opt(v3.settings.monthlyExpenses),
                preTaxIncome: opt(v3.settings.preTaxIncome),
                iraAnnualLimit: Money.fromDollars(v3.settings.iraAnnualLimit),
                hsaSelfLimit: Money.fromDollars(v3.settings.hsaSelfLimit),
                hsaFamilyLimit: Money.fromDollars(v3.settings.hsaFamilyLimit)
            ),
            decisions: v3.decisions,
            nodes: nodes,
            budget: book,
            shownCelebrations: v3.shownCelebrations,
            earnedMedals: v3.earnedMedals
        )
    }

    private static func sourced(_ n: LegacySourcedNumber) -> SourcedNumber {
        SourcedNumber(
            value: Money.fromDollars(n.value),
            source: n.source,
            lastSyncedAt: n.lastSyncedAt
        )
    }

    /// The one extra rewrite v4 rides along with: every on-budget row that never
    /// entered an envelope lands on `cat:uncategorized`, materializing the system
    /// group and the envelope in the same pass.
    ///
    /// The rows selected here are exactly the rows `Ledger.bookIntegrity` counts
    /// in its `unbudgetedSpending` residual: on an on-budget account, carrying no
    /// `categoryId`, and not one leg of an on-budget -> on-budget transfer (that
    /// pair cancels inside the cash total, so giving it an envelope would invent
    /// activity that never happened). An on-budget -> off-budget leg IS included:
    /// that money really does leave the budget, and every live write path already
    /// makes the user categorize it.
    ///
    /// Consequence, stated plainly: an uncategorized outflow that used to sit
    /// outside the envelope system now shows as overspending in Uncategorized,
    /// and a *past* month's overspend sweeps into Ready-to-Assign. That is the
    /// correction, not a side effect — the money always left, the book just
    /// wasn't saying where from. After this pass `unbudgetedSpending` is 0 and
    /// stays 0, which is what makes `drift == 0` an unconditional invariant from
    /// v4 forward. Mirrors `backfillUncategorized` in `src/state/io.ts`.
    private static func backfillUncategorized(_ book: inout BudgetBook) {
        let onBudget = Set(book.accounts.filter { Ledger.isOnBudget($0.kind) }.map(\.id))

        var touched = false
        for i in book.transactions.indices {
            let t = book.transactions[i]
            if t.categoryId != nil { continue }
            if !onBudget.contains(t.accountId) { continue }
            if let other = t.transferAccountId, onBudget.contains(other) { continue }
            book.transactions[i].categoryId = BudgetBook.uncategorizedCategoryID
            touched = true
        }
        guard touched else { return }

        // One definition of the system group + envelope, shared with every live
        // write path (AppStore.addTxn, AppStore.deleteCategory, ...).
        book.ensureUncategorized()
    }

    // MARK: - Legacy (dollar) helpers
    //
    // The v1/v2 stages used to borrow `NodeLedger.ensureGroup` and
    // `Ledger.accountBalance`, which now speak `Money`. These are the same
    // computations over the dollar-denominated legacy book.

    private static let legacyGroupNames: [String: String] = [
        NodeLedger.groupBills: "Bills",
        NodeLedger.groupEF: "Emergency Fund",
        NodeLedger.groupGoals: "Savings Goals",
    ]

    private static func legacyEnsureGroup(_ book: LegacyBudgetBook, _ groupID: String) -> CategoryGroup? {
        guard !book.groups.contains(where: { $0.id == groupID }) else { return nil }
        return CategoryGroup(
            id: groupID,
            name: legacyGroupNames[groupID] ?? groupID,
            order: book.groups.count
        )
    }

    /// The pre-v4 (dollar) emergency-fund targets, frozen for the legacy path —
    /// the live helpers in `Settings.swift` now return cents.
    private static func legacyEmergencyFundTarget(monthlyExpenses: LegacyDollars?) -> LegacyDollars {
        guard let monthlyExpenses, monthlyExpenses > 0 else { return 1000 }
        return max(1000, monthlyExpenses)
    }

    private static func legacyBigEmergencyFundTarget(months: Int, monthlyExpenses: LegacyDollars?) -> LegacyDollars {
        guard let monthlyExpenses, monthlyExpenses > 0 else { return 0 }
        return Decimal(months) * monthlyExpenses
    }

    private static func legacyAccountBalance(_ book: LegacyBudgetBook, _ accountID: String) -> LegacyDollars {
        var total: LegacyDollars = 0
        for t in book.transactions where t.accountId == accountID {
            total += t.amount
        }
        return total
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
    private static func efPayloadNode(_ big: LegacyBigEFData?, _ small: LegacySmallEFData?) -> NodeId? {
        if let big, (big.balance?.value ?? 0) > 0 || !(big.items ?? []).isEmpty { return .BigEF }
        if small != nil { return .SmallEF }
        return nil
    }

    private static func seedEmergencyFund(
        node: NodeId,
        items: [LegacyEFBucket]?,
        balance: LegacyDollars,
        singleTarget: LegacyDollars,
        addCategory: (LegacyCategory, LegacyDollars) -> Void
    ) {
        if let items, !items.isEmpty {
            for bucket in items {
                addCategory(
                    LegacyCategory(
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
                LegacyCategory(
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

    private static func startingTxn(_ accountID: String, date: String, amount: LegacyDollars) -> LegacyTxn {
        LegacyTxn(
            id: "txn:start:\(accountID)",
            accountId: accountID,
            date: date,
            payee: "Starting balance",
            amount: amount
        )
    }
}
