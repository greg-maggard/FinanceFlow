import SwiftUI
import Foundation
import FinanceFlowKit

/// A subtle full-bleed gradient tinted by the active phase color.
struct AmbientBackground: View {
    @Environment(\.theme) private var theme
    let phase: Phase

    var body: some View {
        let c = theme.phaseColor(phase)
        ZStack {
            theme.colors.background
            RadialGradient(
                colors: [c.tint, .clear],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 520
            )
            RadialGradient(
                colors: [c.glow.opacity(0.18), .clear],
                center: .bottomLeading,
                startRadius: 10,
                endRadius: 460
            )
        }
        .animation(theme.motion.emphasized, value: phase)
    }
}

/// Themed glass surface used by cards and sheets.
struct GlassCard<Content: View>: View {
    @Environment(\.theme) private var theme
    var padding: CGFloat? = nil
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding ?? theme.spacing.lg)
            .background(theme.materials.card, in: RoundedRectangle(cornerRadius: theme.radii.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.radii.lg, style: .continuous)
                    .strokeBorder(theme.colors.stroke, lineWidth: 1)
            )
    }
}

struct GlassIconButton: View {
    @Environment(\.theme) private var theme
    let systemName: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.colors.textSecondary)
                .frame(width: 38, height: 38)
                .background(theme.colors.surface, in: Circle())
                .overlay(Circle().strokeBorder(theme.colors.stroke, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// A pill-style primary/secondary action button.
struct GlassButton: View {
    @Environment(\.theme) private var theme
    let title: String
    var systemImage: String? = nil
    var tint: Color? = nil
    var filled: Bool = false
    let action: () -> Void

    var body: some View {
        let accent = tint ?? theme.colors.primary
        Button(action: action) {
            HStack(spacing: theme.spacing.sm) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(theme.typography.callout)
            .foregroundStyle(filled ? theme.colors.onAccent : accent)
            .padding(.vertical, theme.spacing.md)
            .padding(.horizontal, theme.spacing.lg)
            .frame(maxWidth: .infinity)
            .background(
                (filled ? AnyShapeStyle(accent) : AnyShapeStyle(accent.opacity(0.14))),
                in: RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.radii.md, style: .continuous)
                    .strokeBorder(accent.opacity(filled ? 0 : 0.45), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

/// Circular progress indicator.
struct ProgressRing: View {
    @Environment(\.theme) private var theme
    let fraction: Double
    var color: Color
    var lineWidth: CGFloat = 3

    var body: some View {
        ZStack {
            Circle().stroke(theme.colors.stroke, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.001, min(1, fraction)))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(theme.motion.bar, value: fraction)
        }
    }
}

/// Horizontal goal bar with value/target labels.
struct GoalBar: View {
    @Environment(\.theme) private var theme
    /// What the two compact labels beneath the bar are counted in. The bar's
    /// fraction is unitless; only the labels care. `.money` reads `value`/`max`
    /// as integer cents, matching `Money`.
    enum Unit {
        case money
        case percent
        /// A plain tally (e.g. 3 of 7 steps done) — no unit suffix.
        case count

        /// The unit a `ProgressInfo.goal` carries. Mirrors the web's
        /// `GoalBar`'s `unit` prop.
        init(_ unit: ProgressUnit) {
            self = unit == .cents ? .money : .percent
        }
    }

    let value: Double
    let max: Double
    var color: Color
    var unit: Unit = .money

    private var fraction: Double { max <= 0 ? 0 : Swift.min(1, value / max) }

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.xs) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.colors.surface)
                    Capsule()
                        .fill(color)
                        .frame(width: geo.size.width * fraction)
                        .animation(theme.motion.bar, value: fraction)
                }
            }
            .frame(height: 8)

            HStack {
                Text(format(value))
                    .foregroundStyle(theme.colors.textPrimary)
                Spacer()
                Text(format(max))
                    .foregroundStyle(theme.colors.textSecondary)
            }
            .font(theme.typography.caption)
        }
    }

    private func format(_ v: Double) -> String {
        switch unit {
        case .money: return CurrencyFormat.string(Money(cents: Int(v.rounded())))
        case .percent: return NumberFormat.string(v) + "%"
        case .count: return NumberFormat.string(v)
        }
    }
}

/// A small status / phase chip.
struct Chip: View {
    @Environment(\.theme) private var theme
    let text: String
    var color: Color

    var body: some View {
        Text(text)
            .font(theme.typography.overline)
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(color)
            .padding(.horizontal, theme.spacing.sm)
            .padding(.vertical, theme.spacing.xs)
            .background(color.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.4), lineWidth: 1))
    }
}

enum CurrencyFormat {
    static func string(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.fractionLength(value.rounded() == value ? 0 : 2)))
    }

    /// Integer cents (how money is stored): whole dollars show no cents,
    /// fractional ones show two — matching the `Double` overload's behavior and
    /// the web's `dollars()` in `src/components/budget/bits.tsx`.
    static func string(_ value: Money) -> String {
        value.decimalDollars.formatted(
            .currency(code: "USD").precision(.fractionLength(value.isWholeDollars ? 0 : 2))
        )
    }
}

enum NumberFormat {
    static func string(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }

    static func string(_ value: Decimal) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }
}

