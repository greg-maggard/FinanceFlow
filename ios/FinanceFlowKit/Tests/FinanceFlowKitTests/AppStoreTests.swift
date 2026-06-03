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
    func debouncedSave() async {
        let memory = MemoryStorageAdapter()
        let store = AppStore(storage: memory, saveDebounce: .milliseconds(50))
        store.toggleComplete(.Start)
        store.setNotes(.Start, "a")
        store.setNotes(.Start, "ab")
        #expect(memory.saveCount == 0)              // nothing yet — still debouncing
        try? await Task.sleep(for: .milliseconds(150))
        #expect(memory.saveCount == 1)              // collapsed into a single write
        let loaded = try? await memory.load()
        #expect(loaded?.node(.Start).notes == "ab")
    }

    @Test("replaceState migrates and replaces")
    func replaceState() {
        let store = AppStore(storage: MemoryStorageAdapter())
        var incoming = AppState.makeInitial()
        incoming.nodes[.Start]?.completed = true
        store.replaceState(incoming)
        #expect(store.state.node(.Start).completed == true)
    }
}
