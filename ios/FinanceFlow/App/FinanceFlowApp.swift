import SwiftUI
import FinanceFlowKit

@main
struct FinanceFlowApp: App {
    @State private var store = AppStore(storage: FileStorageAdapter())
    @State private var celebration = CelebrationCenter()
    @Environment(\.scenePhase) private var scenePhase

    /// The active aesthetic, persisted and swappable from Settings. Swapping this
    /// reskins the entire app — every view reads tokens from `\.theme`.
    @AppStorage("themeID") private var themeID: String = ThemeID.standard.rawValue

    private var theme: Theme {
        (ThemeID(rawValue: themeID) ?? .standard).theme
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(celebration)
                .theme(theme)
                .task { await store.bootstrap() }
                .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                Task { await store.flush() }
            }
        }
    }
}
