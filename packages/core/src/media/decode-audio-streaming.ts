import { nativeMediaAvailable } from "./native-media-bridge";

/**
 * Decodes one audio track of a media file straight into a single AudioBuffer by streaming it through
 * mediabunny (BlobSource reads slices of the Blob on demand).
 *
 * The ffmpeg.wasm route (extractAudioWav) copies the WHOLE file into WebAssembly memory first: for a
 * 683 MB 4K H.264 source that is several transient copies of 683 MB in the renderer just to get at a
 * 128 kbps audio track, which is where the 4K soak's multi-GB peak came from. Streaming only holds
 * the decoded PCM (the AudioBuffer itself, preallocated once).
 *
 * `unsupported` means "use the ffmpeg route" (codec the browser cannot decode, more than two
 * channels, an unreadable container); `none` means the file has no such audio track.
 */
export type StreamingAudioDecodeResult =
  | { status: "ok"; buffer: AudioBuffer }
  | { status: "none" }
  | { status: "unsupported" };

/** Longest audio track decoded this way, in seconds (the buffer is allocated up front). */
const MAX_STREAMING_DURATION_S = 4 * 3600;

export async function decodeAudioBufferStreaming(
  audioContext: BaseAudioContext,
  file: File | Blob,
  audioTrackIndex = 0,
  /** Widest source decoded here: 2 (stereo, the default) or 6 for a 5.1 sequence. Wider tracks are `unsupported`. */
  maxChannels = 2,
): Promise<StreamingAudioDecodeResult> {
  if (nativeMediaAvailable()) return { status: "unsupported" };
  let input: { [Symbol.dispose]?: () => void } | null = null;
  try {
    const { Input, ALL_FORMATS, BlobSource, AudioSampleSink } = await import("mediabunny");
    const opened = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    input = opened as unknown as { [Symbol.dispose]?: () => void };
    const tracks = await opened.getAudioTracks();
    const track = tracks[audioTrackIndex];
    if (tracks.length === 0) return { status: "none" };
    if (!track) return { status: "unsupported" };
    if (track.numberOfChannels < 1 || track.numberOfChannels > maxChannels) return { status: "unsupported" };
    if (!(await track.canDecode())) return { status: "unsupported" };

    const sampleRate = track.sampleRate;
    const duration = await track.computeDuration();
    if (!(duration > 0) || duration > MAX_STREAMING_DURATION_S) return { status: "unsupported" };
    const channels = track.numberOfChannels;
    const length = Math.ceil(duration * sampleRate);
    const out = audioContext.createBuffer(channels, length, sampleRate);

    // AudioSamples (WebCodecs AudioData) are copied straight into the output channels and closed at once.
    // The previous AudioBufferSink route allocated one AudioBuffer per decoded packet that only the garbage
    // collector could free: a 10-minute track piled up a second full copy (230 MB for stereo 48 kHz) of
    // garbage on top of the output buffer, and four tracks decoding in a row peaked at several GB
    // (memory-infra: partition_alloc/array_buffer 1.3 GB for three 10-minute tracks).
    const channelData = Array.from({ length: channels }, (_, c) => out.getChannelData(c));
    let written = 0;
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        const offset = Math.max(0, Math.round(sample.timestamp * sampleRate));
        if (offset >= length) break;
        const frames = Math.min(sample.numberOfFrames, length - offset);
        for (let c = 0; c < channels; c++) {
          const plane = Math.min(c, sample.numberOfChannels - 1);
          if (frames === sample.numberOfFrames) {
            sample.copyTo(channelData[c].subarray(offset, offset + frames), { planeIndex: plane, format: "f32-planar" });
          } else {
            const tmp = new Float32Array(sample.numberOfFrames);
            sample.copyTo(tmp, { planeIndex: plane, format: "f32-planar" });
            channelData[c].set(tmp.subarray(0, frames), offset);
          }
        }
        written = Math.max(written, offset + frames);
      } finally {
        sample.close();
      }
    }
    if (written === 0) return { status: "unsupported" };
    return { status: "ok", buffer: out };
  } catch {
    return { status: "unsupported" };
  } finally {
    try {
      input?.[Symbol.dispose]?.();
    } catch {
      // Closing is best effort.
    }
  }
}
