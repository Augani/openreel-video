import AVFoundation
import Foundation
import UIKit

enum ImportedMediaType: Sendable, Equatable {
    case video
    case image
    case audio
}

struct ImportedMediaAsset: Sendable, Equatable {
    var sourceURL: URL
    var fileName: String
    var assetIdentifier: String?
    var mediaType: ImportedMediaType
}

actor MediaImportService {
    enum ImportError: LocalizedError {
        case missingVideoTrack
        case missingThumbnailData
        case missingImageData
        case noSuitableTrack

        var errorDescription: String? {
            switch self {
            case .missingVideoTrack:
                return "The selected file does not contain a playable video track."
            case .missingThumbnailData:
                return "A preview thumbnail could not be generated for this clip."
            case .missingImageData:
                return "The selected image could not be read."
            case .noSuitableTrack:
                return "No suitable track found on the timeline for this media type."
            }
        }
    }

    func importAssets(
        _ assets: [ImportedMediaAsset],
        into project: OpenReelProject,
        store: ProjectStore
    ) async throws -> OpenReelProject {
        var updatedProject = project

        let videoAssets = assets.filter { $0.mediaType == .video }
        let imageAssets = assets.filter { $0.mediaType == .image }
        let audioAssets = assets.filter { $0.mediaType == .audio }

        if !videoAssets.isEmpty {
            updatedProject = try await importVideos(videoAssets, into: updatedProject, store: store)
        }

        if !imageAssets.isEmpty {
            updatedProject = try await importImages(imageAssets, into: updatedProject, store: store)
        }

        if !audioAssets.isEmpty {
            updatedProject = try await importAudio(audioAssets, into: updatedProject, store: store)
        }

        updatedProject.modifiedAt = Int(Date().timeIntervalSince1970 * 1000)
        return updatedProject
    }

    func importVideos(
        _ assets: [ImportedMediaAsset],
        into project: OpenReelProject,
        store: ProjectStore
    ) async throws -> OpenReelProject {
        guard let videoTrackIndex = project.timeline.tracks.firstIndex(where: { $0.type == .video }) else {
            return project
        }

        var updatedProject = project
        var nextStartTime = updatedProject.timeline.tracks[videoTrackIndex].clips
            .filter { !$0.mediaId.isEmpty }
            .map { $0.startTime + $0.duration }
            .max() ?? 0

        for asset in assets {
            let prepared = try await prepareImportedVideo(
                asset,
                projectID: updatedProject.id,
                trackID: updatedProject.timeline.tracks[videoTrackIndex].id,
                startTime: nextStartTime,
                store: store
            )

            updatedProject.mediaLibrary.items.append(prepared.mediaItem)
            updatedProject.timeline.tracks[videoTrackIndex].clips.append(prepared.clip)
            nextStartTime = prepared.clip.startTime + prepared.clip.duration
        }

        updatedProject.timeline.tracks[videoTrackIndex].clips = updatedProject.timeline.tracks[videoTrackIndex].clips
            .filter { !$0.mediaId.isEmpty }
            .sorted { $0.startTime < $1.startTime }
        updatedProject.timeline.duration = max(updatedProject.timeline.duration, nextStartTime)
        return updatedProject
    }

    private func importImages(
        _ assets: [ImportedMediaAsset],
        into project: OpenReelProject,
        store: ProjectStore
    ) async throws -> OpenReelProject {
        let trackIndex: Int
        if let existing = project.timeline.tracks.firstIndex(where: { $0.type == .image }) {
            trackIndex = existing
        } else if let videoIndex = project.timeline.tracks.firstIndex(where: { $0.type == .video }) {
            trackIndex = videoIndex
        } else {
            return project
        }

        var updatedProject = project
        var nextStartTime = updatedProject.timeline.tracks[trackIndex].clips
            .filter { !$0.mediaId.isEmpty }
            .map { $0.startTime + $0.duration }
            .max() ?? 0

        let defaultImageDuration: Double = 5.0

        for asset in assets {
            let prepared = try await prepareImportedImage(
                asset,
                projectID: updatedProject.id,
                trackID: updatedProject.timeline.tracks[trackIndex].id,
                startTime: nextStartTime,
                duration: defaultImageDuration,
                store: store
            )

            updatedProject.mediaLibrary.items.append(prepared.mediaItem)
            updatedProject.timeline.tracks[trackIndex].clips.append(prepared.clip)
            nextStartTime += defaultImageDuration
        }

        updatedProject.timeline.tracks[trackIndex].clips = updatedProject.timeline.tracks[trackIndex].clips
            .filter { !$0.mediaId.isEmpty }
            .sorted { $0.startTime < $1.startTime }
        updatedProject.timeline.duration = max(updatedProject.timeline.duration, nextStartTime)
        return updatedProject
    }

    private func importAudio(
        _ assets: [ImportedMediaAsset],
        into project: OpenReelProject,
        store: ProjectStore
    ) async throws -> OpenReelProject {
        guard let audioTrackIndex = project.timeline.tracks.firstIndex(where: { $0.type == .audio }) else {
            return project
        }

        var updatedProject = project
        var nextStartTime = updatedProject.timeline.tracks[audioTrackIndex].clips
            .filter { !$0.mediaId.isEmpty }
            .map { $0.startTime + $0.duration }
            .max() ?? 0

        for asset in assets {
            let prepared = try await prepareImportedAudio(
                asset,
                projectID: updatedProject.id,
                trackID: updatedProject.timeline.tracks[audioTrackIndex].id,
                startTime: nextStartTime,
                store: store
            )

            updatedProject.mediaLibrary.items.append(prepared.mediaItem)
            updatedProject.timeline.tracks[audioTrackIndex].clips.append(prepared.clip)
            nextStartTime = prepared.clip.startTime + prepared.clip.duration
        }

        updatedProject.timeline.tracks[audioTrackIndex].clips = updatedProject.timeline.tracks[audioTrackIndex].clips
            .filter { !$0.mediaId.isEmpty }
            .sorted { $0.startTime < $1.startTime }
        updatedProject.timeline.duration = max(updatedProject.timeline.duration, nextStartTime)
        return updatedProject
    }

    private func prepareImportedVideo(
        _ asset: ImportedMediaAsset,
        projectID: String,
        trackID: String,
        startTime: Double,
        store: ProjectStore
    ) async throws -> PreparedImportedMedia {
        let avAsset = AVURLAsset(url: asset.sourceURL)
        guard let videoTrack = try await avAsset.loadTracks(withMediaType: .video).first else {
            throw ImportError.missingVideoTrack
        }

        let durationTime = try await avAsset.load(.duration)
        let duration = max(durationTime.seconds, 0)
        let naturalSize = try await videoTrack.load(.naturalSize)
        let preferredTransform = try await videoTrack.load(.preferredTransform)
        let nominalFrameRate = try await videoTrack.load(.nominalFrameRate)
        let formatDescriptions = try await videoTrack.load(.formatDescriptions)
        let audioTracks = try await avAsset.loadTracks(withMediaType: .audio)

        let transformedRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
        let width = Int(abs(transformedRect.width).rounded())
        let height = Int(abs(transformedRect.height).rounded())
        let frameRate = nominalFrameRate > 0 ? Double(nominalFrameRate) : 30
        let codec = fourCharacterCode(from: formatDescriptions.first)
        let attributes = try FileManager.default.attributesOfItem(atPath: asset.sourceURL.path)
        let fileSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        let modifiedDate = (attributes[.modificationDate] as? Date) ?? .now
        let sourceFile = OpenReelProject.SourceFile(
            name: asset.fileName,
            size: fileSize,
            lastModified: Int64(modifiedDate.timeIntervalSince1970 * 1000),
            folder: nil
        )

        let imageGenerator = AVAssetImageGenerator(asset: avAsset)
        imageGenerator.appliesPreferredTrackTransform = true
        imageGenerator.maximumSize = CGSize(width: 720, height: 720)
        imageGenerator.requestedTimeToleranceAfter = .zero
        imageGenerator.requestedTimeToleranceBefore = .zero

        let posterData = try await jpegData(from: imageGenerator, at: 0)
        let persisted = try await store.persistMedia(
            projectID: projectID,
            sourceURL: asset.sourceURL,
            preferredFileName: asset.fileName,
            thumbnailData: posterData,
            thumbnailFileName: UUID().uuidString + ".jpg"
        )

        let filmstrip = try await persistFilmstrip(
            imageGenerator: imageGenerator,
            duration: duration,
            projectID: projectID,
            store: store
        )

        let mediaItemID = UUID().uuidString
        let clipID = UUID().uuidString

        let mediaItem = OpenReelProject.MediaItem(
            id: mediaItemID,
            name: asset.fileName,
            type: .video,
            metadata: OpenReelProject.MediaMetadata(
                duration: duration,
                width: width,
                height: height,
                frameRate: frameRate,
                codec: codec,
                sampleRate: 48_000,
                channels: audioTracks.isEmpty ? 0 : 2,
                fileSize: fileSize,
                audioTrackCount: audioTracks.count
            ),
            thumbnailUrl: persisted.thumbnailRelativePath,
            waveformData: nil,
            filmstripThumbnails: filmstrip,
            isPlaceholder: false,
            originalUrl: nil,
            sourceFile: sourceFile,
            localFileName: persisted.mediaFileName,
            localAssetIdentifier: asset.assetIdentifier
        )

        let clip = OpenReelProject.Clip(
            id: clipID,
            mediaId: mediaItemID,
            trackId: trackID,
            startTime: startTime,
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
            audioTrackIndex: audioTracks.isEmpty ? nil : 0
        )

        return PreparedImportedMedia(mediaItem: mediaItem, clip: clip)
    }

    private func prepareImportedImage(
        _ asset: ImportedMediaAsset,
        projectID: String,
        trackID: String,
        startTime: Double,
        duration: Double,
        store: ProjectStore
    ) async throws -> PreparedImportedMedia {
        guard let imageData = try? Data(contentsOf: asset.sourceURL),
              let uiImage = UIImage(data: imageData) else {
            throw ImportError.missingImageData
        }

        let width = Int(uiImage.size.width * uiImage.scale)
        let height = Int(uiImage.size.height * uiImage.scale)
        let attributes = try FileManager.default.attributesOfItem(atPath: asset.sourceURL.path)
        let fileSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0

        guard let thumbnailData = uiImage.jpegData(compressionQuality: 0.82) else {
            throw ImportError.missingThumbnailData
        }

        let persisted = try await store.persistMedia(
            projectID: projectID,
            sourceURL: asset.sourceURL,
            preferredFileName: asset.fileName,
            thumbnailData: thumbnailData,
            thumbnailFileName: UUID().uuidString + ".jpg"
        )

        let mediaItemID = UUID().uuidString
        let clipID = UUID().uuidString

        let mediaItem = OpenReelProject.MediaItem(
            id: mediaItemID,
            name: asset.fileName,
            type: .image,
            metadata: OpenReelProject.MediaMetadata(
                duration: duration,
                width: width,
                height: height,
                frameRate: 0,
                codec: "jpeg",
                sampleRate: 0,
                channels: 0,
                fileSize: fileSize,
                audioTrackCount: 0
            ),
            thumbnailUrl: persisted.thumbnailRelativePath,
            waveformData: nil,
            filmstripThumbnails: [],
            isPlaceholder: false,
            originalUrl: nil,
            sourceFile: OpenReelProject.SourceFile(
                name: asset.fileName,
                size: fileSize,
                lastModified: Int64(Date().timeIntervalSince1970 * 1000),
                folder: nil
            ),
            localFileName: persisted.mediaFileName,
            localAssetIdentifier: asset.assetIdentifier
        )

        let clip = OpenReelProject.Clip(
            id: clipID,
            mediaId: mediaItemID,
            trackId: trackID,
            startTime: startTime,
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
            volume: 0,
            keyframes: [],
            speed: 1,
            reversed: false,
            audioTrackIndex: nil
        )

        return PreparedImportedMedia(mediaItem: mediaItem, clip: clip)
    }

    private func prepareImportedAudio(
        _ asset: ImportedMediaAsset,
        projectID: String,
        trackID: String,
        startTime: Double,
        store: ProjectStore
    ) async throws -> PreparedImportedMedia {
        let avAsset = AVURLAsset(url: asset.sourceURL)
        let durationTime = try await avAsset.load(.duration)
        let duration = max(durationTime.seconds, 0)
        let audioTracks = try await avAsset.loadTracks(withMediaType: .audio)
        let attributes = try FileManager.default.attributesOfItem(atPath: asset.sourceURL.path)
        let fileSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0

        let persisted = try await store.persistMedia(
            projectID: projectID,
            sourceURL: asset.sourceURL,
            preferredFileName: asset.fileName,
            thumbnailData: nil,
            thumbnailFileName: nil
        )

        let mediaItemID = UUID().uuidString
        let clipID = UUID().uuidString

        let mediaItem = OpenReelProject.MediaItem(
            id: mediaItemID,
            name: asset.fileName,
            type: .audio,
            metadata: OpenReelProject.MediaMetadata(
                duration: duration,
                width: 0,
                height: 0,
                frameRate: 0,
                codec: "aac",
                sampleRate: 44_100,
                channels: audioTracks.isEmpty ? 1 : 2,
                fileSize: fileSize,
                audioTrackCount: audioTracks.count
            ),
            thumbnailUrl: nil,
            waveformData: nil,
            filmstripThumbnails: [],
            isPlaceholder: false,
            originalUrl: nil,
            sourceFile: OpenReelProject.SourceFile(
                name: asset.fileName,
                size: fileSize,
                lastModified: Int64(Date().timeIntervalSince1970 * 1000),
                folder: nil
            ),
            localFileName: persisted.mediaFileName,
            localAssetIdentifier: asset.assetIdentifier
        )

        let clip = OpenReelProject.Clip(
            id: clipID,
            mediaId: mediaItemID,
            trackId: trackID,
            startTime: startTime,
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

        return PreparedImportedMedia(mediaItem: mediaItem, clip: clip)
    }

    private func persistFilmstrip(
        imageGenerator: AVAssetImageGenerator,
        duration: Double,
        projectID: String,
        store: ProjectStore
    ) async throws -> [OpenReelProject.FilmstripThumbnail] {
        guard duration > 0 else {
            return []
        }

        let frameCount = max(4, min(8, Int(duration.rounded(.up))))
        let step = duration / Double(frameCount)
        var thumbnails: [OpenReelProject.FilmstripThumbnail] = []

        for index in 0..<frameCount {
            let timestamp = min(Double(index) * step, max(duration - 0.05, 0))
            guard let data = try? await jpegData(from: imageGenerator, at: timestamp) else {
                continue
            }
            let relativePath = try await store.persistThumbnail(
                projectID: projectID,
                fileName: UUID().uuidString + ".jpg",
                data: data
            )
            thumbnails.append(OpenReelProject.FilmstripThumbnail(timestamp: timestamp, url: relativePath))
        }

        return thumbnails
    }

    private func jpegData(from imageGenerator: AVAssetImageGenerator, at time: Double) async throws -> Data {
        let cgImage = try await imageGenerator.image(at: CMTime(seconds: time, preferredTimescale: 600)).image
        guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.82) else {
            throw ImportError.missingThumbnailData
        }
        return data
    }

    private func fourCharacterCode(from formatDescription: Any?) -> String {
        guard let formatDescription else {
            return "unknown"
        }

        let cfFormatDescription = formatDescription as AnyObject
        guard CFGetTypeID(cfFormatDescription) == CMFormatDescriptionGetTypeID() else {
            return "unknown"
        }

        let mediaDescription = unsafeBitCast(cfFormatDescription, to: CMFormatDescription.self)
        let subtype = CMFormatDescriptionGetMediaSubType(mediaDescription)
        let bytes: [CChar] = [
            CChar((subtype >> 24) & 0xff),
            CChar((subtype >> 16) & 0xff),
            CChar((subtype >> 8) & 0xff),
            CChar(subtype & 0xff),
            0
        ]
        return String(cString: bytes)
            .trimmingCharacters(in: .controlCharacters)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct PreparedImportedMedia {
    var mediaItem: OpenReelProject.MediaItem
    var clip: OpenReelProject.Clip
}
