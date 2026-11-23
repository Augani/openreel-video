import { fallbackDecodeChannels, getChannelLayout, wideDecodeChannels } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * The editor preview's decode of a clip's source audio (streamed straight out of the Blob, falling back to ffmpeg).
 * Shared so anything that must work on the SAME samples the preview plays (Enhance Speech's cached job is keyed by
 * sample content) decodes exactly the way the preview does.
 */
export const decodeClipAudioBuffer = async (
  audioContext: AudioContext | BaseAudioContext,
  blob: Blob,
  audioTrackIndex: number = 0,
  sourceChannels?: number,
  /** The clip's channel map reads the file's own channels (a mono clip from channel 5 of 8): keep every source channel. */
  wide = false,
): Promise<{ buffer: AudioBuffer | null; failed: boolean }> => {
  try {
    const { extractAudioWav, decodeAudioBufferStreaming } = await import("@openreel/core/media");
    // Stream the track out of the Blob; the ffmpeg route below copies the whole (4K: ~700 MB) file.
    // A 5.1 sequence keeps 5.1 sources' channels (up to 6); stereo sequences decode stereo at most, as before.
    const layout = getChannelLayout(useProjectStore.getState().project.settings);
    const maxChannels = wide ? wideDecodeChannels(sourceChannels) : layout === "5.1" ? 6 : 2;
    const streamed = await decodeAudioBufferStreaming(audioContext, blob, audioTrackIndex, maxChannels);
    if (streamed.status === "ok") return { buffer: streamed.buffer, failed: false };
    if (streamed.status === "none") return { buffer: null, failed: false };
    // Sources the browser cannot stream: ffmpeg keeps the source's channels in a 5.1 sequence (not folded to stereo).
    const fallbackChannels = wide ? wideDecodeChannels(sourceChannels) : fallbackDecodeChannels(layout, sourceChannels);
    const wavBlob = fallbackChannels === undefined
      ? await extractAudioWav(blob, audioTrackIndex)
      : await extractAudioWav(blob, audioTrackIndex, { channels: fallbackChannels });
    const arrayBuffer = await wavBlob.arrayBuffer();
    return { buffer: await audioContext.decodeAudioData(arrayBuffer), failed: false };
  } catch (error) {
    if (error instanceof Error && error.name === "NoAudioStreamError") {
      return { buffer: null, failed: false };
    }
  }

  if (audioTrackIndex === 0) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      return { buffer: await audioContext.decodeAudioData(arrayBuffer), failed: false };
    } catch {
      return { buffer: null, failed: true };
    }
  }
  return { buffer: null, failed: true };
};
