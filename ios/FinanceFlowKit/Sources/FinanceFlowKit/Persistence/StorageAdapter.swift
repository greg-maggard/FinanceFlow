import Foundation

/// Errors a `StorageAdapter` can surface, distinct enough for callers to decide
/// whether a backing file is safe to set aside.
public enum StorageError: Error {
    /// The file exists but its contents could not be decoded. The bytes are
    /// definitely unusable (not a transient I/O hiccup), so it is safe to
    /// quarantine the file rather than overwrite it.
    case unreadableContents(underlying: Error)
}

/// Pluggable persistence. The MVP ships `FileStorageAdapter`; a future
/// `CloudKitStorageAdapter` can slot in without touching `AppStore`.
/// Mirrors `StorageAdapter` in `src/state/storage.ts`.
public protocol StorageAdapter: Sendable {
    /// The persisted bytes, UNDECODED. The schema version has to be read before
    /// the document can be interpreted at all — v3 and v4 use the same field
    /// names for different units (dollars vs. integer cents), so handing back an
    /// already-decoded `AppState` would mean guessing. `IO.importJSON` routes.
    func load() async throws -> Data?
    func save(_ state: AppState) async throws
    /// Best-effort: move an unreadable persisted document aside (so it is
    /// preserved for recovery and not overwritten). No-op for adapters with no
    /// backing file.
    func quarantineUnreadableFile() async
    /// D7 (money-migration-v4.md): copy the current document aside under its own
    /// schema version before the first save of a newly-migrated one, so a bad
    /// migration stays recoverable. Must never clobber an existing backup for
    /// that version.
    ///
    /// Returns `true` when a pre-migration backup for `version` is in place —
    /// either just written, or already present from an earlier launch — and
    /// `false` when the copy could not be made. The result GATES the migration
    /// (`AppStore.bootstrap`): the pre-migration bytes are irreplaceable, and
    /// the first autosave of the migrated document replaces them, so a `false`
    /// must stop that write rather than being swallowed. Disk-full is exactly
    /// the case that fails here — a backup *adds* a whole second copy while the
    /// live save merely *replaces* one — so this is the failure most likely to
    /// coincide with a successful overwrite.
    ///
    /// Adapters with no backing file have nothing to protect and return `true`.
    func backupPreMigration(version: Int) async -> Bool
}

public extension StorageAdapter {
    func quarantineUnreadableFile() async {}
    func backupPreMigration(version: Int) async -> Bool { true }
}

/// Writes a single pretty-printed `state.json` to the app's Documents directory.
public struct FileStorageAdapter: StorageAdapter {
    public let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    /// Default location: `<Documents>/state.json`.
    public init(fileName: String = "state.json", directory: FileManager.SearchPathDirectory = .documentDirectory) {
        let base = (try? FileManager.default.url(for: directory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        self.fileURL = base.appendingPathComponent(fileName)
    }

    public func load() async throws -> Data? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        // A read failure here (e.g. file temporarily protected) propagates as-is so
        // the caller can treat it as transient and leave the file untouched.
        // Decoding — and therefore the "these bytes are genuinely unusable"
        // judgement — happens in `AppStore.bootstrap`, which knows the version.
        return try Data(contentsOf: fileURL)
    }

    public func save(_ state: AppState) async throws {
        let data = try JSONCoder.encode(state)
        try data.write(to: fileURL, options: [.atomic])
    }

    /// Copy `state.json` aside as `state.v<n>-backup.json` before the app first
    /// writes a migrated document over it. Skips silently when a backup for that
    /// version already exists: that file is already a pre-migration copy of the
    /// same schema, and replacing it would trade a known-good backup for a newer
    /// one at exactly the moment the user is most likely to need the older.
    ///
    /// A copy failure (disk full, protected container) is REPORTED, not
    /// swallowed — see the protocol doc. Returning `false` blocks the migrated
    /// write instead of letting it replace bytes nothing has a copy of.
    public func backupPreMigration(version: Int) async -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: fileURL.path) else { return true }
        let base = fileURL.deletingPathExtension().lastPathComponent
        let backup = fileURL
            .deletingLastPathComponent()
            .appendingPathComponent("\(base).v\(version)-backup.json")
        guard !fm.fileExists(atPath: backup.path) else { return true }
        do {
            try fm.copyItem(at: fileURL, to: backup)
            return true
        } catch {
            return false
        }
    }

    /// Rename the existing file to `state.corrupt-<timestamp>.json` so it is
    /// preserved (and recoverable) rather than overwritten by a fresh save.
    public func quarantineUnreadableFile() async {
        let fm = FileManager.default
        guard fm.fileExists(atPath: fileURL.path) else { return }
        let stamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let base = fileURL.deletingPathExtension().lastPathComponent
        let backup = fileURL
            .deletingLastPathComponent()
            .appendingPathComponent("\(base).corrupt-\(stamp).json")
        try? fm.moveItem(at: fileURL, to: backup)
    }
}

/// In-memory adapter for previews and tests. `actor` isolation gives us
/// `Sendable` for free and avoids the `NSLock`-in-async warnings under Swift 6.
public actor MemoryStorageAdapter: StorageAdapter {
    private var stored: Data?
    public private(set) var saveCount = 0
    public private(set) var backedUpVersions: [Int] = []
    /// Test hook: makes `backupPreMigration` report failure, standing in for a
    /// full disk. Set it to prove the migrated write is gated, not merely
    /// logged.
    public private(set) var backupShouldFail = false

    public init(initial: AppState? = nil) {
        self.stored = initial.flatMap { try? JSONCoder.encode($0) }
    }

    /// Seed with raw bytes — how a legacy (pre-v4) document gets into a test.
    public init(rawJSON: String) {
        self.stored = Data(rawJSON.utf8)
    }

    public func load() async throws -> Data? {
        stored
    }

    public func save(_ state: AppState) async throws {
        stored = try JSONCoder.encode(state)
        saveCount += 1
    }

    public func setBackupShouldFail(_ value: Bool) {
        backupShouldFail = value
    }

    public func backupPreMigration(version: Int) async -> Bool {
        guard stored != nil else { return true }   // nothing to protect
        if backupShouldFail { return false }
        if !backedUpVersions.contains(version) { backedUpVersions.append(version) }
        return true
    }

    /// The bytes exactly as they sit in the adapter, for asserting that a
    /// blocked migration left the stored document untouched.
    public func storedBytes() -> Data? {
        stored
    }

    /// The document as last persisted, decoded. `nil` when nothing is stored.
    public func loadState() throws -> AppState? {
        try stored.map { try IO.importJSON($0) }
    }
}
