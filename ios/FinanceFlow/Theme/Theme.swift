import SwiftUI
import FinanceFlowKit

// MARK: - Token types
//
// The entire visual identity is expressed as tokens on a single `Theme` value.
// No view should hardcode a color, font, size, radius, duration, or material —
// only reference `theme.*`. Swapping the aesthetic is then one line in RootView.

public struct ColorTokens {
    public var background: Color
    public var backgroundElevated: Color
    public var surface: Color
    public var surfaceElevated: Color
    public var stroke: Color
    public var separator: Color
    public var primary: Color
    public var accent: Color
    public var success: Color
    public var warning: Color
    public var danger: Color
    public var textPrimary: Color
    public var textSecondary: Color
    public var textTertiary: Color
    public var onAccent: Color
}

public struct PhaseColor {
    public var base: Color
    public var glow: Color
    public var tint: Color
    public var text: Color
}

public struct TypographyTokens {
    public var display: Font
    public var title: Font
    public var headline: Font
    public var body: Font
    public var callout: Font
    public var caption: Font
    public var mono: Font
    public var nodeLabel: Font
    public var overline: Font
}

public struct SpacingTokens {
    public var xs: CGFloat
    public var sm: CGFloat
    public var md: CGFloat
    public var lg: CGFloat
    public var xl: CGFloat
    public var xxl: CGFloat
}

public struct RadiusTokens {
    public var sm: CGFloat
    public var md: CGFloat
    public var lg: CGFloat
    public var pill: CGFloat
}

public struct MaterialTokens {
    /// Background style for cards/sheets. A `Material` for glass, or a flat color.
    public var card: AnyShapeStyle
    public var overlay: AnyShapeStyle
    public var sheet: AnyShapeStyle
}

public struct MotionTokens {
    public var standard: Animation
    public var emphasized: Animation
    public var spring: Animation
    public var bar: Animation
    /// Duration the per-node completion bloom plays for.
    public var celebration: Double
}

/// Resolved styling for a node at a given traversal status.
public struct NodeStyle {
    public var fill: Color
    public var stroke: Color
    public var glow: Color
    public var text: Color
    public var lineWidth: CGFloat
    public var opacity: Double
    public var dashed: Bool
}

// MARK: - Theme

public struct Theme {
    public var colors: ColorTokens
    public var phasePalette: (Phase) -> PhaseColor
    public var typography: TypographyTokens
    public var spacing: SpacingTokens
    public var radii: RadiusTokens
    public var materials: MaterialTokens
    public var motion: MotionTokens
    public var statusStyle: (Status, PhaseColor) -> NodeStyle

    public init(
        colors: ColorTokens,
        phasePalette: @escaping (Phase) -> PhaseColor,
        typography: TypographyTokens,
        spacing: SpacingTokens,
        radii: RadiusTokens,
        materials: MaterialTokens,
        motion: MotionTokens,
        statusStyle: @escaping (Status, PhaseColor) -> NodeStyle
    ) {
        self.colors = colors
        self.phasePalette = phasePalette
        self.typography = typography
        self.spacing = spacing
        self.radii = radii
        self.materials = materials
        self.motion = motion
        self.statusStyle = statusStyle
    }

    public func phaseColor(_ phase: Phase) -> PhaseColor { phasePalette(phase) }
    public func style(for status: Status, phase: Phase) -> NodeStyle {
        statusStyle(status, phasePalette(phase))
    }
}

// MARK: - Environment

private struct ThemeKey: EnvironmentKey {
    static let defaultValue: Theme = .default
}

public extension EnvironmentValues {
    var theme: Theme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

public extension View {
    func theme(_ theme: Theme) -> some View {
        environment(\.theme, theme)
    }
}

// MARK: - Color hex helper

public extension Color {
    /// `Color(hex: "#34d399")` or `Color(hex: "34d399")`. Supports optional alpha.
    init(hex: String, opacity: Double = 1) {
        let raw = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: raw).scanHexInt64(&value)
        let r, g, b: Double
        if raw.count == 6 {
            r = Double((value & 0xFF0000) >> 16) / 255
            g = Double((value & 0x00FF00) >> 8) / 255
            b = Double(value & 0x0000FF) / 255
        } else {
            r = 0; g = 0; b = 0
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
