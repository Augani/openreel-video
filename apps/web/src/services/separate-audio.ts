import { v4 as uuidv4 } from "uuid";
import type { MediaItem } from "@openreel/core";
import {
  extractAudioWav,
  getFFmpegFallback,
  nativeMediaAvailable,
  probeAudioStreamCountViaNative,
} from "@openreel/core/media";
import { getMediaBridge, initializeMediaBridge } from "../bridges/media-bridge";

/** Materialize each recorded stream as its own audio-only media source. */
export async function extractAudioTracks(media: MediaItem): Promise<MediaItem[]> {
  if (!media.blob) {
    throw new Error("Relink the original video before separating its audio.");
  }

  let count = media.metadata.audioTrackCount ?? 1;
  if (count <= 1) {
    try {
      count = nativeMediaAvailable()
        ? await probeAudioStreamCountViaNative(media.blob)
        : (await getFFmpegFallback().probeAudioStreams(media.blob)).audioStreamCount;
    } catch {
      // Older projects may lack a stream count. Extraction still validates stream 0.
    }
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("This video has no recorded audio streams to separate.");
  }

  const bridge = getMediaBridge();
  if (!bridge.isInitialized()) await initializeMediaBridge();
  const sources: MediaItem[] = [];
  const baseName = media.name.replace(/\.[^.]+$/, "");
  // Extract sequentially to bound decoder memory use on long recordings.
  for (let index = 0; index < count; index++) {
    const wav = await extractAudioWav(media.blob, index);
    const file = new File([wav], `${baseName} - Audio ${index + 1}.wav`, {
      type: "audio/wav",
    });
    const result = await bridge.importFile(file, true);
    if (!result.success || !result.media || !result.media.metadata.hasAudio || result.media.metadata.hasVideo) {
      throw new Error(result.error || `Could not decode audio stream ${index + 1}.`);
    }
    const { metadata, waveformData } = result.media;
    sources.push({
      id: uuidv4(),
      name: file.name,
      type: "audio",
      fileHandle: null,
      blob: file,
      metadata: {
        duration: metadata.duration,
        width: 0,
        height: 0,
        frameRate: 0,
        codec: metadata.codec,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        fileSize: file.size,
        audioTrackCount: 1,
        hasAudio: true,
        hasVideo: false,
      },
      thumbnailUrl: null,
      waveformData: waveformData?.peaks ?? null,
      sourceFile: { name: file.name, size: file.size, lastModified: file.lastModified },
    });
  }
  return sources;
}
