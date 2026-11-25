import type { Project } from "../../types/project";
import type { Clip } from "../../types/timeline";
import { measureRenderedLoudness, type PcmChunk } from "./loudness-normalizer";
import type { LoudnessSnapshot } from "./loudness-meter";

/** The offline mixdown renderer (AudioEngine) the export pipeline uses. */
export interface MixdownRenderer {
  isInitialized(): boolean;
  initialize(): Promise<void>;
  renderAudio(
    project: Project,
    startTime: number,
    duration: number,
  ): Promise<{ buffer: AudioBuffer }>;
}

export interface LoudnessAnalysis extends LoudnessSnapshot {
  readonly sampleRate: number;
  readonly channels: number;
  /** Timeline seconds analysed. */
  readonly rangeStart: number;
  readonly rangeDuration: number;
}

export interface AnalyzeLoudnessOptions {
  /** Timeline seconds; defaults to the whole audible timeline. */
  readonly range?: { readonly startTime: number; readonly endTime: number };
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/** End of the last clip on an audible track (what the mixdown covers). */
export function audioMixdownDuration(project: Project): number {
  let end = 0;
  for (const track of project.timeline.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) end = Math.max(end, clip.startTime + clip.duration);
  }
  return end;
}

const toChunk = (buffer: AudioBuffer): PcmChunk => ({
  sampleRate: buffer.sampleRate,
  channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)),
});

/**
 * Integrated loudness, loudness range and true peak of the project's whole
 * timeline mix, measured on the offline mixdown (track + master racks, clip
 * effects, fades, automation, mute/solo - exactly what an export would encode).
 */
export async function analyzeProjectLoudness(
  project: Project,
  renderer: MixdownRenderer,
  options: AnalyzeLoudnessOptions = {},
): Promise<LoudnessAnalysis> {
  if (!renderer.isInitialized()) await renderer.initialize();
  const total = audioMixdownDuration(project);
  const rangeStart = Math.max(0, options.range?.startTime ?? 0);
  const rangeEnd = Math.min(total, options.range?.endTime ?? total);
  const rangeDuration = Math.max(0, rangeEnd - rangeStart);
  const sampleRate = project.settings.sampleRate || 48000;
  const channels = project.settings.channels || 2;
  if (rangeDuration <= 0) {
    throw new Error("The timeline has no audio to measure.");
  }
  const snapshot = await measureRenderedLoudness({
    sampleRate,
    channels,
    duration: rangeDuration,
    dialogueGate: true,
    signal: options.signal,
    onProgress: options.onProgress,
    render: async (start, duration) => {
      const { buffer } = await renderer.renderAudio(project, rangeStart + start, duration);
      return toChunk(buffer);
    },
  });
  return { ...snapshot, sampleRate, channels, rangeStart, rangeDuration };
}

/**
 * A copy of the project that contains only `clipId`, on its own unmuted track
 * with no track/master rack, so rendering it yields the clip's contribution
 * alone (its own volume, fades, automation and clip effects included).
 */
export function isolateClipForMeasurement(project: Project, clipId: string): Project | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c: Clip) => c.id === clipId);
    if (!clip) continue;
    const { masterAudioRack: _master, masterPluginRack: _masterPlugins, audioBuses: _buses, ...timelineRest } = project.timeline;
    void _master;
    void _masterPlugins;
    void _buses;
    const { audioRack: _rack, pluginRack: _plugins, output: _output, sends: _sends, ...trackRest } = track;
    void _rack;
    void _plugins;
    void _output;
    void _sends;
    return {
      ...project,
      timeline: {
        ...timelineRest,
        tracks: [
          {
            ...trackRest,
            clips: [{ ...clip, startTime: 0 }],
            transitions: [],
            muted: false,
            solo: false,
            hidden: false,
          },
        ],
        duration: clip.duration,
      },
    };
  }
  return undefined;
}

/** Loudness of one clip as it currently sounds (before any new gain). */
export async function measureClipLoudness(
  project: Project,
  clipId: string,
  renderer: MixdownRenderer,
  options: Pick<AnalyzeLoudnessOptions, "onProgress" | "signal"> = {},
): Promise<LoudnessAnalysis> {
  const isolated = isolateClipForMeasurement(project, clipId);
  if (!isolated) throw new Error(`Clip not found: ${clipId}`);
  return analyzeProjectLoudness(isolated, renderer, options);
}
