import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("AppStore")
@MainActor
struct AppStoreTests {
    @Test("toggleComplete sets completed + completedAt, then clears")
    func toggleComplete() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.toggleComplete(.Start)
        #expect(store.state.node(.Start).completed == true)
        #expect(store.state.node(.Start).completedAt != nil)

        store.toggleComplete(.Start)
        #expect(store.state.node(.Start).completed == false)
        #expect(store.state.node(.Start).completedAt == nil)
    }

    @Test("setDecision and clearing via nil")
    func setDecision() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.setDecision(.Q_Match, .yes)
        #expect(store.state.decisions[.Q_Match] == .yes)
        store.setDecision(.Q_Match, nil)
        #expect(store.state.decisions[.Q_Match] == nil)
    }

    @Test("status reflects mutations")
    func statusReflectsMutations() {
        let store = AppStore(storage: MemoryStorageAdapter())
        #expect(store.status(of: .Start) == .current)
        store.toggleComplete(.Start)
        #expect(store.status(of: .Start) == .done)
        #expect(store.status(of: .Rent) == .current)
    }

    @Test("setNodeData stores the payload verbatim")
    func setNodeDataVerbatim() {
        let store = AppStore(storage: MemoryStorageAdapter())
        let data = NodeData.bigEF(BigEFData(targetMonths: 6))
        store.setNodeData(.BigEF, data)
        #expect(store.state.node(.BigEF).data == data)
    }

    @Test("monthly check toggles on and off")
    func monthlyCheck() {
        let store = AppStore(storage: MemoryStorageAdapter())
        let key = Recurring.ymKey()
        store.toggleMonthlyCheck(.Rent, key)
        #expect(store.state.node(.Rent).monthlyChecks[key] == true)
        store.toggleMonthlyCheck(.Rent, key)
        #expect(store.state.node(.Rent).monthlyChecks[key] == nil)
    }

    @Test("debounced save fires once for a burst of mutations")
    func debouncedSave() async throws {
        let memory = MemoryStorageAdapter()
        let store = AppStore(storage: memory, saveDebounce: .milliseconds(200))
        store.toggleComplete(.Start)
        store.setNotes(.Start, "a")
        store.setNotes(.Start, "ab")
        #expect(await memory.saveCount == 0)        // nothing yet — still debouncing

        // A fixed sleep flakes on slow CI runners (the save task can lag well
        // past the debounce), so wait on the condition with a bounded deadline.
        let deadline = ContinuousClock.now + .seconds(5)
        while await memory.saveCount == 0, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(await memory.saveCount == 1)        // collapsed into a single write
        let loaded = try? await memory.load()
        #expect(loaded?.node(.Start).notes == "ab")

        // …and stays collapsed: no second write arrives afterwards.
        try await Task.sleep(for: .milliseconds(150))
        #expect(await memory.saveCount == 1)
    }

    @Test("replaceState migrates and replaces")
    func replaceState() {
        let store = AppStore(storage: MemoryStorageAdapter())
        var incoming = AppState.makeInitial()
        incoming.nodes[.Start]?.completed = true
        store.replaceState(incoming)
        #expect(store.state.node(.Start).completed == true)
    }

    @Test("assign sets, overwrites, and clears a category's month assignment")
    func assignMutations() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.assign(month: "2026-06", categoryID: "groceries", amount: 600)
        #expect(store.state.budget.assignments["2026-06"]?["groceries"] == 600)

        store.assign(month: "2026-06", categoryID: "groceries", amount: 450)
        #expect(store.state.budget.assignments["2026-06"]?["groceries"] == 450)

        store.assign(month: "2026-06", categoryID: "groceries", amount: 0)
        // Clearing the last assignment removes the empty month table entirely.
        #expect(store.state.budget.assignments["2026-06"] == nil)
        #expect(Ledger.bookIntegrity(store.state.budget, month: "2026-06").drift == 0)
    }

    @Test("deleting one row of a transfer deletes its pair")
    func deleteTransferPair() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.addAccount(Account(id: "checking", name: "Checking", kind: .checking))
        store.addAccount(Account(id: "savings", name: "Savings", kind: .savings))
        store.addTransfer(from: "checking", to: "savings", amount: 200, date: "2026-06-05")
        #expect(store.state.budget.transactions.count == 2)

        let anyRow = store.state.budget.transactions[0]
        store.deleteTxn(anyRow.id)
        #expect(store.state.budget.transactions.isEmpty)
        #expect(Ledger.bookIntegrity(store.state.budget, month: "2026-06").drift == 0)
    }

    @Test("deleteCategory moves transactions and money to the chosen envelope")
    func deleteCategoryCleansUp() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.addAccount(Account(id: "checking", name: "Checking", kind: .checking))
        store.addGroup(name: "Bills")
        let groupID = store.state.budget.groups[0].id
        store.addCategory(groupID: groupID, name: "Phone")
        let catID = store.state.budget.categories[0].id
        store.addTxn(Txn(id: "t1", accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: Ledger.rtaCategoryID))
        store.addTxn(Txn(id: "t2", accountId: "checking", date: "2026-06-05", amount: -40, categoryId: catID))
        store.assign(month: "2026-06", categoryID: catID, amount: 100)
        #expect(Ledger.snapshot(store.state.budget, month: "2026-06").readyToAssign == 900)

        store.deleteCategory(catID, reassignTo: BudgetBook.uncategorizedCategoryID)
        #expect(store.state.budget.categories.map(\.id) == [BudgetBook.uncategorizedCategoryID])
        #expect(
            store.state.budget.transactions.first { $0.id == "t2" }?.categoryId
                == BudgetBook.uncategorizedCategoryID
        )
        // Activity and funding land in the same envelope, so both terms are
        // invariant — nothing vanished and nothing appeared.
        #expect(Ledger.snapshot(store.state.budget, month: "2026-06").readyToAssign == 900)
        #expect(
            Ledger.snapshot(store.state.budget, month: "2026-06")
                .categories[BudgetBook.uncategorizedCategoryID]?.available == 60
        )
        #expect(Ledger.bookIntegrity(store.state.budget, month: "2026-06").drift == 0)
    }

    @Test("deleteCategory returns a never-spent envelope's assignments to Ready-to-Assign")
    func deleteCategoryWithNoTransactions() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.addAccount(Account(id: "checking", name: "Checking", kind: .checking))
        store.addGroup(name: "Bills")
        let groupID = store.state.budget.groups[0].id
        store.addCategory(groupID: groupID, name: "Typo")
        let catID = store.state.budget.categories[0].id
        store.addTxn(Txn(id: "t1", accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: Ledger.rtaCategoryID))
        store.assign(month: "2026-06", categoryID: catID, amount: 100)
        #expect(Ledger.snapshot(store.state.budget, month: "2026-06").readyToAssign == 900)

        store.deleteCategory(catID, reassignTo: BudgetBook.uncategorizedCategoryID)

        // No activity to carry, so there is nothing to keep the funding with:
        // the dollars go back to the pool, and no catch-all envelope is
        // conjured up.
        #expect(store.state.budget.categories.isEmpty)
        #expect(store.state.budget.assignments.isEmpty)
        #expect(Ledger.snapshot(store.state.budget, month: "2026-06").readyToAssign == 1000)
        #expect(Ledger.bookIntegrity(store.state.budget, month: "2026-06").drift == 0)
    }

    @Test("an expense saved with no envelope of its own lands in a real Uncategorized envelope")
    func uncategorizedSpendStaysInsideTheEnvelopeSystem() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.addAccount(Account(id: "checking", name: "Checking", kind: .checking))
        store.addTxn(Txn(id: "t1", accountId: "checking", date: "2026-06-01", amount: 1000, categoryId: Ledger.rtaCategoryID))
        // What TxnFormSheet now writes when the picker was never touched.
        store.addTxn(Txn(
            id: "t2", accountId: "checking", date: "2026-06-05", amount: -40,
            categoryId: BudgetBook.uncategorizedCategoryID
        ))

        // Visible, assignable, and outside every node's math.
        let category = store.state.budget.categories.first { $0.id == BudgetBook.uncategorizedCategoryID }
        #expect(category?.name == "Uncategorized")
        #expect(category?.nodeId == nil)
        #expect(store.state.budget.groups.contains { $0.id == BudgetBook.systemGroupID })

        let integrity = Ledger.bookIntegrity(store.state.budget, month: "2026-06")
        // The spend is in an envelope, not in the residual.
        #expect(integrity.unbudgetedSpending == 0)
        #expect(integrity.drift == 0)
        #expect(
            Ledger.snapshot(store.state.budget, month: "2026-06")
                .categories[BudgetBook.uncategorizedCategoryID]?.available == -40
        )
    }

    @Test("deleteCategory refuses to delete the Uncategorized envelope")
    func deleteUncategorizedIsNoOp() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.addAccount(Account(id: "checking", name: "Checking", kind: .checking))
        store.addTxn(Txn(
            id: "t1", accountId: "checking", date: "2026-06-05", amount: -25,
            categoryId: BudgetBook.uncategorizedCategoryID
        ))
        // Saving into it is what created it.
        #expect(store.state.budget.categories.map(\.id) == [BudgetBook.uncategorizedCategoryID])

        store.deleteCategory(BudgetBook.uncategorizedCategoryID, reassignTo: "anything")

        #expect(store.state.budget.categories.map(\.id) == [BudgetBook.uncategorizedCategoryID])
        #expect(
            store.state.budget.transactions.first { $0.id == "t1" }?.categoryId
                == BudgetBook.uncategorizedCategoryID
        )
        #expect(Ledger.bookIntegrity(store.state.budget, month: "2026-06").drift == 0)
    }

    @Test("apply(_:) lands a balance-edit plan atomically through the store")
    func applyBookOps() {
        let store = AppStore(storage: MemoryStorageAdapter())
        let month = Recurring.ymKey()
        store.addGroup(name: "Emergency Fund")
        let groupID = store.state.budget.groups[0].id
        store.addCategory(groupID: groupID, name: "Medical")
        let catID = store.state.budget.categories[0].id
        store.assign(month: month, categoryID: catID, amount: 100)

        // Lower past the assignment: un-assign + one coalesced adjustment txn.
        // Date the adjustment inside the month under test — a fixed date only
        // passes while the calendar agrees (the web twin was fixed the same way).
        let plan = NodeLedger.planBalanceEdit(
            store.state.budget, month: month, categoryID: catID, newAvailable: -25, today: "\(month)-10"
        )
        store.apply(plan)

        #expect(store.state.budget.assignments[month]?[catID] == nil)
        let adjustments = store.state.budget.transactions.filter { $0.accountId == NodeLedger.adjustAccountID }
        #expect(adjustments.count == 1)
        #expect(adjustments.first?.amount == -25)
        #expect(store.state.budget.accounts.contains { $0.id == NodeLedger.adjustAccountID })
        #expect(Ledger.snapshot(store.state.budget, month: month).categories[catID]?.available == -25)
        #expect(Ledger.bookIntegrity(store.state.budget, month: month).drift == 0)
    }

    @Test("correcting the balance a day later unwinds the write-off, leaving RTA whole")
    func balanceCorrectionUnwindsWriteOff() {
        let store = AppStore(storage: MemoryStorageAdapter())
        let month = Recurring.ymKey()
        store.addGroup(name: "Emergency Fund")
        let groupID = store.state.budget.groups[0].id
        store.addCategory(groupID: groupID, name: "Medical")
        let catID = store.state.budget.categories[0].id
        store.assign(month: month, categoryID: catID, amount: 100)

        let before = store.state.budget
        let rtaBefore = Ledger.snapshot(before, month: month).readyToAssign

        // Day 10 typo: available driven below zero, writing off 25 dollars.
        store.apply(NodeLedger.planBalanceEdit(before, month: month, categoryID: catID, newAvailable: -25, today: "\(month)-10"))
        // Day 11 correction back to where it started.
        store.apply(NodeLedger.planBalanceEdit(store.state.budget, month: month, categoryID: catID, newAvailable: 100, today: "\(month)-11"))

        let after = store.state.budget
        #expect(after.transactions.filter { $0.accountId == NodeLedger.adjustAccountID }.isEmpty)
        #expect(after.assignments == before.assignments)
        let snap = Ledger.snapshot(after, month: month)
        #expect(snap.categories[catID]?.available == 100)
        #expect(snap.readyToAssign == rtaBefore)
        #expect(Ledger.bookIntegrity(after, month: month).drift == 0)
    }

    @Test("addGroup and addCategory assign sequential orders")
    func groupAndCategoryOrders() {
        let store = AppStore(storage: MemoryStorageAdapter())
        store.addGroup(name: "Bills")
        store.addGroup(name: "Goals")
        #expect(store.state.budget.groups.map(\.order) == [0, 1])

        let groupID = store.state.budget.groups[0].id
        store.addCategory(groupID: groupID, name: "Rent")
        store.addCategory(groupID: groupID, name: "Food")
        #expect(store.state.budget.categories.map(\.order) == [0, 1])
        #expect(store.state.budget.categories.allSatisfy { $0.groupId == groupID })
        #expect(Ledger.bookIntegrity(store.state.budget, month: Recurring.ymKey()).drift == 0)
    }
}
