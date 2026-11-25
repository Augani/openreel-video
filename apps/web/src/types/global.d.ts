export {};

interface OpenReelHardwareInfo {
  cpu: { model: string; physicalCores: number; logicalCores: number };
  memory: { totalBytes: number; freeBytes: number };
  gpus: string[];
  encoders: string[];
  platform: "darwin" | "win32" | "linux";
  arch: string;
}

interface OpenReelExportStartArgs {
  /** One video-only segment of a parallel export: the main process supplies everything else from its session. */
  segment?: { sessionId: string; index: number };
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  format: string;
  bitrateKbps: number;
  maxBitrateKbps?: number;
  rateControl?: "quality" | "vbr" | "vbr2";
  outputPath: string;
  totalFrames: number;
  audioSampleRate: number;
  audioChannels: number;
  encodeMode?: "fast" | "balanced" | "smallest";
  encoderChoice?: "auto" | "hardware" | "software";
  quality?: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  dnxhrProfile?: "lb" | "sq" | "hq" | "hqx" | "444";
  /** Broadcast delivery (XDCAM HD422 / AVC-Intra 100 codecs "xdcamhd422" / "avcintra100"): top-field-first interlaced frames. */
  scan?: "progressive" | "interlaced-tff";
  /** MXF wrapper; "opatom" writes one file per essence track. */
  mxfPattern?: "op1a" | "opatom";
  /** The audio is this many mono tracks (one channel each in the WAV). */
  audioTrackCount?: number;
  /** File start timecode, HH:MM:SS:FF (`;` for drop frame). */
  startTimecode?: string;
  /** VR sequence in MP4 / MOV: spherical metadata (st3d / sv3d) to write into the finished file. */
  vr?: { layout: "mono" | "over-under" | "side-by-side"; horizontalFov: number; verticalFov: number; initialView?: { yaw: number; pitch: number; roll: number } };
  /** ProRes 4444: the frames carry real alpha (export over a transparent background). */
  alpha?: boolean;
  /** Frames are planar 8-bit 4:2:0 (I420, BT.709 limited range) converted on the GPU instead of RGBA (plain H.264 / H.265 only). */
  rawYuv420?: boolean;
  keyframeInterval?: number;
  audioBitrateKbps?: number;
  /** Audio codec of the file: "ac3" (Dolby Digital) or "eac3" (Dolby Digital Plus); absent = AAC / Opus / PCM by container. */
  audioCodec?: "ac3" | "eac3";
  /** AC-3 / E-AC-3 dialogue normalisation in dB, -31 to -1. */
  dialnorm?: number;
  /**
   * Colour-managed export: frames are raw planar YCbCr already converted to this output space (not RGBA);
   * the sidecar tags the stream and writes 10-bit HEVC / ProRes 4444 for HDR.
   */
  color?: {
    primaries: "bt709" | "bt2020";
    transfer: "bt709" | "pq" | "hlg";
    bitDepth: 8 | 10;
    chroma: "420" | "444";
  };
  /** Subtitle tracks muxed into the file: SRT text for mov_text, SCC text for a c608 track (MOV only). */
  captions?: Array<{ kind: "mov_text" | "cea608"; data: string; language?: string }>;
  /** ffmpeg `;FFMETADATA1` chapters text (MP4 / MOV). */
  chaptersMetadata?: string;
  /** Native smart render: re-encoded runs must reproduce `match` to join the stream-copied ones. */
  smartRender?: {
    match: {
      codec: "avc" | "hevc" | "prores";
      /** ProRes: the profile of the copied sources, used for the re-encoded runs too. */
      proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
      profile?: number;
      level?: number;
      color?: { matrix?: string | null; transfer?: string | null; primaries?: string | null };
      frameRate: number;
    };
  };
}

interface OpenReelExportSession {
  jobId: string;
  /** The pipe of this job carries I420 (a parallel segment worker learns the session's choice here). */
  rawYuv420?: boolean;
}

interface OpenReelAuroraRenderPreviewArgs {
  scene: unknown;
  assets: unknown[];
  width: number;
  height: number;
  background?: string;
  timeSeconds?: number;
  quality?: "preview" | "final";
}

interface OpenReelAuroraPreviewSessionStartArgs
  extends OpenReelAuroraRenderPreviewArgs {
  sessionId?: string;
}

interface OpenReelAuroraPreviewSessionStartResult {
  sessionId: string;
}

interface OpenReelAuroraSequenceSessionStartArgs
  extends Omit<OpenReelAuroraRenderPreviewArgs, "timeSeconds"> {
  sessionId?: string;
  frameRate: number;
  durationSeconds: number;
}

interface OpenReelAuroraSequenceSessionStartResult {
  sessionId: string;
}

interface OpenReelAuroraRenderPreviewResult {
  backend: "native" | "cpu";
  pngBase64: string;
  dataUri: string;
  width: number;
  height: number;
  coveredPixels: number;
  shadowedPixels: number;
  renderMs: number;
}

type OpenReelAuroraPreviewSessionEvent =
  | {
      kind: "update";
      sessionId: string;
      stage: "draft" | "refine" | "final";
      progress: number;
      done: boolean;
      targetWidth: number;
      targetHeight: number;
      result: OpenReelAuroraRenderPreviewResult;
    }
  | {
      kind: "error";
      sessionId: string;
      done: true;
      error: string;
    };

type OpenReelAuroraSequenceSessionEvent =
  | {
      kind: "frame";
      sessionId: string;
      frameIndex: number;
      totalFrames: number;
      timeSeconds: number;
      progress: number;
      done: boolean;
      result: {
        backend: "native" | "cpu";
        rgba: Uint8Array;
        width: number;
        height: number;
        coveredPixels: number;
        shadowedPixels: number;
        renderMs: number;
      };
    }
  | {
      kind: "error";
      sessionId: string;
      done: true;
      error: string;
    };

export interface OpenReelMcpStatus {
  running: boolean;
  url: string;
  port: number;
  token: string;
  shimPath: string;
  endpointFile: string;
}

export type OpenReelOnboardingStatus = "unseen" | "in-progress" | "done" | "skipped";
export interface OpenReelOnboardingMirror {
  v: 1;
  status: OpenReelOnboardingStatus;
  skippedBy?: "user" | "agent" | "automation" | "format";
  persona?: "pro" | "ai" | "learn" | "agent";
  path?: "ai" | "learn";
  completedAt?: number;
}
export interface OpenReelOllamaProbeResult {
  reachable: boolean;
  models: { name: string; sizeBytes?: number }[];
  error?: string;
}
export interface OpenReelSampleClipInfo {
  id: string;
  name: string;
  kind: "video" | "audio";
  durationSec: number;
  width?: number;
  height?: number;
  sizeBytes: number;
  mimeType: string;
  license: string;
}
export interface OpenReelSampleClipData {
  id: string;
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
}
export interface OpenReelPickFilesArgs {
  title?: string;
  kinds?: Array<"video" | "audio" | "image">;
  multiple?: boolean;
}
export interface OpenReelPickFilesResult {
  canceled: boolean;
  paths: string[];
}
export interface OpenReelMcpClientStatus {
  connected: boolean;
  clients: { name: string; version?: string; connectedAt: number; lastSeenAt: number }[];
  initializeCount: number;
  startError: string | null;
}
export interface OpenReelMcpPolicy {
  allowedRoots: string[];
  defaultRoots: string[];
}
/** Mirrors D/shared/onboarding.ts (mcpFilesResolve*). Keep in sync. */
export type OpenReelMcpFileErrorCode =
  | "NO_PROJECT"
  | "NO_WINDOW"
  | "NOT_FOUND"
  | "OUTSIDE_ALLOWED_ROOTS"
  | "UNSUPPORTED_TYPE"
  | "UNREADABLE"
  | "UNSUPPORTED"
  | "INVALID_PARAMS";
export interface OpenReelMcpAppInfo {
  appVersion: string;
  platform: string;
  windowCount: number;
  editorWindow: boolean;
  protocolVersion: string;
}
export interface OpenReelMcpFilesResolveArgs {
  paths: string[];
  recursive?: boolean;
  mode?: "read" | "write";
}
export interface OpenReelMcpFilesResolveResult {
  resolved: { path: string; realPath: string; kind: "file" | "directory"; sizeBytes: number; exists?: boolean }[];
  rejected: { path: string; code: OpenReelMcpFileErrorCode; message: string }[];
}
export interface OpenReelMcpPlaceOutputArgs {
  from: string;
  /** Omit to only measure `from` (size and SHA-256). */
  to?: string;
  overwrite?: boolean;
  move?: boolean;
}
export type OpenReelMcpPlaceOutputResult =
  | { ok: true; path: string; sizeBytes: number; sha256: string }
  | { ok: false; code: OpenReelMcpFileErrorCode; message: string };

export interface OpenReelNativeSourceProbe {
  path: string;
  codec: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  /** Clockwise degrees from rotation metadata; width/height are already upright. */
  rotation?: number;
  frameCount: number;
  /** ffmpeg's demuxer (`mxf`, `mov,mp4,m4a,3gp,3g2,mj2`). */
  container?: string;
  /** Audio streams in file order; MXF holds one mono PCM stream per channel. */
  audioStreams?: Array<{ codec: string; channels: number; sampleRate: number }>;
  interlaced?: boolean;
  fieldOrder?: "upper" | "lower";
  /** Non-square sample aspect ratio the stream reports. */
  pixelAspectRatio?: number;
  /** Embedded start timecode (MOV / MXF), HH:MM:SS:FF; `;` before the frames for drop frame. */
  startTimecode?: string;
  /** ffmpeg's colour tags for the stream (bt2020nc, smpte2084...); absent fields are untagged. */
  color?: { range?: string; matrix?: string; primaries?: string; transfer?: string };
}
export interface OpenReelNativeFrame {
  width: number;
  height: number;
  frameIndex: number;
  timestamp: number;
  duration: number;
  /** 8-bit RGBA, or little-endian 16-bit RGBA when `bitDepth` is 16. */
  rgba: Uint8Array;
  bitDepth?: 8 | 16;
}
export interface OpenReelNativeDecodeStats {
  cacheHits: number;
  cacheMisses: number;
  streamsStarted: number;
  streamsLive: number;
  framesDecoded: number;
  fullQualityFrames: number;
  cacheBytes: number;
  cacheFrames: number;
}
interface OpenReelRiggingBackendProbe {
  available: boolean;
  provider: "blender";
  mode?: "configured" | "bundled" | "system";
  path?: string;
  version?: string;
  error?: string;
}

interface OpenReelRiggingWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

interface OpenReelRigHumanoidModelArgs {
  modelUrl: string;
  outputPath?: string;
  name?: string;
  heightMeters?: number;
  overwriteExisting?: boolean;
}

interface OpenReelRigHumanoidModelResult {
  ok: boolean;
  provider: "blender";
  inputUrl: string;
  outputUrl?: string;
  outputPath?: string;
  armatureName?: string;
  createdArmature: boolean;
  preservedExistingArmature: boolean;
  skinnedMeshCount: number;
  meshCount: number;
  boneCount: number;
  warnings: OpenReelRiggingWarning[];
  error?: string;
}

export type OpenReelUpdaterStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "none" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export interface OpenReelIngestFolders {
  projectDir: string;
  proxyDir: string;
  mediaDir: string;
  projectSaved: boolean;
}

type OpenReelProxyProfile = import("@openreel/core").DesktopProxyProfile;

export interface OpenReelCopyJobResult {
  destPath: string;
  size: number;
  checksum: { algorithm: "sha256" | "md5" | "xxh64"; value: string };
  reused: boolean;
}

export interface OpenReelProxyJob {
  id: string;
  /** "proxy" when absent. */
  kind?: "proxy" | "copy";
  projectKey: string;
  mediaId: string;
  name?: string;
  srcPath: string;
  outDir: string;
  fileName: string;
  profile: OpenReelProxyProfile;
  previewTwin: boolean;
  copy?: { algorithm: "sha256" | "md5" | "xxh64"; followUp?: unknown };
  copyResult?: OpenReelCopyJobResult;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  error?: string;
  result?: {
    outPath: string;
    previewPath?: string;
    width: number;
    height: number;
    duration: number;
    frameRate: number;
    codec: string;
    fileSize: number;
  };
  attempts: number;
}

export type OpenReelProxyEvent =
  | { type: "update"; job: OpenReelProxyJob }
  | { type: "removed"; id: string; projectKey: string };

export interface OpenReelIngestProject {
  projectId: string;
  projectPath?: string | null;
  config?: {
    proxyProfile?: OpenReelProxyProfile;
    proxyFolder?: string;
    mediaFolder?: string;
    concurrency?: 1 | 2;
    proxiesWithCopy?: boolean;
    checksum?: "sha256" | "md5" | "xxh64";
    proxyPresetId?: string;
  } | null;
}

export type OpenReelCardKind = "sony-xavc" | "sony-xdcam" | "canon-xf" | "panasonic-p2" | "avchd" | "gopro";
export interface OpenReelBrowserClip {
  id: string;
  name: string;
  kind: OpenReelCardKind;
  spanned: boolean;
  segments: Array<{ path: string; name: string; size: number; audioPaths?: string[] }>;
  proxyPath?: string;
  sidecars: string[];
}
export interface OpenReelBrowserEntry {
  id: string;
  kind: "dir" | "file" | "clip";
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  mediaType?: "video" | "audio" | "image";
  clip?: OpenReelBrowserClip;
}
export interface OpenReelBrowserListing {
  path: string;
  parent: string | null;
  card?: { kinds: Array<{ kind: OpenReelCardKind; label: string }> };
  entries: OpenReelBrowserEntry[];
  error?: string;
}
export interface OpenReelBrowserClipRef {
  name: string;
  kind: string;
  segments: Array<{ path: string; audioPaths?: string[] }>;
}
export interface OpenReelXmpFields {
  title?: string;
  description?: string;
  creator?: string;
  rights?: string;
  keywords?: string[];
  scene?: string;
  shot?: string;
  take?: string;
  good?: boolean;
  logComment?: string;
  reel?: string;
}
/** Desktop Media Browser: local and mounted volumes, camera cards as clips, previews, joined clips, XMP. */
export interface OpenReelMediaBrowserBridge {
  places(): Promise<Array<{ name: string; path: string; kind: "volume" | "place" }>>;
  list(args: { path: string; rawFolders?: boolean }): Promise<OpenReelBrowserListing>;
  thumbnail(args: { path: string; time?: number; width?: number }): Promise<string | null>;
  filmstrip(args: { clip: OpenReelBrowserClipRef; count?: number; width?: number }): Promise<{ duration: number; frames: Array<string | null> }>;
  probeClip(args: { clip: OpenReelBrowserClipRef }): Promise<{ duration: number; segmentDurations: number[]; width?: number; height?: number; frameRate?: number; videoCodec?: string }>;
  preview(args: { clip: OpenReelBrowserClipRef }): Promise<{ data: ArrayBuffer; duration: number; truncated: boolean }>;
  prepareImport(args: { clip: OpenReelBrowserClipRef }): Promise<{ path: string; name: string; duration: number; joined: boolean }>;
  readXmp(path: string): Promise<{ fields: OpenReelXmpFields; source: "embedded" | "sidecar"; sidecarPath?: string } | null>;
  writeSidecar(args: { path: string; fields: OpenReelXmpFields }): Promise<{ path: string }>;
}

export interface OpenReelIngestBridge {
  resolveFolders(args: OpenReelIngestProject): Promise<OpenReelIngestFolders>;
  enqueueProxies(
    args: OpenReelIngestProject & {
      items: Array<{
        mediaId: string;
        name: string;
        srcPath: string;
        profile: OpenReelProxyProfile;
        previewTwin: boolean;
      }>;
      force?: boolean;
    },
  ): Promise<OpenReelProxyJob[]>;
  /** Queue verified copies into the project's Media folder as background jobs (optionally followed by proxies). */
  enqueueCopies(
    args: OpenReelIngestProject & {
      items: Array<{ mediaId: string; name: string; srcPath: string }>;
      algorithm?: "sha256" | "md5" | "xxh64";
      thenProxies?: { profile: OpenReelProxyProfile; previewTwin: boolean };
    },
  ): Promise<OpenReelProxyJob[]>;
  listProxyJobs(projectId: string): Promise<OpenReelProxyJob[]>;
  cancelProxyJobs(ids: string[]): Promise<void>;
  retryFailedProxyJobs(projectId: string): Promise<OpenReelProxyJob[]>;
  ackProxyJobs(ids: string[]): Promise<void>;
  setProxyConcurrency(concurrency: number): Promise<void>;
  onProxyEvent(cb: (event: OpenReelProxyEvent) => void): () => void;
  stat(paths: string[]): Promise<Record<string, { exists: boolean; size: number }>>;
  readProxy(path: string): Promise<ArrayBuffer>;
  copyToProject(
    args: OpenReelIngestProject & { requestId: string; srcPath: string },
  ): Promise<{ destPath: string; sha256: string; checksum: { algorithm: "sha256" | "md5" | "xxh64"; value: string }; size: number; alreadyInPlace: boolean }>;
  onCopyProgress(cb: (event: { requestId: string; progress: number }) => void): () => void;
  pickFolder(args?: { title?: string; defaultPath?: string }): Promise<string | null>;
  scanFolder(args: {
    root: string;
    names: string[];
    mode: "media" | "proxy";
    /** Proxy name pattern with one {name}, for example {name}_proxy. */
    proxyPattern?: string;
  }): Promise<{
    candidates: Array<{ path: string; name: string; size?: number; duration?: number; frameRate?: number; width?: number; height?: number }>;
    visited: number;
    truncated: boolean;
  }>;
}

/** Mirrors apps/desktop/src/shared/watch-folders.ts (the web package cannot import apps/desktop). */
export interface OpenReelWatchFolderConfig {
  id: string;
  kind: "ingest" | "export";
  path: string;
  paused: boolean;
  bin: string;
  createProxies: boolean;
  presetId: string;
  outputDir: string;
  includeProjects: boolean;
  baselined: boolean;
  processExisting: boolean;
}
export type OpenReelWatchItemState = "detecting" | "queued" | "waiting" | "running" | "done" | "failed" | "duplicate" | "cancelled";
export interface OpenReelWatchItem {
  id: string;
  folderId: string;
  name: string;
  path: string;
  state: OpenReelWatchItemState;
  progress: number | null;
  detail?: string;
  error?: string;
  outputPath?: string;
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
}
export interface OpenReelWatchFolderStatus {
  state: "watching" | "paused" | "missing" | "error";
  message?: string;
  detecting: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  duplicates: number;
}
export interface OpenReelWatchFoldersSnapshot {
  folders: Array<{ config: OpenReelWatchFolderConfig; status: OpenReelWatchFolderStatus }>;
  items: OpenReelWatchItem[];
}
export interface OpenReelWatchFoldersBridge {
  list(): Promise<OpenReelWatchFoldersSnapshot>;
  /** Opens the native folder dialog; the path never passes through the page. */
  add(kind: "ingest" | "export"): Promise<{ added: boolean; id?: string }>;
  update(
    id: string,
    patch: Partial<Pick<OpenReelWatchFolderConfig, "paused" | "bin" | "createProxies" | "presetId" | "includeProjects" | "processExisting">>,
  ): Promise<void>;
  pickOutput(id: string): Promise<{ changed: boolean }>;
  remove(id: string): Promise<void>;
  retry(itemId: string): Promise<void>;
  clearFinished(): Promise<void>;
  onChange(cb: (snapshot: OpenReelWatchFoldersSnapshot) => void): () => void;
}

export interface OpenReelRenderCacheSettings {
  scratchDir: string;
  isDefault: boolean;
  capBytes: number;
  freeBytes: number | null;
}
/** Hosted audio plugins (the desktop app's out-of-process Audio Unit helper). */
export interface OpenReelPlughostLiveOpenResult {
  ok: true;
  sessionId: string;
  pluginLatencyFrames: number;
  perPluginLatencyFrames: number[];
  prefillBlocks: number;
  blockFrames: number;
  roundTripMs: { p50: number; p95: number; max: number };
}

export interface OpenReelPlughostBridge {
  /** Live (realtime) plugin inserts. Main answers with a MessagePort per session (window message `openreel:plughost-live-port`). */
  liveOpen?(args: {
    sessionId: string;
    steps: Array<{ pluginId: string; effectId: string; state?: string; values: Record<string, number>; automation: Record<string, Array<readonly [number, number]>> }>;
    sampleRate: number;
    blockFrames: 128 | 256 | 512;
  }): Promise<OpenReelPlughostLiveOpenResult | { ok: false; kind: "unavailable" | "failed"; message: string }>;
  liveSet?(sessionId: string, effectId: string, values?: Record<string, number>, automation?: Record<string, Array<readonly [number, number]>>): Promise<boolean>;
  liveClose?(sessionId: string): Promise<boolean>;
  liveStats?(sessionId: string): Promise<{ blocksIn: number; blocksOut: number; dropped: number; staleDropped: number; roundTripMs: { p50: number; p95: number; max: number }; failed: string | null; pids: number[] } | null>;
  scan(force?: boolean): Promise<{
    plugins: Array<{
      id: string;
      format: "au" | "vst3";
      name: string;
      vendor: string;
      version?: string;
      category?: string;
      path?: string;
      hasCustomView?: boolean;
      status: "ok" | "unsupported" | "blocked";
      statusReason?: string;
      latencySamples?: number;
      tailSeconds?: number;
      parameterCount?: number;
    }>;
    helperAvailable: boolean;
    helperError?: string;
    searchedVst3: string[];
    auSearchPaths: string[];
  }>;
  unblock(id: string): Promise<unknown>;
  render(args: {
    jobId: string;
    pluginId: string;
    state?: string;
    values: Record<string, number>;
    automation: Record<string, Array<readonly [number, number]>>;
    channels: Float32Array[];
    sampleRate: number;
  }): Promise<{ ok: boolean; kind?: "unavailable" | "failed" | "cancelled"; message?: string; result?: { channels: Float32Array[]; latencySamples: number } }>;
  cancel(jobId: string): Promise<boolean>;
  describe(pluginId: string, state?: string): Promise<
    | { ok: true; latencySamples: number; tailSeconds: number; state: string | null; parameters: Array<{ key: string; name: string; identifier?: string; min: number; max: number; value: number; unitName?: string; indexed?: boolean }> }
    | { ok: false; message: string }
  >;
  openUi(args: { pluginId: string; title: string; state?: string; values?: Record<string, number> }): Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>;
  closeUi(sessionId: string): Promise<boolean>;
  onProgress(cb: (event: { jobId: string; fraction: number }) => void): () => void;
  onScanProgress(cb: (event: { done: number; total: number }) => void): () => void;
  onUiEvent(cb: (event: { type: "opened" | "paramChanged" | "state" | "closed" | "error"; sessionId: string; key?: string; value?: number; state?: string | null; parameters?: Array<{ key: string; value: number }>; message?: string }) => void): () => void;
}

export interface OpenReelRenderCacheBridge {
  getSettings(): Promise<OpenReelRenderCacheSettings>;
  /** Opens the native folder dialog; the path never passes through the page. */
  pickScratch(): Promise<{ changed: boolean; error: string | null; settings: OpenReelRenderCacheSettings }>;
  resetScratch(): Promise<OpenReelRenderCacheSettings>;
  setCap(capBytes: number): Promise<OpenReelRenderCacheSettings>;
  open(project: string): Promise<boolean>;
  put(project: string, key: string, data: ArrayBuffer): Promise<boolean>;
  get(project: string, key: string): Promise<Uint8Array | undefined>;
  delete(project: string, keys: string[]): Promise<boolean>;
  list(project: string): Promise<Array<{ key: string; bytes: number }>>;
  clearProject(project: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
  stat(paths: string[]): Promise<Array<{ size: number; mtimeMs: number } | null>>;
  usage(): Promise<{ bytes: number; projects: Array<{ key: string; bytes: number; files: number; touchedAt: number }> }>;
}

export type OpenReelProjectLockResult =
  | { status: "acquired" }
  | {
      status: "held";
      holder: { pid: number; host: string; user: string; since: number; heartbeatAt: number; sameApp: boolean; sameHost: boolean };
    }
  | { status: "unsupported"; reason: string };

/** Mirrors apps/desktop/src/shared/project-manager.ts and main/project-manager/runner.ts (the web package cannot import apps/desktop). */
export interface OpenReelProjectManagerOptions {
  mode: "collect" | "consolidate";
  sequenceIds: string[];
  preset: "match-source" | "prores-422-lt" | "prores-422" | "prores-422-hq" | "dnxhr-sq" | "dnxhr-hq" | "h264";
  excludeUnused: boolean;
  trim: boolean;
  handleFrames: number;
  includeProxies: boolean;
  includeRenderFiles: boolean;
  includeAudioConform: boolean;
  renameToClipNames: boolean;
}
export interface OpenReelProjectManagerEstimate {
  totalBytes: number;
  mediaBytes: number;
  proxyBytes: number;
  renderBytes: number;
  freeBytes: number | null;
  items: Array<{ mediaId: string; name: string; action: "copy" | "transcode" | "offline"; trimmed: boolean; keptSeconds: number; sourceSeconds: number; bytes: number; note?: string }>;
  droppedCount: number;
  warnings: string[];
}
export interface OpenReelProjectManagerEvent {
  jobId: string;
  phase: "scanning" | "running" | "finalizing" | "done" | "error" | "cancelled";
  fraction: number;
  label: string;
  itemIndex: number;
  itemCount: number;
  destDir?: string;
  projectPath?: string;
  error?: string;
  summary?: { destDir: string; projectPath: string; files: number; bytes: number; transcoded: number; copied: number; skipped: number; warnings: string[] };
}
export interface OpenReelProjectManagerBridge {
  estimate(args: { projectJson: string; options: OpenReelProjectManagerOptions; destParent?: string | null }): Promise<OpenReelProjectManagerEstimate>;
  start(args: { projectJson: string; options: OpenReelProjectManagerOptions; destParent: string; projectName?: string }): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<boolean>;
  onEvent(cb: (event: OpenReelProjectManagerEvent) => void): () => void;
}

declare global {
  interface Window {
    openreel?: {
      ingest?: OpenReelIngestBridge;
      projectManager?: OpenReelProjectManagerBridge;
      mediaBrowser?: OpenReelMediaBrowserBridge;
      watchFolders?: OpenReelWatchFoldersBridge;
      renderCache?: OpenReelRenderCacheBridge;
      plughost?: OpenReelPlughostBridge;
      platform: "desktop";
      publicOrigin: string;
      /** True for perf/e2e/CI/agent launches (computed in main, read synchronously in preload). Suppresses onboarding. */
      automation?: boolean;
      onboarding?: {
        get(): Promise<OpenReelOnboardingMirror | null>;
        set(mirror: OpenReelOnboardingMirror): Promise<void>;
      };
      ollama?: {
        probe(): Promise<OpenReelOllamaProbeResult>;
      };
      /** OS microphone permission (macOS/Windows privacy settings); the desktop app only. */
      microphone?: {
        status(): Promise<"not-determined" | "granted" | "denied" | "restricted">;
        request(): Promise<"not-determined" | "granted" | "denied" | "restricted">;
        openSettings(): Promise<boolean>;
      };
      /** Main-process helpers for fonts; Brotli for WOFF2 licence checks (Electron's Chromium has no Brotli DecompressionStream). */
      fonts?: {
        brotliDecompress(data: Uint8Array): Promise<Uint8Array | null>;
      };
      samples?: {
        list(): Promise<OpenReelSampleClipInfo[]>;
        get(id: string): Promise<OpenReelSampleClipData | null>;
      };
      probeHardware(): Promise<OpenReelHardwareInfo>;
      onMenuAction(cb: (id: string) => void): () => void;
      /** Files the OS opened with the app (projects, caption files): what arrived before the page loaded, and what arrives later. */
      openFiles?: {
        take(): Promise<Array<{ kind: "project" | "captions"; path: string }>>;
        onOpen(cb: (items: Array<{ kind: "project" | "captions"; path: string }>) => void): () => void;
      };
      fs: {
        showSaveDialog(opts: {
          defaultPath: string;
          filters: { name: string; extensions: string[] }[];
        }): Promise<string | null>;
        showOpenDialog(opts: {
          filters: { name: string; extensions: string[] }[];
        }): Promise<string | null>;
        readFile(path: string): Promise<string>;
        readFileBytes(path: string): Promise<ArrayBuffer>;
        tempFilePath(ext: string, persist?: boolean): Promise<string>;
        releaseTemp?(path: string): Promise<boolean>;
        /** Take the project file lock. `held` means another window or app instance has the project open. */
        lockProject?(path: string): Promise<OpenReelProjectLockResult>;
        unlockProject?(path: string): Promise<boolean>;
        writeFile(path: string, data: string): Promise<void>;
        openWrite(path: string): Promise<string>;
        writeChunk(handleId: string, data: ArrayBuffer | Uint8Array, position: number): Promise<void>;
        closeWrite(handleId: string): Promise<void>;
        abortWrite(handleId: string): Promise<void>;
        revealInFolder(path: string): Promise<void>;
        /** Native multi-file picker for media. */
        pickFiles?(opts?: OpenReelPickFilesArgs): Promise<OpenReelPickFilesResult>;
        /** Native picker for a .openreel project file; null when canceled. */
        pickProject?(): Promise<string | null>;
        /** Absolute path of a picked/dropped File ("" when it is not on disk). */
        pathForFile?(file: File): string;
      };
      /** Effect plugins installed in the user-data plugins folder (Effects > Manage Plugins). */
      plugins?: {
        /** One record of file name -> text per installed plugin folder. */
        list(): Promise<Array<Record<string, string>>>;
        put(id: string, files: Record<string, string>): Promise<void>;
        remove(id: string): Promise<void>;
        revealFolder(): Promise<void>;
      };
      keychain: {
        get(id: string): Promise<string | null>;
        set(id: string, value: string): Promise<void>;
        delete(id: string): Promise<void>;
      };
      export: {
        start(args: OpenReelExportStartArgs): Promise<OpenReelExportSession>;
        writeAudioWav(jobId: string, wav: ArrayBuffer): Promise<void>;
        writeAudioChunk(jobId: string, chunk: ArrayBuffer, position: number): Promise<void>;
        finishAudio(jobId: string): Promise<void>;
        /** Audio-only AC-3 / E-AC-3: encode a WAV mixdown (5.1 as L R C LFE Ls Rs) with the ffmpeg sidecar into a raw elementary stream. */
        encodeDolbyAudio(args: {
          wav: ArrayBuffer;
          codec: "ac3" | "eac3";
          channels: 2 | 6;
          bitrateKbps: number;
          sampleRate: 44100 | 48000;
          dialnorm: number;
        }): Promise<ArrayBuffer>;
        cancel(jobId: string): Promise<void>;
        /** Native smart render: stream-copy `frames` packets of a source file from its key frame at `sourceStart`. */
        copyRun(
          jobId: string,
          run: {
            sourcePath: string;
            sourceStart: number;
            outputStartFrame: number;
            frames: number;
            sourceSize?: number;
            sourceMtimeMs?: number;
            sourceContentHash?: string;
          },
        ): Promise<{ frames: number }>;
        /** How ffmpeg decodes a source file's video: codec, pixel format and the colour tags it carries. */
        probeSource(path: string): Promise<{
          codec: string;
          pixelFormat: string;
          color: { range?: string; matrix?: string; primaries?: string; transfer?: string };
        } | null>;
        /** The first audio stream of a source file as the packet list shows it (codec, rate, encoder delay, length); null without audio. */
        probeAudioSource?(path: string): Promise<{
          codec: string;
          profile?: string;
          sampleRate: number;
          channels: number;
          sampleFormat: string;
          bitrateKbps: number;
          firstPts: number;
          frameSamples: number;
          packets: number;
          endSamples: number;
        } | null>;
        /** Native smart render, audio: build and prove the copies of the plan; resolves with `declined` when the audio must be rendered. */
        prepareAudioCopy?(
          jobId: string,
          plan: {
            codec: "aac" | "pcm";
            sampleRate: number;
            channels: number;
            totalSamples: number;
            segments: Array<
              | { kind: "encode"; start: number; end: number }
              | {
                  kind: "copy";
                  start: number;
                  end: number;
                  sourcePath: string;
                  sourceStart: number;
                  priming?: number;
                  sourceSize?: number;
                  sourceMtimeMs?: number;
                  sourceContentHash?: string;
                }
            >;
          },
        ): Promise<{ declined?: string }>;
        /** Picture types (display order, one letter per frame) of `frames` frames from the key frame at `startTime`. */
        probeGopTypes?(path: string, startTime: number, frames: number): Promise<{ types: string; firstTime: number } | null>;
        /** Absolute path of a File picked or dropped from disk; "" for an in-memory blob. */
        pathForFile?(file: File): string;
      };
      aurora?: {
        renderPreview(
          args: OpenReelAuroraRenderPreviewArgs,
        ): Promise<OpenReelAuroraRenderPreviewResult>;
        startPreviewSession(
          args: OpenReelAuroraPreviewSessionStartArgs,
        ): Promise<OpenReelAuroraPreviewSessionStartResult>;
        cancelPreviewSession(sessionId: string): Promise<void>;
        onPreviewEvent(
          cb: (event: OpenReelAuroraPreviewSessionEvent) => void,
        ): () => void;
        startSequenceSession(
          args: OpenReelAuroraSequenceSessionStartArgs,
        ): Promise<OpenReelAuroraSequenceSessionStartResult>;
        cancelSequenceSession(sessionId: string): Promise<void>;
        onSequenceEvent(
          cb: (event: OpenReelAuroraSequenceSessionEvent) => void,
        ): () => void;
      };
      cloud: {
        fetch(
          service:
            | "elevenlabs"
            | "openai"
            | "anthropic"
            | "openai-compatible"
            | "anthropic-compatible",
          path: string,
          options?: {
            method?: string;
            headers?: Record<string, string>;
            body?: string;
            baseUrl?: string;
          },
        ): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: ArrayBuffer }>;
      };
      win: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
        isMaximized(): Promise<boolean>;
      };
      /** Parallel segment export: the editor starts a session, hidden worker windows render its segments and audio. */
      exportSegments?: {
        start(args: unknown): Promise<{ sessionId: string; encoder: string }>;
        cancel(sessionId: string): Promise<void>;
        init(sessionId: string): Promise<unknown>;
        next(sessionId: string): Promise<unknown>;
        writeAudioChunk(sessionId: string, chunk: ArrayBuffer, position: number): Promise<void>;
        finishAudio(sessionId: string): Promise<void>;
        fail(sessionId: string, message: string): Promise<void>;
        onEvent(cb: (event: unknown) => void): () => void;
      };
      /** Linked composition windows: the main process opens them and relays messages between windows. */
      linkedComp?: {
        open(compositionId: string): Promise<{ ok: boolean; message?: string }>;
        post(message: unknown): void;
        onMessage(cb: (message: unknown) => void): () => void;
      };
      lifecycle: {
        onQueryUnsaved(handler: () => boolean): () => void;
        onFlush(handler: () => Promise<void>): () => void;
      };
      updater: {
        onStatus(cb: (status: OpenReelUpdaterStatus) => void): () => void;
        download(): Promise<void>;
        install(): Promise<void>;
      };
      crash: {
        report(payload: { message: string; stack?: string; type?: string; context?: unknown }): void;
      };
      mcp?: {
        onRequest(
          handler: (req: {
            callId: string;
            kind: "listTools" | "callTool";
            name?: string;
            args?: Record<string, unknown>;
            /** Set by the main process for watch-folder work only. */
            origin?: "watch-folders";
          }) => Promise<{ ok: boolean; result?: unknown; error?: string }>,
        ): () => void;
        getStatus(): Promise<OpenReelMcpStatus>;
        rotateToken(): Promise<OpenReelMcpStatus>;
        testConnection(): Promise<{ ok: boolean; message?: string; toolCount?: number }>;
        getClientStatus?(): Promise<OpenReelMcpClientStatus>;
        getPolicy?(): Promise<OpenReelMcpPolicy>;
        setPolicy?(policy: { allowedRoots: string[] }): Promise<OpenReelMcpPolicy>;
        /** Resolve absolute paths against the allowed roots in main (symlinks resolved; folders expanded). */
        resolveFiles?(args: OpenReelMcpFilesResolveArgs): Promise<OpenReelMcpFilesResolveResult>;
        /** Copy an app temp export to an allowed destination; reports size and SHA-256. */
        placeOutput?(args: OpenReelMcpPlaceOutputArgs): Promise<OpenReelMcpPlaceOutputResult>;
        /** App version, platform and window counts (main process) for get_app_state. */
        getAppInfo?(): Promise<OpenReelMcpAppInfo>;
      };
      media: {
        generateProxy(args: { srcPath: string; preset: "low" | "medium" | "high" }): Promise<{ outPath: string }>;
        transcode(args: {
          srcPath: string;
          container?: "mp4" | "webm" | "mov";
          videoBitrateKbps?: number;
          audioBitrateKbps?: number;
        }): Promise<{ outPath: string }>;
        extractAudioWav(args: { srcPath: string; streamIndex?: number; channels?: number }): Promise<{ outPath: string }>;
        probeAudioStreams(args: { srcPath: string }): Promise<{
          streams: { index: number; codec: string; channels: number; sampleRate: number; language?: string }[];
        }>;
        developRawStill?(args: { srcPath: string }): Promise<{ outPath: string; width: number; height: number }>;
        fetchUrl(args: { url: string; maxBytes?: number }): Promise<{
          ok: boolean;
          status: number;
          statusText: string;
          contentType: string;
          body: ArrayBuffer;
          error?: string;
        }>;
        nativeProbe(args: { path: string }): Promise<OpenReelNativeSourceProbe | null>;
        nativeFrame(args: { path: string; time: number; width?: number; quality?: "preview" | "full"; bitDepth?: 8 | 16 }): Promise<OpenReelNativeFrame | null>;
        nativeStats(): Promise<OpenReelNativeDecodeStats>;
      };
      rigging?: {
        probeBackend(): Promise<OpenReelRiggingBackendProbe>;
        rigHumanoidModel(
          args: OpenReelRigHumanoidModelArgs,
        ): Promise<OpenReelRigHumanoidModelResult>;
      };
    };
  }
}
