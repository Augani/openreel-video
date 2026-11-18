import {
  REPAIR_EFFECT_DEFINITIONS,
  analyzeAudioIssues,
  computeSpectrogram,
  getAudioEngine,
  getProjectClipCapabilities,
  isRepairEffectType,
  sanitizeRepairParams,
  suggestRepairs,
  type AudioIssueReport,
  type Clip,
  type Effect,
  type Project,
  type RepairEffectType,
  type RepairSuggestion,
  type Spectrogram,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Audio repair for a selected clip: analysis (hum, clipping, clicks,
 * sibilance), the settings it suggests, and applying them as a single undo
 * step. Repair effects live in the clip's audio effect list and run through
 * the same worklet in the live preview and in the export mixdown.
 */

const ANALYSIS_WINDOW_SECONDS = 20;
const ANALYSIS_MAX_SECONDS = 60;

export interface ClipPcm {
  readonly channels: Float32Array[];
  readonly sampleRate: number;
  /** Lengths (frames) of the excerpts the channels were stitched from; joins are not real audio. */
  readonly segmentFrames?: readonly number[];
}

export interface ClipAnalysis {
  readonly report: AudioIssueReport;
  readonly suggestions: RepairSuggestion[];
  readonly spectrogram: Spectrogram;
}

function findClip(project: Project, clipId: string): Clip | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

export const isRepairEffect = (effect: Effect): boolean => isRepairEffectType(effect.type);

export function clipRepairEffects(clip: Clip | undefined): Effect[] {
  return (clip?.audioEffects ?? []).filter(isRepairEffect);
}

/** Windows (clip-local seconds) that stand for the clip: all of it when short, else three spread out. */
export function analysisWindows(span: number): Array<{ start: number; duration: number }> {
  if (span <= ANALYSIS_MAX_SECONDS) return [{ start: 0, duration: span }];
  return [0.1, 0.45, 0.8].map((at) => ({
    start: Math.min(span - ANALYSIS_WINDOW_SECONDS, span * at),
    duration: ANALYSIS_WINDOW_SECONDS,
  }));
}

/**
 * Renders just this clip (its own volume/speed/fades; no other tracks) through the export mixdown.
 * `withEffects` keeps the clip's audio effects so the result is what the repair chain produces.
 */
export async function renderClipPcm(
  project: Project,
  clipId: string,
  options: { withEffects?: boolean } = {},
): Promise<ClipPcm> {
  const clip = findClip(project, clipId);
  if (!clip) throw new Error("Clip not found");
  if (!getProjectClipCapabilities(project, clip).audio) throw new Error("This clip has no audio.");
  const engine = getAudioEngine();
  if (!engine.isInitialized()) await engine.initialize();
  const isolated: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      duration: clip.startTime + clip.duration,
      audioBuses: undefined,
      masterAudioRack: undefined,
      tracks: [
        {
          id: clip.trackId,
          name: "Repair analysis",
          type: "audio",
          clips: [{ ...clip, volume: 1, automation: undefined, fade: undefined, audioEffects: options.withEffects ? clip.audioEffects : [] }],
          transitions: [],
          hidden: false,
          muted: false,
          solo: false,
          locked: false,
        },
      ],
    },
  };
  const windows = analysisWindows(clip.duration);
  const parts: Array<{ channels: Float32Array[]; rate: number }> = [];
  for (const window of windows) {
    const { buffer } = await engine.renderAudio(isolated, clip.startTime + window.start, window.duration, { preview: !options.withEffects });
    parts.push({
      channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice()),
      rate: buffer.sampleRate,
    });
  }
  const rate = parts[0].rate;
  const channelCount = parts[0].channels.length;
  const total = parts.reduce((sum, part) => sum + part.channels[0].length, 0);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(total));
  let at = 0;
  for (const part of parts) {
    for (let c = 0; c < channelCount; c += 1) channels[c].set(part.channels[c], at);
    at += part.channels[0].length;
  }
  return { channels, sampleRate: rate, segmentFrames: parts.map((part) => part.channels[0].length) };
}

export function analyzePcm(pcm: ClipPcm): ClipAnalysis {
  const report = analyzeAudioIssues(pcm.channels, pcm.sampleRate, pcm.segmentFrames);
  const mono = new Float32Array(pcm.channels[0].length);
  for (const channel of pcm.channels) for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / pcm.channels.length;
  return { report, suggestions: suggestRepairs(report), spectrogram: computeSpectrogram(mono, pcm.sampleRate) };
}

export async function analyzeClip(clipId: string): Promise<ClipAnalysis> {
  const pcm = await renderClipPcm(useProjectStore.getState().getFullProject(), clipId);
  return analyzePcm(pcm);
}

export async function spectrogramForClip(clipId: string, withEffects: boolean): Promise<Spectrogram> {
  const pcm = await renderClipPcm(useProjectStore.getState().getFullProject(), clipId, { withEffects });
  return analyzePcm(pcm).spectrogram;
}

let effectCounter = 0;
export function createClipRepairEffect(type: RepairEffectType, params?: Record<string, unknown>): Effect {
  effectCounter += 1;
  return {
    id: `repair-${type}-${Date.now().toString(36)}-${effectCounter}`,
    type,
    enabled: true,
    params: sanitizeRepairParams(type, params),
  };
}

/**
 * Adds (or updates, when the clip already has that repair effect) every
 * suggestion on the clip as ONE undo step. Returns the ids of the effects.
 */
export async function applyRepairSuggestions(clipId: string, suggestions: readonly RepairSuggestion[]): Promise<string[]> {
  if (suggestions.length === 0) return [];
  const store = useProjectStore.getState();
  const clip = findClip(store.project, clipId);
  if (!clip) throw new Error("Clip not found");
  const ids: string[] = [];
  store.beginHistoryGroup("Repair audio");
  try {
    for (const suggestion of suggestions) {
      const existing = clipRepairEffects(findClip(useProjectStore.getState().project, clipId)).find((effect) => effect.type === suggestion.type);
      if (existing) {
        await useProjectStore.getState().updateAudioEffect(clipId, existing.id, sanitizeRepairParams(suggestion.type, suggestion.params));
        if (!existing.enabled) await useProjectStore.getState().toggleAudioEffect(clipId, existing.id, true);
        ids.push(existing.id);
      } else {
        const effect = createClipRepairEffect(suggestion.type, suggestion.params);
        await useProjectStore.getState().addAudioEffect(clipId, effect);
        ids.push(effect.id);
      }
    }
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
  return ids;
}

export const repairLabel = (type: string): string =>
  isRepairEffectType(type) ? REPAIR_EFFECT_DEFINITIONS[type].label : type;
