import SwiftUI

struct EditorView: View {
    @Environment(AppState.self) private var appState
    @Environment(PlaybackController.self) private var playbackController

    @State private var showsVolumeControl = false
    @State private var playheadDragStartTime: TimeInterval?
    @State private var showsMediaLibrarySheet = false
    @State private var showsPhotoPickerInSheet = false

    private let editActions = [
        (title: "Split", symbol: "scissors"),
        (title: "Delete", symbol: "trash"),
        (title: "Volume", symbol: "speaker.wave.2"),
        (title: "Speed", symbol: "gauge.with.dots.needle.33percent"),
        (title: "Crop", symbol: "crop"),
        (title: "Filters", symbol: "camera.filters"),
        (title: "Adjust", symbol: "slider.horizontal.3")
    ]

    var body: some View {
        Group {
            if let project = appState.currentProject {
                editorContent(for: project)
            } else {
                emptyState
            }
        }
        .background(OpenReelTheme.background.ignoresSafeArea())
        .task(id: appState.playbackReloadToken) {
            appState.syncPlayback(with: playbackController)
        }
        .sheet(isPresented: $showsMediaLibrarySheet) {
            if let project = appState.currentProject {
                mediaLibrarySheet(for: project)
            }
        }
        .fullScreenCover(
            isPresented: Binding(
                get: { appState.isMediaPickerPresented },
                set: { isPresented in
                    if !isPresented {
                        appState.dismissMediaPicker()
                    }
                }
            )
        ) {
            MediaPicker(
                onCancel: {
                    appState.dismissMediaPicker()
                },
                onPick: { assets in
                    appState.dismissMediaPicker()
                    Task {
                        await appState.importMedia(assets, playbackController: playbackController)
                    }
                }
            )
            .ignoresSafeArea()
        }
        .overlay {
            if appState.isImportingMedia {
                ZStack {
                    Color.black.opacity(0.35)
                        .ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView()
                            .tint(OpenReelTheme.accent)
                        Text("Importing video")
                            .font(.reelBody)
                            .foregroundStyle(.white)
                    }
                    .padding(20)
                    .background(OpenReelTheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
            }
        }
        .sheet(isPresented: $showsVolumeControl) {
            volumeSheet
                .presentationDetents([.height(180)])
                .presentationDragIndicator(.visible)
        }
    }

    private var displayedTab: AppState.EditorTab {
        appState.editorTab == .media ? .edit : appState.editorTab
    }

    private func editorContent(for project: OpenReelProject) -> some View {
        VStack(spacing: 0) {
            topBar(project: project)
                .padding(.top, 4)
                .padding(.bottom, 6)

            previewStage(for: project)

            timecodeBar(for: project)
                .padding(.top, 6)
                .padding(.bottom, 4)

            transportBar(for: project)
                .padding(.bottom, 6)

            timeline(for: project)

            lowerPanel()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "film.stack")
                .font(.system(size: 32, weight: .semibold))
                .foregroundStyle(OpenReelTheme.accent)
            Text("Create a project to start editing")
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(OpenReelTheme.textPrimary)
            Button("New Project") {
                appState.presentNewProjectSheet()
            }
            .buttonStyle(.plain)
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(OpenReelTheme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func topBar(project: OpenReelProject) -> some View {
        HStack(spacing: 12) {
            Button {
                playbackController.pause()
                appState.closeEditor()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                    .frame(width: 42, height: 42)
                    .background(OpenReelTheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 4) {
                Text(project.name)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                    .lineLimit(1)

                Text(projectSubtitle(project))
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textSecondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 8) {
                historyButton(symbol: "arrow.uturn.backward", isEnabled: appState.canUndo) {
                    Task {
                        await appState.undo(playbackController: playbackController)
                    }
                }
                historyButton(symbol: "arrow.uturn.forward", isEnabled: appState.canRedo) {
                    Task {
                        await appState.redo(playbackController: playbackController)
                    }
                }

                Button {
                } label: {
                    Image(systemName: "square.and.arrow.up.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(OpenReelTheme.accent, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(OpenReelTheme.surface.opacity(0.96), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Color.white.opacity(0.05), lineWidth: 1)
        }
        .padding(.horizontal, 16)
    }

    private func previewStage(for project: OpenReelProject) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.black)
                .overlay {
                    if playbackController.player != nil {
                        MetalVideoView(player: playbackController.player)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    } else {
                        placeholderPreview(project: project)
                    }
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                }
                .aspectRatio(appState.selectedAspectRatio.value, contentMode: .fit)
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 240)
        .padding(.horizontal, 16)
    }

    private func placeholderPreview(project: OpenReelProject) -> some View {
        ZStack {
            appState.style(for: project).gradient
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(spacing: 10) {
                Image(systemName: "video.badge.plus")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Import a video from Media")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                Text("Preview activates after first import.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.7))
            }
        }
    }

    private func timecodeBar(for project: OpenReelProject) -> some View {
        HStack {
            Text(playbackController.currentTime.openReelClock(frameRate: project.settings.frameRate))
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(OpenReelTheme.textPrimary)
                .fixedSize(horizontal: true, vertical: false)

            Spacer()

            Menu {
                ForEach(AppState.AspectRatio.allCases) { aspectRatio in
                    Button {
                        appState.selectedAspectRatio = aspectRatio
                    } label: {
                        Label(aspectRatio.rawValue, systemImage: aspectRatioSymbol(for: aspectRatio))
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(appState.selectedAspectRatio.rawValue)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 9, weight: .bold))
                }
                .foregroundStyle(OpenReelTheme.textSecondary)
                .fixedSize(horizontal: true, vertical: false)
            }
        }
        .padding(.horizontal, 20)
    }

    private var hasTimelineContent: Bool {
        guard let project = appState.currentProject else { return false }
        return project.allClips.contains { !$0.mediaId.isEmpty }
    }

    private func transportBar(for project: OpenReelProject) -> some View {
        HStack(spacing: 0) {
            transportButton(symbol: "backward.frame.fill", isEnabled: hasTimelineContent) {
                if playbackController.player == nil {
                    appState.syncPlayback(with: playbackController)
                }
                playbackController.step(frames: -1)
            }

            Spacer()

            Button {
                if playbackController.player == nil {
                    appState.syncPlayback(with: playbackController)
                }
                playbackController.togglePlayback()
            } label: {
                Image(systemName: playbackController.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(OpenReelTheme.accent, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!hasTimelineContent)

            Spacer()

            transportButton(symbol: "forward.frame.fill", isEnabled: hasTimelineContent) {
                if playbackController.player == nil {
                    appState.syncPlayback(with: playbackController)
                }
                playbackController.step(frames: 1)
            }

            Spacer()

            Button {
                if playbackController.volume > 0 {
                    playbackController.setVolume(0)
                } else {
                    playbackController.setVolume(1)
                }
            } label: {
                Image(systemName: volumeIcon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.4).onEnded { _ in
                    showsVolumeControl = true
                }
            )

            Spacer()

            Button {
                showsVolumeControl = true
            } label: {
                Text("\(Int(playbackController.volume * 100))%")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textSecondary)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
    }

    @State private var timelineScrollPosition = ScrollPosition(edge: .leading)

    private func timeline(for project: OpenReelProject) -> some View {
        GeometryReader { proxy in
            let badgeWidth = 48.0
            let badgeGap = 10.0
            let duration = max(project.timeline.duration, 8)
            let trackAreaWidth = proxy.size.width - badgeWidth - badgeGap - 24
            let contentWidth = max(duration * appState.timelineZoom + 120, trackAreaWidth)
            let rowSpacing = 8.0
            let rulerHeight = 34.0
            let trackHeights = project.sortedTracks.map(timelineLaneHeight(for:))
            let tracksHeight = trackHeights.reduce(0, +) + Double(max(project.sortedTracks.count - 1, 0)) * rowSpacing
            let playheadX = playbackController.currentTime * appState.timelineZoom

            ScrollView(.vertical, showsIndicators: false) {
                HStack(alignment: .top, spacing: badgeGap) {
                    VStack(spacing: rowSpacing) {
                        Color.clear.frame(height: rulerHeight)
                        ForEach(project.sortedTracks) { track in
                            trackBadge(for: track)
                        }
                    }
                    .frame(width: badgeWidth)

                    ScrollView(.horizontal, showsIndicators: false) {
                        ZStack(alignment: .topLeading) {
                            VStack(alignment: .leading, spacing: rowSpacing) {
                                timelineRuler(duration: duration, contentWidth: contentWidth, laneInset: 0, frameRate: project.settings.frameRate)
                                    .frame(height: rulerHeight)

                                ForEach(project.sortedTracks) { track in
                                    timelineTrackLane(for: project, track: track, contentWidth: contentWidth)
                                }
                            }
                            .frame(width: contentWidth, alignment: .leading)

                            playheadView(x: playheadX, height: rulerHeight + rowSpacing + tracksHeight)
                                .offset(y: rulerHeight)
                        }
                        .frame(width: contentWidth, alignment: .topLeading)
                        .contentShape(Rectangle())
                        .onTapGesture { location in
                            let tappedTime = max(0, location.x / appState.timelineZoom)
                            playbackController.pause()
                            playbackController.seek(to: min(tappedTime, duration))
                        }
                    }
                    .scrollPosition($timelineScrollPosition)
                    .onChange(of: playbackController.currentTime) { _, newTime in
                        guard playbackController.isPlaying else { return }
                        let targetX = newTime * appState.timelineZoom
                        let visibleCenter = trackAreaWidth * 0.5
                        let scrollOffset = max(0, targetX - visibleCenter)
                        timelineScrollPosition.scrollTo(x: scrollOffset)
                    }
                }
                .padding(.bottom, 8)
            }
            .padding(.horizontal, 12)
            .gesture(
                MagnifyGesture()
                    .onChanged { value in
                        let newZoom = appState.timelineZoom * value.magnification
                        appState.timelineZoom = min(max(newZoom, 20), 300)
                    }
            )
        }
        .frame(maxHeight: .infinity)
        .background(OpenReelTheme.surface.opacity(0.5))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.04))
                .frame(height: 1)
        }
    }

    private func timelineRuler(duration: Double, contentWidth: Double, laneInset: Double, frameRate: Double) -> some View {
        let step = duration <= 15 ? 2.0 : duration <= 45 ? 5.0 : 10.0
        let marks = stride(from: 0.0, through: max(duration, step), by: step).map { $0 }

        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(Color.clear)
                .frame(width: contentWidth, height: 34)

            ForEach(marks, id: \.self) { mark in
                VStack(alignment: .leading, spacing: 4) {
                    Text(mark.shortClock())
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(OpenReelTheme.textSecondary)
                    Rectangle()
                        .fill(Color.white.opacity(0.14))
                        .frame(width: 1, height: 12)
                }
                .offset(x: laneInset + mark * appState.timelineZoom, y: 8)
            }

            Text(playbackController.currentTime.openReelClock(frameRate: frameRate))
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(.black)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(OpenReelTheme.accent, in: Capsule())
                .offset(x: max(laneInset + playbackController.currentTime * appState.timelineZoom - 34, laneInset), y: 0)
        }
    }

    @ViewBuilder
    private func timelineTrackLane(for project: OpenReelProject, track: OpenReelProject.Track, contentWidth: Double) -> some View {
        if track.type == .audio {
            audioTrackLane(track: track, contentWidth: contentWidth)
        } else {
            visualTrackLane(for: project, track: track, contentWidth: contentWidth)
        }
    }

    @ViewBuilder
    private func visualTrackLane(for project: OpenReelProject, track: OpenReelProject.Track, contentWidth: Double) -> some View {
        let clips = track.clips.sorted { $0.startTime < $1.startTime }

        if clips.isEmpty {
            Button {
                showsMediaLibrarySheet = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: emptyLaneSymbol(for: track.type))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(OpenReelTheme.accent)
                    Text(emptyLaneTitle(for: track.type))
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(OpenReelTheme.textSecondary)
                }
                .frame(width: contentWidth, height: timelineLaneHeight(for: track), alignment: .leading)
                .padding(.horizontal, 18)
                .background(OpenReelTheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        } else {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.02))
                    .frame(width: contentWidth, height: timelineLaneHeight(for: track))

                ForEach(clips) { clip in
                    TimelineClipBlock(
                        project: project,
                        clip: clip,
                        pixelsPerSecond: appState.timelineZoom,
                        isSelected: appState.selectedClipID == clip.id
                    )
                    .offset(x: clip.startTime * appState.timelineZoom)
                    .onTapGesture {
                        appState.selectClip(clip)
                        if let mediaItem = appState.mediaItem(for: clip.mediaId, in: project),
                           let url = appState.mediaURL(for: mediaItem, in: project) {
                            playbackController.loadVideo(url: url, duration: clip.duration, frameRate: project.settings.frameRate)
                            playbackController.seek(to: 0)
                        }
                    }
                }
            }
            .frame(width: contentWidth, height: timelineLaneHeight(for: track), alignment: .leading)
        }
    }

    @ViewBuilder
    private func audioTrackLane(track: OpenReelProject.Track, contentWidth: Double) -> some View {
        let audioClips = track.clips.sorted { $0.startTime < $1.startTime }

        if audioClips.isEmpty {
            HStack(spacing: 10) {
                Image(systemName: "waveform.badge.plus")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(OpenReelTheme.accent)
                Text("Add Audio")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textSecondary)
            }
            .frame(width: contentWidth, height: timelineLaneHeight(for: track), alignment: .leading)
            .padding(.horizontal, 18)
            .background(OpenReelTheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.02))
                    .frame(width: contentWidth, height: timelineLaneHeight(for: track))

                ForEach(audioClips) { clip in
                    TimelineAudioClipBlock(
                        clip: clip,
                        pixelsPerSecond: appState.timelineZoom,
                        isSelected: appState.selectedClipID == clip.id
                    )
                    .offset(x: clip.startTime * appState.timelineZoom)
                    .onTapGesture {
                        appState.selectClip(clip)
                    }
                }
            }
            .frame(width: contentWidth, height: timelineLaneHeight(for: track), alignment: .leading)
        }
    }

    private func trackBadge(for track: OpenReelProject.Track) -> some View {
        Image(systemName: trackSymbol(for: track.type))
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(OpenReelTheme.accent)
            .frame(width: 48, height: timelineLaneHeight(for: track))
            .background(OpenReelTheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func playheadView(x: Double, height: Double) -> some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(OpenReelTheme.accent)
                .frame(width: 14, height: 18)
            Rectangle()
                .fill(OpenReelTheme.accent)
                .frame(width: 2, height: max(height - 18, 0))
        }
        .offset(x: x, y: 8)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if playheadDragStartTime == nil {
                        playheadDragStartTime = playbackController.currentTime
                        playbackController.pause()
                    }

                    let baseTime = playheadDragStartTime ?? 0
                    let targetTime = baseTime + Double(value.translation.width) / appState.timelineZoom
                    playbackController.seek(to: targetTime)
                }
                .onEnded { _ in
                    playheadDragStartTime = nil
                }
        )
    }

    private func lowerPanel() -> some View {
        VStack(spacing: 0) {
            if displayedTab == .edit {
                GeometryReader { geo in
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 0) {
                            ForEach(editActions, id: \.title) { action in
                                VStack(spacing: 6) {
                                    Image(systemName: action.symbol)
                                        .font(.system(size: 20, weight: .semibold))
                                        .foregroundStyle(OpenReelTheme.textPrimary)
                                    Text(action.title)
                                        .font(.system(size: 10, weight: .medium, design: .rounded))
                                        .foregroundStyle(OpenReelTheme.textSecondary)
                                }
                                .frame(maxWidth: .infinity)
                                .frame(height: 56)
                            }
                        }
                        .frame(minWidth: geo.size.width)
                        .padding(.vertical, 6)
                    }
                }
                .frame(height: 68)
            } else {
                genericTabPanel(for: displayedTab)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
            }

            Divider()
                .overlay(Color.white.opacity(0.04))

            HStack(spacing: 0) {
                ForEach(AppState.EditorTab.allCases) { tab in
                    Button {
                        if tab == .media {
                            showsMediaLibrarySheet = true
                        } else {
                            appState.editorTab = tab
                        }
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: symbol(for: tab))
                                .font(.system(size: 18, weight: .semibold))
                            Text(tab.rawValue)
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                        }
                        .foregroundStyle(isTabSelected(tab) ? OpenReelTheme.accent : OpenReelTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .background(OpenReelTheme.surfaceElevated)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.04))
                .frame(height: 1)
        }
    }

    private func mediaLibrarySheet(for project: OpenReelProject) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Button {
                        openMediaImporterFromSheet()
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 18, weight: .semibold))
                            Text("Import From Photos")
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(.white.opacity(0.6))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(OpenReelTheme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    if project.mediaLibrary.items.isEmpty {
                        VStack(spacing: 16) {
                            Image(systemName: "photo.on.rectangle.angled")
                                .font(.system(size: 36, weight: .light))
                                .foregroundStyle(OpenReelTheme.textSecondary)
                            Text("No media imported yet")
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .foregroundStyle(OpenReelTheme.textPrimary)
                            Text("Import videos from your Photo Library to start editing.")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(OpenReelTheme.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                            ForEach(project.mediaLibrary.items) { mediaItem in
                                VStack(alignment: .leading, spacing: 0) {
                                    mediaTile(project: project, mediaItem: mediaItem)
                                        .frame(maxWidth: .infinity)
                                        .aspectRatio(16.0 / 10.0, contentMode: .fit)
                                        .clipped()
                                        .overlay(alignment: .bottomTrailing) {
                                            Text(TimeInterval(mediaItem.metadata.duration).shortClock())
                                                .font(.system(size: 10, weight: .bold, design: .monospaced))
                                                .foregroundStyle(.white)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 3)
                                                .background(Color.black.opacity(0.6), in: Capsule())
                                                .padding(6)
                                        }

                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(mediaItem.name)
                                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                                            .foregroundStyle(OpenReelTheme.textPrimary)
                                            .lineLimit(1)

                                        Text(mediaItem.metadata.codec.uppercased())
                                            .font(.system(size: 10, weight: .medium, design: .rounded))
                                            .foregroundStyle(OpenReelTheme.textSecondary)
                                    }
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 8)
                                }
                                .background(OpenReelTheme.surfaceElevated)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                        }
                    }
                }
                .padding(16)
            }
            .navigationTitle("Media")
            .navigationBarTitleDisplayMode(.inline)
            .background(OpenReelTheme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showsMediaLibrarySheet = false
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(OpenReelTheme.textSecondary)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .fullScreenCover(isPresented: $showsPhotoPickerInSheet) {
            MediaPicker(
                onCancel: {
                    showsPhotoPickerInSheet = false
                },
                onPick: { assets in
                    showsPhotoPickerInSheet = false
                    showsMediaLibrarySheet = false
                    Task {
                        await appState.importMedia(assets, playbackController: playbackController)
                    }
                }
            )
            .ignoresSafeArea()
        }
    }

    private func openMediaImporterFromSheet() {
        showsPhotoPickerInSheet = true
    }

    @ViewBuilder
    private func mediaTile(project: OpenReelProject, mediaItem: OpenReelProject.MediaItem) -> some View {
        if let thumbnailURL = appState.thumbnailURL(for: mediaItem.thumbnailUrl, in: project) {
            AsyncImage(url: thumbnailURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .empty, .failure:
                    appState.style(for: project).gradient
                @unknown default:
                    appState.style(for: project).gradient
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else {
            appState.style(for: project).gradient
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func genericTabPanel(for tab: AppState.EditorTab) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(panelItems(for: tab), id: \.title) { item in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: item.symbol)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(OpenReelTheme.accent)
                            Spacer()
                            Text(item.tag)
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                .foregroundStyle(OpenReelTheme.textSecondary)
                        }
                        Text(item.title)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundStyle(OpenReelTheme.textPrimary)
                        Text(item.subtitle)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(OpenReelTheme.textSecondary)
                            .lineLimit(2)
                    }
                    .padding(14)
                    .frame(width: 168, alignment: .leading)
                    .background(OpenReelTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
        }
    }

    private var volumeIcon: String {
        if playbackController.volume == 0 {
            return "speaker.slash.fill"
        } else if playbackController.volume < 0.4 {
            return "speaker.wave.1.fill"
        } else {
            return "speaker.wave.2.fill"
        }
    }

    private var volumeSheet: some View {
        VStack(spacing: 20) {
            HStack {
                Text("Volume")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenReelTheme.textPrimary)
                Spacer()
                Text("\(Int(playbackController.volume * 100))%")
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenReelTheme.accent)
            }

            HStack(spacing: 12) {
                Image(systemName: "speaker.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenReelTheme.textSecondary)

                Slider(
                    value: Binding(
                        get: { Double(playbackController.volume) },
                        set: { playbackController.setVolume(Float($0)) }
                    ),
                    in: 0...1
                )
                .tint(OpenReelTheme.accent)

                Image(systemName: "speaker.wave.3.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenReelTheme.textSecondary)
            }

            HStack(spacing: 12) {
                volumePresetButton(label: "Mute", value: 0)
                volumePresetButton(label: "50%", value: 0.5)
                volumePresetButton(label: "100%", value: 1)
            }
        }
        .padding(20)
        .background(OpenReelTheme.background.ignoresSafeArea())
    }

    private func volumePresetButton(label: String, value: Float) -> some View {
        Button {
            playbackController.setVolume(value)
        } label: {
            Text(label)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(abs(playbackController.volume - value) < 0.01 ? OpenReelTheme.accent : OpenReelTheme.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(
                    abs(playbackController.volume - value) < 0.01 ? OpenReelTheme.accent.opacity(0.12) : OpenReelTheme.surfaceElevated,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
        }
        .buttonStyle(.plain)
    }

    private func historyButton(symbol: String, isEnabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(isEnabled ? OpenReelTheme.textPrimary : OpenReelTheme.textSecondary.opacity(0.35))
                .frame(width: 38, height: 38)
                .background(OpenReelTheme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }

    private func transportButton(symbol: String, isEnabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isEnabled ? OpenReelTheme.textPrimary : OpenReelTheme.textSecondary.opacity(0.35))
                .frame(width: 36, height: 36)
                .background(OpenReelTheme.surfaceElevated, in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }

    private func isTabSelected(_ tab: AppState.EditorTab) -> Bool {
        if tab == .media {
            return showsMediaLibrarySheet
        }
        return displayedTab == tab
    }

    private func symbol(for tab: AppState.EditorTab) -> String {
        switch tab {
        case .edit:
            return "scissors"
        case .media:
            return "photo.on.rectangle"
        case .text:
            return "textformat"
        case .effects:
            return "wand.and.stars"
        case .audio:
            return "music.note"
        }
    }

    private func panelItems(for tab: AppState.EditorTab) -> [(title: String, subtitle: String, symbol: String, tag: String)] {
        switch tab {
        case .edit:
            return []
        case .media:
            return []
        case .text:
            return [
                ("Title Presets", "Phase 1 keeps the shell ready for text overlays and captions.", "character.textbox", "TEXT"),
                ("Captions", "Subtitles and text clips arrive in the next phase.", "captions.bubble", "NEXT"),
                ("Animation", "The editor already reserves the bottom tab surface for text tooling.", "sparkles.square.filled.on.square", "READY")
            ]
        case .effects:
            return [
                ("Looks", "Color pipelines and LUTs land after the foundation milestone.", "camera.filters", "FX"),
                ("Adjust", "Exposure and contrast controls are staged on this tab shell.", "dial.high", "COLOR"),
                ("Stack", "Effect ordering will plug into the same project model later.", "square.stack.3d.down.right", "PLAN")
            ]
        case .audio:
            return [
                ("Music", "Phase 1 preserves video audio through AVPlayer playback.", "music.note.list", "AUDIO"),
                ("Voiceover", "Dedicated recording arrives after the timeline foundation.", "mic", "NEXT"),
                ("Cleanup", "Noise reduction and ducking build on the stored media model next.", "waveform.path.ecg.rectangle", "PLAN")
            ]
        }
    }

    private func projectSubtitle(_ project: OpenReelProject) -> String {
        let resolution = "\(project.settings.width)x\(project.settings.height)"
        let fps = "\(Int(project.settings.frameRate))fps"
        if let lastSavedAt = appState.lastSavedAt {
            return "\(resolution) · \(fps) · Saved \(lastSavedAt.formatted(date: .omitted, time: .shortened))"
        }
        return "\(resolution) · \(fps)"
    }

    private func timelineLaneHeight(for track: OpenReelProject.Track) -> Double {
        track.type == .audio ? 64 : 74
    }

    private func trackSymbol(for type: OpenReelProject.TrackType) -> String {
        switch type {
        case .video:
            return "film.stack"
        case .audio:
            return "waveform"
        case .image:
            return "photo.stack"
        case .text:
            return "textformat"
        case .graphics:
            return "sparkles"
        }
    }

    private func emptyLaneSymbol(for type: OpenReelProject.TrackType) -> String {
        switch type {
        case .video:
            return "plus.rectangle.on.folder"
        case .audio:
            return "waveform.badge.plus"
        case .image:
            return "photo.badge.plus"
        case .text:
            return "plus.bubble"
        case .graphics:
            return "sparkles.square.filled.on.square"
        }
    }

    private func emptyLaneTitle(for type: OpenReelProject.TrackType) -> String {
        switch type {
        case .video:
            return "Open Media Sheet"
        case .audio:
            return "Add Audio"
        case .image:
            return "Open Media Sheet"
        case .text:
            return "Add Text"
        case .graphics:
            return "Add Graphic"
        }
    }

    private func aspectRatioSymbol(for aspectRatio: AppState.AspectRatio) -> String {
        switch aspectRatio {
        case .landscape:
            return "rectangle.ratio.16.to.9"
        case .portrait:
            return "rectangle.portrait"
        case .square:
            return "square"
        case .vertical:
            return "rectangle.portrait.and.arrow.right"
        case .standard:
            return "rectangle"
        }
    }
}

private struct TimelineClipBlock: View {
    @Environment(AppState.self) private var appState

    let project: OpenReelProject
    let clip: OpenReelProject.Clip
    let pixelsPerSecond: Double
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(mediaItem?.name ?? "Clip")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)

            Text(TimeInterval(clip.duration).shortClock())
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.82))

            HStack(spacing: 3) {
                if thumbnailURLs.isEmpty {
                    ForEach(0..<8) { index in
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Color.white.opacity(index.isMultiple(of: 2) ? 0.16 : 0.28))
                            .frame(width: thumbnailWidth, height: 22)
                    }
                } else {
                    ForEach(Array(thumbnailURLs.enumerated()), id: \.offset) { _, url in
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFill()
                            case .empty, .failure:
                                Rectangle()
                                    .fill(Color.white.opacity(0.18))
                            @unknown default:
                                Rectangle()
                                    .fill(Color.white.opacity(0.18))
                            }
                        }
                        .frame(width: thumbnailWidth, height: 22)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                }
            }
        }
        .padding(12)
        .frame(width: clipWidth, height: 72, alignment: .leading)
        .background(appState.style(for: project).gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isSelected ? OpenReelTheme.accent : Color.white.opacity(0.06), lineWidth: isSelected ? 2 : 1)
        }
    }

    private var mediaItem: OpenReelProject.MediaItem? {
        appState.mediaItem(for: clip.mediaId, in: project)
    }

    private var thumbnailURLs: [URL] {
        mediaItem?.filmstripThumbnails?
            .compactMap { appState.thumbnailURL(for: $0.url, in: project) } ?? []
    }

    private var clipWidth: CGFloat {
        max(CGFloat(clip.duration * pixelsPerSecond), 160)
    }

    private var thumbnailWidth: CGFloat {
        let count = max(thumbnailURLs.count, 8)
        return max((clipWidth - 24 - CGFloat(count - 1) * 3) / CGFloat(count), 18)
    }
}

private struct TimelineAudioClipBlock: View {
    let clip: OpenReelProject.Clip
    let pixelsPerSecond: Double
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<24) { index in
                Capsule()
                    .fill(Color.white.opacity(0.28))
                    .frame(width: 4, height: index.isMultiple(of: 3) ? 14 : 24)
            }
        }
        .padding(12)
        .frame(width: max(CGFloat(clip.duration * pixelsPerSecond), 160), height: 60, alignment: .leading)
        .background(Color(red: 0.36, green: 0.24, blue: 0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isSelected ? OpenReelTheme.accent : Color.white.opacity(0.06), lineWidth: isSelected ? 2 : 1)
        }
    }
}

#Preview {
    EditorView()
        .environment(AppState())
        .environment(PlaybackController())
}