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
    func load() async throws -> AppState?
    func save(_ state: AppState) async throws
    /// Best-effort: move an unreadable persisted document aside (so it is
    /// preserved for recovery and not overwritten). No-op for adapters with no
    /// backing file.
    func quarantineUnreadableFile() async
}

public extension StorageAdapter {
    func quarantineUnreadableFile() async {}
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

    public func load() async throws -> AppState? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        // A read failure here (e.g. file temporarily protected) propagates as-is so
        // the caller can treat it as transient and leave the file untouched.
        let data = try Data(contentsOf: fileURL)
        // A decode failure means the bytes are genuinely unusable — tag it so the
        // caller knows the file is safe to quarantine.
        do {
            return try JSONCoder.decode(data)
        } catch {
            throw StorageError.unreadableContents(underlying: error)
        }
    }

    public func save(_ state: AppState) async throws {
        let data = try JSONCoder.encode(state)
        try data.write(to: fileURL, options: [.atomic])
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
    private var stored: AppState?
    public private(set) var saveCount = 0

    public init(initial: AppState? = nil) {
        self.stored = initial
    }

    public func load() async throws -> AppState? {
        stored
    }

    public func save(_ state: AppState) async throws {
        stored = state
        saveCount += 1
    }
}
