export const AI_CLOUD_JOB_KINDS = {
  transcription: "transcription",
  aiHighlight: "ai_highlight",
  autoCaptions: "auto_captions",
  personMatting: "person_matting",
  objectTracking: "object_tracking",
  faceAnalysis: "face_analysis",
  stabilization: "stabilization",
  autoReframe: "auto_reframe",
  audioSeparation: "audio_separation",
  colorMatch: "color_match",
  colorize: "colorize",
  upscale: "upscale",
  sceneDetection: "scene_detection",
  backgroundRemoval: "background_removal",
  musicGeneration: "music_generation",
  photoEnhance: "photo_enhance",
  portraitBokeh: "portrait_bokeh",
  smartThumbnail: "smart_thumbnail",
  denoise: "denoise",
  silenceRemoval: "silence_removal",
  frameInterpolation: "frame_interpolation",
  faceRestore: "face_restore",
  objectRemoval: "object_removal",
  voiceEnhance: "voice_enhance",
  translation: "translation",
} as const;

export type AiCloudJobKind = (typeof AI_CLOUD_JOB_KINDS)[keyof typeof AI_CLOUD_JOB_KINDS];

export type AiCloudJobStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export const MEDIA_OPTIONAL_KINDS: ReadonlySet<string> = new Set([
  AI_CLOUD_JOB_KINDS.musicGeneration,
  AI_CLOUD_JOB_KINDS.translation,
]);

export interface AiCloudJobRequest {
  kind: string;
  params: Record<string, unknown>;
}

export interface AiCloudJobCreated {
  jobID: string;
  status: AiCloudJobStatus;
  manifestURL?: string;
}

export interface AiCloudJobStatusResponse {
  jobID: string;
  status: AiCloudJobStatus;
  progress?: number;
  message?: string;
  manifestURL?: string;
  error?: string;
  queuePosition?: number;
  pendingAhead?: number;
}

export interface AiWorkerArtifactReference {
  type?: string;
  stem?: string;
  relativePath: string;
  width?: number;
  height?: number;
  frameIndex?: number;
  sourceTime?: number;
  score?: number;
  fps?: number;
  frameCount?: number;
  sampleRate?: number;
  duration?: number;
  channels?: number;
}

export interface AiWorkerResultManifest {
  jobID: string;
  kind: string;
  status?: AiCloudJobStatus;
  model?: string;
  artifacts: AiWorkerArtifactReference[];
  metadata?: Record<string, unknown>;
}

const IMAGE_EXTS: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "tiff", "tif", "bmp"]);
const VIDEO_EXTS: ReadonlySet<string> = new Set(["mp4", "mov", "m4v", "webm"]);
const AUDIO_EXTS: ReadonlySet<string> = new Set(["wav", "m4a", "mp3", "aac", "ogg"]);

function ext(relativePath: string): string {
  return relativePath.split(".").pop()?.toLowerCase() ?? "";
}

export function artifactIsImage(a: AiWorkerArtifactReference): boolean {
  return a.type === "image" || IMAGE_EXTS.has(ext(a.relativePath));
}

export function artifactIsVideo(a: AiWorkerArtifactReference): boolean {
  return a.type === "video" || a.type === "mask_video" || VIDEO_EXTS.has(ext(a.relativePath));
}

export function artifactIsAudio(a: AiWorkerArtifactReference): boolean {
  return a.type === "audio" || AUDIO_EXTS.has(ext(a.relativePath));
}

export function normalizeResultManifest(raw: Record<string, unknown>): AiWorkerResultManifest {
  const artifactsRaw = Array.isArray(raw.artifacts) ? (raw.artifacts as Record<string, unknown>[]) : [];
  return {
    jobID: String(raw.jobID ?? ""),
    kind: String(raw.kind ?? ""),
    status: raw.status as AiCloudJobStatus | undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    artifacts: artifactsRaw
      .filter((a) => typeof a.relativePath === "string")
      .map((a) => ({ ...(a as object), relativePath: String((a as { relativePath: unknown }).relativePath) }) as AiWorkerArtifactReference),
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

export function primaryArtifact(manifest: AiWorkerResultManifest): AiWorkerArtifactReference | null {
  return (
    manifest.artifacts.find(artifactIsVideo) ??
    manifest.artifacts.find(artifactIsImage) ??
    manifest.artifacts.find(artifactIsAudio) ??
    manifest.artifacts[0] ??
    null
  );
}
