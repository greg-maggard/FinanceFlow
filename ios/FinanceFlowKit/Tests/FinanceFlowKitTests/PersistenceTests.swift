import Testing
import Foundation
@testable import FinanceFlowKit

@Suite("Persistence & bootstrap")
@MainActor
struct PersistenceTests {

    private func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ff-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("FileStorageAdapter: nil before first save, round-trips after")
    func fileRoundTrip() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let adapter = FileStorageAdapter(fileURL: dir.appendingPathComponent("state.json"))

        #expect(try await adapter.load() == nil)            // no file yet

        var s = AppState.makeInitial()
        s.nodes[.Start]?.completed = true
        s.settings.monthlyExpenses = 3000
        try await adapter.save(s)

        #expect(try await adapter.load() == s)              // exact round-trip
    }

    /// Regression for the silent-data-loss bug: a present-but-unreadable file must
    /// be preserved (quarantined), never overwritten by a fresh autosave.
    @Test("bootstrap quarantines a corrupt file instead of clobbering it")
    func corruptFileIsQuarantinedNotClobbered() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("state.json")

        let garbage = Data("{ not valid json".utf8)
        try garbage.write(to: url)

        let store = AppStore(storage: FileStorageAdapter(fileURL: url), saveDebounce: .milliseconds(10))
        await store.bootstrap()
        #expect(store.loadError != nil)                      // user is informed

        // The OLD bug: this edit's autosave overwrote state.json with empty data.
        store.toggleComplete(.Start)
        await store.flush()

        // The original bytes must survive in a quarantine file.
        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        let quarantined = try #require(files.first { $0.contains(".corrupt-") })
        let preserved = try Data(contentsOf: dir.appendingPathComponent(quarantined))
        #expect(preserved == garbage)
    }

    @Test("bootstrap adopts a valid persisted document")
    func bootstrapLoads() async throws {
        var initial = AppState.makeInitial()
        initial.nodes[.Start]?.completed = true
        let store = AppStore(storage: MemoryStorageAdapter(initial: initial))
        await store.bootstrap()
        #expect(store.state.node(.Start).completed == true)
        #expect(store.loadError == nil)
    }

    @Test("flush persists immediately, bypassing the debounce, exactly once")
    func flushImmediate() async throws {
        let memory = MemoryStorageAdapter()
        let store = AppStore(storage: memory, saveDebounce: .seconds(60))   // long debounce
        store.toggleComplete(.Start)
        await store.flush()
        #expect(await memory.saveCount == 1)
        let loaded = try await memory.load()
        #expect(loaded?.node(.Start).completed == true)
    }
}
