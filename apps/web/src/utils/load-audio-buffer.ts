export const loadAudioBuffer = async (
  audioContext: AudioContext | BaseAudioContext,
  blob: Blob,
  audioTrackIndex: number = 0,
): Promise<AudioBuffer | null> => {
  try {
    const { getFFmpegFallback } = await import("@openreel/core/media");
    const ffmpeg = getFFmpegFallback();
    const wavBlob = await ffmpeg.extractAudioAsWav(blob, audioTrackIndex);
    const arrayBuffer = await wavBlob.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
  } catch {
    // Fall back to browser decode for the primary track when extraction is unavailable.
  }

  if (audioTrackIndex === 0) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      return await audioContext.decodeAudioData(arrayBuffer);
    } catch {
      return null;
    }
  }

  return null;
};