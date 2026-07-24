import { nativeMediaAvailable, extractAudioWavViaNative } from "./native-media-bridge";

export { NoAudioStreamError } from "./native-media-bridge";

export interface ExtractAudioProgressOptions {
  onProgress?: (progress: { phase?: string; progress: number }) => void;
}

// Desktop routes to the native FFmpeg sidecar; web uses the ffmpeg.wasm fallback.
// (Per-op progress is only surfaced on the wasm path for now; native runs without granular progress.)
export async function extractAudioWav(
  file: File | Blob,
  audioTrackIndex = 0,
  options?: ExtractAudioProgressOptions,
): Promise<Blob> {
  if (nativeMediaAvailable()) {
    return extractAudioWavViaNative(file, audioTrackIndex);
  }
  const { getFFmpegFallback } = await import("./ffmpeg-fallback");
  return getFFmpegFallback().extractAudioAsWav(
    file,
    audioTrackIndex,
    options as Parameters<ReturnType<typeof getFFmpegFallback>["extractAudioAsWav"]>[2],
  );
}
