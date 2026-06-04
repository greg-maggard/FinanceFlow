import SwiftUI

/// Named, persistable aesthetic choices. Add a case here when you add a `Theme`.
enum ThemeID: String, CaseIterable, Identifiable {
    case standard
    case brutalist

    var id: String { rawValue }
    var label: String {
        switch self {
        case .standard: return "Standard"
        case .brutalist: return "Brutalist (debug)"
        }
    }

    var theme: Theme {
        switch self {
        case .standard: return .default
        case .brutalist: return .brutalist
        }
    }
}
