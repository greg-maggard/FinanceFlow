import Foundation

/// Export / import / migrate. Mirrors `src/state/io.ts`.
public enum IO {
    /// Pretty-printed JSON for backup. Mirrors `exportJson`.
    public static func exportJSON(_ state: AppState) throws -> Data {
        try JSONCoder.encode(state)
    }

    public static func exportString(_ state: AppState) throws -> String {
        String(decoding: try exportJSON(state), as: UTF8.self)
    }

    /// Parse + migrate imported JSON. Unknown/garbage input yields fresh state,
    /// matching the web's forgiving `importJson` → `migrate`.
    public static func importJSON(_ data: Data) -> AppState {
        guard let state = try? JSONCoder.decode(data) else {
            return AppState.makeInitial()
        }
        return migrate(state)
    }

    public static func importString(_ raw: String) -> AppState {
        importJSON(Data(raw.utf8))
    }

    /// Forward-migration hook. Today only version 1 exists; anything else is
    /// reset to initial. Add `case 2:` here as the schema evolves.
    /// Mirrors `migrate`.
    public static func migrate(_ state: AppState) -> AppState {
        switch state.version {
        case 1:
            return state
        default:
            return AppState.makeInitial()
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
