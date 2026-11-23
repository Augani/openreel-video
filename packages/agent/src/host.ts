import type { Action, ActionResult } from "@openreel/core/types/actions";
import type { Project } from "@openreel/core/types/project";
import type { AudioIssueReport, RepairSuggestion } from "@openreel/core/audio/repair/repair-analysis";
import type { SequenceEditResult } from "@openreel/core/timeline/sequences";
import type { GraphicTemplate } from "@openreel/core/graphic-templates/types";
import type { LutLibraryEntry, SavedLook } from "@openreel/core/color/looks";
import type { TransitionType } from "@openreel/core/types/effects";
import type { TransitionPreset } from "@openreel/core/video/transition-presets";
import type { TimelineToolPlan } from "@openreel/core/editing/timeline-tool-edit";
import type { CapabilityManifest } from "@openreel/core/capabilities/manifest";
import type {
  MulticamActivityMap,
  MulticamManifest,
  MulticamShotPolicy,
  MulticamTranscriptSegment,
} from "@openreel/core";

export type JobKind =
  | "exportVideo"
  | "exportAudio"
  | "exportFrame"
  | "exportImageSequence"
  | "exportGif";

export interface JobResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
  /** Stable error code when the failure has one (e.g. OUTSIDE_ALLOWED_ROOTS, UNSUPPORTED). */
  readonly code?: string;
  /** What to do next. */
  readonly hint?: string;
}

export interface TxnHandle {
  readonly id: string;
}

export interface ProjectRef {
  readonly id: string;
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly modifiedAt?: number;
  /** Desktop: absolute path of the project file (recent files on disk). Open it with open_project_file. */
  readonly path?: string;
}

export interface ImportedMediaRef {
  readonly mediaId: string;
  readonly name: string;
  readonly type: string;
  readonly durationSec: number;
  readonly width?: number;
  readonly height?: number;
}

/** Stable error codes of the local-file tools (import_media_from_path, open_project_file, ...). */
export type HostFileErrorCode =
  | "NO_PROJECT"
  | "NO_WINDOW"
  | "NOT_FOUND"
  | "OUTSIDE_ALLOWED_ROOTS"
  | "UNSUPPORTED_TYPE"
  | "UNREADABLE"
  | "UNSUPPORTED"
  | "INVALID_PARAMS";

/** Thrown by hosts for a local-file failure; tools turn it into a ToolResult with the same code and a hint. */
export class HostFileError extends Error {
  constructor(
    readonly code: HostFileErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "HostFileError";
  }
}

export interface FileAccessEntry {
  readonly path: string;
  readonly realPath: string;
  readonly kind: "file" | "directory";
  readonly sizeBytes: number;
  /** Write mode: false when the target is not on disk yet. */
  readonly exists?: boolean;
}

export interface FileAccessRejection {
  readonly path: string;
  readonly code: HostFileErrorCode;
  readonly message: string;
}

export interface FileAccessResolveResult {
  readonly resolved: readonly FileAccessEntry[];
  readonly rejected: readonly FileAccessRejection[];
}

/**
 * Local file access for the path tools. The allowed-roots check (symlinks resolved, traversal
 * rejected) runs where the file access happens (the desktop main process); hosts without it leave
 * this undefined and the tools answer UNSUPPORTED.
 */
export interface LocalFileAccess {
  resolve(
    paths: readonly string[],
    options?: { recursive?: boolean; mode?: "read" | "write" },
  ): Promise<FileAccessResolveResult>;
  /** Read a path that `resolve` returned. */
  readBytes(realPath: string): Promise<Uint8Array>;
}

export type ImportedFileKind = "video" | "audio" | "image" | "raw";

export interface ImportedFileRef {
  readonly mediaId: string;
  readonly path: string;
  readonly name: string;
  readonly kind: ImportedFileKind;
  readonly durationSec: number;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly codec?: string;
}

export interface ImportMediaFromPathOptions {
  readonly paths: readonly string[];
  readonly recursive?: boolean;
  /** Desktop: also copy the imported media into the project's Media folder (checksum verified). */
  readonly copyToProject?: boolean;
  /** none | proxies | copy for THIS import; the project's own preset is not changed. */
  readonly ingestPreset?: string;
  readonly createProxies?: boolean;
  /** Bin id or name to file the imported items in. */
  readonly bin?: string;
}

export interface ImportMediaFromPathResult {
  readonly imported: readonly ImportedFileRef[];
  readonly skipped: ReadonlyArray<{ path: string; code: HostFileErrorCode; message: string }>;
  /** Non-fatal follow-up problems (e.g. a copy-to-project or proxy request that did not run). */
  readonly warnings?: readonly string[];
}

export interface ProjectFileRef extends ProjectRef {
  /** Absolute path of the project file that was opened / written. */
  readonly path: string;
  readonly sizeBytes?: number;
}

/** How a font used by the project travels when the project is packaged. */
export type ProjectFontEmbedStatus =
  | "embedded"
  | "embedded-readonly"
  | "restricted"
  | "unknown-license"
  | "web"
  | "bundled"
  | "system";

export interface ProjectFontEntry {
  readonly family: string;
  readonly usages: readonly string[];
  readonly status: ProjectFontEmbedStatus;
  /** OS/2 fsType of a user font whose file could be read. */
  readonly fsType?: number | null;
  /** Stylesheet URL recorded for a web (catalog) font. */
  readonly url?: string;
  readonly note: string;
}

export interface ProjectFontReport {
  readonly fonts: readonly ProjectFontEntry[];
}

export interface AppStateSnapshot {
  readonly appVersion: string;
  readonly platform: string;
  readonly route: string;
  readonly windows: { editor: boolean; count: number };
  readonly projectOpen: boolean;
  readonly projectId: string | null;
  readonly onboarding: { status: string; path: string | null; skippedBy: string | null };
  readonly ai: { configured: boolean; provider: string | null };
  readonly mcp: { toolCount: number; autoAllow: boolean; allowedRoots: string[]; protocolVersion: string };
}

/** One container with what it can carry on this machine (get_export_options). */
export interface ExportFormatOption {
  readonly id: string;
  readonly container: string;
  readonly codecs: readonly string[];
  readonly bitDepths: ReadonlyArray<8 | 10>;
  readonly hdr: ReadonlyArray<"sdr" | "pq" | "hlg">;
  readonly available: boolean;
  readonly reason?: string;
  /** What each codec allows (a codec may be 8-bit SDR only while another carries 10-bit HDR). */
  readonly codecOptions?: ReadonlyArray<{
    readonly codec: string;
    readonly bitDepths: ReadonlyArray<8 | 10>;
    readonly hdr: ReadonlyArray<"sdr" | "pq" | "hlg">;
  }>;
  /** Codecs the container has in principle but this machine cannot encode, with the reason. */
  readonly unavailableCodecs?: ReadonlyArray<{ readonly codec: string; readonly reason: string }>;
}

export interface ExportPresetOption {
  readonly id: string;
  readonly label: string;
  readonly kind: "video" | "audio";
  readonly description?: string;
  readonly format?: string;
  readonly codec?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly bitrateKbps?: number;
}

export interface ExportOptionsCatalog {
  readonly platform: "desktop" | "web";
  /** True when the project's working colour space is Rec.2020: output is colour-managed even for SDR, so two-pass VBR is unavailable. */
  readonly colorManaged?: boolean;
  readonly formats: readonly ExportFormatOption[];
  readonly presets: readonly ExportPresetOption[];
  readonly resolutions: ReadonlyArray<{ label: string; width: number; height: number }>;
  readonly frameRates: readonly number[];
  readonly audioLayouts: ReadonlyArray<"mono" | "stereo" | "5.1">;
  readonly hdr: { readonly supported: boolean; readonly reason?: string };
  readonly timecode: { readonly supported: boolean; readonly reason?: string };
}

export type RiggingBackendMode = "configured" | "bundled" | "system";

export interface RiggingBackendProbe {
  readonly available: boolean;
  readonly provider: "blender";
  readonly mode?: RiggingBackendMode;
  readonly path?: string;
  readonly version?: string;
  readonly error?: string;
}

interface ModelInspectionVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ModelInspectionBounds {
  readonly min: ModelInspectionVec3;
  readonly max: ModelInspectionVec3;
  readonly size: ModelInspectionVec3;
  readonly center: ModelInspectionVec3;
}

export interface ModelInspectionMesh {
  readonly name: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly skinned: boolean;
  readonly materialNames: readonly string[];
}

export interface ModelInspectionTexture {
  readonly name: string;
  readonly slot: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ModelInspectionMaterial {
  readonly name: string;
  readonly type: string;
  readonly color?: string;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly textureSlots: readonly string[];
}

export interface ModelInspectionAnimation {
  readonly name: string;
  readonly duration: number;
  readonly trackCount: number;
  readonly targetCount: number;
  readonly tracks: readonly string[];
}

export interface ModelInspectionArmature {
  readonly hasSkinnedMesh: boolean;
  readonly skinnedMeshCount: number;
  readonly boneCount: number;
  readonly rootBones: readonly string[];
  readonly sampleBones: readonly string[];
}

export interface ModelInspectionWarning {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface ModelInspectionReport {
  readonly modelUrl: string;
  readonly name?: string;
  readonly source?: string;
  readonly meshCount: number;
  readonly materialCount: number;
  readonly textureCount: number;
  readonly animationCount: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly bounds?: ModelInspectionBounds;
  readonly meshes: readonly ModelInspectionMesh[];
  readonly materials: readonly ModelInspectionMaterial[];
  readonly textures: readonly ModelInspectionTexture[];
  readonly animations: readonly ModelInspectionAnimation[];
  readonly armature: ModelInspectionArmature;
  readonly warnings: readonly ModelInspectionWarning[];
  readonly suggestedNextTools: readonly string[];
}

export interface ModelInspectionRequest {
  readonly modelUrl: string;
  readonly name?: string;
  readonly source?: string;
}

export interface HumanoidRigRequest {
  readonly modelUrl: string;
  readonly outputPath?: string;
  readonly name?: string;
  readonly heightMeters?: number;
  readonly overwriteExisting?: boolean;
}

export interface HumanoidRigResult {
  readonly ok: boolean;
  readonly provider: "blender";
  readonly inputUrl: string;
  readonly outputUrl?: string;
  readonly outputPath?: string;
  readonly armatureName?: string;
  readonly createdArmature: boolean;
  readonly preservedExistingArmature: boolean;
  readonly skinnedMeshCount: number;
  readonly meshCount: number;
  readonly boneCount: number;
  readonly warnings: readonly ModelInspectionWarning[];
  readonly error?: string;
}

export interface MulticamHostBridge {
  getManifest(groupId?: string): Promise<{ groupId: string; manifest: MulticamManifest }>;
  getActivityMap(
    groupId?: string,
    range?: { startMs?: number; endMs?: number },
  ): Promise<{ groupId: string; activity: MulticamActivityMap; sampled: boolean }>;
  getTranscript(
    groupId?: string,
    range?: { startMs?: number; endMs?: number },
  ): Promise<{ groupId: string; transcripts: Record<string, MulticamTranscriptSegment[]> }>;
  setEditPolicy(
    groupId: string,
    policy: Partial<MulticamShotPolicy>,
  ): Promise<Record<string, unknown>>;
  annotateSegment(input: {
    groupId: string;
    startMs: number;
    endMs: number;
    note: string;
  }): Promise<Record<string, unknown>>;
  getEditSummary(groupId?: string): Promise<Record<string, unknown>>;
  overrideCut(input: {
    groupId: string;
    switchId: string;
    operation: "accept" | "reject" | "nudge" | "set-camera";
    deltaMs?: number;
    cameraId?: string;
  }): Promise<Record<string, unknown>>;
  previewFrame(groupId: string, timeMs: number): Promise<JobResult>;
}

export interface SceneAnalysisCut {
  /** Source-media time of the first frame of the new scene (seconds). */
  readonly sourceTime: number;
  /** Where that cut lands on the timeline for the clip as it is now (seconds). */
  readonly timelineTime: number;
  /** Frame-distance score in [0, 1]. */
  readonly score: number;
}

export interface SceneAnalysisSummary {
  readonly analysisId: string;
  readonly clipId: string;
  readonly cuts: readonly SceneAnalysisCut[];
}

export interface SceneApplySummary {
  readonly splits: number;
  readonly markers: number;
  readonly droppedCuts: number;
  readonly skippedLockedLinked: number;
}

/** Scene edit detection. Needs frame decoding, so only the live host has it. */
export interface SceneDetectionBridge {
  analyse(input: {
    clipId: string;
    sensitivity: number;
    minSceneLength: number;
  }): Promise<SceneAnalysisSummary>;
  apply(input: {
    analysisId: string;
    splitClip: boolean;
    addMarkers: boolean;
  }): Promise<SceneApplySummary>;
}

export type ScopeKindName =
  | "waveform"
  | "parade"
  | "yc"
  | "vectorscope"
  | "hls"
  | "histogram";
export type ScopeScaleName = "ire" | "pq" | "hlg";

export interface ScopeFrame {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ScopesState {
  readonly visible: boolean;
  readonly kind: ScopeKindName;
  /** Waveform level axis: IRE percent, or nits for PQ / HLG footage. */
  readonly scale?: ScopeScaleName;
  /** False-colour exposure overlay on the Program monitor. */
  readonly falseColor?: boolean;
}

/** The Scopes panel and the program frame it reads. Live host only. */
export interface ScopesBridge {
  getState(): ScopesState;
  setVisible(visible: boolean, kind?: ScopeKindName): ScopesState;
  /** Waveform level scale and the Program monitor false-colour overlay (preview only). */
  setView?(patch: { scale?: ScopeScaleName; falseColor?: boolean }): ScopesState;
  /** The current program frame, optionally after seeking to `timeSec`. */
  captureFrame(options?: { timeSec?: number }): Promise<ScopeFrame | null>;
}

export type ComparisonModeName = "off" | "side" | "split-v" | "split-h";
export type ComparisonReferenceName = "bypass" | "still" | "playhead";

export interface ComparisonSnapshot {
  readonly mode: ComparisonModeName;
  readonly reference: ComparisonReferenceName;
  readonly split: number;
  readonly stillId: string | null;
  readonly refTime: number | null;
  readonly stills: ReadonlyArray<{ id: string; label: string; time: number }>;
}

export interface GrabbedStill {
  readonly stillId: string;
  readonly label: string;
  readonly time: number;
  readonly width: number;
  readonly height: number;
}

/** Program monitor comparison view and stills (preview only). Live host only. */
export interface ColorMonitorBridge {
  getComparison(): ComparisonSnapshot;
  setComparison(patch: {
    mode?: ComparisonModeName;
    reference?: ComparisonReferenceName;
    split?: number;
    stillId?: string;
    refTime?: number;
  }): ComparisonSnapshot;
  /** Grab the graded Program frame (at `time`, default the playhead) as a still. */
  grabStill(options: { time?: number; label?: string }): Promise<GrabbedStill | null>;
}

/** A BS.1770-4 / EBU R128 measurement, JSON-safe (silence is `null`). */
export interface LoudnessMeasurement {
  readonly integratedLufs: number | null;
  readonly loudnessRangeLu: number;
  readonly truePeakDbtp: number | null;
  readonly samplePeakDbfs: number | null;
  readonly momentaryMaxLufs: number | null;
  readonly shortTermMaxLufs: number | null;
  readonly durationSec: number;
  readonly sampleRate: number;
  readonly channels: number;
}

/** Offline loudness measurement through the editor's mixdown renderer. Live host only. */
export interface LoudnessBridge {
  /** The whole timeline mix (or a range), rendered as an export would. */
  measureTimeline(range?: { startTime: number; endTime: number }): Promise<LoudnessMeasurement>;
  /** One clip in isolation, as it currently sounds. `clipId` is the audible clip measured. */
  measureClip(clipId: string): Promise<LoudnessMeasurement & { clipId: string }>;
  /** One bus's stem (its post-fader output) rendered offline and measured. */
  measureBus?(busId: string): Promise<LoudnessMeasurement & { busId: string }>;
}

/** One exported bus stem (a WAV file). */
export interface StemExportFile {
  readonly busId: string;
  readonly name: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationSec: number;
}

/** Bus stem export through the editor's offline mixdown. Live host only. */
export interface StemExportBridge {
  /** Renders the stems and hands every WAV to the user (downloads / disk). */
  exportStems(options: { busIds?: string[]; bitDepth?: 16 | 24 }): Promise<StemExportFile[]>;
}

/** Clip audio analysis (hum, clipping, clicks, sibilance). Live host only. */
export interface AudioRepairBridge {
  analyze(clipId: string): Promise<{ report: AudioIssueReport; suggestions: RepairSuggestion[] }>;
}

/** The decoded source audio of a clip (source time), for the spectral analysis tools. Live host only. */
export interface SpectralSourceBridge {
  /** Mono mix of the clip's media (all of it, not just the trimmed part) at its decoded sample rate. */
  getSource(clipId: string): Promise<{ mono: Float32Array; sampleRate: number; duration: number }>;
}

/** The Source monitor: per-media In/Out marks and the loaded clip. Live host only. */
export interface SourceMonitorBridge {
  open(mediaId: string, time?: number): void;
  /** The loaded clip and its Source playhead (seconds), if any. */
  getState?(): { mediaId: string | null; position: number };
  getMarks(mediaId: string): { in?: number; out?: number };
  setMarks(mediaId: string, marks: { in?: number | null; out?: number | null }): void;
}

/** Editor-side track targeting and source patch state. Live host only. */
export interface TargetingState {
  /** Tracks whose target toggle (V1/A1 style) is on. */
  readonly targetedTrackIds: readonly string[];
  /** Which track each Source monitor component is patched to. */
  readonly sourcePatch: { readonly video?: string; readonly audio?: string };
  /** Multichannel source patch: the track patched to each audio channel group beyond A1 (0-based channel index). */
  readonly channelPatches?: Readonly<Record<number, string>>;
  /** Audio channel groups whose patch indicator is switched off (0-based). */
  readonly disabledChannels?: readonly number[];
}

export interface TargetingBridge {
  getState(): TargetingState;
  setTrackTargeted(trackId: string, targeted: boolean): void;
  setSourcePatch(kind: "video" | "audio", trackId: string | null): void;
  /** Patches audio channel group `channel` (0 = A1) to a track, or clears it. */
  setChannelPatch?(channel: number, trackId: string | null): void;
  setChannelEnabled?(channel: number, enabled: boolean): void;
}

/**
 * Sequence edits through the editor's own command path, so switching the active
 * sequence parks the In/Out range and playhead exactly like a tab click. Live host only.
 */
export interface SequenceCommandBridge {
  commit(label: string, build: (project: Project) => SequenceEditResult): Promise<SequenceEditResult>;
}

/**
 * Audio-waveform sync for multicam angles. The live editor decodes each
 * angle's audio and cross-correlates it; hosts without media decoding omit it
 * and `create_multicam` then needs explicit offsets.
 */
export interface MulticamSyncBridge {
  /** Offsets (shared-time seconds of each media's time 0) relative to the first media, plus 0..1 confidence. */
  measureAudioOffsets(mediaIds: readonly string[]): Promise<{ offsets: number[]; confidence: number[] }>;
}

/** The user's saved Essential Graphics templates ("My templates"). Built-ins are not included. */
export interface GraphicTemplateLibrary {
  list(): readonly GraphicTemplate[];
  save(template: GraphicTemplate): void;
}

/**
 * The user's colour library: imported LUTs and saved looks, kept per user (not
 * per project) so they are reusable across projects. Live host only; headless
 * hosts keep a library for the session.
 */
/** The app-wide transition preset library; live host only (headless hosts have no per-user storage). */
export interface TransitionLibraryBridge {
  list(): Promise<readonly TransitionPreset[]>;
  save(name: string, source: { type: TransitionType; duration: number; params: Record<string, unknown> }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  exportJson(): Promise<string>;
  importJson(text: string): Promise<{ ok: true; added: number; skipped: number } | { ok: false; error: string }>;
}

export interface ColorLibraryBridge {
  listLooks(): Promise<readonly SavedLook[]>;
  saveLook(look: SavedLook): Promise<void>;
  deleteLook(id: string): Promise<boolean>;
  listLuts(): Promise<readonly LutLibraryEntry[]>;
  saveLut(entry: LutLibraryEntry): Promise<void>;
  deleteLut(id: string): Promise<boolean>;
  /** Hand a .cube file to the user (a download in the editor). Absent where nothing can write files. */
  exportCube?(filename: string, text: string): Promise<void>;
}

/** Computes a timeline plan against the host's authoritative project. */
export type TimelinePlanBuilder = (project: Project) => TimelineToolPlan;

export interface CreateProjectOptions {
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
}

export type ExportMotionSceneFormat = "mp4" | "webm-alpha" | "mov-prores4444";

export interface ExportMotionSceneOptions {
  readonly compositionId: string;
  readonly format?: ExportMotionSceneFormat;
  readonly filename?: string;
  readonly acknowledgeH264Fallback?: boolean;
}

export interface ExportMotionSceneResult {
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly framesRendered: number;
  readonly requestedFormat: ExportMotionSceneFormat;
  readonly encodedFormat: ExportMotionSceneFormat;
  readonly normalizedToH264: boolean;
  readonly note?: string;
}

/**
 * The single seam the tool layer executes through. Implemented by the live
 * renderer (LiveEditorHost) and by a headless Node host (HeadlessHost), so the
 * same registry, executor, and loop drive any environment.
 */
export interface EditingHost {
  /** The authoritative, serializable project. */
  getProject(): Project;
  /** Dispatch an action through the action system; records undo. */
  applyAction(action: Action): Promise<ActionResult>;
  /** Open an undoable transaction so a whole agent turn reverts as one unit. */
  beginTransaction(label?: string): TxnHandle;
  commitTransaction(handle: TxnHandle, label: string): void | Promise<void>;
  rollbackTransaction(handle: TxnHandle): Promise<void>;
  /** Long-running GPU/analysis/export jobs. */
  runJob(kind: JobKind, params: Record<string, unknown>): Promise<JobResult>;
  /** Machine-readable enums + parameter ranges for the agent. */
  capabilities(): CapabilityManifest;
  /** Narrow multicam planning/review surface shared with local MCP clients. */
  multicam?: MulticamHostBridge;
  /** Scene edit detection (analyse + apply); live host only. */
  sceneDetection?: SceneDetectionBridge;
  /** Scopes panel + program-frame capture for colour QA; live host only. */
  scopes?: ScopesBridge;
  /** Comparison view + stills for colour QA; live host only. */
  colorMonitor?: ColorMonitorBridge;
  /** Loudness measurement (BS.1770-4); live host only. */
  loudness?: LoudnessBridge;
  /** Bus stem export (WAV per bus); live host only. */
  stems?: StemExportBridge;
  /** Dialogue issue detection for the repair tools; live host only. */
  audioRepair?: AudioRepairBridge;
  /** Decoded clip source for finding tones and clicks to heal; live host only. */
  spectralSource?: SpectralSourceBridge;
  /**
   * Build and commit a trim/insert/lift/extract plan as exactly one undo step.
   * Hosts that own derived caches (the live editor) implement it so those stay
   * in sync; others fall back to the `timeline/toolEdit` action.
   */
  commitTimelinePlan?(build: TimelinePlanBuilder): Promise<ActionResult & { plan?: TimelineToolPlan }>;
  /**
   * Linked clip ids (separated audio/video streams) that must be edited with
   * `clipIds`, honouring the editor's linked-selection setting. Includes the
   * given ids; live host only. Headless hosts leave it undefined (no links).
   */
  resolveLinkedClipIds?(project: Project, clipIds: readonly string[]): string[];
  /** Source monitor (open clip, In/Out marks); live host only. */
  sourceMonitor?: SourceMonitorBridge;
  /** Track targeting toggles and source patch; live host only. */
  targeting?: TargetingBridge;
  /** Sequence commands that behave like the UI (In/Out and playhead parking); live host only. */
  sequenceCommands?: SequenceCommandBridge;
  /** Audio sync for `create_multicam`; live host only. */
  multicamSync?: MulticamSyncBridge;
  /** Saved Essential Graphics templates; live host only (headless hosts keep them for the session). */
  graphicTemplates?: GraphicTemplateLibrary;
  /** Per-user LUT library and saved looks; live host only (headless hosts keep them for the session). */
  colorLibrary?: ColorLibraryBridge;
  /** App-wide transition presets; live host only. */
  transitionLibrary?: TransitionLibraryBridge;
  /** Select a media item in the library (what Match Frame does in the UI); live host only. */
  selectLibraryMedia?(mediaId: string): void;
  /** Throws when no project is open (guard for mutating tools). */
  requireOpenProject(): void;

  /**
   * Project lifecycle + media ingest. Optional because they require a real
   * editor environment (Zustand store, IndexedDB, a main-process URL fetcher)
   * that only the live/desktop host provides. Tools must feature-detect these
   * and fail clearly when undefined (e.g. on the headless cloud host).
   */
  createProject?(options: CreateProjectOptions): Promise<ProjectRef>;
  openProject?(id: string): Promise<ProjectRef>;
  listProjects?(): Promise<readonly ProjectRef[]>;
  saveProject?(): Promise<ProjectRef>;
  importMediaFromUrl?(url: string, options?: { name?: string }): Promise<ImportedMediaRef>;
  /** Import local files / folders by absolute path (desktop). Throws HostFileError. */
  importMediaFromPath?(options: ImportMediaFromPathOptions): Promise<ImportMediaFromPathResult>;
  /** Open a project file (.oreel / .openreel / .json) by path and make it active. Throws HostFileError. */
  openProjectFile?(path: string): Promise<ProjectFileRef>;
  /** Write the active project to `path` and make it the save target. Throws HostFileError. */
  saveProjectAs?(path: string, options: { overwrite: boolean }): Promise<ProjectFileRef>;
  /** Allowed-roots-checked file access (desktop). */
  files?: LocalFileAccess;
  /** Fonts used by text clips, motion text layers and captions with their package-embed status. */
  getProjectFonts?(): Promise<ProjectFontReport>;
  /** Snapshot of app-level state for get_app_state (needs the live renderer). */
  getAppState?(): Promise<AppStateSnapshot>;
  /** Dismiss first-run onboarding; idempotent. */
  dismissOnboarding?(): Promise<{ status: string; changed: boolean }>;
  /** Formats, codecs, presets and limits this machine can export (get_export_options). */
  exportOptions?(): Promise<ExportOptionsCatalog>;
  /**
   * Render a motion composition to a finished video file (mp4 / transparent
   * WebM / ProRes 4444 MOV). Optional because it needs the renderer-side motion
   * export pipeline that only the live/desktop web host provides — headless
   * hosts leave it undefined and the export tool fails clearly. On web the ProRes
   * and alpha formats normalize to H.264; the implementation enforces the
   * acknowledge-fallback guardrail and reports the format actually encoded.
   */
  exportMotionScene?(
    options: ExportMotionSceneOptions,
  ): Promise<ExportMotionSceneResult>;
  /**
   * Motion render queue bridge (add/run/list/cancel). Optional because it needs
   * the live editor's motion store + renderer-side export pipeline that only the
   * live/desktop web host provides — headless hosts leave it undefined and the
   * queue tools fail clearly.
   */
  motionRenderQueue?: MotionRenderQueueBridge;
  /** Render In to Out cache bridge (live editor only). */
  renderCache?: RenderCacheBridge;
  /** Export queue bridge (live editor only). */
  exportQueue?: ExportQueueBridge;
  /** Proxy / ingest workflow (live editor only). */
  proxies?: ProxyBridge;
  /** Motion tracking (live editor only). */
  motionTracking?: MotionTrackBridge;
  /** Desktop-only DCC backend discovery for character rigging/retarget jobs. */
  probeRiggingBackend?(): Promise<RiggingBackendProbe>;
  /** Inspect a GLB/glTF model so agents can choose animation, rigging, and cleanup tools. */
  inspectModel?(options: ModelInspectionRequest): Promise<ModelInspectionReport>;
  /** Run a desktop rigging backend job to create or repair a humanoid GLB rig. */
  rigHumanoidModel?(options: HumanoidRigRequest): Promise<HumanoidRigResult>;
  /**
   * Create a text overlay through the engine-aware store path so it actually
   * registers with the TitleEngine the preview + timeline read from. The raw
   * text/create action only appends to project.textClips and never reaches the
   * engine, so it renders nothing — this method is the live host's fix.
   */
  createTextOverlay?(options: TextOverlayOptions): Promise<OverlayRef>;
  /**
   * Create a graphic (shape) overlay through the engine-aware store path so it
   * registers with the GraphicsEngine the preview reads from — the raw
   * shape/create action only appends to project.shapeClips and renders nothing.
   */
  createShapeOverlay?(options: ShapeOverlayOptions): Promise<OverlayRef>;
  /**
   * Edit/remove overlays through the engine-aware store path. The raw
   * text/update, text/remove, shape/*, sticker/*, svg/* actions only mutate the
   * serialized project arrays and never reach the Title/Graphics engines the
   * preview + export read from, so they appear to succeed but render stale.
   * These methods are the live host's fix for that whole class of bug.
   */
  updateTextOverlay?(id: string, options: UpdateTextOverlayOptions): Promise<OverlayRef>;
  updateShapeOverlay?(id: string, options: UpdateShapeOverlayOptions): Promise<OverlayRef>;
  createStickerOverlay?(options: StickerOverlayOptions): Promise<OverlayRef>;
  updateStickerOverlay?(id: string, options: UpdateStickerOverlayOptions): Promise<OverlayRef>;
  createSvgOverlay?(options: SvgOverlayOptions): Promise<OverlayRef>;
  updateSvgOverlay?(id: string, updates: Record<string, unknown>): Promise<OverlayRef>;
  removeOverlay?(kind: OverlayKind, id: string): Promise<boolean>;
}

export type MotionRenderQueueAddFormat =
  | "mp4"
  | "webm-alpha"
  | "mov-prores4444"
  | "png-sequence";

export interface MotionRenderQueueAddInput {
  readonly compositionId: string;
  readonly format?: MotionRenderQueueAddFormat;
  readonly range?: { readonly startTime: number; readonly endTime: number };
  readonly resolutionScale?: number;
  readonly filename?: string;
}

export interface MotionRenderQueueAddResult {
  readonly itemId: string;
}

export interface MotionRenderQueueAddError {
  readonly error: string;
}

export interface MotionRenderQueueRunOutcome {
  readonly itemId: string;
  readonly status: string;
  readonly encodedFormat?: string;
  readonly filename?: string;
  readonly error?: string;
}

export interface MotionRenderQueueRunResult {
  readonly outcomes: ReadonlyArray<MotionRenderQueueRunOutcome>;
  readonly alreadyRunning: boolean;
}

export interface MotionRenderQueueBridge {
  add(
    input: MotionRenderQueueAddInput,
  ): MotionRenderQueueAddResult | MotionRenderQueueAddError;
  run(): Promise<MotionRenderQueueRunResult>;
  list(): ReadonlyArray<Record<string, unknown>>;
  cancel(itemId: string): boolean;
}

export interface RenderCacheRunResult {
  readonly status: "completed" | "canceled" | "failed";
  readonly framesRendered: number;
  readonly framesSkipped: number;
  readonly totalFrames: number;
  readonly elapsedMs: number;
  readonly codec: string;
  readonly message?: string;
}

export interface RenderCacheStatus {
  readonly rendering: boolean;
  readonly frameCount: number;
  readonly bytes: number;
  readonly budgetBytes: number;
  /** Cached stretches in seconds. */
  readonly cachedRanges: ReadonlyArray<{ start: number; end: number }>;
  /** The render-status bar: green = cached, yellow = needs render, red = likely not real time. */
  readonly segments: ReadonlyArray<{
    start: number;
    end: number;
    level: "cached" | "light" | "heavy";
    reasons: readonly string[];
  }>;
}

/**
 * Premiere-style preview render cache ("Render In to Out"). Optional because
 * it needs the live editor's compositor and browser storage; headless hosts
 * leave it undefined and the render-cache tools fail clearly.
 */
export interface RenderCacheBridge {
  renderInToOut(options?: { rangeStart?: number; rangeEnd?: number; effectsOnly?: boolean }): Promise<RenderCacheRunResult>;
  deleteRenderFiles(): Promise<{ removedFrames: number }>;
  getStatus(): RenderCacheStatus;
}

export type ExportQueueJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ExportQueueJobInfo {
  readonly id: string;
  readonly outputName: string;
  readonly sequenceName: string;
  readonly presetLabel: string;
  readonly status: ExportQueueJobStatus;
  /** 0..1 */
  readonly progress: number;
  readonly elapsedMs: number;
  readonly etaMs?: number;
  readonly range?: { readonly startTime: number; readonly endTime: number };
  readonly usePreviews: boolean;
  readonly framesFromCache?: number;
  /** "Smart render: 62% copied" once a finished job's untouched H.264 runs were stream-copied. */
  readonly smartRender?: {
    readonly copiedPercent: number;
    readonly summary: string;
    readonly engine?: "webcodecs" | "native";
    readonly copiedFrames?: number;
    readonly totalFrames?: number;
    readonly copiedRuns?: number;
    /** Seconds of the audio track copied from the sources vs rendered and encoded (desktop native path). */
    readonly audioCopiedSeconds?: number;
    readonly audioEncodedSeconds?: number;
    readonly reasons?: readonly string[];
  };
  readonly error?: string;
  /** Disk path (desktop) of the finished file. */
  readonly outputPath?: string;
  readonly outputBytes?: number;
  /** SHA-256 of the finished file when it was delivered to a requested outputPath. */
  readonly sha256?: string;
  /** 'stems' for a stems job (outputName is a zip of WAVs); absent for a video export. */
  readonly kind?: "video" | "stems";
  /** Per-WAV listing of a finished stems job. */
  readonly stems?: readonly StemExportFile[];
}

export interface QueueStemsRequest {
  readonly busIds?: string[];
  readonly bitDepth?: 16 | 24;
  readonly filename?: string;
  readonly start?: boolean;
}

export interface QueueExportRequest {
  /** Preset id from get_export_options (quick presets mp4 | 4k | 1080p-high | 1080p-60, and platform presets). */
  readonly preset?: string;
  readonly format?: "mp4" | "webm" | "mov" | "mxf";
  readonly codec?: "h264" | "h265" | "vp8" | "vp9" | "av1" | "prores" | "dnxhr" | "xdcamhd422" | "avcintra100";
  readonly bitDepth?: 8 | 10;
  readonly hdr?: "sdr" | "pq" | "hlg";
  readonly maxBitrateKbps?: number;
  readonly rateControl?: "quality" | "vbr" | "vbr2";
  readonly audioChannels?: "mono" | "stereo" | "5.1";
  /** Write the sequence start timecode into the file (MOV / MXF). */
  readonly timecode?: boolean;
  readonly targetLufs?: number;
  readonly truePeakCeilingDb?: number;
  /** Absolute destination inside the allowed roots; the app's own output when omitted. */
  readonly outputPath?: string;
  readonly overwrite?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  /** kbps */
  readonly bitrate?: number;
  readonly rangeStart?: number;
  readonly rangeEnd?: number;
  readonly usePreviews?: boolean;
  /** Stream-copy untouched H.264 runs of the sources instead of re-encoding them (default true). */
  readonly smartRender?: boolean;
  readonly filename?: string;
  /** Sequence id to render (default: the active sequence). */
  readonly sequenceId?: string;
  /** Start the queue after adding (default true). */
  readonly start?: boolean;
  /**
   * Per caption track: burn into the picture (default true) and/or embed as a subtitle
   * track ("subtitle" = WebVTT in browser MP4 / tx3g on desktop; "cea608" = c608 in desktop MOV).
   */
  readonly captions?: ReadonlyArray<{
    readonly captionTrackId: string;
    readonly burnIn?: boolean;
    readonly embedded?: "none" | "subtitle" | "cea608";
  }>;
}

/**
 * Export queue (live editor only). Jobs snapshot the project when queued, so
 * later edits never change them.
 */
export interface ExportQueueBridge {
  enqueue(request: QueueExportRequest): Promise<ExportQueueJobInfo>;
  /** Queue a stems job (selected buses as WAVs, zipped). */
  enqueueStems?(request: QueueStemsRequest): Promise<ExportQueueJobInfo>;
  list(): readonly ExportQueueJobInfo[];
  cancel(jobId: string): { found: boolean; status?: ExportQueueJobStatus };
}

export type ProxyItemState = "none" | "ready" | "building" | "failed" | "missing-proxy" | "missing-full";

export interface ProxyStatusItem {
  readonly mediaId: string;
  readonly name: string;
  readonly state: ProxyItemState;
  readonly proxyWidth?: number;
  readonly proxyHeight?: number;
  readonly progress?: number;
  /** Desktop: the proxy file is on disk but preview cannot decode it (ProRes without a preview twin). */
  readonly external?: boolean;
}

/** Desktop-only ingest: native ffmpeg proxies, copy-to-project and relink by folder search. */
export interface DesktopIngestBridge {
  /** Re-queue every failed native proxy job (and rebuild failed items that have no job left). */
  retryFailed(): Promise<{ retried: number }>;
  copyToProject(mediaIds: readonly string[] | undefined): Promise<{
    copied: Array<{ mediaId: string; name: string; path: string; /** SHA-256 of the copy; empty when another algorithm verified it. */ sha256: string; /** Verification algorithm and digest (sha256, md5 or xxh64). */ algorithm?: string; checksum?: string }>;
    skipped: Array<{ name: string; reason: string }>;
  }>;
  /** Search `folder` (recursively) for offline media ("full") or missing proxies ("proxy"); match by name + duration + frame rate. */
  relink(kind: "full" | "proxy", folder: string): Promise<{
    linked: Array<{ mediaId: string; name: string; path: string }>;
    ambiguous: Array<{ name: string; candidates: string[] }>;
    notFound: string[];
    failed: Array<{ name: string; reason: string }>;
  }>;
  folders(): Promise<{ proxyDir: string; mediaDir: string; projectSaved: boolean } | null>;
}

/** Proxy builds, attach and Toggle Proxies. Proxies are preview-only; export reads full resolution. */
export interface ProxyBridge {
  create(
    mediaIds: readonly string[] | undefined,
    quality: "low" | "medium" | "high",
    force: boolean,
  ): { queued: string[]; skipped: Array<{ id: string; reason: string }> };
  /** Link proxy media already in the library to their originals (pairs, or by name when omitted). */
  attach(pairs: ReadonlyArray<{ mediaId: string; proxyMediaId: string }> | undefined): Promise<{
    attached: Array<{ mediaId: string; name: string }>;
    skipped: Array<{ name: string; reason: string }>;
  }>;
  toggle(on?: boolean): { on: boolean };
  status(): { on: boolean; ingestPreset: string; items: ProxyStatusItem[]; counts?: { ready: number; building: number; missing: number; failed: number; none: number } };
  /** Present on the desktop app only. */
  desktop?: DesktopIngestBridge;
}

export interface MotionTrackRequest {
  /** Source clip to follow. */
  readonly clipId: string;
  /** Target region in SOURCE pixels at `anchorFrame` (default: the central half of the frame). */
  readonly region?: { x: number; y: number; width: number; height: number };
  /** Clip-local frame (project fps) where the region is defined. Omit to track the whole clip from frame 0. */
  readonly anchorFrame?: number;
  readonly direction?: "forward" | "backward";
  readonly algorithm?: "correlation" | "optical-flow" | "feature";
  readonly confidenceThreshold?: number;
  /** Keep the frames outside the tracked range of an existing path (partial re-track). */
  readonly merge?: boolean;
}

export interface MotionTrackSummary {
  readonly clipId: string;
  readonly frameRate: number;
  readonly frames: number;
  readonly firstFrame: number;
  readonly lastFrame: number;
  readonly lostFrames: number;
  /** Runs of hidden / weak frames, [start, end] inclusive, so an agent can re-track or correct them. */
  readonly lowConfidence: ReadonlyArray<{ start: number; end: number; kind: "lost" | "weak" }>;
  readonly manualFrames: readonly number[];
  readonly framesPerSecond?: number;
  readonly start: { frame: number; x: number; y: number };
  readonly end: { frame: number; x: number; y: number };
}

export interface MotionTrackAttachRequest {
  readonly clipId: string;
  /** Clip or overlay (text, shape, sticker, svg) that should follow the track. */
  readonly targetId: string;
  readonly offset?: { x: number; y: number };
  readonly applyScale?: boolean;
  readonly applyRotation?: boolean;
  readonly smoothing?: number;
  readonly mode?: "follow" | "pin";
}

/** Motion tracking in the live editor: decoded frames, a worker tracker and the undoable attach edit. */
export interface MotionTrackBridge {
  track(request: MotionTrackRequest): Promise<MotionTrackSummary>;
  attach(request: MotionTrackAttachRequest): Promise<{ keyframes: number }>;
  correct(clipId: string, frame: number, position: { x: number; y: number }): Promise<MotionTrackSummary>;
  summary(clipId: string): MotionTrackSummary | null;
}

export type OverlayKind = "text" | "shape" | "sticker" | "svg";

export interface UpdateTextOverlayOptions {
  readonly text?: string;
  readonly style?: Record<string, unknown>;
  readonly transform?: Record<string, unknown>;
  readonly animation?: string;
  readonly animationInSec?: number;
  readonly animationOutSec?: number;
}

export interface UpdateShapeOverlayOptions {
  readonly color?: string;
  readonly opacity?: number;
  readonly style?: Record<string, unknown>;
  readonly transform?: Record<string, unknown>;
  readonly fullFrame?: boolean;
}

export interface StickerOverlayOptions {
  readonly emoji?: string;
  readonly imageUrl?: string;
  readonly name?: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
}

export interface UpdateStickerOverlayOptions {
  readonly transform?: Record<string, unknown>;
}

export interface SvgOverlayOptions {
  readonly svg: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
}

export interface TextOverlayOptions {
  readonly text: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
  readonly style?: Record<string, unknown>;
  /** Entrance/exit animation preset (e.g. "fade", "scale", "slide-up", "pop"). */
  readonly animation?: string;
  readonly animationInSec?: number;
  readonly animationOutSec?: number;
}

export interface ShapeOverlayOptions {
  readonly shapeType?: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
  readonly color?: string;
  readonly opacity?: number;
  /** Scale the shape to cover the whole canvas (e.g. a full-frame scrim). */
  readonly fullFrame?: boolean;
  /** SVG path data for shapeType "path"; wins over `points`. */
  readonly pathData?: string;
  /** Vertices (normalized 0..1) for polygon/path shapes. */
  readonly points?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly closed?: boolean;
}

export interface OverlayRef {
  readonly id: string;
  readonly trackId: string;
}

export type JobRunner = (
  kind: JobKind,
  params: Record<string, unknown>,
) => Promise<JobResult>;
