import Foundation

/// Export / import / migrate. Mirrors `src/state/io.ts`.
public enum IO {
    private static var decoder: JSONDecoder { JSONCoder.decoder }

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

    /// Just enough of a document to route it to the right decoder.
    private struct VersionProbe: Decodable {
        var version: Int?
    }

    /// The schema version a document declares, without interpreting anything
    /// else in it. `nil` when the bytes aren't a JSON object at all.
    public static func documentVersion(_ data: Data) -> Int? {
        guard let probe = try? decoder.decode(VersionProbe.self, from: data) else { return nil }
        return probe.version ?? 1
    }

    /// Parse + migrate imported JSON. Throws on undecodable input or an
    /// unsupported schema version so callers can surface a real error instead of
    /// silently substituting empty state (which could then overwrite good data).
    ///
    /// The version has to be read BEFORE the document is decoded, because v3 and
    /// v4 spell the same field names in different units: `"amount": 33.335` is
    /// dollars in a v3 document and would decode as cents (or fail — `Money` is
    /// an integer) against the live model. A pre-v4 document therefore decodes
    /// as `LegacyState` and runs the chain; a v4 document decodes directly.
    public static func importJSON(_ data: Data, now: Date = Date()) throws -> AppState {
        let version = try decoder.decode(VersionProbe.self, from: data).version ?? 1
        switch version {
        case 4:
            return try decoder.decode(AppState.self, from: data)
        case 1, 2, 3:
            return try migrate(decoder.decode(LegacyState.self, from: data), now: now)
        default:
            throw ImportError.unsupportedVersion(version)
        }
    }

    public static func importString(_ raw: String, now: Date = Date()) throws -> AppState {
        try importJSON(Data(raw.utf8), now: now)
    }

    /// Forward-migration hook over an already-decoded pre-v4 document. A
    /// newer/unknown version is a hard error — the caller must preserve the
    /// file, not reset it to empty state. Mirrors `migrate` in
    /// `src/state/io.ts`; the chain is v1 -> v2 -> v3 -> v4.
    static func migrate(_ state: LegacyState, now: Date = Date()) throws -> AppState {
        switch state.version {
        case 1:
            return Migration.v3ToV4(Migration.v2ToV3(Migration.v1ToV2(state, now: now), now: now))
        case 2:
            return Migration.v3ToV4(Migration.v2ToV3(state, now: now))
        case 3:
            return Migration.v3ToV4(state)
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
