export * from "./types";
export * from "./utils";
export * from "./actions";
export * from "./capabilities";
export * from "./storage";
export * from "./timeline";
export * from "./media";
export * from "./video";
export * from "./audio";
export * from "./playback";
export * from "./text";
export * from "./graphics";
export * from "./photo";
export * from "./editing-templates";
export * from "./graphic-templates";
export * from "./linked-comps";
export * from "./template";
export * from "./motion";
export * from "./ai";
export * from "./animation";
export * from "./effects";
export * from "./device";
export * from "./multicam";
export * from "./render-cache";
export * from "./plugins";
export {
  ExportEngine,
  getExportEngine,
  downloadBlob,
  setEncoderBackendFactory,
  exportSettingsRequireNativeEncoder,
  desktopExportRequiresNativeEncoder,
  exportWritesAlpha,
  hasBroadcastOptions,
  createIsolatedExportEngine,
} from "./export/export-engine";
export type { ExportEngineOptions } from "./export/export-engine";
export * from "./export/color-output";
export * from "./export/image-sequence";
export {
  GIF_MAX_DIMENSION,
  GIF_MAX_FRAMES,
  GIF_MAX_RGBA_BYTES,
  gifPlaybackFps,
  validateGifFrameBudget,
  validateGifOptions,
} from "./export/gif-encoder";
export * from "./export/broadcast";
export * from "./export/encoder-choice";
export * from "./color/source-color";
export * from "./color/cube-lut";
export * from "./color/lut-json";
export * from "./color/looks";
export * from "./color/input-transform";
export * from "./color/camera-log";
export * from "./color/hdr-working";
export * from "./color/aces";
export * from "./color/ocio-config";
export * from "./color/hdr-effects";
export * from "./color/hdr-light-level";
export { planHdrTransition, isHdrTransitionKind, type HdrTransitionStep, type HdrTransitionKind } from "./video/hdr-transition";
export * from "./raw";
// GpuHdrCompositor / isGpuHdrAvailable: import from "@openreel/core/video/hdr-gpu". Its shader templates call .toFixed() at module scope, which Rollup keeps, so a barrel re-export would pull the module into the startup entry.
export { hdrExportTargetFor, type HdrExportTarget } from "./video/hdr-frame";
export * from "./export/smart-render";
export { scanSourceForSmartRender } from "./export/smart-render-scan";
export * from "./export/source-fingerprint";
export * from "./export/progress-estimator";

export type { EncoderBackend, SmartRenderMuxer } from "./export/encoder-backend";

export { WebCodecsBackend } from "./export/webcodecs-backend";

export { resolveWebCodecsExportLimits } from "./export/webcodecs-limits";
export { checkBrowserExportCapability, getVideoExportValidationError } from "./export/browser-capabilities";

export type {
  VideoExportSettings,
  AudioExportSettings,
  ExportPreset,
  ExportResult,
  UpscaleQuality,
  ExportFrameSource,
  ExportVideoOptions,
  ExportStats,
  SmartRenderReport,
} from "./export/types";

export * from "./export/export-queue";
export * from "./export/stem-export";
export * from "./export/zip";
export { cloneProjectSnapshot } from "./export/project-snapshot";

export {
  DEFAULT_VIDEO_SETTINGS,
  effectiveRateControl,
  twoPassAvailability,
} from "./export/types";

export type {
  CompressionQuality,
  CompressionTarget,
  CompressionSource,
  CompressionPlan,
} from "./export/compression";

export {
  computeCompressionPlan,
  estimateCompressedBytes,
  compressionPlanToExportSettings,
  COMPRESSION_SIZE_PRESETS,
} from "./export/compression";

export { toRuntimeVideoEffectParams } from "./video/effect-parameter-units";

export { prepareTimelineToolEdit, applyTimelineToolEdits, validateTimelineToolEdits, invertTimelineToolEdits } from "./editing/timeline-tool-edit";
export type { TimelineToolMode, TimelineToolPlan, TimelineToolPreview } from "./editing/timeline-tool-edit";
export { planToolNudge, chooseNudgeEdge, NUDGE_FRAMES, NUDGE_FRAMES_LARGE } from "./editing/timeline-tool-nudge";
export {
  defaultEditPointKind,
  findEditPointNeighbor,
  findGapAt,
  isEditPointValid,
  isGapValid,
  markClipRange,
  planDeleteGap,
  planEditPointTrim,
  toggleEditPointKind,
  type EditPointEdge,
  type EditPointKind,
  type EditPointRef,
  type TimelineGap,
} from "./editing/edit-point";
export {
  DEFAULT_SPLIT_EDIT_FRAMES,
  findLinkedPartners,
  planEdgeMoves,
  planExtendEdit,
  planSplitEdit,
  prepareEdgeMove,
  sideOfTrack,
  splitEditOffsets,
} from "./editing/split-edit";
export type {
  AppliedEdgeMove,
  EdgeMove,
  EdgeMovePlan,
  EdgeName,
  PreparedEdgeMove,
  SplitEditKind,
  TimelineSide,
} from "./editing/split-edit";

export { prepareClipSplit } from "./editing/clip-fragments";
export { planTrackSelect, type TrackSelectItem, type TrackSelectKind, type TrackSelectOptions } from "./editing/track-select";
export { zoomAtPoint, zoomToRange, type ViewState, type ZoomLimits } from "./editing/timeline-view";
export { planRippleDelete, planCloseGap, planCloseGapBeforeClip, planRemoveGaps, planSilenceCut } from "./editing/ripple-delete";
export { planClipDropResolution, clipDropOptionsFromModifiers, snapshotClipOrigins, type ClipDropMode, type ClipDropOptions, type ClipOrigin } from "./editing/clip-drop";
export { planClipSpeedEdit, prepareMultiRateStretch, type MultiRateStretch, resolveClipRate, type ClipSpeedEdit, type ClipSpeedOptions } from "./editing/clip-speed-edit";
export { planRippleTrimToPlayhead, type RippleTrimToPlayheadOptions } from "./editing/ripple-trim-playhead";
export {
  isSyncLocked,
  syncFollowerTrackIds,
  findSyncBlocker,
  assertRangeEmptyOnTracks,
  SyncLockBlockedError,
} from "./editing/sync-lock";
export {
  planAddEditToAllTracks,
  planAddEdit,
  planLift,
  planExtract,
  planInsert,
  planOverwrite,
  createMediaClip,
  findTopmostVisualClipAt,
  clipSourceTimeAt,
} from "./editing/premiere-edits";
export {
  createSourceClip,
  planSourceEdit,
  resolveThreePointEdit,
  sourceDropError,
  sourceTargetKind,
} from "./editing/source-edit";
export {
  findReplaceTarget,
  planFitToFill,
  planReplaceEdit,
  resolveFitToFill,
} from "./editing/replace-fit";
export type {
  FitToFillPlan,
  FitToFillRequest,
  ReplaceAlignment,
  ReplaceEditPlan,
  ReplaceEditRequest,
  ResolvedFitToFill,
  ResolvedReplace,
} from "./editing/replace-fit";
export { CLIP_SPEED_MAX, CLIP_SPEED_MIN } from "./editing/speed-limits";
export type {
  ResolvedSourceEdit,
  SourceComponent,
  SourceEditPlan,
  SourceEditRequest,
  ThreePointInput,
  ThreePointRule,
} from "./editing/source-edit";
export * from "./media/bins";
export * from "./media/interpretation";
export * from "./media/smart-bins";
export * from "./media/proxy-workflow";
export * from "./media/desktop-ingest";
export * from "./media/proxy-presets";
export type { MediaItemPatch, ClipLabelPatch, MediaOrganizeParams } from "./actions/handlers/media-organize";
export { buildBenchProject } from "./perf/bench-project";
export type { BenchProjectOptions } from "./perf/bench-project";
export type { ClipPlacement, NewTrackPlacement } from "./editing/premiere-edits";
export { findReverseMatch, timelineTimeForSource } from "./editing/reverse-match-frame";
export type { ReverseMatch } from "./editing/reverse-match-frame";
export {
  canTargetTrack,
  chooseTrackForMedia,
  createEmptyTrack,
  findMainTrack,
  resolveSourceTracks,
} from "./editing/track-targeting";
export type {
  SourcePatch,
  SourceTrackResolution,
  TargetMediaKind,
  TrackChoice,
  TrackTargetingInput,
} from "./editing/track-targeting";

export {
  parseCaptions,
  exportCaptions,
  exportSrt,
  exportVtt,
  exportTtml,
  listCaptionTracks,
  formatVttTime,
  formatSrtTime,
  CAPTION_EXPORT_FORMATS,
  CAPTION_FORMAT_INFO,
  decodeCaptionText,
  exportCaptionFile,
  parseCaptionBytes,
} from "./captions/caption-formats";
export type {
  CaptionExportFormat,
  CaptionExportOptions,
  CaptionFile,
  CaptionImportOptions,
  CaptionParseResult,
  CaptionTrackSummary,
} from "./captions/caption-formats";
export { parseTtml, isTtmlContent } from "./captions/ttml";
export { parseSbv, encodeSbv, isSbvContent } from "./captions/sbv";
export { encodeScc, exportScc, parseScc, isSccContent } from "./captions/scc";
export type { CaptionFormatIssue, SccExportResult, SccOptions, SccParseOptions, SccParseResult } from "./captions/scc";
export { encodeStl, exportStl, parseStl, isStlContent } from "./captions/ebu-stl";
export type { StlExportResult, StlHeader, StlOptions, StlParseOptions, StlParseResult } from "./captions/ebu-stl";
export { checkCaptions, visibleRows, DEFAULT_CAPTION_QC } from "./captions/caption-qc";
export type { CaptionQcCode, CaptionQcIssue, CaptionQcOptions, CaptionQcReport } from "./captions/caption-qc";
export {
  framesToTimecode,
  timecodeToFrames,
  resolveCaptionFrameRate,
} from "./captions/caption-timecode";
export type { CaptionFrameRate } from "./captions/caption-timecode";
export {
  applyCaptionBurnIn,
  burnedInSubtitles,
  captionsChangeBurnIn,
  planEmbeddedCaptions,
  planSidecarFiles,
  subtitlesForRange,
  trackExportSettings,
  iso6392,
} from "./captions/caption-export";
export type {
  CaptionExportSettings,
  CaptionTrackExportSettings,
  EmbeddedCaptionKind,
  EmbeddedCaptionMode,
  EmbeddedCaptionPayload,
  EmbeddedCaptionPlan,
  SidecarFile,
} from "./captions/caption-export";
export {
  SPEAKER_PALETTE,
  defaultSpeakerName,
  paletteColor,
  cosineDistance,
  clusterEmbeddings,
  labelCuesBySpeaker,
  findSpeakerProfile,
  ensureSpeakerProfiles,
  renameSpeakerProfile,
  applySpeakerStyles,
  detectionCues,
  mirrorSpeakersToTranslations,
} from "./captions/diarization";
export type { SpeakerProfile, SpeakerPosition, ClusterOptions } from "./captions/diarization";
export {
  computeSpeakerEmbedding,
  EMBEDDING_SAMPLE_RATE,
  SPEAKER_EMBEDDING_DIMENSIONS,
} from "./captions/speaker-embedding";
export {
  buildTranscript,
  wordRange,
  wordIndexAt,
  searchTranscript,
  findFillerWords,
  findPauses,
  mergeTimeRanges,
  listSpeakers,
  renameSpeaker,
  assignSpeaker,
  parseTranscriptJson,
  DEFAULT_FILLER_PHRASES,
} from "./captions/transcript";
export type {
  Transcript,
  TranscriptWord,
  TranscriptSentence,
  TranscriptMatch,
  FillerMatch,
  PauseMatch,
  TimeRange,
} from "./captions/transcript";
export {
  planTranscriptCut,
  cutDuration,
  registerTranscriptionProvider,
  getTranscriptionProviders,
} from "./captions/transcript-edit";
export type { TranscriptionProvider, TranscriptionRequest } from "./captions/transcript-edit";
export * from "./review/review-comments";
export { nextMarker, prevMarker, markersInRange, markerAt, sortMarkers } from "./editing/marker-nav";
export type { MarkerNavOptions } from "./editing/marker-nav";
export {
  sourceToTimelineTime,
  timelineToSourceTime,
  sourceTimeInClip,
  resolveClipMarkers,
  sourceTimeForTimelineMarker,
  flattenClipMarkers,
} from "./editing/clip-markers";
export type { ClipMarkerScope, ResolvedClipMarker } from "./editing/clip-markers";
export {
  chaptersText,
  markersCsv,
  markersEdlLocs,
  parseEdlLocs,
  formatChapterTime,
  markerColorFromName,
  markerFrameRate,
  nearestMarkerColorName,
  CSV_COLUMNS,
  MIN_CHAPTERS,
  MIN_CHAPTER_SECONDS,
} from "./interchange/marker-export";
export type {
  Chapter,
  ChaptersResult,
  ChaptersOptions,
  MarkersCsvOptions,
  EdlLocOptions,
  ParsedLoc,
} from "./interchange/marker-export";
export * from "./export/surround-export";
export * from "./export/dolby";

export {
  translateCaptionTrack,
  uniqueCaptionTrackId,
  buildTranslationPrompt,
  parseTranslationReply,
  isAbortError,
} from "./captions/caption-translate";
export type {
  CaptionTranslator,
  CaptionTranslationProgress,
  CaptionTranslationResult,
  TranslateCaptionTrackOptions,
} from "./captions/caption-translate";
export * from "./tasks";
