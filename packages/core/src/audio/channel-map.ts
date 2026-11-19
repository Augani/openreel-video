/**
 * Audio channel mapping (Premiere "Modify > Audio Channels").
 *
 * A clip's channel map says what each of its OUTPUT channels (mono = 1, stereo = 2, 5.1 = 6)
 * plays from the SOURCE file. One entry per output channel:
 *   - n >= 0       source channel n (0-based: L, R, C, LFE, Ls, Rs for a 5.1 file)
 *   - SILENT (-1)  the channel is muted
 *   - MIX (-2)     the average of every source channel (a mono fold-down)
 * The map is applied to the decoded source buffer, so preview, waveforms, metering and the
 * export mixdown all hear the same thing.
 */

export type ClipChannelFormat = "mono" | "stereo" | "5.1";
/** What a newly imported file defaults to. "file" follows the file's own channel layout. */
export type ChannelPreset = "file" | "mono" | "stereo";

export const SILENT_CHANNEL = -1;
export const MIX_CHANNELS = -2;

export const CLIP_CHANNEL_FORMATS: readonly ClipChannelFormat[] = ["mono", "stereo", "5.1"];
export const CHANNEL_PRESETS: readonly ChannelPreset[] = ["file", "mono", "stereo"];
export const FORMAT_CHANNEL_COUNT: Readonly<Record<ClipChannelFormat, number>> = { mono: 1, stereo: 2, "5.1": 6 };
export const FORMAT_CHANNEL_NAMES: Readonly<Record<ClipChannelFormat, readonly string[]>> = {
  mono: ["Mono"],
  stereo: ["Left", "Right"],
  "5.1": ["L", "R", "C", "LFE", "Ls", "Rs"],
};
export const CHANNEL_PRESET_LABELS: Readonly<Record<ChannelPreset, string>> = {
  file: "Use file",
  mono: "Mono",
  stereo: "Stereo",
};

export interface ClipChannelMap {
  readonly format: ClipChannelFormat;
  /** Source channel for each output channel; `sources.length === FORMAT_CHANNEL_COUNT[format]`. */
  readonly sources: readonly number[];
}

export const isClipChannelFormat = (value: unknown): value is ClipChannelFormat =>
  value === "mono" || value === "stereo" || value === "5.1";
export const isChannelPreset = (value: unknown): value is ChannelPreset =>
  value === "file" || value === "mono" || value === "stereo";

/** Channel format a file has on its own. */
export function fileChannelFormat(sourceChannels: number | undefined): ClipChannelFormat {
  const count = Math.round(sourceChannels ?? 2);
  if (count <= 1) return "mono";
  return count >= 6 ? "5.1" : "stereo";
}

/** The map that plays a file untouched. */
export function identityChannelMap(sourceChannels: number | undefined): ClipChannelMap {
  const format = fileChannelFormat(sourceChannels);
  const count = FORMAT_CHANNEL_COUNT[format];
  return { format, sources: Array.from({ length: count }, (_, index) => index) };
}

const sourceCount = (sourceChannels: number | undefined): number => Math.max(1, Math.round(sourceChannels ?? 2));

/** Normalises untrusted input (saved project, agent call); undefined when it is not a valid map. */
export function sanitizeChannelMap(value: unknown): ClipChannelMap | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { format, sources } = value as { format?: unknown; sources?: unknown };
  if (!isClipChannelFormat(format) || !Array.isArray(sources)) return undefined;
  const count = FORMAT_CHANNEL_COUNT[format];
  const cleaned = Array.from({ length: count }, (_, index) => {
    const entry = sources[index];
    if (entry === MIX_CHANNELS) return MIX_CHANNELS;
    return typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry < 64 ? entry : SILENT_CHANNEL;
  });
  return { format, sources: cleaned };
}

/** The map a preset gives a file of `sourceChannels` channels; undefined for "file" (no mapping). */
export function presetChannelMap(preset: ChannelPreset | undefined, sourceChannels: number | undefined): ClipChannelMap | undefined {
  if (!preset || preset === "file") return undefined;
  if (preset === "mono") return { format: "mono", sources: [0] };
  return { format: "stereo", sources: sourceCount(sourceChannels) > 1 ? [0, 1] : [0, 0] };
}

/** Preset a map corresponds to for a file of `sourceChannels` channels, or null for a custom map. */
export function matchChannelPreset(map: ClipChannelMap | undefined, sourceChannels: number | undefined): ChannelPreset | null {
  if (!map || isIdentityChannelMap(map, sourceChannels)) return "file";
  for (const preset of ["mono", "stereo"] as const) {
    const candidate = presetChannelMap(preset, sourceChannels);
    if (candidate && sameChannelMap(candidate, map)) return preset;
  }
  return null;
}

/** True when a map reads source channels a stereo decode would have folded away (a 5.1 output, or a source beyond L/R). */
export const channelMapNeedsWideSource = (map: ClipChannelMap | undefined): boolean =>
  !!map && (map.format === "5.1" || map.sources.some((entry) => entry >= 2));

export const sameChannelMap = (a: ClipChannelMap | undefined, b: ClipChannelMap | undefined): boolean =>
  a === b || (!!a && !!b && a.format === b.format && a.sources.length === b.sources.length && a.sources.every((source, index) => source === b.sources[index]));

export function isIdentityChannelMap(map: ClipChannelMap | undefined, sourceChannels: number | undefined): boolean {
  return !map || sameChannelMap(map, identityChannelMap(sourceChannels));
}

/**
 * The mapping as a matrix: `matrix[output][source]` is the gain of that source channel in that
 * output channel (0 or 1, or 1/N for a MIX row). The unit-tested definition of a channel map.
 */
export function channelMatrix(map: ClipChannelMap, sourceChannels: number): number[][] {
  const available = sourceCount(sourceChannels);
  return map.sources.map((entry) => {
    const row = new Array<number>(available).fill(0);
    if (entry === MIX_CHANNELS) row.fill(1 / available);
    else if (entry >= 0 && entry < available) row[entry] = 1;
    return row;
  });
}

/** Applies a map to decoded channel data. Single-source outputs reuse the source array; mixes and silence allocate. */
export function applyChannelMapToChannels(channels: readonly Float32Array[], map: ClipChannelMap): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const matrix = channelMatrix(map, channels.length);
  return matrix.map((row) => {
    const taps = row.flatMap((gain, source) => (gain === 0 ? [] : [[source, gain] as const]));
    if (taps.length === 0) return new Float32Array(length);
    if (taps.length === 1 && taps[0][1] === 1) return channels[taps[0][0]];
    const out = new Float32Array(length);
    for (const [source, gain] of taps) {
      const data = channels[source];
      for (let i = 0; i < length; i++) out[i] += data[i] * gain;
    }
    return out;
  });
}

const mappedBuffers = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
const mapKey = (map: ClipChannelMap): string => `${map.format}:${map.sources.join(",")}`;

/** The clip-channel buffer for a decoded source buffer; the source itself when the map changes nothing. Cached per source buffer. */
export function mapAudioBuffer(context: Pick<BaseAudioContext, "createBuffer">, buffer: AudioBuffer, map: ClipChannelMap | undefined): AudioBuffer {
  if (!map || isIdentityChannelMap(map, buffer.numberOfChannels)) return buffer;
  const key = mapKey(map);
  const cached = mappedBuffers.get(buffer)?.get(key);
  if (cached) return cached;
  const source: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) source.push(buffer.getChannelData(c));
  const mapped = applyChannelMapToChannels(source, map);
  const out = context.createBuffer(mapped.length, Math.max(1, buffer.length), buffer.sampleRate);
  mapped.forEach((data, c) => out.getChannelData(c).set(data));
  let perBuffer = mappedBuffers.get(buffer);
  if (!perBuffer) mappedBuffers.set(buffer, (perBuffer = new Map()));
  perBuffer.set(key, out);
  return out;
}

/** The map a clip plays with: its own, else the file's import preset. undefined = the file as it is. */
export function resolveClipChannelMap(
  clip: { readonly channelMap?: ClipChannelMap },
  media: { readonly channelPreset?: ChannelPreset; readonly metadata?: { readonly channels?: number } } | undefined,
): ClipChannelMap | undefined {
  return clip.channelMap ?? presetChannelMap(media?.channelPreset, media?.metadata?.channels);
}

/** Short human label for a map, e.g. "Mono (Left)", "Stereo (swapped)". */
export function describeChannelMap(map: ClipChannelMap | undefined, sourceChannels: number | undefined): string {
  if (isIdentityChannelMap(map, sourceChannels) || !map) return `${FORMAT_LABELS[fileChannelFormat(sourceChannels)]} (file)`;
  const names = FORMAT_CHANNEL_NAMES[fileChannelFormat(sourceChannels)];
  const parts = map.sources.map((entry) => (entry === SILENT_CHANNEL ? "off" : entry === MIX_CHANNELS ? "mix" : names[entry] ?? `${entry + 1}`));
  return `${FORMAT_LABELS[map.format]} (${parts.join(" / ")})`;
}
const FORMAT_LABELS: Readonly<Record<ClipChannelFormat, string>> = { mono: "Mono", stereo: "Stereo", "5.1": "5.1" };
