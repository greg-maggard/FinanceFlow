import SwiftUI
import FinanceFlowKit

public extension Theme {
    /// The first concrete aesthetic — a calm dark "glass" look mirroring the web.
    /// Swap this for another `Theme` in `RootView` to reskin the whole app.
    static let `default`: Theme = {
        let colors = ColorTokens(
            background: Color(hex: "07080F"),
            backgroundElevated: Color(hex: "0C0E16"),
            surface: Color.white.opacity(0.04),
            surfaceElevated: Color.white.opacity(0.07),
            stroke: Color.white.opacity(0.10),
            separator: Color.white.opacity(0.08),
            primary: Color(hex: "60A5FA"),
            accent: Color(hex: "A78BFA"),
            success: Color(hex: "34D399"),
            warning: Color(hex: "FBBF24"),
            danger: Color(hex: "F87171"),
            textPrimary: Color.white.opacity(0.95),
            textSecondary: Color.white.opacity(0.62),
            textTertiary: Color.white.opacity(0.40),
            onAccent: Color(hex: "07080F")
        )

        let typography = TypographyTokens(
            display: .system(size: 34, weight: .semibold, design: .rounded),
            title: .system(size: 24, weight: .semibold, design: .rounded),
            headline: .system(size: 18, weight: .semibold, design: .rounded),
            body: .system(size: 16, weight: .regular, design: .rounded),
            callout: .system(size: 14, weight: .medium, design: .rounded),
            caption: .system(size: 12, weight: .medium, design: .rounded),
            mono: .system(size: 14, weight: .medium, design: .monospaced),
            nodeLabel: .system(size: 13, weight: .semibold, design: .rounded),
            overline: .system(size: 10, weight: .semibold, design: .rounded)
        )

        let spacing = SpacingTokens(xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 36)
        let radii = RadiusTokens(sm: 8, md: 14, lg: 22, pill: 999)

        let materials = MaterialTokens(
            card: AnyShapeStyle(.ultraThinMaterial),
            overlay: AnyShapeStyle(.thinMaterial),
            sheet: AnyShapeStyle(Color(hex: "0C0E16"))
        )

        let motion = MotionTokens(
            standard: .spring(response: 0.42, dampingFraction: 0.82),
            emphasized: .spring(response: 0.55, dampingFraction: 0.78),
            spring: .interactiveSpring(response: 0.32, dampingFraction: 0.7),
            bar: .spring(response: 0.7, dampingFraction: 0.85),
            celebration: 1.7
        )

        return Theme(
            colors: colors,
            phasePalette: PhasePalettes.default,
            typography: typography,
            spacing: spacing,
            radii: radii,
            materials: materials,
            motion: motion,
            statusStyle: StatusStyles.default
        )
    }()

    /// A deliberately raw theme to prove no view bypasses the design system.
    /// Use in Settings' debug theme picker.
    static let brutalist: Theme = {
        var t = Theme.default
        t.colors = ColorTokens(
            background: .black,
            backgroundElevated: Color(white: 0.08),
            surface: Color(white: 0.12),
            surfaceElevated: Color(white: 0.18),
            stroke: .white,
            separator: Color(white: 0.3),
            primary: .white,
            accent: .yellow,
            success: .green,
            warning: .orange,
            danger: .red,
            textPrimary: .white,
            textSecondary: Color(white: 0.75),
            textTertiary: Color(white: 0.5),
            onAccent: .black
        )
        t.radii = RadiusTokens(sm: 0, md: 0, lg: 0, pill: 0)
        t.typography.nodeLabel = .system(size: 13, weight: .heavy, design: .monospaced)
        t.phasePalette = { _ in
            PhaseColor(base: .white, glow: Color.white.opacity(0.4), tint: Color.white.opacity(0.12), text: .white)
        }
        return t
    }()
}

enum PhasePalettes {
    /// Direct port of `PHASE_COLORS` in `src/theme/phaseColors.ts`.
    static func `default`(_ phase: Phase) -> PhaseColor {
        switch phase {
        case .foundations:
            return PhaseColor(base: Color(hex: "94A3B8"), glow: Color(hex: "94A3B8", opacity: 0.55), tint: Color(hex: "94A3B8", opacity: 0.18), text: Color(hex: "CBD5E1"))
        case .emergency:
            return PhaseColor(base: Color(hex: "F87171"), glow: Color(hex: "F87171", opacity: 0.55), tint: Color(hex: "F87171", opacity: 0.18), text: Color(hex: "FCA5A5"))
        case .match:
            return PhaseColor(base: Color(hex: "FBBF24"), glow: Color(hex: "FBBF24", opacity: 0.55), tint: Color(hex: "FBBF24", opacity: 0.18), text: Color(hex: "FCD34D"))
        case .debt:
            return PhaseColor(base: Color(hex: "34D399"), glow: Color(hex: "34D399", opacity: 0.55), tint: Color(hex: "34D399", opacity: 0.18), text: Color(hex: "6EE7B7"))
        case .ira:
            return PhaseColor(base: Color(hex: "60A5FA"), glow: Color(hex: "60A5FA", opacity: 0.55), tint: Color(hex: "60A5FA", opacity: 0.18), text: Color(hex: "93C5FD"))
        case .retirement:
            return PhaseColor(base: Color(hex: "3B82F6"), glow: Color(hex: "3B82F6", opacity: 0.55), tint: Color(hex: "3B82F6", opacity: 0.18), text: Color(hex: "BFDBFE"))
        case .advanced:
            return PhaseColor(base: Color(hex: "A78BFA"), glow: Color(hex: "A78BFA", opacity: 0.55), tint: Color(hex: "A78BFA", opacity: 0.18), text: Color(hex: "C4B5FD"))
        }
    }
}

enum StatusStyles {
    static func `default`(_ status: Status, _ phase: PhaseColor) -> NodeStyle {
        switch status {
        case .current:
            return NodeStyle(fill: phase.tint, stroke: phase.base, glow: phase.glow, text: phase.text, lineWidth: 2, opacity: 1, dashed: false)
        case .done:
            return NodeStyle(fill: phase.tint.opacity(0.6), stroke: phase.base.opacity(0.85), glow: phase.glow.opacity(0.5), text: phase.text, lineWidth: 1.5, opacity: 1, dashed: false)
        case .upcoming:
            return NodeStyle(fill: Color.white.opacity(0.04), stroke: Color.white.opacity(0.18), glow: .clear, text: Color.white.opacity(0.62), lineWidth: 1, opacity: 0.85, dashed: false)
        case .skipped:
            return NodeStyle(fill: Color.white.opacity(0.02), stroke: Color.white.opacity(0.12), glow: .clear, text: Color.white.opacity(0.35), lineWidth: 1, opacity: 0.4, dashed: true)
        }
    }
}
