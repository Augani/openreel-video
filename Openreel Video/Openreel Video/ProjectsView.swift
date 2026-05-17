import SwiftUI

struct ProjectsView: View {
    @Environment(AppState.self) private var appState
    @State private var showsGrid = true

    var body: some View {
        ZStack {
            OpenReelTheme.background
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    if appState.projects.isEmpty {
                        emptyState
                    } else if showsGrid {
                        gridContent
                    } else {
                        listContent
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 40)
            }
        }
        .navigationTitle("Projects")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(OpenReelTheme.background, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 2) {
                    toggleButton(symbol: "square.grid.2x2", isSelected: showsGrid) {
                        showsGrid = true
                    }
                    toggleButton(symbol: "list.bullet", isSelected: !showsGrid) {
                        showsGrid = false
                    }
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    appState.presentNewProjectSheet()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(OpenReelTheme.accent, in: Circle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 20) {
            Image(systemName: "film.stack")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(OpenReelTheme.textSecondary)

            VStack(spacing: 8) {
                Text("No projects yet")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                Text("Create a project to start editing video.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textSecondary)
            }

            Button {
                appState.presentNewProjectSheet()
            } label: {
                Text("New Project")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(OpenReelTheme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private var listContent: some View {
        LazyVStack(spacing: 10) {
            ForEach(appState.projects) { project in
                Button {
                    appState.openProject(project)
                } label: {
                    ProjectBrowserRowCard(project: project)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var gridContent: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(appState.projects) { project in
                Button {
                    appState.openProject(project)
                } label: {
                    ProjectBrowserGridCard(project: project)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func toggleButton(symbol: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isSelected ? OpenReelTheme.accent : OpenReelTheme.textSecondary.opacity(0.4))
                .frame(width: 32, height: 32)
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    NavigationStack {
        ProjectsView()
            .environment(AppState())
    }
}
