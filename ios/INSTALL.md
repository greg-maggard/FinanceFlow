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
- ✅ FinanceFlowKit domain tests maintain parity with web ledger math (117+ tests)
- ⛔ No daily-use installation (web PWA is the book of record)
- ⛔ No sync between iOS and web (Wave 3 decision)
- ⛔ No iOS-only UI enhancements

The Wave 3 platform decision will determine whether iOS becomes a full co-equal citizen (with sync, conflict resolution, and UI parity) or remains a read-only reference implementation.

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
