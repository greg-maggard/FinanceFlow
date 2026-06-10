import Foundation

/// v1 -> v2: seed the budget book from the node payloads.
/// Mirrors `migrateV1` in `src/state/io.ts` — including every generated id,
/// which derives from a stable v1 id so both platforms migrate the same
/// document to the same book. `MigrationTests` pins the two together.
///
/// The v1 payloads stay untouched (the UI still reads them until it switches
/// to the ledger), so this is purely additive bootstrap data.
///
/// Seeding rule: each funded/saved amount becomes that category's assignment
/// in the migration month, and one starting-balance inflow on a seeded Cash
/// account covers the total — so every envelope's available matches its v1
/// bar exactly and Ready-to-Assign lands at exactly zero.
enum Migration {
    private static let recurringNodes: [NodeId] = [
        .Rent, .Food, .Essential, .Income, .Health, .MinDebt, .NonEssential,
    ]

    static func v1ToV2(_ v1: AppState, now: Date = Date()) -> AppState {
        var book = BudgetBook()
        let month = Recurring.ymKey(now)
        let today = isoDay(now)
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
        if let big, big.balance.value > 0 || !(big.items ?? []).isEmpty {
            seedEmergencyFund(
                node: .BigEF,
                items: big.items,
                balance: big.balance.value,
                singleTarget: bigEmergencyFundTarget(
                    months: big.targetMonths,
                    monthlyExpenses: v1.settings.monthlyExpenses
                ),
                addCategory: addCategory
            )
        } else if let small {
            seedEmergencyFund(
                node: .SmallEF,
                items: small.items,
                balance: small.balance.value,
                singleTarget: emergencyFundTarget(monthlyExpenses: v1.settings.monthlyExpenses),
                addCategory: addCategory
            )
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
                    minPayment: debt.minPayment
                )
                book.accounts.append(account)
                if debt.balance != 0 {
                    book.transactions.append(startingTxn(account.id, date: today, amount: -debt.balance))
                }
            }
        }

        // The 529 balance becomes a tracking account.
        if let college = v1.node(.College).data?.college, college.balance.value > 0 {
            book.accounts.append(Account(id: "acct:college", name: "529 Plan", kind: .tracking))
            book.transactions.append(startingTxn("acct:college", date: today, amount: college.balance.value))
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

    /// Local "YYYY-MM-DD", matching the web's `isoDay`.
    static func isoDay(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
