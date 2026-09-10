# FinanceFlow iOS Installation

## For Wave 1 Daily Driver Experiment

**⚠️ IMPORTANT: FinanceFlow on iOS is NOT the book of record. The web PWA is your single source of truth. Do not install this as a second daily ledger — there is no sync and no drift detection, so two live installs mean two silently diverging budgets.**

## Installation Steps

### Prerequisites
- Xcode 15+ installed
- An Apple Developer account (free Apple ID is sufficient for development/simulator)

### Steps

1. **Open the Xcode project:**
   ```
   cd ios
   open FinanceFlow.xcodeproj
   ```

2. **Sign in with your Apple ID:**
   - Go to `Xcode > Settings > Accounts` (or `Xcode > Preferences > Accounts` on older versions)
   - Click the `+` button to add an account
   - Sign in with your Apple ID
   - Xcode will automatically create and manage a free personal team for code signing

3. **Select the iPhone Simulator:**
   - In the Xcode window, select the simulator destination (e.g., `iPhone 17` or your preferred device)
   - Or manually in the simulator app: `Xcode > Open Developer Tool > Simulator`, then select a device

4. **Build and run:**
   - Press `Cmd + R` or click the Run button
   - Xcode will build, sign, and launch the app in the simulator

## Free Provisioning Constraint (⚠️ Critical)

FinanceFlow uses **free automatic code signing** with a personal Apple team. This is sufficient for simulator development and free device installation, but has a critical limitation:

- **Free personal teams re-sign provisioning profiles approximately every 7 days**
- If you install the app on a physical iPhone using the free team, the app **will stop launching after ~7 days** unless you rebuild and reinstall it
- **Solution:** Either:
  - Rebuild and reinstall weekly (tethered to this Mac), or
  - Enroll in Apple Developer Program ($99/year) to get permanent provisioning

If you plan to keep the app on a device longer than 7 days without regular rebuilds, a paid $99/year Apple Developer enrollment is required.

## Data & Backups

### Local Storage
FinanceFlow stores its ledger data in the app's Documents directory (on iOS) and app-local storage (in the PWA):

- **iOS:** The Documents directory contents are **included in standard iCloud/Finder device backups** by default (no `isExcludedFromBackup` flag is set)
- **Web PWA:** Stored in browser local storage and IndexedDB, backed up by browser sync if enabled

### Before Installing on Device
**Verify that your iPhone has iCloud backups enabled:**
- Go to `Settings > [Your Name] > iCloud > iCloud Backup`
- Toggle "iCloud Backup" to ON
- Run a manual backup if desired by tapping "Back Up Now"

This ensures your budget data survives accidental deletion or device loss (assuming iCloud has capacity).

## Scope of iOS Support

iOS is currently in Wave 1 of the FinanceFlow roadmap:
- ✅ Simulator builds and runs clean
- ✅ FinanceFlowKit domain tests maintain parity with web ledger math (184 tests as of the Wave 3 decision below)
- ⛔ No daily-use installation (web PWA is the book of record)
- ⛔ No sync between iOS and web (Wave 3 decision — see below)
- ⛔ No iOS-only UI enhancements

### Wave 3 platform decision (recorded 2026-08-06): NOT YET — stay on web

**Decision: iOS does NOT become the daily driver at this time. Web PWA remains the sole book of record. iOS stays a read-only-in-practice parity guard.**

The w3-ios-decision spec is explicit that this call is only to be made "after Greg has used the web PWA daily for two to three weeks" of real elapsed time, because running both platforms without sync means two silently diverging budgets and this app has no drift detection. Checking the actual commit history at decision time: the entire Wave 2 web-ergonomics set (FAB add-transaction, edit-in-place, fund-this-month, today-strip, persist-view) and the entire Wave 3 set to date (backup-key, schema v4, Plaid snapshot import, search/undo) landed in one continuous session on the morning of 2026-08-06 — commits minutes apart, not days apart. Zero calendar days of Greg actually living in the web PWA have elapsed since those ergonomics existed to live in. The precondition for an affirmative decision is factually unmet, regardless of how good the iOS build otherwise is, so the answer is no by default rather than yes by inference.

This is not a quality verdict against iOS. Everything in the "yes" case for the spec still checks out as of this date and remains true for whenever this is revisited:
- Builds clean, signing pre-wired to a free personal team (`ios/project.yml:45`, team `GJ3G9V9Q8Z`).
- Persistence is genuinely ahead of web's: atomic writes to a single `state.json` (`FileStorageAdapter.swift`), 500ms debounced autosave serialized behind any in-flight save (`AppStore.swift`), flush on `scenePhase` background (`FinanceFlowApp.swift`), corrupt-file quarantine instead of clobbering (`AppStore.swift`), and Documents-directory inclusion in standard iCloud/Finder device backups.
- The one disqualifier is unchanged: free provisioning means an installed device build stops launching roughly weekly until rebuilt from a tethered Mac. That's a $99/yr Apple Developer enrollment away from being fixed, whenever it's worth fixing.

**Re-decide when:** Greg has put real, spaced-out daily use on the web PWA — actual calendar days, not commits in the same sitting — for two to three weeks. At that point, re-run this same item: if the web ergonomics (FAB add, edit-in-place, fund-this-month, today-strip) have held up as the daily flow, do the one-time migration + paid-enrollment + ergonomics-port sequence from the item spec. Until then, do not install this on a phone as a second live ledger.

FinanceFlowKit tests stay green throughout as the parity guard this decision keeps them for: `cd ios/FinanceFlowKit && swift test`.

## Troubleshooting

### "Unable to boot simulator" or app crashes on launch
- Restart the simulator: `xcrun simctl erase all`
- Rebuild: `Cmd + Shift + K`, then `Cmd + B`

### "Code signing failed"
- Verify you're signed in to Xcode: `Xcode > Settings > Accounts`
- Verify the bundle ID is correct: `com.gregmaggard.financeflow`
- Check that your Apple ID account exists and is trusted on this Mac

### "App stops launching after 7 days"
- This is expected with free provisioning. See "Free Provisioning Constraint" above.
- Rebuild and reinstall: `Cmd + R` in Xcode

## Additional Resources

- iOS app source: `ios/FinanceFlow/` (SwiftUI UI)
- Shared domain logic: `ios/FinanceFlowKit/` (Swift Package, mirrors web budget semantics)
- Run tests: `cd ios/FinanceFlowKit && swift test`
- Regenerate Xcode project from config: `cd ios && xcodegen generate`
