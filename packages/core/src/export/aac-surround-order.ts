import { SURROUND_CHANNELS } from "../audio/surround";

type MediaBunnyModule = typeof import("mediabunny");

/**
 * Channel order the browser's AAC encoder reads a six-channel buffer in.
 *
 * Mixes here are L R C LFE Ls Rs (Web Audio / SMPTE). The AAC bitstream for
 * channelConfiguration 6 is C L R Ls Rs LFE, and Chrome's WebCodecs encoder does
 * not translate between them: it takes channel 0 as the bitstream's first
 * channel. Fed a Web Audio ordered buffer it writes a file whose speakers are
 * rotated (centre on L, L on R, ...; measured by decoding the exported file).
 *
 * `order[slot]` is the mix channel to put in encoder input `slot`. The standard
 * answer is MPEG order; `resolveAacSurroundOrder` measures what this browser
 * actually does (encode six distinct tones, decode them back) and derives the
 * permutation that makes the decoded file come back as L R C LFE Ls Rs, falling
 * back to MPEG order when it cannot measure.
 */
export const MPEG_5_1_INPUT_ORDER: readonly number[] = [2, 0, 1, 4, 5, 3];

/** True for a permutation of 0..n-1. */
export const isPermutation = (order: readonly number[], size = order.length): boolean =>
  order.length === size && new Set(order).size === size && order.every((v) => Number.isInteger(v) && v >= 0 && v < size);

/**
 * Given the probe result `heard[output] = input slot whose tone came out on that
 * output channel`, the input order that restores identity: slot `heard[o]` must
 * carry mix channel `o`. Null when the probe is not a permutation.
 */
export function inputOrderFromProbe(heard: readonly number[]): number[] | null {
  if (!isPermutation(heard, SURROUND_CHANNELS)) return null;
  const order = new Array<number>(SURROUND_CHANNELS).fill(0);
  heard.forEach((slot, output) => {
    order[slot] = output;
  });
  return order;
}

/** Applies an input order to per-channel PCM (a new array of the same channel data, reordered). */
export function reorderChannels<T>(channels: readonly T[], order: readonly number[]): T[] {
  return order.map((source) => channels[source]);
}

// Low tones: the LFE slot of an AAC stream is band-limited (about 120 Hz), so every probe tone must survive there.
const PROBE_TONES = [30, 40, 50, 60, 70, 80];

let measured: Promise<readonly number[]> | undefined;

/** The encoder input order for six-channel AAC, measured once per page load. */
export function resolveAacSurroundOrder(library: MediaBunnyModule, sampleRate: number, bitrate: number): Promise<readonly number[]> {
  measured ??= measureAacSurroundOrder(library, sampleRate, bitrate)
    .then((order) => order ?? MPEG_5_1_INPUT_ORDER)
    .catch(() => MPEG_5_1_INPUT_ORDER);
  return measured;
}

/** Forget the measurement (tests). */
export function resetAacSurroundOrderProbe(): void {
  measured = undefined;
}

async function measureAacSurroundOrder(library: MediaBunnyModule, sampleRate: number, bitrate: number): Promise<number[] | null> {
  const { Output, BufferTarget, Mp4OutputFormat, AudioBufferSource, Input, BufferSource, ALL_FORMATS, AudioSampleSink } = library;
  const length = sampleRate; // one second
  const probe = new AudioBuffer({ length, numberOfChannels: SURROUND_CHANNELS, sampleRate });
  for (let c = 0; c < SURROUND_CHANNELS; c++) {
    const data = probe.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = 0.4 * Math.sin((2 * Math.PI * PROBE_TONES[c] * i) / sampleRate);
  }
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new AudioBufferSource({ codec: "aac", bitrate });
  output.addAudioTrack(source);
  let finalized = false;
  try {
    await output.start();
    await source.add(probe);
    source.close();
    await output.finalize();
    finalized = true;
    if (!target.buffer) return null;
    const input = new Input({ source: new BufferSource(target.buffer), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return null;
      const decoded = Array.from({ length: SURROUND_CHANNELS }, () => new Float32Array(length));
      let seen = 0;
      for await (const sample of new AudioSampleSink(track).samples()) {
        try {
          const pcm = sample.toAudioBuffer();
          if (pcm.numberOfChannels !== SURROUND_CHANNELS) return null;
          const offset = Math.max(0, Math.round(sample.timestamp * sampleRate));
          for (let c = 0; c < SURROUND_CHANNELS; c++) {
            const part = pcm.getChannelData(c).subarray(0, Math.max(0, length - offset));
            decoded[c].set(part, offset);
          }
          seen += pcm.length;
        } finally {
          sample.close();
        }
      }
      if (seen < length / 2) return null;
      // Which probe tone is loudest on each decoded channel (middle of the signal, clear of priming).
      const from = Math.floor(length * 0.25);
      const to = Math.floor(length * 0.75);
      const heard = decoded.map((channel) => {
        let best = -1;
        let bestAmp = 0;
        PROBE_TONES.forEach((freq, slot) => {
          let re = 0;
          let im = 0;
          for (let i = from; i < to; i++) {
            const w = (2 * Math.PI * freq * i) / sampleRate;
            re += channel[i] * Math.cos(w);
            im -= channel[i] * Math.sin(w);
          }
          const amp = (2 * Math.hypot(re, im)) / (to - from);
          if (amp > bestAmp) {
            bestAmp = amp;
            best = slot;
          }
        });
        return bestAmp > 0.1 ? best : -1;
      });
      return inputOrderFromProbe(heard);
    } finally {
      input.dispose();
    }
  } finally {
    source.close();
    if (!finalized) await output.cancel().catch(() => {});
  }
}
