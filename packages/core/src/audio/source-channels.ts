import {
  FORMAT_CHANNEL_COUNT,
  MIX_CHANNELS,
  SILENT_CHANNEL,
  isIdentityChannelMap,
  resolveClipChannelMap,
  sameChannelMap,
  sanitizeChannelMap,
  type ChannelPreset,
  type ClipChannelMap,
} from "./channel-map";

/**
 * Multichannel source layout (Premiere "Modify > Audio Channels" on a project item, and the source patch).
 *
 * A source file carries `streams` audio streams of `channels` channels each (an 8-mono WAV is 1 x 8, a MOV with two
 * stereo tracks is 2 x 2). Its LAYOUT is the list of audio clips an edit makes out of it: one group per clip, each
 * reading one stream through a clip channel map. The Source monitor shows one patch indicator (A1..An) per group,
 * and Insert / Overwrite place one audio clip per enabled, patched group.
 *
 * "Use file" (no stored layout) groups every stream by its own channel count: mono, stereo and 5.1 streams stay one
 * clip; a stream of any other width (3, 4, 5, 7, 8, ... channels, an unlabelled poly file) is one mono clip per channel.
 */

/** Layout presets: "file" is the file's own grouping, the rest regroup every channel. */
export type SourceLayoutPreset = "file" | "mono" | "stereo" | "5.1";
export const SOURCE_LAYOUT_PRESETS: readonly SourceLayoutPreset[] = ["file", "mono", "stereo", "5.1"];
export const SOURCE_LAYOUT_PRESET_LABELS: Readonly<Record<SourceLayoutPreset, string>> = {
  file: "Use file",
  mono: "All mono",
  stereo: "Stereo pairs",
  "5.1": "5.1 groups",
};
export const isSourceLayoutPreset = (value: unknown): value is SourceLayoutPreset =>
  value === "file" || value === "mono" || value === "stereo" || value === "5.1";

/** One audio clip an edit places: a clip channel map over one audio stream of the file. */
export interface SourceChannelGroup {
  /** 0-based audio stream of the file (`clip.audioTrackIndex`). */
  readonly stream: number;
  readonly map: ClipChannelMap;
}

/** Most audio clips one source can expand to (the patch panel and the timeline stay usable). */
export const MAX_SOURCE_GROUPS = 32;
const MAX_STREAMS = 64;

export interface SourceAudioShape {
  readonly streams: number;
  /** The widest stream (what a decode has to keep). */
  readonly channels: number;
  /** Channels of every stream, in stream order. A file can mix widths (a mono dialogue track beside a stereo mix). */
  readonly streamChannels: readonly number[];
}

interface SourceMediaLike {
  readonly type?: string;
  readonly channelLayout?: readonly SourceChannelGroup[];
  readonly channelPreset?: ChannelPreset;
  readonly metadata?: {
    readonly channels?: number;
    readonly audioTrackCount?: number;
    readonly audioStreamChannels?: readonly number[];
    readonly hasAudio?: boolean;
  };
}

export function sourceAudioShape(media: SourceMediaLike | undefined): SourceAudioShape {
  const metadata = media?.metadata;
  const streams = Math.min(MAX_STREAMS, Math.max(1, Math.round(metadata?.audioTrackCount ?? 1) || 1));
  const fallback = Math.min(64, Math.max(1, Math.round(metadata?.channels ?? 2) || 2));
  const reported = metadata?.audioStreamChannels;
  const streamChannels = Array.from({ length: streams }, (_, stream) => {
    const value = reported?.[stream];
    return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.min(64, Math.round(value)) : fallback;
  });
  return { streams, channels: reported ? Math.max(...streamChannels) : fallback, streamChannels };
}

/** Channels of one stream of a source (the widest when the stream is unknown). */
export const streamChannelCount = (shape: SourceAudioShape, stream: number): number => shape.streamChannels[stream] ?? shape.channels;

const mono = (channel: number): ClipChannelMap => ({ format: "mono", sources: [channel] });
const stereo = (left: number, right: number): ClipChannelMap => ({ format: "stereo", sources: [left, right] });

/** The groups a preset makes of a source shape. */
export function buildSourceGroups(preset: SourceLayoutPreset, shape: SourceAudioShape): SourceChannelGroup[] {
  const groups: SourceChannelGroup[] = [];
  for (let stream = 0; stream < shape.streams; stream++) {
    const channels = streamChannelCount(shape, stream);
    if (preset === "file") {
      if (channels === 1) groups.push({ stream, map: mono(0) });
      else if (channels === 2) groups.push({ stream, map: stereo(0, 1) });
      else if (channels === 6) groups.push({ stream, map: { format: "5.1", sources: [0, 1, 2, 3, 4, 5] } });
      else for (let c = 0; c < channels; c++) groups.push({ stream, map: mono(c) });
    } else if (preset === "mono") {
      for (let c = 0; c < channels; c++) groups.push({ stream, map: mono(c) });
    } else if (preset === "stereo") {
      if (channels === 1) groups.push({ stream, map: stereo(0, 0) });
      for (let c = 0; channels > 1 && c < channels; c += 2) {
        groups.push({ stream, map: c + 1 < channels ? stereo(c, c + 1) : mono(c) });
      }
    } else {
      let c = 0;
      for (; c + 6 <= channels; c += 6) groups.push({ stream, map: { format: "5.1", sources: [c, c + 1, c + 2, c + 3, c + 4, c + 5] } });
      for (; c < channels; c++) groups.push({ stream, map: mono(c) });
    }
  }
  return groups.slice(0, MAX_SOURCE_GROUPS);
}

/** Normalises an untrusted layout (saved project, agent call); undefined when nothing valid is left. */
export function sanitizeSourceLayout(value: unknown): SourceChannelGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups: SourceChannelGroup[] = [];
  for (const entry of value.slice(0, MAX_SOURCE_GROUPS)) {
    if (!entry || typeof entry !== "object") continue;
    const { stream, map } = entry as { stream?: unknown; map?: unknown };
    const cleaned = sanitizeChannelMap(map);
    if (!cleaned || typeof stream !== "number" || !Number.isInteger(stream) || stream < 0 || stream >= MAX_STREAMS) continue;
    groups.push({ stream, map: cleaned });
  }
  return groups.length ? groups : undefined;
}

/** Keeps a stored layout inside what the file actually has: unknown streams are dropped, unknown channels go silent. */
function fitToShape(groups: readonly SourceChannelGroup[], shape: SourceAudioShape): SourceChannelGroup[] {
  return groups
    .filter((group) => group.stream < shape.streams)
    .map((group) => ({
      stream: group.stream,
      map: {
        format: group.map.format,
        sources: group.map.sources.map((entry) => (entry >= streamChannelCount(shape, group.stream) ? SILENT_CHANNEL : entry)),
      },
    }));
}

/** The audio clips an edit makes out of a source, in patch order (A1, A2, ...). Empty for a source without audio. */
export function resolveSourceChannelGroups(media: SourceMediaLike | undefined): SourceChannelGroup[] {
  if (!media) return [];
  const hasAudio = media.type === "audio" || (media.type === "video" && media.metadata?.hasAudio !== false);
  if (!hasAudio) return [];
  const shape = sourceAudioShape(media);
  const stored = media.channelLayout ? fitToShape(sanitizeSourceLayout(media.channelLayout) ?? [], shape) : [];
  return stored.length ? stored : buildSourceGroups("file", shape);
}

/** True when the source expands to more than one audio clip: the multichannel source patch applies. */
export const isMultichannelSource = (media: SourceMediaLike | undefined): boolean => resolveSourceChannelGroups(media).length > 1;

export const sameSourceLayout = (a: readonly SourceChannelGroup[], b: readonly SourceChannelGroup[]): boolean =>
  a.length === b.length && a.every((group, index) => group.stream === b[index].stream && sameChannelMap(group.map, b[index].map));

/** The preset a source's layout corresponds to, or null for a custom layout. */
export function matchSourceLayoutPreset(media: SourceMediaLike | undefined): SourceLayoutPreset | null {
  const current = resolveSourceChannelGroups(media);
  const shape = sourceAudioShape(media);
  for (const preset of SOURCE_LAYOUT_PRESETS) {
    if (sameSourceLayout(current, buildSourceGroups(preset, shape))) return preset;
  }
  return null;
}

/**
 * The clip fields an audio clip of this group needs. The channel map is left off when it equals the stream played
 * untouched and the file has no import default that would otherwise apply.
 */
export function clipFieldsForGroup(
  group: SourceChannelGroup,
  media: SourceMediaLike | undefined,
): { audioTrackIndex?: number; channelMap?: ClipChannelMap } {
  const shape = sourceAudioShape(media);
  const overridesPreset = !!media?.channelPreset && media.channelPreset !== "file";
  const identity = isIdentityChannelMap(group.map, streamChannelCount(shape, group.stream));
  return {
    ...(group.stream > 0 ? { audioTrackIndex: group.stream } : {}),
    ...(identity && !overridesPreset ? {} : { channelMap: group.map }),
  };
}

/** Patch indicator name of group `index` ("A1" ...). */
export const patchLabel = (index: number): string => `A${index + 1}`;

/** Short description of what a group plays, e.g. "Stereo (ch 3 + 4)", "Mono (ch 5)", "Stream 2 Stereo". */
export function describeSourceGroup(group: SourceChannelGroup, streams = 1): string {
  const format = group.map.format === "mono" ? "Mono" : group.map.format === "stereo" ? "Stereo" : "5.1";
  const parts = group.map.sources.map((entry) => (entry === SILENT_CHANNEL ? "off" : entry === MIX_CHANNELS ? "mix" : `${entry + 1}`));
  const where = group.map.format === "5.1" && parts.join("") === "123456" ? "" : ` (ch ${parts.join(" + ")})`;
  return `${streams > 1 ? `Stream ${group.stream + 1} ` : ""}${format}${where}`;
}

/** A clip's flattened source channels: streams are laid end to end, so stream 1 channel 0 of a 2 x 2 file is channel 3. */
export function flattenedSourceChannels(
  clip: { readonly audioTrackIndex?: number; readonly channelMap?: ClipChannelMap },
  media: SourceMediaLike | undefined,
): { format: ClipChannelMap["format"]; sources: number[]; fileChannels: number } {
  const shape = sourceAudioShape(media);
  const stream = Math.min(Math.max(0, clip.audioTrackIndex ?? 0), shape.streams - 1);
  const width = streamChannelCount(shape, stream);
  const map = resolveClipChannelMap(clip, media) ?? { format: width === 1 ? "mono" as const : width === 6 ? "5.1" as const : "stereo" as const, sources: Array.from({ length: width === 1 ? 1 : width === 6 ? 6 : 2 }, (_, i) => i) };
  const base = shape.streamChannels.slice(0, stream).reduce((sum, width) => sum + width, 0);
  return {
    format: map.format,
    fileChannels: shape.streamChannels.reduce((sum, width) => sum + width, 0),
    sources: map.sources.slice(0, FORMAT_CHANNEL_COUNT[map.format]).map((entry) => (entry >= 0 ? base + entry : entry)),
  };
}
