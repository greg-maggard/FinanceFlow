# FinanceFlow — iOS (SwiftUI)

A native SwiftUI port of the FinanceFlow web app: an interactive tracker for the
r/PersonalFinance "prime directive" flowchart. Full feature parity with the web
MVP — the 32-node interactive graph, per-node tracking, decisions, monthly
check-ins, and JSON export/import — with all data stored **on-device**.

## Requirements

- Xcode 16+ (iOS 17 SDK)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`

## Generate & run

```bash
cd ios
xcodegen generate          # writes FinanceFlow.xcodeproj from project.yml
open FinanceFlow.xcodeproj  # build & run on an iOS 17 simulator (e.g. iPhone 15)
```

`FinanceFlow.xcodeproj` is generated and git-ignored — never edit it by hand.
Change `project.yml` and re-run `xcodegen generate` instead.

## Run the domain tests

The graph traversal, progress, persistence, and store logic live in a pure Swift
package (`FinanceFlowKit`) with no UIKit/SwiftUI dependency, so they run from the
command line:

```bash
cd ios/FinanceFlowKit
swift test
```

`DeriveTests` is a direct port of the web's `src/graph/derive.test.ts` and is the
load-bearing contract: the iOS graph must route identically to the web app.

## Architecture

```
ios/
  project.yml                 # XcodeGen spec (single app target + local package)
  FinanceFlowKit/             # pure domain layer (Swift package, fully testable)
    Sources/FinanceFlowKit/
      Models/                 # AppState, NodeData, NodeId… (port of schema.ts)
      Graph/                  # Flowchart, Derive, Path (port of flowchart.ts / derive.ts)
      Domain/                 # Progress, Recurring streaks, Identity/medals
      State/AppStore.swift    # @Observable store + debounced autosave
      Persistence/            # StorageAdapter, FileStorageAdapter, JSONCoder, IO/migrate
      Integrations/           # BalanceProvider seam (+ ManualProvider)
    Tests/FinanceFlowKitTests/
  FinanceFlow/                # SwiftUI app target
    App/                      # entry point, RootView, CelebrationCenter
    Theme/                    # the swappable design system (see below)
    Components/               # themed fields, editors, glass kit
    Screens/                  # Graph, Trail, NodeDetail (+ Forms), Overview, Settings, Celebration
```

### The design system is the swappable layer

Every color, font, size, radius, material, and animation is a token on a single
`Theme` value injected through `@Environment(\.theme)`. **No view hardcodes an
aesthetic value** — they only read `theme.*`. To reskin the app, add a new `Theme`
in `Theme/Themes/` and select it (Settings → Appearance, or change the default in
`FinanceFlowApp`). `Theme.brutalist` exists as a deliberately raw theme to prove
nothing bypasses the system.

### Data compatibility

The on-device document and JSON export use the **same shape as the web app**
(`schema.ts`), so backups are portable. `FinanceFlowKit/Models/AppState.swift`
implements a custom `Codable` to keep `decisions` / `nodes` / `categoryMap` as
keyed JSON objects and to decode each node's payload by its id.

### The graph board zoom is UIKit-backed

The app is otherwise pure SwiftUI, but `Screens/Graph/GraphScreen` hosts the
32-node canvas inside a `UIScrollView` (`ZoomableScrollView`). SwiftUI's
`ScrollView` + `scaleEffect` can only scale from a *fixed* anchor, so a pinch
always jumped to that corner; `UIScrollView` gives native focal-point pinch
zoom and pan-while-zoomed for free. Node taps are resolved by a tap recognizer
that hit-tests `GraphLayout.node(at:)` rather than per-node `Button`s — a
`Button`'s gesture recognizer would claim a finger that lands on a card and
starve the scroll view's two-finger pinch. `NodeCard` is therefore purely
visual; nodes keep an `accessibilityAction` so VoiceOver can still open them.

## Deferred to v2 (seams already in place)

- **YNAB / Plaid** — `BalanceProvider` protocol ships; only `ManualProvider` is wired.
- **iCloud sync** — `StorageAdapter` lets a `CloudKitStorageAdapter` drop in later.
- Accounts, Widgets, Live Activities, Shortcuts, notifications, snapshot tests.
