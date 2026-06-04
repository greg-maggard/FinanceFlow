import Foundation

/// Centralized JSON encoder/decoder so every read/write uses the same date
/// format and key ordering. Dates round-trip as ISO-8601 with fractional
/// seconds to match the web's `new Date().toISOString()`.
public enum JSONCoder {
    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(isoWithFraction.string(from: date))
        }
        return e
    }()

    public static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let raw = try c.decode(String.self)
            if let date = isoWithFraction.date(from: raw) ?? isoPlain.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: c, debugDescription: "Invalid ISO-8601 date: \(raw)"
            )
        }
        return d
    }()

    public static func encode(_ state: AppState) throws -> Data {
        try encoder.encode(state)
    }

    public static func decode(_ data: Data) throws -> AppState {
        try decoder.decode(AppState.self, from: data)
    }
}
