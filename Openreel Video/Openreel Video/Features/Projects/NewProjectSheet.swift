import SwiftUI

struct NewProjectSheet: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("New Project")
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(OpenReelTheme.textPrimary)
                        Text("Pick a canvas and frame rate for your first edit.")
                            .font(.reelBody)
                            .foregroundStyle(OpenReelTheme.textSecondary)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Project Name")
                            .font(.reelSection)
                            .foregroundStyle(OpenReelTheme.textPrimary)

                        TextField("Project Name", text: $appState.newProjectConfiguration.name)
                            .textInputAutocapitalization(.words)
                            .padding(.horizontal, 16)
                            .frame(height: 52)
                            .background(OpenReelTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Resolution")
                            .font(.reelSection)
                            .foregroundStyle(OpenReelTheme.textPrimary)

                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            ForEach(NewProjectConfiguration.presets) { preset in
                                Button {
                                    appState.newProjectConfiguration.preset = preset
                                } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(preset.name)
                                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                                        Text("\(preset.width) × \(preset.height)")
                                            .font(.reelCaption)
                                    }
                                    .foregroundStyle(appState.newProjectConfiguration.preset == preset ? Color.black : OpenReelTheme.textPrimary)
                                    .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
                                    .padding(.horizontal, 14)
                                    .background(
                                        appState.newProjectConfiguration.preset == preset ?
                                        AnyShapeStyle(OpenReelTheme.accent) :
                                        AnyShapeStyle(OpenReelTheme.surface)
                                    , in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Frame Rate")
                            .font(.reelSection)
                            .foregroundStyle(OpenReelTheme.textPrimary)

                        HStack(spacing: 10) {
                            ForEach(NewProjectConfiguration.supportedFrameRates, id: \.self) { frameRate in
                                Button {
                                    appState.newProjectConfiguration.frameRate = frameRate
                                } label: {
                                    Text("\(Int(frameRate)) fps")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                        .foregroundStyle(appState.newProjectConfiguration.frameRate == frameRate ? Color.black : OpenReelTheme.textPrimary)
                                        .padding(.horizontal, 14)
                                        .frame(height: 42)
                                        .background(
                                            appState.newProjectConfiguration.frameRate == frameRate ?
                                            AnyShapeStyle(OpenReelTheme.accent) :
                                            AnyShapeStyle(OpenReelTheme.surfaceElevated)
                                        , in: Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Button {
                        Task {
                            await appState.createProject()
                        }
                    } label: {
                        Text("Create Project")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(OpenReelTheme.accent, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
                .padding(20)
            }
            .background(OpenReelTheme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") {
                        appState.dismissNewProjectSheet()
                    }
                    .foregroundStyle(OpenReelTheme.textSecondary)
                }
            }
        }
    }
}

#Preview {
    NewProjectSheet()
        .environment(AppState())
}