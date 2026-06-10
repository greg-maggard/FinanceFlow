import Foundation

/// Export / import / migrate. Mirrors `src/state/io.ts`.
public enum IO {
    /// Why a document couldn't be adopted.
    public enum ImportError: Error, Equatable {
        /// The document declares a schema version this build doesn't understand.
        /// We must preserve, never silently discard, such a file.
        case unsupportedVersion(Int)
    }

    /// Pretty-printed JSON for backup. Mirrors `exportJson`.
    public static func exportJSON(_ state: AppState) throws -> Data {
        try JSONCoder.encode(state)
    }

    public static func exportString(_ state: AppState) throws -> String {
        String(decoding: try exportJSON(state), as: UTF8.self)
    }

    /// Parse + migrate imported JSON. Throws on undecodable input or an
    /// unsupported schema version so callers can surface a real error instead of
    /// silently substituting empty state (which could then overwrite good data).
    public static func importJSON(_ data: Data) throws -> AppState {
        try migrate(JSONCoder.decode(data))
    }

    public static func importString(_ raw: String) throws -> AppState {
        try importJSON(Data(raw.utf8))
    }

    /// Forward-migration hook. A newer/unknown version is a hard error — the
    /// caller must preserve the file, not reset it to empty state.
    public static func migrate(_ state: AppState, now: Date = Date()) throws -> AppState {
        switch state.version {
        case 1:
            return Migration.v1ToV2(state, now: now)
        case 2:
            return state
        default:
            throw ImportError.unsupportedVersion(state.version)
        }
    }

    /// Suggested export filename, e.g. `financeflow-2026-06-03.json`.
    public static func exportFileName(date: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return "financeflow-\(f.string(from: date)).json"
    }
}
