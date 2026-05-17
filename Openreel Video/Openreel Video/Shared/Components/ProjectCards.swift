import Foundation
import SwiftUI

struct ProjectShowcaseCard: View {
    @Environment(AppState.self) private var appState
    let project: OpenReelProject
    var width: CGFloat = 280

    private var summary: ProjectCardSummary {
        ProjectCardSummary(project: project)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProjectArtworkView(project: project, cornerRadius: 0)
                .frame(width: width, height: 148)
                .clipped()
                .overlay(alignment: .bottomLeading) {
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.6)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 60)
                }
                .overlay(alignment: .bottomLeading) {
                    ProjectDurationPill(text: summary.duration)
                        .padding(12)
                }
                .overlay(alignment: .topTrailing) {
                    ProjectOptionsButton(inverse: true)
                        .padding(10)
                }

            VStack(alignment: .leading, spacing: 8) {
                Text(project.name)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                    .lineLimit(1)

                HStack(spacing: 12) {
                    ProjectMetaItem(symbol: "film.stack", text: summary.clipCount)
                    ProjectMetaItem(symbol: "rectangle", text: summary.resolution)
                    Spacer(minLength: 0)
                    Text(summary.workedRelative)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(OpenReelTheme.textSecondary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .frame(width: width, alignment: .leading)
        .background(OpenReelTheme.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
        }
    }
}

struct ProjectBrowserRowCard: View {
    @Environment(AppState.self) private var appState
    let project: OpenReelProject

    private var summary: ProjectCardSummary {
        ProjectCardSummary(project: project)
    }

    var body: some View {
        HStack(spacing: 14) {
            ProjectArtworkView(project: project, cornerRadius: 12)
                .frame(width: 96, height: 68)
                .overlay(alignment: .bottomTrailing) {
                    ProjectDurationPill(text: summary.duration)
                        .padding(6)
                }

            VStack(alignment: .leading, spacing: 6) {
                Text(project.name)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                    .lineLimit(1)

                HStack(spacing: 10) {
                    ProjectMetaItem(symbol: "film.stack", text: summary.clipCount)
                    ProjectMetaItem(symbol: "rectangle", text: summary.resolution)
                }

                Text(summary.workedRelative)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textSecondary)
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(OpenReelTheme.textSecondary.opacity(0.5))
        }
        .padding(12)
        .background(OpenReelTheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
        }
    }
}

struct ProjectBrowserGridCard: View {
    @Environment(AppState.self) private var appState
    let project: OpenReelProject

    private var summary: ProjectCardSummary {
        ProjectCardSummary(project: project)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProjectArtworkView(project: project, cornerRadius: 0)
                .frame(maxWidth: .infinity)
                .aspectRatio(16.0 / 10.0, contentMode: .fit)
                .clipped()
                .overlay(alignment: .bottomLeading) {
                    ProjectDurationPill(text: summary.duration)
                        .padding(8)
                }

            VStack(alignment: .leading, spacing: 6) {
                Text(project.name)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    ProjectMetaItem(symbol: "film.stack", text: summary.clipCount)
                    Spacer(minLength: 0)
                    Text(summary.workedRelative)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(OpenReelTheme.textSecondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 10)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OpenReelTheme.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
        }
    }
}

private struct ProjectCardSummary {
    let project: OpenReelProject

    var modifiedDate: Date {
        Date(timeIntervalSince1970: TimeInterval(project.modifiedAt) / 1000)
    }

    var workedRelative: String {
        ProjectDateFormatter.relative.localizedString(for: modifiedDate, relativeTo: .now)
    }

    var workedExact: String {
        modifiedDate.formatted(date: .abbreviated, time: .shortened)
    }

    var resolution: String {
        "\(project.settings.width)x\(project.settings.height)"
    }

    var duration: String {
        TimeInterval(project.timeline.duration).shortClock()
    }

    var clipCount: String {
        let count = project.allClips.count
        return count == 1 ? "1 clip" : "\(count) clips"
    }

    var stateLabel: String {
        project.allClips.isEmpty ? "Draft" : "Ready"
    }
}

private enum ProjectDateFormatter {
    static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.dateTimeStyle = .named
        return formatter
    }()
}

private struct ProjectOptionsButton: View {
    var inverse: Bool = false

    var body: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(inverse ? Color.white : OpenReelTheme.textPrimary)
            .frame(width: 28, height: 28)
            .background(inverse ? Color.black.opacity(0.4) : OpenReelTheme.surface, in: Circle())
    }
}

private struct ProjectDurationPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(Color.black.opacity(0.6), in: Capsule())
    }
}

private struct ProjectMetaItem: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .semibold))
            Text(text)
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .medium, design: .rounded))
        .foregroundStyle(OpenReelTheme.textSecondary)
    }
}
