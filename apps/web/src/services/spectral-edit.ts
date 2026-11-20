import {
  clipSpectralRegions,
  getSharedSpectralRepairCache,
  getSpectralBackend,
  planSpectralRegionsAction,
  spectralRegionsKey,
  type Clip,
  type MediaItem,
  type SpectralRegion,
  type SpectralView,
  type SpectralViewOptions,
} from "@openreel/core";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import { useProjectStore } from "../stores/project-store";

/**
 * Spectral editing for a selected clip. The edit is the clip's "spectralRepair" audio effect (a list of
 * regions in source time); committing one is a single undoable action. The spectrogram is computed in a
 * worker from the decoded source with the edit applied, so what you see is what the preview and export play.
 */

export interface SpectralSource {
  /** Identity of the decoded media (changes when the file does). */
  readonly key: string;
  readonly buffer: AudioBuffer;
  readonly duration: number;
  readonly sampleRate: number;
}

const sources = new Map<string, Promise<SpectralSource>>();
const MAX_DECODE_BYTES = 400 * 1024 * 1024;

export function findClip(clipId: string): Clip | undefined {
  for (const track of useProjectStore.getState().project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

function findMedia(clip: Clip): MediaItem | undefined {
  return useProjectStore.getState().project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
}

/** The decoded source audio of a clip's media (cached per media file). Rejects when the clip has no decodable audio. */
export function loadSpectralSource(clipId: string): Promise<SpectralSource> {
  const clip = findClip(clipId);
  const media = clip ? findMedia(clip) : undefined;
  if (!clip || !media?.blob) return Promise.reject(new Error("This clip has no audio to edit."));
  if (media.blob.size > MAX_DECODE_BYTES) return Promise.reject(new Error("This file is too large to open in the spectral editor."));
  const key = `${media.id}:${media.blob.size}:${clip.audioTrackIndex ?? 0}`;
  let job = sources.get(key);
  if (!job) {
    const rate = useProjectStore.getState().project.settings.sampleRate || 48000;
    job = (async () => {
      const context = new OfflineAudioContext(2, 1, rate);
      const buffer = await loadAudioBuffer(context, media.blob as Blob, { audioTrackIndex: clip.audioTrackIndex ?? 0 });
      if (!buffer) throw new Error("This clip has no decodable audio.");
      return { key, buffer, duration: buffer.duration, sampleRate: buffer.sampleRate };
    })();
    job.catch(() => sources.delete(key));
    sources.set(key, job);
  }
  return job;
}

/** Replaces the clip's region list as ONE undoable action (add / replace / remove the "spectralRepair" effect). Resolves false when rejected. */
export async function commitSpectralRegions(clipId: string, regions: readonly SpectralRegion[]): Promise<boolean> {
  const { project, actionExecutor } = useProjectStore.getState();
  const clip = findClip(clipId);
  if (!clip) return false;
  const action = planSpectralRegionsAction(clip, regions, { actionId: crypto.randomUUID(), effectId: `spectral-${crypto.randomUUID()}` });
  if (!action) return true;
  const result = await actionExecutor.execute(action, project);
  if (!result.success) {
    console.error("Failed to edit spectral regions:", result.error?.message);
    return false;
  }
  useProjectStore.setState({ project: { ...project, modifiedAt: Date.now() } });
  return true;
}

export const regionsOf = (clip: Clip | undefined): SpectralRegion[] => clipSpectralRegions(clip);

const loadedViews: string[] = [];
const MAX_VIEW_SOURCES = 3;

/**
 * Makes the (optionally edited) source available to the spectrogram worker and returns its view key. With regions the
 * edited audio comes from the shared repair cache (the same job the preview and export use); without, the original.
 */
export async function prepareSpectralView(source: SpectralSource, regions: readonly SpectralRegion[], showOriginal: boolean): Promise<string> {
  const regionKey = showOriginal ? "" : spectralRegionsKey(regions);
  const key = `${source.key}|${regionKey}`;
  if (loadedViews.includes(key)) return key;
  let buffer = source.buffer;
  if (regionKey) {
    const cache = getSharedSpectralRepairCache((channels, sampleRate) => {
      const out = new OfflineAudioContext(1, 1, sampleRate).createBuffer(channels.length, Math.max(1, channels[0]?.length ?? 1), sampleRate);
      channels.forEach((data, c) => out.getChannelData(c).set(data));
      return out;
    });
    buffer = (await cache.request({ buffer: source.buffer, regions: regions.filter((region) => region.enabled) })) ?? source.buffer;
  }
  const mono = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i += 1) mono[i] += data[i] / channels;
  }
  await getSpectralBackend().load(key, mono, buffer.sampleRate);
  loadedViews.push(key);
  while (loadedViews.length > MAX_VIEW_SOURCES) {
    const old = loadedViews.shift();
    if (old) void getSpectralBackend().drop(old);
  }
  return key;
}

export function requestSpectralView(viewKey: string, options: SpectralViewOptions): Promise<SpectralView> {
  return getSpectralBackend().view(viewKey, options);
}

/** Forget a prepared view (its worker was restarted) so the next prepare loads it again. */
export function forgetSpectralView(viewKey: string): void {
  const at = loadedViews.indexOf(viewKey);
  if (at >= 0) loadedViews.splice(at, 1);
}
