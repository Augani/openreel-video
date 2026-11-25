import type { FootageInterpretation } from "../media/interpretation";
import type { SpeakerProfile } from "../captions/diarization";
import type { FootageColorPreset, SourceColorSpace } from "../color/source-color";
import type { RawStillInfo } from "../raw/settings";
import type { ParticleEffect } from "../effects/particle-types";
import type { Timeline } from "./timeline";
import type { TextClip } from "../text/types";
import type { SavedStyleLibrary } from "../text/saved-styles";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";
import type { AdjustmentLayer } from "../video/adjustment-layer-engine";
import type { Mask } from "../video/mask-engine";
import type { EffectPreset } from "../video/effect-presets";
import type { DefaultTransition, TransitionPreset } from "../video/transition-presets";
import type { MultiCamGroup } from "../video/multicam-engine";
import type { MulticamSource } from "../multicam/source";
import type {
  CompoundClip,
  CompoundClipInstance,
} from "../timeline/nested-sequence-engine";
import type {
  MotionComposition,
  MotionCompositionInstance,
} from "../motion/types";
import type { MotionShaderDef } from "../motion/shaders/types";
import type { CreationProjectState } from "../creation";
import type { GraphicInstance } from "../graphic-templates/types";
import type { LinkedComposition } from "../linked-comps/types";

/**
 * Sequence working colour space. Rec.709 (the default and the only behaviour
 * before this setting existed) leaves export pixels untouched; Rec.2020 makes
 * the export convert to and tag BT.2020 primaries. See export/color-output.ts.
 */
export type WorkingColorSpace = "rec709" | "rec2020";

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly channels: number;
  /**
   * Sequence audio channel layout. Absent = stereo. "5.1" makes the mixdown,
   * stems and export six channels (L R C LFE Ls Rs) and `channels` is kept at 6
   * (see audio/surround.ts: `layoutSettingsPatch`).
   */
  readonly channelLayout?: import("../audio/surround").ChannelLayout;
  /** Absent = Rec.709. */
  readonly workingColorSpace?: WorkingColorSpace;
  /**
   * HDR sequence colour space (Rec.2100 PQ or HLG). Absent = Rec.709 / SDR. Only honoured together with
   * `workingColorSpace: "rec2020"`; see `color/sequence-color.ts`.
   */
  readonly sequenceColorSpace?: "rec2100pq" | "rec2100hlg";
  /**
   * Project colour management. Absent / "display-referred": the classic display-referred pipeline, unchanged.
   * "aces": footage goes through an ACES Input Transform (IDT) to ACEScg, grading runs in ACEScct, and the picture
   * leaves through the ACES Output Transform (RRT + ODT). See `color/aces.ts`.
   */
  readonly colorManagement?: import("../color/aces").ColorManagementMode;
  /** ACES mode only: the SDR Output Transform of the monitor and of SDR exports. Absent = sRGB. HDR exports pick the Rec.2020 PQ / HLG transforms. */
  readonly acesOutput?: import("../color/aces").AcesSdrOutput;
  /**
   * OCIO mode (`colorManagement: "ocio"`): the loaded config text, its LUT files and the working space, default input
   * space, display, view and looks chosen from it. See `color/ocio`.
   */
  readonly ocio?: import("../color/ocio/settings").OcioProjectSettings;
  /**
   * HDR working mode only: the luminance, in nits, that the white of 8-bit graphics (titles, shapes, stickers,
   * subtitles, motion graphics) is placed at. Absent = 203 nits, ITU-R BT.2408 graphics white. 80 to 1000.
   */
  readonly graphicsWhiteNits?: number;
  /**
   * Sequence start timecode, HH:MM:SS:FF (`;` before the frames for drop frame). Absent = 00:00:00:00.
   * Written into MOV / MXF exports by the desktop encoder and used as the record timecode base of timeline exports.
   */
  readonly startTimecode?: string;
  /** Sequence pixel aspect ratio (width / height of one output pixel). Absent = 1 (square). Frames are squeezed so the display shape is right.
   * Limitation: only video/image media layers are squeezed (text, shapes, graphics and effects are laid out in stored pixels), the Program
   * monitor is not stretched and exports carry no SAR flag, so use it for media-only sequences. */
  readonly pixelAspectRatio?: number;
  /** Sequence field order, used to pick which field a bob deinterlace keeps first. Absent = progressive. */
  readonly fieldOrder?: import("../media/interpretation").FieldOrder;
  /**
   * Immersive video (Premiere "VR Properties"): projection, frame layout and captured view of the sequence. Absent =
   * a flat sequence. An equirectangular sequence is exported with spherical metadata so players and YouTube treat it
   * as 360 (see export/spherical-export.ts).
   */
  readonly vr?: import("../vr/vr-properties").VrProperties;
}

/**
 * A named, independently editable timeline with its own canvas settings.
 * Markers live on `timeline.markers`. See `timeline/sequences.ts` for the
 * active-sequence invariant (project.timeline / project.settings ARE the active
 * sequence; the stored copy of the active entry is stale until flushed).
 */
export interface Sequence {
  readonly id: string;
  readonly name: string;
  readonly settings: ProjectSettings;
  readonly timeline: Timeline;
  readonly inPoint?: number;
  readonly outPoint?: number;
  readonly color?: string;
  /** Project-panel bin holding this sequence; absent = project root. */
  readonly binId?: string;
  /** For a nest created from timeline clips: inner track id to the parent track it came from (used by Flatten). */
  readonly sourceTrackIds?: Readonly<Record<string, string>>;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly mediaLibrary: MediaLibrary;
  readonly timeline: Timeline;
  readonly textClips?: TextClip[];
  /** Named text and caption styles (save once, apply to many). */
  readonly savedStyles?: SavedStyleLibrary;
  /** Caption speakers: colour and caption position per `Subtitle.speaker` name. */
  readonly speakers?: readonly SpeakerProfile[];
  readonly shapeClips?: ShapeClip[];
  readonly svgClips?: SVGClip[];
  readonly stickerClips?: StickerClip[];
  readonly adjustmentLayers?: AdjustmentLayer[];
  readonly masks?: Mask[];
  /** Saved effect presets (effects plus instance keyframes) reusable across clips. */
  readonly effectPresets?: EffectPreset[];
  /** Saved custom transition presets (type, duration, parameters) reusable on any cut. */
  readonly transitionPresets?: TransitionPreset[];
  /** What Apply Default Transition uses; absent means Cross dissolve. */
  readonly defaultTransition?: DefaultTransition;
  readonly particleEffects?: ParticleEffect[];
  readonly multicamGroups?: MultiCamGroup[];
  /**
   * Premiere-style multi-camera sources (synced angles). Optional: absent on
   * every project saved before multicam sources existed.
   */
  readonly multicamSources?: readonly MulticamSource[];
  /**
   * Derived render projection of every NON-active sequence (nest clips resolve
   * `compound:<sequenceId>` against it). Recomputed by `withNestProjection`;
   * never edit it directly on a project that has `sequences`.
   */
  readonly compoundClips?: CompoundClip[];
  /** All sequences, in project-panel order. Absent on pre-sequence projects. */
  readonly sequences?: readonly Sequence[];
  /** The sequence mirrored by `timeline` and `settings`. */
  readonly activeSequenceId?: string;
  /** Sequence tabs, in tab order. */
  readonly openSequenceIds?: readonly string[];
  readonly nestedInstances?: CompoundClipInstance[];
  readonly motionCompositions?: MotionComposition[];
  readonly motionInstances?: MotionCompositionInstance[];
  readonly generatedShaders?: readonly MotionShaderDef[];
  /**
   * Essential Graphics: templates placed on the timeline. Each instance owns a
   * set of ordinary text/shape/svg member clips (see graphic-templates/). Absent
   * on projects that never used a graphic template.
   */
  readonly graphicInstances?: readonly GraphicInstance[];
  /**
   * Live linked compositions (Dynamic Link style): master graphic templates whose
   * edits update every linked instance on the timeline. See linked-comps/.
   */
  readonly linkedCompositions?: readonly LinkedComposition[];
  readonly creation?: CreationProjectState;
  /**
   * Project-panel bins (nested folders). Absent on projects created before
   * bins existed: every media item then lives at the root.
   */
  readonly bins?: readonly MediaBin[];
  /**
   * Smart bins: saved Project-panel searches evaluated live against the media
   * library. Optional; absent on older projects.
   */
  readonly smartBins?: readonly SmartBin[];
  /** Feature capabilities required to edit this project without data loss. */
  readonly capabilities?: readonly string[];
  /** Oldest project reader version that can safely open this project. */
  readonly minimumReaderVersion?: string;
}

export interface MediaLibrary {
  readonly items: MediaItem[];
  /** Project default for what happens to newly imported video (see media/proxy-workflow). Absent = "none". */
  readonly ingestPreset?: IngestPreset;
  /** Desktop ingest settings (proxy profile, folders, concurrency). Absent = defaults. */
  readonly desktopIngest?: DesktopIngestConfig;
}

/** Codec of a desktop (native ffmpeg) proxy: ProRes 422 Proxy or DNxHR LB in .mov, or H.264 in .mp4. */
export type DesktopProxyCodec = "prores-proxy" | "prores-lt" | "prores-422" | "h264" | "dnxhr-lb" | "dnxhr-sq";
/**
 * Proxy frame size: the source size ("full"), half or quarter of it, a fixed height (never upscaled),
 * or a custom width in pixels (`DesktopProxyProfile.customWidth`, never upscaled, aspect kept).
 */
export type DesktopProxySize = "full" | "half" | "quarter" | "720p" | "1080p" | "custom";

/** Where a proxy is written: the project's Proxies folder, a "Proxies" folder next to the media, or a chosen folder. */
export type DesktopProxyDestinationMode = "project" | "media" | "custom";
export interface DesktopProxyDestination {
  readonly mode: DesktopProxyDestinationMode;
  /** Absolute folder for "custom". */
  readonly folder?: string;
}

export interface DesktopProxyProfile {
  readonly codec: DesktopProxyCodec;
  readonly size: DesktopProxySize;
  /** Output width in pixels for size "custom" (even, 16..16384). */
  readonly customWidth?: number;
  /** "strip" writes a proxy with no audio. Absent = keep. Frame rate is always kept. */
  readonly audio?: "keep" | "strip";
  /** Burn the clip name and/or the source timecode into the picture (a viewing copy, never for delivery). */
  readonly burnIn?: { readonly clipName?: boolean; readonly timecode?: boolean };
  /** Absent = the project's Proxies folder (or the project's folder override). */
  readonly destination?: DesktopProxyDestination;
}

/** Copy-ingest checksum: SHA-256 (default), MD5 or xxHash64. */
export type IngestChecksumAlgorithm = "sha256" | "md5" | "xxh64";

/** Per-project desktop ingest settings. Every field is optional. */
export interface DesktopIngestConfig {
  readonly proxyProfile?: DesktopProxyProfile;
  /** Proxies folder override; absent = a "Proxies" folder next to the project file. */
  readonly proxyFolder?: string;
  /** Media folder override for copy-to-project ingest; absent = a "Media" folder next to the project file. */
  readonly mediaFolder?: string;
  /** Background proxy jobs run at once (1 or 2). */
  readonly concurrency?: 1 | 2;
  /** With the "copy" ingest preset: also build proxies for the copied media. */
  readonly proxiesWithCopy?: boolean;
  /** Checksum used to verify a copy. Absent = SHA-256. */
  readonly checksum?: IngestChecksumAlgorithm;
  /** Id of the app-level preset the proxy profile was taken from (the profile itself is stored, so the project stays portable). */
  readonly proxyPresetId?: string;
}

/** What import does with new video: nothing, build proxies, or (desktop) copy the media into the project. */
export type IngestPreset = "none" | "proxies" | "copy";

/**
 * Where a proxy's bytes live. "idb" = the project's IndexedDB media store (key `proxy:<mediaId>`),
 * "path" = a file on disk (desktop / attached from a folder), "opfs" = an OPFS file name.
 */
export type MediaProxyStorage = "idb" | "path" | "opfs";

/**
 * Reference from a media item to its low-resolution proxy. Preview/scrub/playback may decode the
 * proxy; export and interchange always use the full-resolution item. Status here is the persisted
 * state (a proxy that cannot be found at load is reported as "missing" by the runtime, not stored).
 */
export interface MediaProxyRef {
  readonly storage: MediaProxyStorage;
  /** File path (path), OPFS name (opfs) or record key (idb). */
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly codec: string;
  readonly frameRate: number;
  readonly duration: number;
  readonly fileSize: number;
  readonly status: "ready" | "offline";
  /** Preset the proxy was built with; absent for proxies attached from existing files. */
  readonly preset?: "low" | "medium" | "high";
  /** Desktop proxy profile the file was built with (native ffmpeg proxies). */
  readonly profile?: DesktopProxyProfile;
  /**
   * Desktop only: a player-friendly H.264 twin of a ProRes proxy, used for preview when the
   * renderer cannot decode ProRes. `path` stays the ProRes file (interchange / external NLEs).
   */
  readonly previewPath?: string;
  readonly source: "generated" | "attached";
  readonly createdAt: number;
}

export interface MediaItem {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio" | "image";
  readonly fileHandle: FileSystemFileHandle | null;
  readonly blob: Blob | null;
  readonly metadata: MediaMetadata;
  readonly thumbnailUrl: string | null;
  readonly waveformData: Float32Array | null;
  /** Preferences > Default audio channels, stamped at import: clips of this file start with that channel format. Absent = use file. */
  readonly channelPreset?: import("../audio/channel-map").ChannelPreset;
  /**
   * Modify > Audio Channels on a project item: how the file's audio streams and channels group into audio clips
   * (one per source patch indicator A1..An). Absent = use file (see audio/source-channels.ts).
   */
  readonly channelLayout?: readonly import("../audio/source-channels").SourceChannelGroup[];
  readonly filmstripThumbnails?: FilmstripThumbnail[];
  readonly isPlaceholder?: boolean;
  readonly originalUrl?: string;
  /** File hint stored in JSON for cross-session/cross-machine asset matching */
  /**
   * Desktop: this file is decoded by the native (ffmpeg) path because WebCodecs cannot read its codec
   * (ProRes, DNxHD...). Saved with the project so a reopened project decodes it natively again; `path`
   * is where the file was, and relinking updates it. `width`/`height` are the upright (rotated) size.
   */
  readonly nativeSource?: {
    readonly path: string;
    readonly codec: string;
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
    /** Clockwise degrees from the file's rotation metadata (omitted when 0). */
    readonly rotation?: number;
  };
  readonly sourceFile?: { name: string; size: number; lastModified: number; folder?: string; /** Desktop: absolute path of the file on disk. */ path?: string };
  /** Desktop copy-to-project ingest: where the media was copied from (the original is never deleted). */
  readonly copiedFrom?: {
    path: string;
    /** SHA-256 of the verified copy; empty when a different algorithm was chosen (see `checksum`). */
    sha256: string;
    copiedAt: number;
    /** Digest and algorithm the copy was verified with (absent on copies made before MD5 / xxHash64 were offered). */
    checksum?: { algorithm: IngestChecksumAlgorithm; value: string };
  };
  /** True while a background KieAI generation task is in progress */
  readonly isPending?: boolean;
  /** True when polling exhausted all retries — shows manual retry button */
  readonly kieaiError?: boolean;
  /** KieAI task ID used to poll for completion */
  readonly kieaiTaskId?: string;
  /** Master-clip markers (Source monitor): `time` is source-media seconds; shown on every timeline instance. */
  readonly markers?: import("./timeline").Marker[];
  /** "Interpret footage": the user's override of the file's colour tags. Absent means as tagged. */
  readonly colorInterpretation?: FootageColorPreset;
  /** "Interpret footage": frame rate / pixel aspect ratio / field order overrides. Absent means as the file says. */
  readonly interpretation?: FootageInterpretation;
  /** Immersive video: the user's override of the file's VR properties (projection, layout, captured view). Absent means as the file says. */
  readonly vrProperties?: import("../vr/vr-properties").VrProperties;
  /** Pixel aspect the stored thumbnail/filmstrip frames were stretched for; absent = square (legacy). */
  readonly thumbnailPixelAspect?: number;
  /**
   * Camera RAW still (DNG decoded by OpenReel, or a proprietary RAW developed by the OS). `blob` is the
   * camera file; for OpenReel-developed items `raw.settings` drives the pixels in preview and export.
   */
  readonly raw?: RawStillInfo;
  /** Containing bin id; undefined means the project root. */
  readonly binId?: string;
  /** Project-panel label colour; clips placed from this media inherit it. */
  readonly label?: MediaLabelId;
  /** Free-text project-panel "Comment" column. */
  readonly comment?: string;
  /** Free-text project-panel "Description" column (also the log note). */
  readonly description?: string;
  /** Logging metadata: scene / shot / take (free text, e.g. "12A") and the good-take flag. */
  readonly scene?: string;
  readonly shot?: string;
  readonly take?: string;
  readonly goodTake?: boolean;
  /** XMP-style metadata (Dublin Core `dc:subject`, xmpDM `logComment` / `tapeName`); edited in the Metadata panel. */
  readonly keywords?: string[];
  readonly logComment?: string;
  /** Reel / tape name (xmpDM:tapeName). */
  readonly reel?: string;
  /** Where the logging metadata was last read from at import: embedded XMP or a sidecar `.xmp`. */
  readonly xmpSource?: "embedded" | "sidecar";
  /** Epoch ms the item entered the project. */
  readonly importedAt?: number;
  /**
   * Present on subclips: a bin item that references a window of another media
   * item. `metadata.duration` stays the full source duration (decoders,
   * waveforms and trim maths address the real file); the subclip window is
   * `inPoint`..`outPoint` in source time.
   */
  readonly subclip?: MediaSubclip;
  /** Optional proxy reference; preview-only, never used for export. */
  readonly proxy?: MediaProxyRef;
}

/** The label palette ids (Premiere-style). */
export type MediaLabelId =
  | "violet"
  | "iris"
  | "caribbean"
  | "lavender"
  | "cerulean"
  | "forest"
  | "rose"
  | "mango"
  | "purple"
  | "blue"
  | "teal"
  | "magenta"
  | "tan"
  | "green"
  | "brown"
  | "yellow";

/** A saved search. `column` limits matching to one column; "all" matches every metadata field. */
export interface SmartBin {
  readonly id: string;
  readonly name: string;
  readonly query: string;
  readonly column: string;
}

export interface MediaBin {
  readonly id: string;
  readonly name: string;
  /** Parent bin id; undefined means a top-level bin. */
  readonly parentId?: string;
  readonly label?: MediaLabelId;
}

export interface MediaSubclip {
  /** The (non-subclip) media item this window refers to. */
  readonly parentId: string;
  readonly inPoint: number;
  readonly outPoint: number;
  /** When true, trims on clips of this subclip cannot leave the window. */
  readonly restrictTrims: boolean;
}

/** Thumbnail for filmstrip display in timeline */
export interface FilmstripThumbnail {
  readonly timestamp: number;
  readonly url: string;
}

export interface MediaMetadata {
  /** Reusable credits remain attached to downloaded footage through save/export. */
  readonly stockSource?: StockMediaSource;
  /** Stable provenance for sound-library imports; independent of the file name. */
  readonly soundLibraryId?: string;
  /** Set when the file came straight from the in-app recorder; independent of the file name. */
  readonly recordedTake?: "screen" | "webcam" | "voiceover";
  readonly duration: number; // In seconds
  readonly width: number; // For video/image
  readonly height: number; // For video/image
  readonly frameRate: number; // For video
  readonly codec: string;
  readonly sampleRate: number; // For audio
  readonly channels: number; // For audio
  readonly fileSize: number;
  /** Number of audio tracks in the file (may be > 1 for multi-track video/audio files) */
  readonly audioTrackCount?: number;
  /** Channels of each audio stream, in stream order. Absent for projects saved before per-stream widths were read: every stream then has `channels`. */
  readonly audioStreamChannels?: readonly number[];
  /** Optional source-stream flags preserved by modern importers. */
  readonly hasVideo?: boolean;
  readonly hasAudio?: boolean;
  /** Embedded start timecode in seconds (a time of day), when the importer found one. Used for multicam timecode sync. */
  readonly startTimecode?: number;
  /** The same start timecode as text (HH:MM:SS:FF, `;` for drop frame) as read from the MXF / MOV file; shown in media info and the Inspector. */
  readonly startTimecodeText?: string;
  /** Colour space the file's container tags declare (primaries / transfer / matrix / range). Absent when untagged. */
  readonly sourceColor?: SourceColorSpace;
  /** Pixel (sample) aspect ratio the file reports (SAR, width / height of one pixel). Absent = square. */
  readonly pixelAspectRatio?: number;
  /** Field order the file reports. Absent = progressive. */
  readonly fieldOrder?: import("../media/interpretation").FieldOrder;
  /** Immersive video detected on import: spherical metadata in the file (`source: "metadata"`) or a 2:1 picture (`source: "aspect"`, only a hint). */
  readonly vr?: import("../vr/vr-properties").VrProperties;
}

export interface StockMediaSource {
  readonly provider: "wikimedia-commons";
  readonly id: string;
  readonly title: string;
  readonly creator: string;
  readonly pageUrl: string;
  readonly license: string;
  readonly licenseUrl?: string;
}
