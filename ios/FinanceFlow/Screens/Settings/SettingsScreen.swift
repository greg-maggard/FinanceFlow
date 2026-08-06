import SwiftUI
import CoreTransferable
import UniformTypeIdentifiers
import FinanceFlowKit

/// Settings: target inputs, JSON export/import for backup, theme switch, reset.
struct SettingsScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @AppStorage("themeID") private var themeID: String = ThemeID.standard.rawValue

    @State private var showImporter = false
    @State private var showResetConfirm = false
    @State private var importMessage: String?
    @State private var importFailed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: theme.spacing.xl) {
                    settingsCard
                    integrityCard
                    backupCard
                    appearanceCard
                    dangerCard
                }
                .padding(theme.spacing.lg)
            }
            .background(theme.materials.sheet)
            .scrollContentBackground(.hidden)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(theme.colors.primary)
                }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
                handleImport(result)
            }
            .alert("Reset everything?", isPresented: $showResetConfirm) {
                Button("Reset", role: .destructive) { store.reset() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This clears all progress and data on this device. Export a backup first if you want to keep it.")
            }
        }
    }

    private var settingsCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.md) {
                Text("Your numbers").font(theme.typography.headline).foregroundStyle(theme.colors.textPrimary)
                LabeledField(label: "Monthly expenses") {
                    NumberField(value: store.state.settings.monthlyExpenses ?? .zero) { v in
                        store.updateSettings { $0.monthlyExpenses = v > .zero ? v : nil }
                    }
                }
                LabeledField(label: "Pre-tax income (annual)") {
                    NumberField(value: store.state.settings.preTaxIncome ?? .zero) { v in
                        store.updateSettings { $0.preTaxIncome = v > .zero ? v : nil }
                    }
                }
                HStack(spacing: theme.spacing.md) {
                    LabeledField(label: "IRA limit") {
                        NumberField(value: store.state.settings.iraAnnualLimit) { v in
                            store.updateSettings { $0.iraAnnualLimit = v }
                        }
                    }
                    LabeledField(label: "HSA self") {
                        NumberField(value: store.state.settings.hsaSelfLimit) { v in
                            store.updateSettings { $0.hsaSelfLimit = v }
                        }
                    }
                    LabeledField(label: "HSA family") {
                        NumberField(value: store.state.settings.hsaFamilyLimit) { v in
                            store.updateSettings { $0.hsaFamilyLimit = v }
                        }
                    }
                }
            }
        }
    }

    /// Conservation-of-money read-out. Every dollar in an on-budget account
    /// must be sitting in an envelope, waiting in Ready-to-Assign, or spent
    /// outside the budget — a non-zero drift means the book invented or lost
    /// money. Mirrors the web Settings row.
    private var integrityCard: some View {
        let integrity = Ledger.bookIntegrity(store.state.budget, month: Recurring.ymKey())
        let ok = integrity.drift == .zero
        return GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.md) {
                Text("Check integrity").font(theme.typography.headline).foregroundStyle(theme.colors.textPrimary)
                integrityRow("On-budget cash", integrity.onBudgetCash)
                integrityRow("Sum of available", integrity.sumAvailable)
                integrityRow("Ready to assign", integrity.readyToAssign)
                integrityRow("Unbudgeted spending", integrity.unbudgetedSpending)
                integrityRow(ok ? "Balanced" : "Drift", integrity.drift,
                             tint: ok ? theme.colors.success : theme.colors.danger)
                Text(ok
                     ? "Every dollar is accounted for."
                     : "The books don't balance — this is a bug, not your data.")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
            }
        }
    }

    private func integrityRow(_ label: String, _ value: Money, tint: Color? = nil) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value.decimalDollars, format: .currency(code: "USD")).monospacedDigit()
        }
        .font(theme.typography.callout)
        .foregroundStyle(tint ?? theme.colors.textSecondary)
    }

    private var backupCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.md) {
                Text("Backup").font(theme.typography.headline).foregroundStyle(theme.colors.textPrimary)
                Text("Your data lives only on this device. Export a JSON backup, or import one to restore.")
                    .font(theme.typography.caption)
                    .foregroundStyle(theme.colors.textSecondary)
                HStack(spacing: theme.spacing.md) {
                    if let backup = try? BackupFile(state: store.state) {
                        ShareLink(item: backup, preview: SharePreview("FinanceFlow backup")) {
                            Label("Export", systemImage: "square.and.arrow.up")
                                .font(theme.typography.callout)
                                .foregroundStyle(theme.colors.primary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, theme.spacing.md)
                                .background(theme.colors.primary.opacity(0.14), in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous).strokeBorder(theme.colors.primary.opacity(0.45), lineWidth: 1))
                        }
                    }
                    GlassButton(title: "Import", systemImage: "square.and.arrow.down") { showImporter = true }
                }
                if let importMessage {
                    Text(importMessage)
                        .font(theme.typography.caption)
                        .foregroundStyle(importFailed ? theme.colors.danger : theme.colors.success)
                }
            }
        }
    }

    private var appearanceCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: theme.spacing.md) {
                Text("Appearance").font(theme.typography.headline).foregroundStyle(theme.colors.textPrimary)
                Picker("Theme", selection: $themeID) {
                    ForEach(ThemeID.allCases) { Text($0.label).tag($0.rawValue) }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private var dangerCard: some View {
        GlassButton(title: "Reset all data", systemImage: "trash", tint: theme.colors.danger) {
            showResetConfirm = true
        }
    }

    private func handleImport(_ result: Result<URL, Error>) {
        guard case let .success(url) = result else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            let imported = try IO.importJSON(data)
            store.replaceState(imported)
            importFailed = false
            importMessage = "Imported \(store.progress.done)/\(store.progress.total) steps complete."
        } catch {
            importFailed = true
            importMessage = "Couldn't read that backup — it may be corrupt or from a newer version."
        }
    }
}

/// Transferable JSON backup used by `ShareLink`. Avoids writing a temp file.
struct BackupFile: Transferable {
    let data: Data

    init(state: AppState) throws {
        self.data = try IO.exportJSON(state)
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .json) { $0.data }
            .suggestedFileName(IO.exportFileName())
    }
}
