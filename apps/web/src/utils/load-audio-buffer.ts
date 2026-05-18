export interface AudioLoadProgress {
  stage: "extracting" | "decoding";
  progress: number;
  message: string;
}

export interface LoadAudioBufferOptions {
  audioTrackIndex?: number;
  onProgress?: (progress: AudioLoadProgress) => void;
}

export const loadAudioBuffer = async (
  audioContext: AudioContext | BaseAudioContext,
  blob: Blob,
  options: LoadAudioBufferOptions = {},
): Promise<AudioBuffer | null> => {
  const audioTrackIndex = options.audioTrackIndex ?? 0;

  try {
    const { getFFmpegFallback } = await import("@openreel/core/media");
    const ffmpeg = getFFmpegFallback();
    options.onProgress?.({
      stage: "extracting",
      progress: 0.08,
      message: "Extracting audio track",
    });
    const wavBlob = await ffmpeg.extractAudioAsWav(blob, audioTrackIndex, {
      onProgress: (progress) => {
        options.onProgress?.({
          stage: "extracting",
          progress: Math.min(0.82, 0.08 + progress.progress * 0.72),
          message: "Extracting audio track",
        });
      },
    });
    options.onProgress?.({
      stage: "decoding",
      progress: 0.88,
      message: "Decoding extracted audio",
    });
    const arrayBuffer = await wavBlob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    options.onProgress?.({
      stage: "decoding",
      progress: 1,
      message: "Audio ready for analysis",
    });
    return decoded;
  } catch {
    options.onProgress?.({
      stage: "decoding",
      progress: 0.45,
      message: "Falling back to source audio decode",
    });
  }

  if (audioTrackIndex === 0) {
    try {
      options.onProgress?.({
        stage: "decoding",
        progress: 0.55,
        message: "Decoding source audio",
      });
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      options.onProgress?.({
        stage: "decoding",
        progress: 1,
        message: "Audio ready for analysis",
      });
      return decoded;
    } catch {
      return null;
    }
  }

  return null;
};