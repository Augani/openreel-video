import SwiftUI

struct ProjectArtworkView: View {
    @Environment(AppState.self) private var appState

    let project: OpenReelProject
    var cornerRadius: CGFloat = 18

    var body: some View {
        GeometryReader { geo in
            ZStack {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(appState.style(for: project).gradient)

                if let clip = appState.primaryVisualClip(in: project),
                   let mediaItem = appState.mediaItem(for: clip.mediaId, in: project),
                   let url = appState.thumbnailURL(for: mediaItem.thumbnailUrl, in: project) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFill()
                                .frame(width: geo.size.width, height: geo.size.height)
                                .clipped()
                        case .empty, .failure:
                            appState.style(for: project).gradient
                        @unknown default:
                            appState.style(for: project).gradient
                        }
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

#Preview {
    ProjectArtworkView(project: OpenReelProject.blank(configuration: NewProjectConfiguration(name: "Preview")))
        .environment(AppState())
}