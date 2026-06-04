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
                    NumberField(value: store.state.settings.monthlyExpenses ?? 0) { v in
                        store.updateSettings { $0.monthlyExpenses = v > 0 ? v : nil }
                    }
                }
                LabeledField(label: "Pre-tax income (annual)") {
                    NumberField(value: store.state.settings.preTaxIncome ?? 0) { v in
                        store.updateSettings { $0.preTaxIncome = v > 0 ? v : nil }
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
