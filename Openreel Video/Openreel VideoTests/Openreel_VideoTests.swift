import Foundation
import Testing
@testable import Openreel_Video

@MainActor
struct Openreel_VideoTests {

    @Test func createProjectPersistsAndOpensEditor() async throws {
        let harness = try makeHarness()
        defer { harness.cleanup() }

        let portraitPreset = try #require(NewProjectConfiguration.presets.first(where: { $0.name == "Portrait" }))
        harness.appState.newProjectConfiguration = NewProjectConfiguration(
            name: "  Launch Cut  ",
            preset: portraitPreset,
            frameRate: 60
        )

        await harness.appState.createProject()

        let project = try #require(harness.appState.currentProject)
        let persistedProject = try await harness.projectStore.loadProject(id: project.id)

        #expect(harness.appState.projects.count == 1)
        #expect(harness.appState.activeScreen == .editor)
        #expect(harness.appState.selectedProjectID == project.id)
        #expect(harness.appState.selectedAspectRatio == .portrait)
        #expect(project.name == "Launch Cut")
        #expect(project.settings.width == 1080)
        #expect(project.settings.height == 1920)
        #expect(project.settings.frameRate == 60)
        #expect(harness.appState.isShowingNewProjectSheet == false)
        #expect(persistedProject == project)
    }

    @Test func bootstrapLoadsPersistedProjectsAndSelectsPrimaryClip() async throws {
        let harness = try makeHarness()
        defer { harness.cleanup() }

        var olderProject = makeProject(name: "Older Draft")
        olderProject.modifiedAt = 10

        let portraitPreset = try #require(NewProjectConfiguration.presets.first(where: { $0.name == "Portrait" }))
        var newerProject = makeProject(name: "Phone Cut", preset: portraitPreset, frameRate: 60)
        let newerClip = try #require(addVideoClip(to: &newerProject, duration: 12))
        newerProject.modifiedAt = 20

        try await harness.projectStore.save(project: olderProject)
        try await harness.projectStore.save(project: newerProject)

        let appState = AppState(projectStore: harness.projectStore, mediaImportService: MediaImportService())
        await appState.bootstrap()

        #expect(appState.hasBootstrapped)
        #expect(appState.isBootstrapping == false)
        #expect(appState.projects.count == 2)
        #expect(appState.currentProject?.id == newerProject.id)
        #expect(appState.selectedProjectID == newerProject.id)
        #expect(appState.selectedClipID == newerClip.id)
        #expect(appState.selectedAspectRatio == .portrait)
        #expect(appState.currentProjectDuration == 12)
    }

    @Test func openProjectSelectsProjectAndPrimaryClip() throws {
        let appState = AppState(projectStore: ProjectStore(baseURL: temporaryDirectoryURL()), mediaImportService: MediaImportService())
        var firstProject = makeProject(name: "Landscape Cut")
        var secondProject = makeProject(name: "Vertical Cut", preset: NewProjectConfiguration.presets[2], frameRate: 30)
        let secondClip = try #require(addVideoClip(to: &secondProject, duration: 8))
        _ = addVideoClip(to: &firstProject, duration: 4)

        appState.projects = [firstProject, secondProject]

        appState.openProject(secondProject)

        #expect(appState.activeScreen == .editor)
        #expect(appState.selectedProjectID == secondProject.id)
        #expect(appState.currentProject?.id == secondProject.id)
        #expect(appState.selectedClipID == secondClip.id)
        #expect(appState.selectedAspectRatio == .portrait)
        #expect(appState.editorTab == .edit)
    }

    @Test func advanceAspectRatioCyclesForward() {
        let appState = AppState(projectStore: ProjectStore(baseURL: temporaryDirectoryURL()), mediaImportService: MediaImportService())
        let first = appState.selectedAspectRatio

        appState.advanceAspectRatio()

        #expect(first == .landscape)
        #expect(appState.selectedAspectRatio == .portrait)
    }

    private func makeHarness() throws -> TestHarness {
        let directoryURL = temporaryDirectoryURL()
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let projectStore = ProjectStore(baseURL: directoryURL)
        let appState = AppState(projectStore: projectStore, mediaImportService: MediaImportService())
        return TestHarness(appState: appState, projectStore: projectStore, directoryURL: directoryURL)
    }

    private func makeProject(
        name: String,
        preset: NewProjectConfiguration.Preset? = nil,
        frameRate: Double = 30
    ) -> OpenReelProject {
        let resolvedPreset = preset ?? NewProjectConfiguration.presets[0]
        return OpenReelProject.blank(
            configuration: NewProjectConfiguration(
                name: name,
                preset: resolvedPreset,
                frameRate: frameRate
            )
        )
    }

    private func addVideoClip(to project: inout OpenReelProject, duration: Double) -> OpenReelProject.Clip? {
        guard let videoTrackIndex = project.timeline.tracks.firstIndex(where: { $0.type == .video }) else {
            return nil
        }

        let mediaID = UUID().uuidString
        let trackID = project.timeline.tracks[videoTrackIndex].id
        let mediaItem = OpenReelProject.MediaItem(
            id: mediaID,
            name: "Sample.mov",
            type: .video,
            metadata: OpenReelProject.MediaMetadata(
                duration: duration,
                width: project.settings.width,
                height: project.settings.height,
                frameRate: project.settings.frameRate,
                codec: "h264",
                sampleRate: 48_000,
                channels: 2,
                fileSize: 1_024,
                audioTrackCount: 1
            ),
            thumbnailUrl: nil,
            waveformData: nil,
            filmstripThumbnails: nil,
            isPlaceholder: false,
            originalUrl: nil,
            sourceFile: nil,
            localFileName: "sample.mov",
            localAssetIdentifier: nil
        )

        let clip = OpenReelProject.Clip(
            id: UUID().uuidString,
            mediaId: mediaID,
            trackId: trackID,
            startTime: 0,
            duration: duration,
            inPoint: 0,
            outPoint: duration,
            effects: [],
            audioEffects: [],
            transform: OpenReelProject.Transform(
                position: OpenReelProject.Point(x: 0.5, y: 0.5),
                scale: OpenReelProject.Point(x: 1, y: 1),
                rotation: 0,
                anchor: OpenReelProject.Point(x: 0.5, y: 0.5),
                opacity: 1,
                borderRadius: nil,
                fitMode: .contain,
                crop: nil
            ),
            volume: 1,
            keyframes: [],
            speed: 1,
            reversed: false,
            audioTrackIndex: 0
        )

        project.mediaLibrary.items = [mediaItem]
        project.timeline.tracks[videoTrackIndex].clips = [clip]
        project.timeline.duration = duration
        return clip
    }
}

private struct TestHarness {
    let appState: AppState
    let projectStore: ProjectStore
    let directoryURL: URL

    func cleanup() {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}

private func temporaryDirectoryURL() -> URL {
    URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
}