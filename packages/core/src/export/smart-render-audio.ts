import type { Clip, MediaItem, Project, Track } from "../types";
import { getCompoundClipId, getProjectClipCapabilities } from "../timeline/timeline-items";
import type { VideoExportSettings } from "./types";

/**
 * Smart rendering, audio side (pure planning; the desktop main process does the copying).
 *
 * The export's audio is a mixdown that is re-rendered and encoded in the final
 * pass. Where the mix is exactly one untouched source stream, the source's own
 * samples can stand in for it:
 *
 *  - AAC export: the source's AAC packets are copied when the audio of the
 *    whole export is that one stream and both cut points sit on AAC frames
 *    (1024 samples, on the source's own frame grid, whose offset is its
 *    encoder delay). A cut inside the stream carries one pre-roll frame.
 *  - PCM export (ProRes MOV masters carry 24-bit PCM): every untouched span of
 *    a 16- or 24-bit PCM source is copied sample for sample and joined with the
 *    rendered mixdown of the remaining spans.
 *
 * Anything else (effects, gain, fades, automation, other clips, different
 * rate or channels, an AAC cut between frames) is rendered as before. The
 * conditions are a whitelist of what the mixer leaves alone, so a feature added
 * to the mixer later makes the audio render, never copy.
 */

export type SmartAudioCodec = "aac" | "pcm";

/** What the planner needs to know about one source's first audio stream (from the native probe). */
export interface SmartAudioSourceInfo {
  readonly mediaId: string;
  readonly codec: SmartAudioCodec;
  readonly sampleRate: number;
  readonly channels: number;
  /** Decoded length with the container's own trim applied (end of the last packet), in samples. */
  readonly sampleCount: number;
  /** The stream plays from its first sample at time 0 (no start offset). */
  readonly startsAtZero: boolean;
  /** AAC: encoder delay trimmed from the start; packet i starts at i * 1024 - priming. */
  readonly priming?: number;
  /** AAC: samples per packet (1024 for AAC-LC). */
  readonly frameSamples?: number;
  /** AAC: packets in the stream. */
  readonly packets?: number;
  readonly bitrateKbps?: number;
}

export type SmartAudioSegment =
  | { readonly kind: "encode"; readonly start: number; readonly end: number }
  | {
      readonly kind: "copy";
      readonly start: number;
      readonly end: number;
      readonly mediaId: string;
      /** Sample of the source's decoded audio that plays at output sample `start`. */
      readonly sourceStart: number;
      readonly priming?: number;
    };

export interface SmartAudioPlan {
  readonly eligible: boolean;
  readonly codec: SmartAudioCodec;
  readonly sampleRate: number;
  readonly channels: number;
  /** Samples of the mixdown the export would write (the sum of its 15 s chunks). */
  readonly totalSamples: number;
  /** Tiles [0, totalSamples). */
  readonly segments: readonly SmartAudioSegment[];
  readonly copiedSamples: number;
  readonly encodedSamples: number;
  readonly copiedSeconds: number;
  readonly encodedSeconds: number;
  /** "whole": one copy covers the export; "spans": copies between rendered spans; "none". */
  readonly mode: "whole" | "spans" | "none";
  readonly reasons: readonly string[];
}

export interface SmartAudioPlanInput {
  readonly project: Project;
  readonly settings: Pick<VideoExportSettings, "format" | "codec"> & {
    readonly audioSettings: Pick<VideoExportSettings["audioSettings"], "format" | "sampleRate" | "channels" | "bitrate"> &
      Partial<Pick<VideoExportSettings["audioSettings"], "loudness" | "channelLayout">>;
    readonly broadcast?: { readonly audioTracks?: number };
  };
  readonly sources: ReadonlyMap<string, SmartAudioSourceInfo>;
  readonly exportStart: number;
  readonly exportDuration: number;
}

/** The export's chunk length, and how many frames the offline render makes of a window (mirrors the audio engine). */
export const AUDIO_EXPORT_CHUNK_SECONDS = 15;
const frameCount = (seconds: number, sampleRate: number): number => Math.max(1, Math.ceil(seconds * sampleRate - 1e-7));

/** Samples of the mixdown for an export of `durationSeconds`: the sum of its 15-second chunks, as the export writes them. */
export function mixdownSampleCount(durationSeconds: number, sampleRate: number): number {
  let total = 0;
  for (let start = 0; start < durationSeconds; start += AUDIO_EXPORT_CHUNK_SECONDS) {
    total += frameCount(Math.min(AUDIO_EXPORT_CHUNK_SECONDS, durationSeconds - start), sampleRate);
  }
  return total;
}

/** Copy spans shorter than this are not worth the bookkeeping of a seam. */
export const MIN_AUDIO_COPY_SECONDS = 0.25;
/** AAC-LC frame length. */
export const AAC_FRAME_SAMPLES = 1024;
/** Tolerance when a time must land on a whole sample. */
const SAMPLE_EPS = 1e-3;

const noPlan = (
  codec: SmartAudioCodec,
  sampleRate: number,
  channels: number,
  totalSamples: number,
  reasons: readonly string[],
): SmartAudioPlan => ({
  eligible: false,
  codec,
  sampleRate,
  channels,
  totalSamples,
  segments: totalSamples > 0 ? [{ kind: "encode", start: 0, end: totalSamples }] : [],
  copiedSamples: 0,
  encodedSamples: totalSamples,
  copiedSeconds: 0,
  encodedSeconds: totalSamples / sampleRate,
  mode: "none",
  reasons: [...new Set(reasons)],
});

/** The audio plan for an export whose audio could not be copied after all: everything is rendered. */
export function declineSmartAudio(plan: SmartAudioPlan, reason: string): SmartAudioPlan {
  return noPlan(plan.codec, plan.sampleRate, plan.channels, plan.totalSamples, [...plan.reasons, reason]);
}

const isWhole = (value: number): boolean => Math.abs(value - Math.round(value)) < SAMPLE_EPS;

/** Mixer features that are project wide: any of them can colour every clip, so the audio is rendered. */
function projectAudioReason(project: Project): string | null {
  const { timeline, settings } = project;
  if (settings.channelLayout === "5.1") return "5.1 sequence";
  const master = timeline.masterAudioRack;
  if (master && (master.effects.length > 0 || (master.volume !== undefined && master.volume !== 1))) return "master bus processing";
  if ((timeline.audioBuses?.length ?? 0) > 0) return "audio buses";
  if (timeline.tracks.some((track) => track.clips.some((clip) => clip.audioEffects?.some((effect) => effect.enabled)))) {
    // A clip plays its linked partner's effects when it has none of its own.
    return "audio effects";
  }
  if (timeline.tracks.some((track) => track.clips.some((clip) => (clip.automation?.volume?.length ?? 0) > 0 || (clip.automation?.pan?.length ?? 0) > 0))) {
    return "volume or pan automation";
  }
  return null;
}

function trackAudioReason(track: Track): string | null {
  const rack = track.audioRack;
  if (rack && (rack.effects.length > 0 || (rack.volume !== undefined && rack.volume !== 1) || (rack.pan !== undefined && rack.pan !== 0))) return "track mixer settings";
  if ((track.pluginRack?.plugins?.length ?? 0) > 0 || (track.pluginRack as { slots?: unknown[] } | undefined)?.slots?.length) return "audio plugins";
  if (track.output) return "track routed to a bus";
  if ((track.sends?.length ?? 0) > 0) return "track sends";
  if ((track.automation?.volume?.length ?? 0) > 0 || (track.automation?.pan?.length ?? 0) > 0) return "track automation";
  return null;
}

/** Why this clip's audio is not simply its source (null when the mixer leaves it alone). */
export function audioClipTouchedReason(track: Track, clip: Clip, media: MediaItem | undefined): string | null {
  if (getCompoundClipId(clip)) return "nested sequence";
  if (clip.volume !== 1) return "clip volume";
  if (clip.fade && (clip.fade.fadeIn > 0 || clip.fade.fadeOut > 0)) return "fade";
  if ((clip.audioEffects?.length ?? 0) > 0) return "audio effects";
  if (clip.effects.some((effect) => effect.enabled && (effect.type === "pan" || effect.type === "fadeIn" || effect.type === "fadeOut"))) return "audio effects";
  if (clip.keyframes.some((keyframe) => /volume|pan|gain|audio|plugin/i.test(keyframe.property))) return "audio keyframes";
  if ((clip.speed ?? 1) !== 1 || clip.reversed) return "speed";
  if ((clip.speedKeyframes?.length ?? 0) > 0) return "speed ramp";
  if ((clip.freezeFrames?.length ?? 0) > 0) return "freeze frame";
  if (clip.metadata?.liveDucking) return "ducking";
  if (clip.channelMap || clip.surroundPan) return "channel mapping";
  if ((clip.audioTrackIndex ?? 0) > 0) return "alternate audio track";
  if (media?.channelPreset && media.channelPreset !== "file") return "channel preset";
  if (track.transitions.some((transition) => transition.clipAId === clip.id || transition.clipBId === clip.id)) return "transition";
  return null;
}

interface AudibleClip {
  readonly track: Track;
  readonly clip: Clip;
  readonly media: MediaItem | undefined;
  /** Output sample where the clip starts (may be negative: it began before the export). */
  readonly startSample: number;
  readonly endSample: number;
}

/** Output span and source offset of the part of `clip` that shows in the export, or null when the timing is not sample aligned. */
function clipSamples(clip: Clip, exportStart: number, sampleRate: number): { startSample: number; endSample: number; shift: number } | null {
  const start = (clip.startTime - exportStart) * sampleRate;
  const inPoint = clip.inPoint * sampleRate;
  const length = clip.duration * sampleRate;
  if (!isWhole(start) || !isWhole(inPoint)) return null;
  const startSample = Math.round(start);
  // The offline mixer stops a clip at a time it rounds to a sample; a fractional end is cut one sample early to stay inside it.
  const endSample = isWhole(length) ? startSample + Math.round(length) : startSample + Math.floor(length) - 1;
  // source sample = output sample + shift
  return { startSample, endSample, shift: Math.round(inPoint) - startSample };
}

/**
 * Plan the audio of a smart-render export. Returns a plan with `eligible: false` (and the reasons) when the audio is
 * to be rendered and encoded as usual.
 */
export function planSmartAudio(input: SmartAudioPlanInput): SmartAudioPlan {
  const { project, settings, sources, exportStart, exportDuration } = input;
  const audio = settings.audioSettings;
  const sampleRate = audio.sampleRate;
  const channels = audio.channels;
  // ProRes masters carry PCM (the native export writes pcm_s24le); every other smart-render codec carries AAC.
  const codec: SmartAudioCodec = settings.codec === "prores" ? "pcm" : "aac";
  const totalSamples = mixdownSampleCount(exportDuration, sampleRate);
  const decline = (...reasons: string[]): SmartAudioPlan => noPlan(codec, sampleRate, channels, totalSamples, reasons);

  if (!(exportDuration > 0)) return decline("empty export");
  if (audio.format === "ac3" || audio.format === "eac3") return decline("Dolby audio is encoded");
  if (channels !== 2) return decline("audio copy handles stereo only");
  if (audio.loudness?.enabled) return decline("loudness normalisation changes the audio");
  if (typeof settings.broadcast?.audioTracks === "number" && settings.broadcast.audioTracks > 0) return decline("mono audio tracks are rendered");
  const projectReason = projectAudioReason(project);
  if (projectReason) return decline(`${projectReason}: the audio is rendered`);

  const exportEnd = exportStart + exportDuration;
  const hasSolo = project.timeline.tracks.some((track) => !track.hidden && track.solo);
  if (hasSolo) return decline("solo changes what plays: the audio is rendered");

  // Everything the mixer plays inside the export, on tracks that make sound.
  const audible: AudibleClip[] = [];
  const reasons: string[] = [];
  const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item] as const));
  for (const track of project.timeline.tracks) {
    if (track.hidden || track.muted) continue;
    for (const clip of track.clips) {
      if (clip.startTime >= exportEnd - 1e-9 || clip.startTime + clip.duration <= exportStart + 1e-9) continue;
      if (!getProjectClipCapabilities(project, clip).audio) continue;
      const timing = clipSamples(clip, exportStart, sampleRate);
      audible.push({
        track,
        clip,
        media: mediaById.get(clip.mediaId),
        startSample: timing?.startSample ?? Math.floor((clip.startTime - exportStart) * sampleRate),
        endSample: timing?.endSample ?? Math.ceil((clip.startTime + clip.duration - exportStart) * sampleRate),
      });
    }
  }
  if (audible.length === 0) return decline("no audio to copy");

  // The racks of the tracks that play: one touched track touches what it plays.
  const trackReasons = new Map<string, string | null>();
  for (const entry of audible) if (!trackReasons.has(entry.track.id)) trackReasons.set(entry.track.id, trackAudioReason(entry.track));
  // Sources of other clips sum into the mix wherever they overlap a copied span; they must be plain too, or their tail/colour
  // could reach a span the copy covers.
  for (const entry of audible) {
    const other = trackReasons.get(entry.track.id) ?? audioClipTouchedReason(entry.track, entry.clip, entry.media);
    if (other) {
      return decline(`${entry.media?.name ?? entry.clip.mediaId}: ${other}`);
    }
  }

  const aac = codec === "aac";
  interface Piece {
    readonly clipId: string;
    readonly start: number;
    readonly end: number;
    readonly mediaId: string;
    readonly shift: number;
    readonly info: SmartAudioSourceInfo;
  }
  const pieces: Piece[] = [];
  for (const entry of audible) {
    const { clip, media } = entry;
    const name = media?.name ?? clip.mediaId;
    const info = sources.get(clip.mediaId);
    if (!info) {
      reasons.push(`${name}: its audio was not scanned or its codec cannot be copied`);
      continue;
    }
    if (info.codec !== codec) {
      reasons.push(`${name}: ${info.codec === "aac" ? "AAC" : "PCM"} audio cannot be copied into a ${aac ? "AAC" : "PCM"} track`);
      continue;
    }
    if (info.sampleRate !== sampleRate) {
      reasons.push(`${name}: sample rate ${info.sampleRate} Hz differs from the export's ${sampleRate} Hz`);
      continue;
    }
    if (info.channels !== channels) {
      reasons.push(`${name}: ${info.channels} channels differ from the export's ${channels}`);
      continue;
    }
    if (!info.startsAtZero) {
      reasons.push(`${name}: the audio stream does not start at the beginning of the file`);
      continue;
    }
    if (aac && settings.audioSettings.bitrate > 0 && info.bitrateKbps !== undefined && info.bitrateKbps > settings.audioSettings.bitrate * 1.1) {
      reasons.push(`${name}: its ${Math.round(info.bitrateKbps)} kb/s audio is above the export's ${settings.audioSettings.bitrate} kb/s`);
      continue;
    }
    const timing = clipSamples(clip, exportStart, sampleRate);
    if (!timing) {
      reasons.push(`${name}: the clip is not aligned to a whole sample`);
      continue;
    }
    // Source samples that exist for the clip's span.
    const start = Math.max(0, timing.startSample);
    const end = Math.min(totalSamples, timing.endSample, info.sampleCount - timing.shift);
    if (end - start < 1 || start + timing.shift < 0) continue;
    pieces.push({ clipId: clip.id, start, end, mediaId: clip.mediaId, shift: timing.shift, info });
  }

  // Free pieces: a span where only this clip plays. Any other audible clip over a span makes it a rendered one.
  const covers = audible.map((entry) => ({ a: entry.startSample, b: entry.endSample, id: entry.clip.id }));
  const copies: Array<Extract<SmartAudioSegment, { kind: "copy" }>> = [];
  const minCopy = Math.round(MIN_AUDIO_COPY_SECONDS * sampleRate);
  for (const piece of pieces) {
    let free: Array<{ a: number; b: number }> = [{ a: piece.start, b: piece.end }];
    for (const cover of covers) {
      if (cover.id === piece.clipId) continue;
      free = free.flatMap((span) => {
        if (cover.b <= span.a || cover.a >= span.b) return [span];
        const out: Array<{ a: number; b: number }> = [];
        if (cover.a > span.a) out.push({ a: span.a, b: cover.a });
        if (cover.b < span.b) out.push({ a: cover.b, b: span.b });
        return out;
      });
    }
    for (const span of free) {
      if (span.b - span.a < minCopy && span.b - span.a < totalSamples) continue;
      copies.push({
        kind: "copy",
        start: span.a,
        end: span.b,
        mediaId: piece.mediaId,
        sourceStart: span.a + piece.shift,
        ...(piece.info.priming !== undefined ? { priming: piece.info.priming } : {}),
      });
    }
  }
  copies.sort((x, y) => x.start - y.start);
  // A razor cut inside one source leaves two clips that play it on: join the copies that meet at the same source offset.
  const merged: Array<Extract<SmartAudioSegment, { kind: "copy" }>> = [];
  for (const copy of copies) {
    const last = merged[merged.length - 1];
    if (last && last.mediaId === copy.mediaId && last.end === copy.start && last.sourceStart + (last.end - last.start) === copy.sourceStart) {
      merged[merged.length - 1] = { ...last, end: copy.end };
    } else if (!last || copy.start >= last.end) {
      merged.push(copy);
    }
  }

  if (merged.length === 0) return decline(...(reasons.length ? reasons : ["no untouched stretch of source audio long enough to copy"]));

  if (aac) {
    // AAC joins nowhere: its packets are copied for the whole export or not at all.
    const [only] = merged;
    if (merged.length !== 1 || only.start !== 0 || only.end !== totalSamples) {
      return decline(...reasons, "an AAC track is copied only when one untouched source is the audio of the whole export");
    }
    const info = sources.get(only.mediaId)!;
    const priming = info.priming ?? 0;
    const frame = info.frameSamples ?? 0;
    if (frame !== AAC_FRAME_SAMPLES) return decline(...reasons, "the AAC stream does not use 1024-sample frames");
    if (only.sourceStart < 0) return decline(...reasons, "the export starts before the audio does");
    if (only.sourceStart > 0 && (only.sourceStart + priming) % AAC_FRAME_SAMPLES !== 0) {
      return decline(...reasons, "the cut does not start on an AAC frame boundary");
    }
    const endSample = only.sourceStart + totalSamples;
    if ((endSample + priming) % AAC_FRAME_SAMPLES !== 0) return decline(...reasons, "the cut does not end on an AAC frame boundary");
    if (endSample > info.sampleCount || (info.packets !== undefined && endSample + priming > info.packets * AAC_FRAME_SAMPLES)) {
      return decline(...reasons, "the export runs past the end of the audio");
    }
    return {
      eligible: true,
      codec,
      sampleRate,
      channels,
      totalSamples,
      segments: [only],
      copiedSamples: totalSamples,
      encodedSamples: 0,
      copiedSeconds: totalSamples / sampleRate,
      encodedSeconds: 0,
      mode: "whole",
      reasons: [...new Set(reasons)],
    };
  }

  const segments: SmartAudioSegment[] = [];
  let cursor = 0;
  let copied = 0;
  for (const copy of merged) {
    if (copy.start > cursor) segments.push({ kind: "encode", start: cursor, end: copy.start });
    segments.push(copy);
    copied += copy.end - copy.start;
    cursor = copy.end;
  }
  if (cursor < totalSamples) segments.push({ kind: "encode", start: cursor, end: totalSamples });
  return {
    eligible: true,
    codec,
    sampleRate,
    channels,
    totalSamples,
    segments,
    copiedSamples: copied,
    encodedSamples: totalSamples - copied,
    copiedSeconds: copied / sampleRate,
    encodedSeconds: (totalSamples - copied) / sampleRate,
    mode: copied === totalSamples ? "whole" : "spans",
    reasons: [...new Set(reasons)],
  };
}

/**
 * Output sample ranges the renderer may leave unmixed: the chunks of the mixdown that lie entirely inside copied spans.
 * Chunks are the export's 15-second windows; a chunk that touches a rendered span is rendered in full.
 */
export function skippableAudioChunks(plan: SmartAudioPlan, exportDuration: number): Array<{ startSec: number; durationSec: number; frames: number }> {
  if (!plan.eligible) return [];
  const copies = plan.segments.filter((segment) => segment.kind === "copy");
  const chunks: Array<{ startSec: number; durationSec: number; frames: number }> = [];
  let cursor = 0;
  for (let start = 0; start < exportDuration; start += AUDIO_EXPORT_CHUNK_SECONDS) {
    const durationSec = Math.min(AUDIO_EXPORT_CHUNK_SECONDS, exportDuration - start);
    const frames = frameCount(durationSec, plan.sampleRate);
    const covered = copies.some((segment) => segment.start <= cursor && segment.end >= cursor + frames);
    if (covered) chunks.push({ startSec: start, durationSec, frames });
    cursor += frames;
  }
  return chunks;
}

/** "Audio: 100% copied" for the report. */
export function formatSmartAudioSummary(copiedSamples: number, totalSamples: number): string {
  const percent = totalSamples > 0 ? Math.round((copiedSamples / totalSamples) * 100) : 0;
  return `Audio: ${percent}% copied`;
}
