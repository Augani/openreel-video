import type { Project } from "../types/project";
import { busesWithSignal, getAudioBuses, isolateBusStem } from "../audio/audio-routing";
import {
  analyzeProjectLoudness,
  audioMixdownDuration,
  type LoudnessAnalysis,
  type MixdownRenderer,
} from "../audio/loudness/project-loudness";
import {
  bakeLiveDucking,
  audioTypeStemIds,
  audioTypeStemLabel,
  isolateAudioTypeStem,
  isolateTrackStem,
  trackStemCandidates,
  type StemMode,
} from "../audio/stem-isolation";
import { getWavEncoder } from "../wasm/wav";
import { isSurroundLayout, SURROUND_CHANNELS } from "../audio/surround";
import { encodeMultichannelWav } from "./surround-export";

/**
 * Stem export: every bus, track or Essential Sound type (or the selected ones)
 * rendered as its own WAV from the SAME offline mixdown the master export uses. A stem is the bus's
 * post-fader output (its own rack, fader and automation, plus everything routed
 * or sent into it), before the master rack. All stems cover the full timeline,
 * so they line up sample-for-sample and can be re-summed in a DAW.
 */

export interface StemPlanItem {
  /** Id of the stem's source: a bus id, a track id, or an audio type (dialogue, music, sfx, ambience, untyped). */
  readonly busId: string;
  readonly name: string;
  readonly fileName: string;
  /** What `busId` refers to; absent means a bus. */
  readonly kind?: StemMode;
}

export interface StemSelection {
  /** What to split the mix by; default buses. */
  readonly mode?: StemMode;
  /** Source ids to export; default = every source of the mode that carries audio. */
  readonly ids?: readonly string[];
}

export interface StemExportOptions {
  /** What to split the mix by; default buses. */
  readonly mode?: StemMode;
  /** Source ids for `mode` (bus ids, track ids or audio types); default = all that carry audio. */
  readonly ids?: readonly string[];
  /** Bus ids to export (bus mode); default = every bus that carries signal. */
  readonly busIds?: readonly string[];
  readonly bitDepth?: 16 | 24;
  /** Seconds rendered per mixdown window. */
  readonly chunkSeconds?: number;
  readonly signal?: AbortSignal;
  /** 0..1 over the whole export. */
  readonly onProgress?: (fraction: number) => void;
}

export interface RenderedStem extends StemPlanItem {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  readonly wav: Uint8Array;
}

export class StemExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StemExportError";
  }
}

const safeFileName = (name: string): string =>
  name.replace(/[^A-Za-z0-9 _.-]+/g, "").trim().replace(/\s+/g, "_") || "Bus";

function uniqueFileNames(project: Project, sources: { id: string; name: string; kind: StemMode }[]): StemPlanItem[] {
  const used = new Set<string>();
  return sources.map(({ id, name, kind }) => {
    const base = `${safeFileName(project.name || "Project")}_${safeFileName(name)}`;
    let fileName = `${base}.wav`;
    for (let n = 2; used.has(fileName); n += 1) fileName = `${base}_${n}.wav`;
    used.add(fileName);
    return { busId: id, name, fileName, kind };
  });
}

/** Which stems an export would write, with unique file names. */
export function planStems(project: Project, selection: StemSelection = {}): StemPlanItem[] {
  const mode = selection.mode ?? "bus";
  const ids = selection.ids;
  if (mode === "track") {
    const tracks = trackStemCandidates(project).filter((track) => !ids || ids.includes(track.id));
    return uniqueFileNames(project, tracks.map((track) => ({ id: track.id, name: track.name || "Track", kind: "track" as const })));
  }
  if (mode === "audioType") {
    const types = audioTypeStemIds(project).filter((id) => !ids || ids.includes(id));
    return uniqueFileNames(project, types.map((id) => ({ id, name: audioTypeStemLabel(id), kind: "audioType" as const })));
  }
  const all = getAudioBuses(project.timeline);
  const wanted = ids ? all.filter((b) => ids.includes(b.id)) : busesWithSignal(project.timeline);
  return uniqueFileNames(project, wanted.map((bus) => ({ id: bus.id, name: bus.name, kind: "bus" as const })));
}

/** Bus stems (kept for existing callers): which buses an export would write. */
export const planStemExport = (project: Project, busIds?: readonly string[]): StemPlanItem[] =>
  planStems(project, { mode: "bus", ids: busIds });

/** The project copy whose master mix is this stem. */
export function isolateStem(project: Project, item: Pick<StemPlanItem, "busId" | "kind">): Project | undefined {
  switch (item.kind ?? "bus") {
    case "track":
      return isolateTrackStem(project, item.busId);
    case "audioType":
      return isolateAudioTypeStem(project, item.busId);
    default:
      // Bake live ducking first: isolating mutes the tracks that do not feed the bus, dialogue included.
      return isolateBusStem(bakeLiveDucking(project), item.busId);
  }
}

const toFloat = (buffer: AudioBuffer, channel: number): Float32Array =>
  buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));

/**
 * Renders one stem to PCM (all channels, whole timeline). The length comes from
 * the full project, not the isolated copy, so every stem is the same length.
 */
export async function renderStemPcm(
  project: Project,
  item: Pick<StemPlanItem, "busId" | "kind">,
  renderer: MixdownRenderer,
  options: Pick<StemExportOptions, "chunkSeconds" | "signal"> & { onProgress?: (fraction: number) => void } = {},
): Promise<{ sampleRate: number; channels: Float32Array[]; frames: number }> {
  const isolated = isolateStem(project, item);
  if (!isolated) throw new StemExportError(`Stem source not found: ${item.busId}`);
  if (!renderer.isInitialized()) await renderer.initialize();
  const total = audioMixdownDuration(project);
  if (!(total > 0)) throw new StemExportError("The timeline has no audio to export.");
  const sampleRate = project.settings.sampleRate || 48000;
  // A 5.1 sequence writes six-channel stems (L R C LFE Ls Rs); stereo sequences are unchanged.
  const channelCount = isSurroundLayout(project.settings) ? SURROUND_CHANNELS : Math.max(1, Math.min(2, project.settings.channels || 2));
  const frames = Math.max(1, Math.round(total * sampleRate));
  const out = Array.from({ length: channelCount }, () => new Float32Array(frames));
  const chunk = Math.max(1, options.chunkSeconds ?? 10);
  let at = 0;
  while (at < frames) {
    if (options.signal?.aborted) throw new StemExportError("Stem export cancelled.");
    const start = at / sampleRate;
    const length = Math.min(Math.round(chunk * sampleRate), frames - at);
    const { buffer } = await renderer.renderAudio(isolated, start, length / sampleRate);
    for (let c = 0; c < channelCount; c++) {
      const data = toFloat(buffer, c);
      out[c].set(data.subarray(0, Math.min(length, data.length)), at);
    }
    at += length;
    options.onProgress?.(at / frames);
  }
  return { sampleRate, channels: out, frames };
}

/** Renders one bus stem to PCM (all channels, whole timeline). */
export const renderBusStemPcm = (
  project: Project,
  busId: string,
  renderer: MixdownRenderer,
  options: Pick<StemExportOptions, "chunkSeconds" | "signal"> & { onProgress?: (fraction: number) => void } = {},
) => renderStemPcm(project, { busId, kind: "bus" }, renderer, options);

/** Encodes one rendered stem as a PCM WAV. */
export function encodeStemWav(
  pcm: { channels: Float32Array[]; sampleRate: number },
  bitDepth: 16 | 24 = 24,
): Uint8Array {
  if (pcm.channels.length > 2) return encodeMultichannelWav(pcm.channels, pcm.sampleRate, bitDepth);
  return getWavEncoder().encodeFullWav(pcm.channels, pcm.sampleRate, bitDepth);
}

/** Renders the stems and encodes each as a PCM WAV. */
export async function exportBusStems(
  project: Project,
  renderer: MixdownRenderer,
  options: StemExportOptions = {},
): Promise<RenderedStem[]> {
  const mode = options.mode ?? "bus";
  const plan = planStems(project, { mode, ids: options.ids ?? options.busIds });
  if (plan.length === 0) {
    throw new StemExportError(
      mode === "track"
        ? "No track carries audio to export."
        : mode === "audioType"
          ? "No clip carries audio to export."
          : getAudioBuses(project.timeline).length === 0
            ? "There are no buses to export. Add a bus (or the Dialogue / Music / FX preset) and route tracks into it."
            : "None of the selected buses carries any audio.",
    );
  }
  const encoder = getWavEncoder();
  const results: RenderedStem[] = [];
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    const pcm = await renderStemPcm(project, item, renderer, {
      chunkSeconds: options.chunkSeconds,
      signal: options.signal,
      onProgress: (fraction) => options.onProgress?.((i + fraction) / plan.length),
    });
    const wav = pcm.channels.length > 2
      ? encodeMultichannelWav(pcm.channels, pcm.sampleRate, options.bitDepth ?? 24)
      : encoder.encodeFullWav(pcm.channels, pcm.sampleRate, options.bitDepth ?? 24);
    results.push({ ...item, sampleRate: pcm.sampleRate, channels: pcm.channels.length, frames: pcm.frames, wav });
  }
  return results;
}

/** Integrated loudness / true peak of one bus (its stem). */
export function analyzeBusLoudness(
  project: Project,
  busId: string,
  renderer: MixdownRenderer,
  options: Parameters<typeof analyzeProjectLoudness>[2] = {},
): Promise<LoudnessAnalysis> {
  const isolated = isolateBusStem(bakeLiveDucking(project), busId);
  if (!isolated) return Promise.reject(new StemExportError(`Bus not found: ${busId}`));
  // The isolated project keeps every track (muted when they do not feed the bus),
  // so the analysed range matches the master's and every bus measures the same span.
  return analyzeProjectLoudness(isolated, renderer, options);
}
