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
    }
}
