import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if appState.isBootstrapping && !appState.hasBootstrapped {
                loadingView
            } else {
                if appState.activeScreen == .editor {
                    EditorView()
                } else {
                    LibraryTabView()
                }
            }
        }
        .background(OpenReelTheme.background.ignoresSafeArea())
        .task {
            await appState.bootstrap()
        }
        .sheet(
            isPresented: Binding(
                get: { appState.isShowingNewProjectSheet },
                set: { isPresented in
                    if !isPresented {
                        appState.dismissNewProjectSheet()
                    }
                }
            )
        ) {
            NewProjectSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .alert(
            "OpenReel",
            isPresented: Binding(
                get: { appState.importErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        appState.dismissError()
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                appState.dismissError()
            }
        } message: {
            Text(appState.importErrorMessage ?? "")
        }
    }

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(OpenReelTheme.accent)
            Text("Loading projects")
                .font(.reelBody)
                .foregroundStyle(OpenReelTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct LibraryTabView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        TabView(selection: selection) {
            NavigationStack {
                HomeView()
            }
                .tag(AppState.Screen.home)
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            NavigationStack {
                ProjectsView()
            }
                .tag(AppState.Screen.projects)
                .tabItem {
                    Label("Projects", systemImage: "film.stack")
                }
        }
        .tint(OpenReelTheme.accent)
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarBackground(OpenReelTheme.surfaceElevated, for: .tabBar)
    }

    private var selection: Binding<AppState.Screen> {
        Binding(
            get: {
                switch appState.activeScreen {
                case .projects:
                    return .projects
                case .home, .editor:
                    return .home
                }
            },
            set: { newValue in
                switch newValue {
                case .home:
                    appState.showHome()
                case .projects:
                    appState.showProjects()
                case .editor:
                    appState.showHome()
                }
            }
        )
    }
}

#Preview {
    RootView()
        .environment(AppState())
        .environment(PlaybackController())
}