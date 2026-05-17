import SwiftUI
import UIKit

enum OpenReelTheme {
    static let background = dynamicColor(light: 0xFFFFFF, dark: 0x0D0D0D)
    static let surface = dynamicColor(light: 0xF5F5F5, dark: 0x1A1A1A)
    static let surfaceElevated = dynamicColor(light: 0xFFFFFF, dark: 0x262626)
    static let accent = dynamicColor(light: 0x16A34A, dark: 0x4ADE80)
    static let accentSecondary = dynamicColor(light: 0x059669, dark: 0x00E676)
    static let textPrimary = dynamicColor(light: 0x1A1A1A, dark: 0xFFFFFF)
    static let textSecondary = dynamicColor(light: 0x737373, dark: 0xA3A3A3)
    static let destructive = dynamicColor(light: 0xDC2626, dark: 0xEF4444)

    static func dynamicColor(light: Int, dark: Int) -> Color {
        Color(
            uiColor: UIColor { traitCollection in
                UIColor(hex: traitCollection.userInterfaceStyle == .dark ? dark : light)
            }
        )
    }
}

extension UIColor {
    convenience init(hex: Int) {
        let red = CGFloat((hex >> 16) & 0xFF) / 255
        let green = CGFloat((hex >> 8) & 0xFF) / 255
        let blue = CGFloat(hex & 0xFF) / 255
        self.init(red: red, green: green, blue: blue, alpha: 1)
    }
}

extension Font {
    static let reelDisplay = Font.system(size: 34, weight: .bold, design: .rounded)
    static let reelSection = Font.system(size: 16, weight: .semibold, design: .rounded)
    static let reelBody = Font.system(size: 15, weight: .medium, design: .rounded)
    static let reelCaption = Font.system(size: 12, weight: .medium, design: .rounded)
    static let reelMono = Font.system(size: 13, weight: .medium, design: .monospaced)
}

extension AppState.ProjectStyle {
    var colors: [Color] {
        switch self {
        case .emerald:
            return [Color(red: 0.08, green: 0.32, blue: 0.20), Color(red: 0.14, green: 0.79, blue: 0.47)]
        case .cobalt:
            return [Color(red: 0.11, green: 0.18, blue: 0.37), Color(red: 0.27, green: 0.49, blue: 0.98)]
        case .amber:
            return [Color(red: 0.32, green: 0.21, blue: 0.09), Color(red: 0.98, green: 0.73, blue: 0.20)]
        case .coral:
            return [Color(red: 0.40, green: 0.14, blue: 0.17), Color(red: 0.97, green: 0.43, blue: 0.39)]
        }
    }

    var gradient: LinearGradient {
        LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}