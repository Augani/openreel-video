/**
 * 5.1 surround: channel layout, panning and routing matrices, and the Web Audio
 * nodes that apply them. Everything here is a pure function of the data model
 * (or builds nodes from it), so the live preview graph, the offline mixdown,
 * stems and the unit tests all use the same numbers.
 *
 * Channel order is the Web Audio / WebCodecs / SMPTE 5.1 order used everywhere
 * in a 5.1 mix: L, R, C, LFE, Ls, Rs. Stereo sequences never reach this module's
 * node builders: they keep the exact stereo graph they always had.
 */

export type ChannelLayout = "stereo" | "5.1";

export const CHANNEL_LAYOUTS: readonly ChannelLayout[] = ["stereo", "5.1"];

export const SURROUND_CHANNELS = 6;
/** Index of each speaker in a 5.1 buffer. */
export const CH_L = 0;
export const CH_R = 1;
export const CH_C = 2;
export const CH_LFE = 3;
export const CH_LS = 4;
export const CH_RS = 5;
export const SURROUND_CHANNEL_NAMES = ["L", "R", "C", "LFE", "Ls", "Rs"] as const;

export const LAYOUT_LABELS: Record<ChannelLayout, string> = { stereo: "Stereo", "5.1": "5.1 Surround" };

/** The subset of ProjectSettings this module needs. */
export interface LayoutSettings {
  readonly channelLayout?: ChannelLayout;
  readonly channels?: number;
}

export function isChannelLayout(value: unknown): value is ChannelLayout {
  return value === "stereo" || value === "5.1";
}

/** Sequence layout. Absent = stereo, so every project saved before this setting behaves as before. */
export function getChannelLayout(settings: LayoutSettings | undefined): ChannelLayout {
  return settings?.channelLayout === "5.1" ? "5.1" : "stereo";
}

export const isSurroundLayout = (settings: LayoutSettings | undefined): boolean => getChannelLayout(settings) === "5.1";

export const layoutChannelCount = (layout: ChannelLayout): number => (layout === "5.1" ? SURROUND_CHANNELS : 2);

/**
 * Channels the mixdown has: 6 for a 5.1 sequence, otherwise the legacy
 * `settings.channels` (default 2), unchanged.
 */
export function mixChannelCount(settings: LayoutSettings | undefined, fallback = 2): number {
  return isSurroundLayout(settings) ? SURROUND_CHANNELS : settings?.channels || fallback;
}

/**
 * Channels an ffmpeg fallback decode (`extractAudioWav`) must keep for a source of `sourceChannels`
 * channels: a 5.1 sequence keeps the source's own channels up to six (a stereo source stays stereo,
 * the panner positions it later; asking ffmpeg for `-ac 6` would invent channels). A stereo
 * sequence returns undefined = the legacy stereo decode, unchanged.
 */
export function fallbackDecodeChannels(layout: ChannelLayout, sourceChannels: number | undefined): number | undefined {
  if (layout !== "5.1") return undefined;
  const count = Math.floor(Number.isFinite(sourceChannels) ? (sourceChannels as number) : 2);
  return Math.min(SURROUND_CHANNELS, Math.max(1, count || 2));
}

/** Settings patch for a layout change: layout and channel count always move together. */
export function layoutSettingsPatch(layout: ChannelLayout): { channelLayout: ChannelLayout; channels: number } {
  return { channelLayout: layout, channels: layoutChannelCount(layout) };
}

// ---------------------------------------------------------------------------
// Surround panner
// ---------------------------------------------------------------------------

/**
 * Position of a source in the listening room.
 *  x: -1 (left) .. 1 (right)
 *  y: -1 (rear) .. 1 (front)
 *  divergence 0..1: how much of the front image is pulled into the centre
 *     speaker (0 = phantom image between L and R only, 1 = a source at x=0
 *     comes from C alone). The effect fades out towards the hard-left/right edges.
 *  lfeSend 0..1: linear level of the signal also sent to the LFE channel.
 */
export interface SurroundPan {
  readonly x: number;
  readonly y: number;
  readonly divergence: number;
  readonly lfeSend: number;
}

export const DEFAULT_SURROUND_PAN: SurroundPan = { x: 0, y: 1, divergence: 0, lfeSend: 0 };

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

export function sanitizeSurroundPan(value: Partial<SurroundPan> | null | undefined): SurroundPan {
  const d = DEFAULT_SURROUND_PAN;
  return {
    x: clamp(value?.x ?? d.x, -1, 1),
    y: clamp(value?.y ?? d.y, -1, 1),
    divergence: clamp(value?.divergence ?? d.divergence, 0, 1),
    lfeSend: clamp(value?.lfeSend ?? d.lfeSend, 0, 1),
  };
}

export const isDefaultSurroundPan = (pan: SurroundPan | undefined): boolean => {
  if (!pan) return true;
  const p = sanitizeSurroundPan(pan);
  return p.x === 0 && p.y === 1 && p.divergence === 0 && p.lfeSend === 0;
};

/** The clip's own panner if it has one, otherwise the track's (otherwise the default). */
export function resolveSurroundPan(
  clip: { readonly surroundPan?: SurroundPan } | undefined,
  track: { readonly surroundPan?: SurroundPan } | undefined,
): SurroundPan {
  return sanitizeSurroundPan(clip?.surroundPan ?? track?.surroundPan);
}

/**
 * Constant-power gains (L, R, C, LFE, Ls, Rs) for ONE mono signal at a position.
 * The six speaker feeds (LFE excluded) always sum to unit power, so moving a
 * source around never changes its level.
 *
 *   front/back split: sin / cos of the y position (constant power)
 *   front: L/R pan law on x, then `divergence` moves a share of the power to C
 *   back:  L/R pan law on x between Ls and Rs
 */
export function surroundPanGains(input: Partial<SurroundPan>): number[] {
  const pan = sanitizeSurroundPan(input);
  const front = Math.sin(((pan.y + 1) / 2) * (Math.PI / 2));
  const back = Math.cos(((pan.y + 1) / 2) * (Math.PI / 2));
  const angle = ((pan.x + 1) / 2) * (Math.PI / 2);
  const left = Math.cos(angle);
  const right = Math.sin(angle);
  const centreShare = pan.divergence * (1 - Math.abs(pan.x));
  const spread = Math.sqrt(1 - centreShare);
  const gains = new Array<number>(SURROUND_CHANNELS).fill(0);
  gains[CH_L] = front * left * spread;
  gains[CH_R] = front * right * spread;
  gains[CH_C] = front * Math.sqrt(centreShare);
  gains[CH_LFE] = pan.lfeSend;
  gains[CH_LS] = back * left;
  gains[CH_RS] = back * right;
  // cos(pi/2) is 6e-17, not 0: snap so an exact corner is an exact single-speaker feed.
  return gains.map((g) => (Math.abs(g) < 1e-12 ? 0 : g));
}

/** Where each channel of a multichannel source lands when it is not positioned (already a layout). */
function passThroughTargets(sourceChannels: number): number[] {
  if (sourceChannels === 4) return [CH_L, CH_R, CH_LS, CH_RS]; // quad: L R Ls Rs
  if (sourceChannels === 5) return [CH_L, CH_R, CH_C, CH_LS, CH_RS]; // 5.0
  return Array.from({ length: Math.min(sourceChannels, SURROUND_CHANNELS) }, (_, i) => i); // 3, 6 and wider
}

/**
 * Routing matrix `matrix[outputChannel][sourceChannel]` of a source with
 * `sourceChannels` channels into the 6 channels of a 5.1 mix.
 *
 *  1 channel   panned at (x, y)
 *  2 channels  a stereo pair: the left channel is panned at x - 1 and the right
 *              at x + 1 (clamped), so x = 0, y = 1 is the identity L->L, R->R
 *              and moving x or y moves the whole image
 *  3+ channels already a layout (5.1 maps L R C LFE Ls Rs straight to its own
 *              channels, 5.0 and quad to the matching ones). They are not
 *              panned: position does not apply, the clip/track gain does.
 */
export function sourceToSurroundMatrix(sourceChannels: number, input: Partial<SurroundPan> = DEFAULT_SURROUND_PAN): number[][] {
  const count = Math.max(1, Math.floor(sourceChannels));
  const matrix = Array.from({ length: SURROUND_CHANNELS }, () => new Array<number>(count).fill(0));
  if (count === 1) {
    surroundPanGains(input).forEach((gain, out) => (matrix[out][0] = gain));
    return matrix;
  }
  if (count === 2) {
    const pan = sanitizeSurroundPan(input);
    const left = surroundPanGains({ ...pan, x: clamp(pan.x - 1, -1, 1) });
    const right = surroundPanGains({ ...pan, x: clamp(pan.x + 1, -1, 1) });
    for (let out = 0; out < SURROUND_CHANNELS; out++) {
      // The LFE send is for the whole signal, not per side: split it evenly so a
      // full-scale send adds the pair's mono sum at unity.
      matrix[out][0] = out === CH_LFE ? left[out] / 2 : left[out];
      matrix[out][1] = out === CH_LFE ? right[out] / 2 : right[out];
    }
    return matrix;
  }
  passThroughTargets(count).forEach((out, source) => {
    matrix[out][source] = 1;
  });
  return matrix;
}

/** True when the source is positioned by the panner (mono and stereo), false when it is passed through. */
export const isPositionedSource = (sourceChannels: number): boolean => sourceChannels <= 2;

// ---------------------------------------------------------------------------
// Downmix (monitoring and "export as stereo")
// ---------------------------------------------------------------------------

/**
 * ITU-R BS.775 downmix 5.1 -> stereo: Lo = L + 0.707 C + 0.707 Ls, Ro likewise;
 * the LFE is left out. The same coefficients the Web Audio spec uses when a
 * 6-channel signal is mixed down to a stereo output, so the live preview (which
 * monitors through the audio device's stereo output) and an "as stereo" export
 * agree.
 */
export const DOWNMIX_5_1_TO_STEREO: readonly (readonly number[])[] = [
  [1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0],
  [0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2],
];

export function downmixSurroundToStereo(channels: readonly ArrayLike<number>[], length = channels[0]?.length ?? 0): Float32Array[] {
  const out = [new Float32Array(length), new Float32Array(length)];
  for (let o = 0; o < 2; o++) {
    for (let c = 0; c < Math.min(channels.length, SURROUND_CHANNELS); c++) {
      const g = DOWNMIX_5_1_TO_STEREO[o][c];
      if (g === 0) continue;
      const src = channels[c];
      const dst = out[o];
      for (let i = 0; i < length; i++) dst[i] += g * src[i];
    }
  }
  return out;
}

/** Matrix (rows = outputs) of a clip/track pan resolved for a given source layout. */
export function describeMatrix(matrix: readonly (readonly number[])[]): string {
  return matrix.map((row) => row.map((v) => v.toFixed(3)).join(" ")).join(" / ");
}

// ---------------------------------------------------------------------------
// Web Audio nodes
// ---------------------------------------------------------------------------

export interface SurroundPannerNodes {
  /** Connect the clip signal here (explicit channel count = the source's, discrete). */
  readonly input: AudioNode;
  /** Six discrete channels. */
  readonly output: AudioNode;
  readonly sourceChannels: number;
  /** Set a new position (live mixer moves); no nodes are rebuilt. */
  setPan(pan: Partial<SurroundPan>, when?: number): void;
  dispose(): void;
}

/**
 * Splitter -> per-route gain -> 6-input merger. Every connection is discrete,
 * so no Web Audio up/down-mix rule ever touches the signal: the matrix is the
 * whole story. Offline and live use the same builder; the live mixer calls
 * `setPan`, which only changes gain values.
 */
export function createSurroundPanner(ctx: BaseAudioContext, sourceChannels: number, pan: Partial<SurroundPan> = DEFAULT_SURROUND_PAN): SurroundPannerNodes {
  const count = Math.max(1, Math.floor(sourceChannels));
  const input = ctx.createGain();
  input.channelCount = count;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "discrete";
  const splitter = ctx.createChannelSplitter(count);
  const merger = ctx.createChannelMerger(SURROUND_CHANNELS);
  input.connect(splitter);
  const positioned = isPositionedSource(count);
  const routes: { out: number; source: number; gain: GainNode }[] = [];
  const matrix = sourceToSurroundMatrix(count, pan);
  for (let out = 0; out < SURROUND_CHANNELS; out++) {
    for (let source = 0; source < count; source++) {
      // Passed-through layouts only need their wired routes; positioned sources keep every route so moving never rebuilds.
      if (!positioned && matrix[out][source] === 0) continue;
      const gain = ctx.createGain();
      gain.gain.value = matrix[out][source];
      splitter.connect(gain, source);
      gain.connect(merger, 0, out);
      routes.push({ out, source, gain });
    }
  }
  return {
    input,
    output: merger,
    sourceChannels: count,
    setPan(next, when) {
      if (!positioned) return;
      const m = sourceToSurroundMatrix(count, next);
      for (const route of routes) {
        if (when === undefined) route.gain.gain.value = m[route.out][route.source];
        else route.gain.gain.setTargetAtTime(m[route.out][route.source], when, 0.01);
      }
    },
    dispose() {
      for (const node of [input, splitter, merger, ...routes.map((r) => r.gain)]) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    },
  };
}

/**
 * Splits a 6-channel signal into three stereo pairs (L R / C LFE / Ls Rs), so
 * the stereo effect racks can run on each pair, and merges them back. Returns
 * the per-pair stereo ends to attach a rack to.
 */
export interface SurroundPairs {
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly pairs: readonly { readonly input: AudioNode; readonly output: AudioNode }[];
  dispose(): void;
}

export const SURROUND_PAIRS: readonly (readonly [number, number])[] = [
  [CH_L, CH_R],
  [CH_C, CH_LFE],
  [CH_LS, CH_RS],
];

export function createSurroundPairs(
  ctx: BaseAudioContext,
  makePair: (index: number) => { readonly input: AudioNode; readonly output: AudioNode },
): SurroundPairs {
  const input = ctx.createGain();
  input.channelCount = SURROUND_CHANNELS;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "discrete";
  const splitter = ctx.createChannelSplitter(SURROUND_CHANNELS);
  const output = ctx.createChannelMerger(SURROUND_CHANNELS);
  input.connect(splitter);
  const pairs = SURROUND_PAIRS.map(([a, b], index) => {
    const pair = makePair(index);
    const feed = ctx.createChannelMerger(2);
    splitter.connect(feed, a, 0);
    splitter.connect(feed, b, 1);
    feed.connect(pair.input);
    const back = ctx.createChannelSplitter(2);
    pair.output.connect(back);
    back.connect(output, 0, a);
    back.connect(output, 1, b);
    return pair;
  });
  return {
    input,
    output,
    pairs,
    dispose() {
      for (const node of [input, splitter, output]) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    },
  };
}
