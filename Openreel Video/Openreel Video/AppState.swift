import Foundation
import Observation
import SwiftUI

@MainActor
@Observable
final class AppState {
    enum Screen: Equatable {
        case home
        case projects
        case editor
    }

    enum EditorTab: String, CaseIterable, Identifiable {
        case edit = "Edit"
        case media = "Media"
        case text = "Text"
        case effects = "Effects"
        case audio = "Audio"

        var id: String { rawValue }
    }

    enum AspectRatio: String, CaseIterable, Identifiable {
        case landscape = "16:9"
        case portrait = "9:16"
        case square = "1:1"
        case vertical = "4:5"
        case standard = "4:3"

        var id: String { rawValue }

        var value: CGFloat {
            switch self {
            case .landscape:
                return 16 / 9
            case .portrait:
                return 9 / 16
            case .square:
                return 1
            case .vertical:
                return 4 / 5
            case .standard:
                return 4 / 3
            }
        }
    }

    enum ProjectStyle: String, CaseIterable, Hashable {
        case emerald
        case cobalt
        case amber
        case coral
    }

    var activeScreen: Screen = .home
    var editorTab: EditorTab = .edit
    var selectedAspectRatio: AspectRatio = .landscape
    var selectedProjectID: String?
    var selectedClipID: String?
    var projects: [OpenReelProject] = []
    var isBootstrapping = false
    var hasBootstrapped = false
    var isShowingNewProjectSheet = false
    var newProjectConfiguration = NewProjectConfiguration(name: "Project 1")
    var isMediaPickerPresented = false
    var isImportingMedia = false
    var importErrorMessage: String?
    var timelineZoom: Double = 72
    var lastSavedAt: Date?

    @ObservationIgnored private let projectStore: ProjectStore
    @ObservationIgnored private let mediaImportService: MediaImportService
    @ObservationIgnored private let history = ActionHistory<OpenReelProject>()

    init(
        projectStore: ProjectStore = ProjectStore(),
        mediaImportService: MediaImportService = MediaImportService()
    ) {
        self.projectStore = projectStore
        self.mediaImportService = mediaImportService
    }

    var currentProject: OpenReelProject? {
        guard let selectedProjectID else {
            return projects.first
        }

        return projects.first(where: { $0.id == selectedProjectID })
    }

    var currentProjectDuration: TimeInterval {
        currentProject?.timeline.duration ?? 0
    }

    var canUndo: Bool {
        history.canUndo
    }

    var canRedo: Bool {
        history.canRedo
    }

    var playbackReloadToken: String {
        let projectID = selectedProjectID ?? "none"
        let modifiedAt = currentProject?.modifiedAt ?? 0
        return "\(projectID)-\(modifiedAt)"
    }

    func bootstrap() async {
        guard !hasBootstrapped else {
            return
        }

        isBootstrapping = true
        defer {
            isBootstrapping = false
            hasBootstrapped = true
        }

        do {
            projects = try await projectStore.loadProjects()
            selectedProjectID = projects.first?.id
            if let project = currentProject {
                syncAspectRatio(to: project)
                selectedClipID = primaryVisualClip(in: project)?.id
            }
        } catch {
            importErrorMessage = error.localizedDescription
        }

        prepareNewProjectDefaults()
    }

    func showHome() {
        activeScreen = .home
    }

    func showProjects() {
        activeScreen = .projects
    }

    func openProject(_ project: OpenReelProject) {
        selectedProjectID = project.id
        selectedClipID = primaryVisualClip(in: project)?.id
        syncAspectRatio(to: project)
        editorTab = .edit
        activeScreen = .editor
    }

    func closeEditor() {
        activeScreen = .home
        editorTab = .edit
        isMediaPickerPresented = false
        isImportingMedia = false
    }

    func presentNewProjectSheet() {
        prepareNewProjectDefaults()
        isShowingNewProjectSheet = true
    }

    func dismissNewProjectSheet() {
        isShowingNewProjectSheet = false
    }

    func createProject() async {
        let trimmedName = newProjectConfiguration.name.trimmingCharacters(in: .whitespacesAndNewlines)
        newProjectConfiguration.name = trimmedName.isEmpty ? suggestedProjectName() : trimmedName

        let project = OpenReelProject.blank(configuration: newProjectConfiguration)
        projects.insert(project, at: 0)
        selectedProjectID = project.id
        selectedClipID = nil
        activeScreen = .editor
        editorTab = .edit
        syncAspectRatio(to: project)
        history.clear()
        isShowingNewProjectSheet = false

        do {
            try await projectStore.save(project: project)
            lastSavedAt = .now
        } catch {
            importErrorMessage = error.localizedDescription
        }

        prepareNewProjectDefaults()
    }

    func presentMediaPicker() {
        isMediaPickerPresented = true
    }

    func dismissMediaPicker() {
        isMediaPickerPresented = false
    }

    func selectClip(_ clip: OpenReelProject.Clip) {
        selectedClipID = clip.id
    }

    func importMedia(_ assets: [ImportedMediaAsset], playbackController: PlaybackController) async {
        guard let project = currentProject, !assets.isEmpty else {
            return
        }

        isImportingMedia = true
        defer {
            isImportingMedia = false
            isMediaPickerPresented = false
        }

        do {
            let updatedProject = try await mediaImportService.importAssets(assets, into: project, store: projectStore)
            await replaceCurrentProject(with: updatedProject, captureHistory: true)
            selectedClipID = primaryVisualClip(in: updatedProject)?.id
            syncPlayback(with: playbackController)
        } catch {
            importErrorMessage = error.localizedDescription
        }
    }

    func undo(playbackController: PlaybackController) async {
        guard let currentProject,
              let previous = history.undo(current: currentProject)
        else {
            return
        }

        await replaceCurrentProject(with: previous, captureHistory: false)
        selectedClipID = primaryVisualClip(in: previous)?.id
        syncPlayback(with: playbackController)
    }

    func redo(playbackController: PlaybackController) async {
        guard let currentProject,
              let next = history.redo(current: currentProject)
        else {
            return
        }

        await replaceCurrentProject(with: next, captureHistory: false)
        selectedClipID = primaryVisualClip(in: next)?.id
        syncPlayback(with: playbackController)
    }

    func advanceAspectRatio() {
        guard let currentIndex = AspectRatio.allCases.firstIndex(of: selectedAspectRatio) else {
            selectedAspectRatio = .landscape
            return
        }

        let nextIndex = AspectRatio.allCases.index(after: currentIndex)
        selectedAspectRatio = nextIndex == AspectRatio.allCases.endIndex ? AspectRatio.allCases[0] : AspectRatio.allCases[nextIndex]
    }

    func style(for project: OpenReelProject) -> ProjectStyle {
        let styles = ProjectStyle.allCases
        let index = abs(project.id.hashValue) % styles.count
        return styles[index]
    }

    func primaryVisualClip(in project: OpenReelProject? = nil) -> OpenReelProject.Clip? {
        let project = project ?? currentProject
        return project?.timeline.tracks
            .first(where: { $0.type == .video || $0.type == .image })?
            .clips
            .sorted(by: { $0.startTime < $1.startTime })
            .first
    }

    func selectedVisualClip(in project: OpenReelProject? = nil) -> OpenReelProject.Clip? {
        let project = project ?? currentProject
        guard let project, let selectedClipID else {
            return primaryVisualClip(in: project)
        }

        return project.timeline.tracks
            .filter { $0.type == .video || $0.type == .image }
            .flatMap(\.clips)
            .first { $0.id == selectedClipID } ?? primaryVisualClip(in: project)
    }

    func clips(for trackType: OpenReelProject.TrackType, in project: OpenReelProject? = nil) -> [OpenReelProject.Clip] {
        let project = project ?? currentProject
        return project?.timeline.tracks.first(where: { $0.type == trackType })?.clips ?? []
    }

    func mediaItem(for mediaID: String, in project: OpenReelProject? = nil) -> OpenReelProject.MediaItem? {
        let project = project ?? currentProject
        return project?.mediaLibrary.items.first(where: { $0.id == mediaID })
    }

    func mediaURL(for mediaItem: OpenReelProject.MediaItem, in project: OpenReelProject? = nil) -> URL? {
        let project = project ?? currentProject
        guard let project, let localFileName = mediaItem.localFileName else {
            return nil
        }

        return projectStore.mediaDirectoryURL(for: project.id).appendingPathComponent(localFileName, isDirectory: false)
    }

    func thumbnailURL(for relativePath: String?, in project: OpenReelProject? = nil) -> URL? {
        let project = project ?? currentProject
        guard let project, let relativePath else {
            return nil
        }

        return projectStore.relativeResourceURL(projectID: project.id, relativePath: relativePath)
    }

    func syncPlayback(with playbackController: PlaybackController) {
        guard let project = currentProject,
              let clip = selectedVisualClip(in: project),
              let mediaItem = mediaItem(for: clip.mediaId, in: project),
              let mediaURL = mediaURL(for: mediaItem, in: project)
        else {
            playbackController.loadVideo(url: nil, duration: 0, frameRate: 30)
            return
        }

        playbackController.loadVideo(
            url: mediaURL,
            duration: clip.duration,
            frameRate: project.settings.frameRate
        )
    }

    func dismissError() {
        importErrorMessage = nil
    }

    private func replaceProject(_ project: OpenReelProject) {
        if let index = projects.firstIndex(where: { $0.id == project.id }) {
            projects[index] = project
        } else {
            projects.insert(project, at: 0)
        }
        projects.sort { $0.modifiedAt > $1.modifiedAt }
        selectedProjectID = project.id
    }

    private func replaceCurrentProject(with project: OpenReelProject, captureHistory: Bool) async {
        if captureHistory, let currentProject {
            history.capture(currentProject)
        }

        replaceProject(project)

        do {
            try await projectStore.save(project: project)
            lastSavedAt = .now
        } catch {
            importErrorMessage = error.localizedDescription
        }
    }

    private func syncAspectRatio(to project: OpenReelProject) {
        let ratio = Double(project.settings.width) / Double(max(project.settings.height, 1))
        let closest = AspectRatio.allCases.min { lhs, rhs in
            abs(Double(lhs.value) - ratio) < abs(Double(rhs.value) - ratio)
        }
        selectedAspectRatio = closest ?? .landscape
    }

    private func prepareNewProjectDefaults() {
        newProjectConfiguration = NewProjectConfiguration(name: suggestedProjectName())
    }

    private func suggestedProjectName() -> String {
        "Project \(projects.count + 1)"
    }
}
