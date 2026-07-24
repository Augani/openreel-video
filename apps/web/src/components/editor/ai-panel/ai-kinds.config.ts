import { AI_CLOUD_JOB_KINDS } from "@openreel/core";

export type ClipMediaType = "video" | "image" | "audio";

export type AiKindOutput = "media" | "subtitles" | "scenes" | "highlights" | "tracking";

/**
 * For output:"media" kinds, how the result is applied:
 * - "replace": the result IS the clip's transformed media → replace the clip's
 *   source media in place (no new library tile).
 * - "newAsset": the result is genuinely new content (generated music, audio
 *   stems, thumbnails) → add it to the media library as a new item.
 */
export type AiKindApply = "replace" | "newAsset";

export interface AiKindDef {
  kind: string;
  label: string;
  group: "Enhance" | "Cut-out" | "Motion" | "Analyze" | "Audio" | "Generate";
  requiresClip: boolean;
  media: ClipMediaType[];
  output: AiKindOutput;
  apply?: AiKindApply;
  webSupported?: boolean;
  interactive?: boolean;
  /**
   * The worker emits multiple distinct media artifacts that should each become
   * their own library item (e.g. audio_separation -> vocals/drums/bass/other
   * stems). Without this, only the single primaryArtifact is imported — which
   * for demucs is the alphabetically-first (bass) stem, often near-silent.
   */
  multiAsset?: boolean;
}

export const AI_KINDS: AiKindDef[] = [
  { kind: AI_CLOUD_JOB_KINDS.upscale, label: "Upscale", group: "Enhance", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.denoise, label: "Denoise", group: "Enhance", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.faceRestore, label: "Face Restore", group: "Enhance", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.photoEnhance, label: "Photo Enhance", group: "Enhance", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.colorize, label: "Colorize", group: "Enhance", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.colorMatch, label: "Color Match", group: "Enhance", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.backgroundRemoval, label: "Remove Background", group: "Cut-out", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.personMatting, label: "Person Matte", group: "Cut-out", requiresClip: true, media: ["video"], output: "media", webSupported: false },
  { kind: AI_CLOUD_JOB_KINDS.objectRemoval, label: "Object Removal", group: "Cut-out", requiresClip: true, media: ["image"], output: "media", interactive: true },
  { kind: AI_CLOUD_JOB_KINDS.stabilization, label: "Stabilize", group: "Motion", requiresClip: true, media: ["video"], output: "tracking", webSupported: false },
  { kind: AI_CLOUD_JOB_KINDS.autoReframe, label: "Auto Reframe", group: "Motion", requiresClip: true, media: ["video"], output: "tracking", webSupported: false },
  { kind: AI_CLOUD_JOB_KINDS.frameInterpolation, label: "Smooth (Interpolate)", group: "Motion", requiresClip: true, media: ["video"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.portraitBokeh, label: "Portrait Bokeh", group: "Enhance", requiresClip: true, media: ["image"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.transcription, label: "Transcribe", group: "Analyze", requiresClip: true, media: ["video", "audio"], output: "subtitles" },
  { kind: AI_CLOUD_JOB_KINDS.autoCaptions, label: "Auto Captions", group: "Analyze", requiresClip: true, media: ["video", "audio"], output: "subtitles" },
  { kind: AI_CLOUD_JOB_KINDS.sceneDetection, label: "Scene Detection", group: "Analyze", requiresClip: true, media: ["video"], output: "scenes" },
  { kind: AI_CLOUD_JOB_KINDS.faceAnalysis, label: "Face Analysis", group: "Analyze", requiresClip: true, media: ["video"], output: "tracking", webSupported: false },
  { kind: AI_CLOUD_JOB_KINDS.objectTracking, label: "Object Tracking", group: "Analyze", requiresClip: true, media: ["video"], output: "tracking", interactive: true },
  { kind: AI_CLOUD_JOB_KINDS.smartThumbnail, label: "Smart Thumbnail", group: "Analyze", requiresClip: true, media: ["video"], output: "media", apply: "newAsset" },
  { kind: AI_CLOUD_JOB_KINDS.aiHighlight, label: "AI Highlights", group: "Analyze", requiresClip: true, media: ["video"], output: "highlights" },
  { kind: AI_CLOUD_JOB_KINDS.audioSeparation, label: "Separate Audio", group: "Audio", requiresClip: true, media: ["video", "audio"], output: "media", apply: "newAsset", multiAsset: true },
  { kind: AI_CLOUD_JOB_KINDS.voiceEnhance, label: "Enhance Voice", group: "Audio", requiresClip: true, media: ["video", "audio"], output: "media" },
  { kind: AI_CLOUD_JOB_KINDS.silenceRemoval, label: "Remove Silence", group: "Audio", requiresClip: true, media: ["video", "audio"], output: "highlights", webSupported: false },
  { kind: AI_CLOUD_JOB_KINDS.musicGeneration, label: "Generate Music", group: "Generate", requiresClip: false, media: [], output: "media", apply: "newAsset" },
  { kind: AI_CLOUD_JOB_KINDS.translation, label: "Translate", group: "Generate", requiresClip: false, media: [], output: "subtitles", webSupported: false },
];

export const AI_KIND_GROUPS = ["Enhance", "Cut-out", "Motion", "Analyze", "Audio", "Generate"] as const;

export function kindMatchesClipType(kind: AiKindDef, clipType: ClipMediaType): boolean {
  return kind.media.includes(clipType);
}

export function isWebSupported(kind: AiKindDef): boolean {
  return kind.webSupported !== false;
}

export function kindsForClipType(clipType: ClipMediaType): AiKindDef[] {
  return AI_KINDS.filter((kind) => kindMatchesClipType(kind, clipType));
}

export function outputForKind(kind: string): AiKindOutput {
  return AI_KINDS.find((k) => k.kind === kind)?.output ?? "media";
}

export function applyModeForKind(kind: string): AiKindApply {
  return AI_KINDS.find((k) => k.kind === kind)?.apply ?? "replace";
}

export function isMultiAssetKind(kind: string): boolean {
  return AI_KINDS.find((k) => k.kind === kind)?.multiAsset === true;
}
