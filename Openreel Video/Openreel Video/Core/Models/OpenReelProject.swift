import Foundation

struct OpenReelProjectFile: Codable, Equatable {
    static let schemaVersion = "1.0.0"

    var version: String
    var project: OpenReelProject

    init(project: OpenReelProject, version: String = OpenReelProjectFile.schemaVersion) {
        self.version = version
        self.project = project
    }
}

struct OpenReelProject: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var createdAt: Int
    var modifiedAt: Int
    var settings: ProjectSettings
    var mediaLibrary: MediaLibrary
    var timeline: Timeline

    struct ProjectSettings: Codable, Equatable {
        var width: Int
        var height: Int
        var frameRate: Double
        var sampleRate: Int
        var channels: Int
    }

    struct MediaLibrary: Codable, Equatable {
        var items: [MediaItem]
    }

    struct MediaItem: Codable, Identifiable, Equatable {
        var id: String
        var name: String
        var type: MediaType
        var metadata: MediaMetadata
        var thumbnailUrl: String?
        var waveformData: [Float]?
        var filmstripThumbnails: [FilmstripThumbnail]?
        var isPlaceholder: Bool?
        var originalUrl: String?
        var sourceFile: SourceFile?
        var localFileName: String?
        var localAssetIdentifier: String?
    }

    struct FilmstripThumbnail: Codable, Equatable {
        var timestamp: Double
        var url: String
    }

    struct SourceFile: Codable, Equatable {
        var name: String
        var size: Int64
        var lastModified: Int64
        var folder: String?
    }

    enum MediaType: String, Codable, Equatable {
        case video
        case audio
        case image
    }

    struct MediaMetadata: Codable, Equatable {
        var duration: Double
        var width: Int
        var height: Int
        var frameRate: Double
        var codec: String
        var sampleRate: Int
        var channels: Int
        var fileSize: Int64
        var audioTrackCount: Int?
    }

    struct Timeline: Codable, Equatable {
        var tracks: [Track]
        var subtitles: [Subtitle]
        var duration: Double
        var markers: [Marker]
    }

    struct Track: Codable, Identifiable, Equatable {
        var id: String
        var type: TrackType
        var name: String
        var clips: [Clip]
        var transitions: [Transition]
        var locked: Bool
        var hidden: Bool
        var muted: Bool
        var solo: Bool
    }

    enum TrackType: String, Codable, Equatable {
        case video
        case audio
        case image
        case text
        case graphics
    }

    struct Clip: Codable, Identifiable, Equatable {
        var id: String
        var mediaId: String
        var trackId: String
        var startTime: Double
        var duration: Double
        var inPoint: Double
        var outPoint: Double
        var effects: [Effect]
        var audioEffects: [Effect]
        var transform: Transform
        var volume: Double
        var keyframes: [Keyframe]
        var speed: Double?
        var reversed: Bool?
        var audioTrackIndex: Int?
    }

    struct Effect: Codable, Identifiable, Equatable {
        var id: String
        var type: String
        var params: [String: JSONValue]
        var enabled: Bool
    }

    struct Transform: Codable, Equatable {
        var position: Point
        var scale: Point
        var rotation: Double
        var anchor: Point
        var opacity: Double
        var borderRadius: Double?
        var fitMode: FitMode?
        var crop: Crop?
    }

    struct Point: Codable, Equatable {
        var x: Double
        var y: Double
    }

    struct Crop: Codable, Equatable {
        var x: Double
        var y: Double
        var width: Double
        var height: Double
    }

    enum FitMode: String, Codable, Equatable {
        case contain
        case cover
        case stretch
        case none
    }

    struct Keyframe: Codable, Identifiable, Equatable {
        var id: String
        var time: Double
        var property: String
        var value: JSONValue
        var easing: String
    }

    struct Marker: Codable, Identifiable, Equatable {
        var id: String
        var time: Double
        var label: String
        var color: String
    }

    struct Transition: Codable, Identifiable, Equatable {
        var id: String
        var clipAId: String
        var clipBId: String
        var type: String
        var duration: Double
        var params: [String: JSONValue]
    }

    struct Subtitle: Codable, Identifiable, Equatable {
        var id: String
        var text: String
        var startTime: Double
        var endTime: Double
    }
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

struct NewProjectConfiguration: Equatable {
    struct Preset: Identifiable, Equatable {
        var id: String { name }
        var name: String
        var width: Int
        var height: Int
    }

    static let presets: [Preset] = [
        Preset(name: "1080p", width: 1920, height: 1080),
        Preset(name: "Square", width: 1080, height: 1080),
        Preset(name: "Portrait", width: 1080, height: 1920),
        Preset(name: "4K", width: 3840, height: 2160)
    ]

    static let supportedFrameRates: [Double] = [24, 30, 60]

    var name: String = "Project"
    var preset: Preset = Self.presets[0]
    var frameRate: Double = 30

    var settings: OpenReelProject.ProjectSettings {
        OpenReelProject.ProjectSettings(
            width: preset.width,
            height: preset.height,
            frameRate: frameRate,
            sampleRate: 48_000,
            channels: 2
        )
    }
}

extension OpenReelProject {
    static func blank(configuration: NewProjectConfiguration) -> Self {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let videoTrackID = UUID().uuidString
        let audioTrackID = UUID().uuidString

        return OpenReelProject(
            id: UUID().uuidString,
            name: configuration.name,
            createdAt: now,
            modifiedAt: now,
            settings: configuration.settings,
            mediaLibrary: MediaLibrary(items: []),
            timeline: Timeline(
                tracks: [
                    Track(
                        id: videoTrackID,
                        type: .video,
                        name: "Video 1",
                        clips: [],
                        transitions: [],
                        locked: false,
                        hidden: false,
                        muted: false,
                        solo: false
                    ),
                    Track(
                        id: audioTrackID,
                        type: .audio,
                        name: "Audio 1",
                        clips: [],
                        transitions: [],
                        locked: false,
                        hidden: false,
                        muted: false,
                        solo: false
                    )
                ],
                subtitles: [],
                duration: 0,
                markers: []
            )
        )
    }

    var sortedTracks: [Track] {
        timeline.tracks
    }

    var allClips: [Clip] {
        timeline.tracks
            .flatMap(\.clips)
            .sorted { $0.startTime < $1.startTime }
    }

    var primaryVisualTrack: Track? {
        timeline.tracks.first(where: { $0.type == .video || $0.type == .image })
    }

    var primaryAudioTrack: Track? {
        timeline.tracks.first(where: { $0.type == .audio })
    }
}