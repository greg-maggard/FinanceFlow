import SwiftUI
import FinanceFlowKit

/// Uppercase field caption used above inputs.
struct FieldLabel: View {
    @Environment(\.theme) private var theme
    let text: String
    var body: some View {
        Text(text)
            .font(theme.typography.overline)
            .textCase(.uppercase)
            .tracking(1.2)
            .foregroundStyle(theme.colors.textSecondary)
    }
}

/// Wraps any input with a label above it.
struct LabeledField<Content: View>: View {
    @Environment(\.theme) private var theme
    let label: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.xs) {
            FieldLabel(text: label)
            content
        }
    }
}

private struct FieldChrome: ViewModifier {
    @Environment(\.theme) private var theme
    func body(content: Content) -> some View {
        content
            .font(theme.typography.body)
            .foregroundStyle(theme.colors.textPrimary)
            .padding(.horizontal, theme.spacing.md)
            .padding(.vertical, theme.spacing.sm + 2)
            .background(theme.colors.surface, in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous).strokeBorder(theme.colors.stroke, lineWidth: 1))
    }
}

/// Format a numeric value for display in a field ("" for zero, so the prompt shows).
private func numericFieldDisplay(_ v: Double) -> String { v == 0 ? "" : NumberFormat.string(v) }

/// Parse numeric-field input. Collapses to a single decimal point ("1.2.3" → "1.2")
/// and returns `nil` for non-empty-but-unparseable input, so the caller can keep the
/// previous value rather than silently zeroing the field.
private func parseNumericField(_ s: String) -> Double? {
    let filtered = s.filter { $0.isNumber || $0 == "." }
    if filtered.isEmpty { return 0 }                                  // cleared field → 0
    let parts = filtered.split(separator: ".", omittingEmptySubsequences: false)
    let normalized = parts.count <= 1 ? filtered : String(parts[0]) + "." + String(parts[1])
    if normalized == "." { return 0 }
    return Double(normalized)
}

/// Currency entry. Mirrors the web's `NumberField`; shows a leading `$`.
struct NumberField: View {
    @Environment(\.theme) private var theme
    let value: Double
    let onChange: (Double) -> Void
    var prompt: String = "0"

    @State private var text: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: theme.spacing.xs) {
            Text("$").foregroundStyle(theme.colors.textTertiary)
            TextField(prompt, text: $text)
                .keyboardType(.decimalPad)
                .focused($focused)
                .foregroundStyle(theme.colors.textPrimary)
                .onChange(of: text) { _, new in
                    guard let parsed = parseNumericField(new) else { return }   // unparseable → keep prior value
                    if parsed != value { onChange(parsed) }
                }
        }
        .font(theme.typography.body)
        .padding(.horizontal, theme.spacing.md)
        .padding(.vertical, theme.spacing.sm + 2)
        .background(theme.colors.surface, in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous).strokeBorder(theme.colors.stroke, lineWidth: 1))
        .onAppear { text = numericFieldDisplay(value) }
        .onChange(of: value) { _, newValue in
            // Reflect external changes (e.g. a recomputed limit) without fighting
            // the user while they're actively editing.
            if !focused { text = numericFieldDisplay(newValue) }
        }
    }
}

/// Percentage entry (0–100), trailing `%`.
struct PercentField: View {
    @Environment(\.theme) private var theme
    let value: Double
    let onChange: (Double) -> Void

    @State private var text: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: theme.spacing.xs) {
            TextField("0", text: $text)
                .keyboardType(.decimalPad)
                .focused($focused)
                .foregroundStyle(theme.colors.textPrimary)
                .onChange(of: text) { _, new in
                    guard let parsed = parse(new) else { return }   // unparseable → keep prior value
                    if parsed != value { onChange(parsed) }
                }
            Text("%").foregroundStyle(theme.colors.textTertiary)
        }
        .font(theme.typography.body)
        .padding(.horizontal, theme.spacing.md)
        .padding(.vertical, theme.spacing.sm + 2)
        .background(theme.colors.surface, in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous).strokeBorder(theme.colors.stroke, lineWidth: 1))
        .onAppear { text = numericFieldDisplay(value) }
        .onChange(of: value) { _, newValue in
            if !focused { text = numericFieldDisplay(newValue) }
        }
    }

    /// Clamp to 0–100; nil (keep prior value) for unparseable input.
    private func parse(_ s: String) -> Double? {
        guard let v = parseNumericField(s) else { return nil }
        return min(100, v)
    }
}

/// Plain text entry, themed.
struct PlainTextField: View {
    @Environment(\.theme) private var theme
    let placeholder: String
    @Binding var text: String

    var body: some View {
        TextField(placeholder, text: $text)
            .modifier(FieldChrome())
    }
}

/// Optional `"YYYY-MM"` date entry via a DatePicker, stored as a string.
struct MonthYearField: View {
    @Environment(\.theme) private var theme
    let label: String
    let value: String?
    let onChange: (String?) -> Void

    private var selection: Date {
        guard let value, let d = Self.formatter.date(from: value) else { return Date() }
        return d
    }

    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    var body: some View {
        HStack {
            FieldLabel(text: label)
            Spacer()
            DatePicker(
                "",
                selection: Binding(
                    get: { selection },
                    set: { onChange(Self.formatter.string(from: $0)) }
                ),
                displayedComponents: .date
            )
            .labelsHidden()
            .tint(theme.colors.primary)
        }
    }
}
