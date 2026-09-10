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
        s.settings.monthlyExpenses = 300_000
        try await adapter.save(s)

        // `load()` returns raw bytes now (the version has to be read before the
        // document can be interpreted), so the round-trip is asserted through
        // the importer.
        let raw = try #require(try await adapter.load())
        #expect(try IO.importJSON(raw) == s)
    }

    /// D7 (money-migration-v4.md): opening a pre-v4 document upgrades it in
    /// place, and the debounced save then replaces `state.json` with the v4
    /// image. The ORIGINAL bytes have to be copied aside first, or a bad
    /// migration is unrecoverable.
    @Test("bootstrap copies the pre-migration document aside before writing v4 over it")
    func preMigrationBackupIsTakenBeforeTheFirstV4Write() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("state.json")

        let v3 = Data("""
        {
          "version": 3,
          "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
          "decisions": {},
          "nodes": {},
          "budget": {
            "accounts": [{ "id": "checking", "name": "Checking", "kind": "checking", "source": "manual" }],
            "transactions": [
              { "id": "t1", "accountId": "checking", "date": "2026-06-01", "amount": 12.34, "categoryId": "rta", "source": "manual" }
            ],
            "groups": [], "categories": [], "assignments": {}
          }
        }
        """.utf8)
        try v3.write(to: url)

        let store = AppStore(storage: FileStorageAdapter(fileURL: url), saveDebounce: .milliseconds(10))
        await store.bootstrap()
        #expect(store.loadError == nil)
        #expect(store.state.version == 4)
        #expect(Ledger.accountBalance(store.state.budget, "checking") == Money(cents: 1234))

        store.toggleComplete(.Start)
        await store.flush()

        // The live file is now v4...
        let live = try Data(contentsOf: url)
        #expect(IO.documentVersion(live) == 4)
        // ...and the pre-migration bytes survive, byte for byte.
        let backup = try Data(contentsOf: dir.appendingPathComponent("state.v3-backup.json"))
        #expect(backup == v3)
    }

    @Test("an existing pre-migration backup is never clobbered")
    func preMigrationBackupNeverClobbers() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("state.json")
        let backupURL = dir.appendingPathComponent("state.v3-backup.json")

        let keeper = Data("{\"the one to keep\": true}".utf8)
        try keeper.write(to: backupURL)
        try Data("""
        {"version": 3, "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
         "decisions": {}, "nodes": {},
         "budget": { "accounts": [], "transactions": [], "groups": [], "categories": [], "assignments": {} }}
        """.utf8).write(to: url)

        let store = AppStore(storage: FileStorageAdapter(fileURL: url), saveDebounce: .milliseconds(10))
        await store.bootstrap()

        #expect(try Data(contentsOf: backupURL) == keeper)
    }

    /// F2 (Wave 3): the pre-migration backup GATES the migration. It used to be
    /// `try?` — swallowed — while the first v4 save went ahead regardless, and
    /// the two outcomes are correlated: the backup adds a whole second copy of
    /// the document while the save only replaces one, so a full disk fails the
    /// backup and succeeds the overwrite. The pre-migration bytes have to
    /// survive a failed backup.
    @Test("a failed pre-migration backup blocks the migrated write and surfaces the block")
    func failedPreMigrationBackupGatesTheMigration() async throws {
        let v3 = """
        {"version": 3,
         "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
         "decisions": {}, "nodes": {},
         "budget": {
           "accounts": [{ "id": "checking", "name": "Checking", "kind": "checking", "source": "manual" }],
           "transactions": [
             { "id": "t1", "accountId": "checking", "date": "2026-06-01", "amount": 12.34, "categoryId": "rta", "source": "manual" }
           ],
           "groups": [], "categories": [], "assignments": {} }}
        """
        let original = Data(v3.utf8)
        let memory = MemoryStorageAdapter(rawJSON: v3)
        await memory.setBackupShouldFail(true)

        let store = AppStore(storage: memory, saveDebounce: .milliseconds(10))
        await store.bootstrap()

        // The block is surfaced, not swallowed...
        let message = try #require(store.loadError)
        #expect(message.contains("backup"))
        #expect(message.contains("NOT been changed"))
        // ...the migrated document was NOT adopted (throwaway initial state,
        // same as the transient-read-failure path)...
        #expect(store.state.budget.accounts.isEmpty)
        // ...and no backup was recorded, so nothing pretends otherwise.
        #expect(await memory.backedUpVersions.isEmpty)

        // The decisive part: an edit's autosave must not replace the v3 bytes.
        store.toggleComplete(.Start)
        await store.flush()
        #expect(await memory.saveCount == 0)
        #expect(await memory.storedBytes() == original)
        #expect(IO.documentVersion(try #require(await memory.storedBytes())) == 3)
    }

    /// The same document with a working backup: the gate is a gate, not a wall.
    @Test("a successful pre-migration backup lets the migration proceed")
    func successfulPreMigrationBackupAllowsTheMigration() async throws {
        let v3 = """
        {"version": 3,
         "settings": { "iraAnnualLimit": 7000, "hsaSelfLimit": 4300, "hsaFamilyLimit": 8550 },
         "decisions": {}, "nodes": {},
         "budget": {
           "accounts": [{ "id": "checking", "name": "Checking", "kind": "checking", "source": "manual" }],
           "transactions": [], "groups": [], "categories": [], "assignments": {} }}
        """
        let memory = MemoryStorageAdapter(rawJSON: v3)
        let store = AppStore(storage: memory, saveDebounce: .milliseconds(10))
        await store.bootstrap()

        #expect(store.loadError == nil)
        #expect(store.state.version == 4)
        #expect(await memory.backedUpVersions == [3])
        // The migration that was allowed to proceed produced a balanced book.
        #expect(Ledger.bookIntegrity(store.state.budget, month: "2026-06").drift == .zero)

        store.toggleComplete(.Start)
        await store.flush()
        #expect(await memory.saveCount == 1)
        #expect(IO.documentVersion(try #require(await memory.storedBytes())) == 4)
    }

    /// The reporting contract at the adapter level, on the real file adapter:
    /// a copy that can't be made is `false`, an already-present backup is
    /// `true` (write-once, and the caller must not be blocked by it).
    @Test("FileStorageAdapter reports whether a pre-migration backup is in place")
    func fileAdapterReportsBackupOutcome() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("state.json")
        let adapter = FileStorageAdapter(fileURL: url)

        // Nothing to protect yet: not a failure.
        #expect(await adapter.backupPreMigration(version: 3) == true)

        try Data("{\"version\": 3}".utf8).write(to: url)
        #expect(await adapter.backupPreMigration(version: 3) == true)
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("state.v3-backup.json").path))

        // Already parked — still `true`, and still not clobbered.
        #expect(await adapter.backupPreMigration(version: 3) == true)

        // A destination that cannot be written reports failure rather than
        // being swallowed: here the enclosing directory is gone.
        let missingDir = dir.appendingPathComponent("nope", isDirectory: true)
        let orphan = FileStorageAdapter(fileURL: missingDir.appendingPathComponent("state.json"))
        try FileManager.default.createDirectory(at: missingDir, withIntermediateDirectories: true)
        try Data("{\"version\": 3}".utf8).write(to: orphan.fileURL)
        // Replace the directory entry the copy would land in with something
        // that makes `copyItem` fail: a read-only container.
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: missingDir.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: missingDir.path) }
        #expect(await orphan.backupPreMigration(version: 3) == false)
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
        let loaded = try await memory.loadState()
        #expect(loaded?.node(.Start).completed == true)
    }
}
