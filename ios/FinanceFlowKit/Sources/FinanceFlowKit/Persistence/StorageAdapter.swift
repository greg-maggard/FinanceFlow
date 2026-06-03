import Foundation

/// Pluggable persistence. The MVP ships `FileStorageAdapter`; a future
/// `CloudKitStorageAdapter` can slot in without touching `AppStore`.
/// Mirrors `StorageAdapter` in `src/state/storage.ts`.
public protocol StorageAdapter: Sendable {
    func load() async throws -> AppState?
    func save(_ state: AppState) async throws
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
        let data = try Data(contentsOf: fileURL)
        return try JSONCoder.decode(data)
    }

    public func save(_ state: AppState) async throws {
        let data = try JSONCoder.encode(state)
        try data.write(to: fileURL, options: [.atomic])
    }
}

/// In-memory adapter for previews and tests.
public final class MemoryStorageAdapter: StorageAdapter, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: AppState?
    public private(set) var saveCount = 0

    public init(initial: AppState? = nil) {
        self.stored = initial
    }

    public func load() async throws -> AppState? {
        lock.lock(); defer { lock.unlock() }
        return stored
    }

    public func save(_ state: AppState) async throws {
        lock.lock(); defer { lock.unlock() }
        stored = state
        saveCount += 1
    }
}
