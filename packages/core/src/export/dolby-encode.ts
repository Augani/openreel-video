import { dolbyEncodeArgs, dolbyRawMuxer, dolbyFileExtension, type DolbyEncodeParams } from "./dolby";

/**
 * Audio-only AC-3 / E-AC-3: a PCM WAV (5.1 as L R C LFE Ls Rs) becomes a raw elementary stream.
 *
 * Desktop: the ffmpeg sidecar (`openreel.export.encodeDolbyAudio`). Browser: the ffmpeg.wasm core, which this
 * module loads on demand (it is a separate chunk, so none of it is on the app's entry path). Both run the same
 * ffmpeg encoder with the same options (`dolbyEncodeArgs`).
 */

export interface DolbyStreamRequest {
  /** PCM WAV, 2 or 6 channels (6 with the 5.1 speaker mask). */
  wav: Uint8Array;
  params: DolbyEncodeParams;
}

interface DesktopDolbyBridge {
  export?: {
    encodeDolbyAudio?: (args: {
      wav: ArrayBuffer;
      codec: "ac3" | "eac3";
      channels: 2 | 6;
      bitrateKbps: number;
      sampleRate: 44100 | 48000;
      dialnorm: number;
    }) => Promise<ArrayBuffer>;
  };
}

/** Which engine encodes: the desktop sidecar when the desktop bridge offers it, else ffmpeg.wasm. */
export function dolbyEncoderEngine(): "sidecar" | "wasm" {
  const bridge = (globalThis as { openreel?: DesktopDolbyBridge }).openreel;
  return typeof bridge?.export?.encodeDolbyAudio === "function" ? "sidecar" : "wasm";
}

export async function encodeDolbyStream(request: DolbyStreamRequest, signal?: AbortSignal): Promise<Uint8Array> {
  const { params } = request;
  if (dolbyEncoderEngine() === "sidecar") {
    const bridge = (globalThis as { openreel?: DesktopDolbyBridge }).openreel!;
    const wav = request.wav.buffer.slice(request.wav.byteOffset, request.wav.byteOffset + request.wav.byteLength) as ArrayBuffer;
    const encoded = await bridge.export!.encodeDolbyAudio!({
      wav,
      codec: params.codec,
      channels: params.channels > 2 ? 6 : 2,
      bitrateKbps: params.bitrateKbps,
      sampleRate: params.sampleRate === 44100 ? 44100 : 48000,
      dialnorm: params.dialnorm,
    });
    return new Uint8Array(encoded);
  }
  const { getFFmpegFallback } = await import("../media/ffmpeg-fallback");
  const ffmpeg = getFFmpegFallback();
  await ffmpeg.load(signal);
  return ffmpeg.encodeAudioStream(request.wav, dolbyEncodeArgs(params), dolbyRawMuxer(params.codec), dolbyFileExtension(params.codec));
}
