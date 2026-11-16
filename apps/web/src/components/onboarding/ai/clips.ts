import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";

export type ClipKind = "video" | "audio" | "image";

const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|mxf|mts|m2ts|mpg|mpeg|3gp|wmv|flv|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|oga|opus|aif|aiff|wma)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif|svg)$/i;

/** What a dropped or picked file is, from its mime type first and its extension second. */
export function clipKind(file: Pick<File, "name" | "type">): ClipKind | null {
  const type = file.type.toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (VIDEO_EXT.test(file.name)) return "video";
  if (AUDIO_EXT.test(file.name)) return "audio";
  if (IMAGE_EXT.test(file.name)) return "image";
  return null;
}

export interface FormatChoice {
  readonly id: "horizontal" | "vertical" | "square";
  readonly label: string;
  readonly description: string;
  readonly dimensions: string;
  readonly preset: SocialMediaCategory;
}

/** Same three formats and presets as the welcome screen's cards. */
export const FORMAT_CHOICES: readonly FormatChoice[] = [
  { id: "horizontal", label: "Horizontal", description: "YouTube, Vimeo, Web", dimensions: "1920 × 1080", preset: "youtube-video" },
  { id: "vertical", label: "Vertical", description: "TikTok, Reels, Shorts", dimensions: "1080 × 1920", preset: "tiktok" },
  { id: "square", label: "Square", description: "Instagram, Facebook", dimensions: "1080 × 1080", preset: "instagram-post" },
];

export function formatSettings(choice: FormatChoice): { width: number; height: number; frameRate: number } {
  const preset = SOCIAL_MEDIA_PRESETS[choice.preset];
  return { width: preset.width, height: preset.height, frameRate: preset.frameRate ?? 30 };
}

export function formatForSize(width: number, height: number): FormatChoice["id"] {
  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (ratio < 0.85) return "vertical";
    if (ratio < 1.15) return "square";
  }
  return "horizontal";
}

/**
 * Reads the first picture size out of a clip (video or image) so the format chips can default to
 * its shape. Resolves null on timeout or any failure; it only ever guesses a default.
 */
export function probeClipSize(
  file: File,
  timeoutMs = 3000,
): Promise<{ width: number; height: number } | null> {
  const kind = clipKind(file);
  if (kind !== "video" && kind !== "image") return Promise.resolve(null);
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let url = "";
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (size: { width: number; height: number } | null): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
      resolve(size);
    };
    try {
      url = URL.createObjectURL(file);
      timer = setTimeout(() => finish(null), timeoutMs);
      if (kind === "image") {
        const img = new Image();
        img.onload = () => finish({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => finish(null);
        img.src = url;
      } else {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.onloadedmetadata = () => finish({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => finish(null);
        video.src = url;
      }
    } catch {
      finish(null);
    }
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
