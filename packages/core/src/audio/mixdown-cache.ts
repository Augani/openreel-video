import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import type { MixdownRenderer } from "./loudness/project-loudness";
import { getAudioBuses, routingFingerprintInput } from "./audio-routing";
import { rackForFingerprint } from "./native-plugin/native-plugin-rack";

/**
 * Master-mix cache. The offline mixdown (`AudioEngine.renderAudio`) is a pure
 * function of (project audio state, start, duration); exports (two passes when a
 * loudness target is set), repeated exports and loudness analyses all render the
 * same windows again. This caches the rendered PCM per window and keys it by an
 * exact fingerprint of everything that can change that window's sound, so an
 * unchanged range is never re-mixed and an audio edit never serves stale audio.
 *
 * Exactness rules (each covered by tests):
 *  - the key covers every audio-relevant clip/track/rack/media field, so any
 *    audio edit changes the key of every window it can reach;
 *  - clips only reach windows they overlap, plus the effect "history" the
 *    offline renderer pre-rolls: with tail-capable effects or racks present the
 *    earlier clips are included, otherwise only overlapping clips are;
 *  - visual-only edits (transform, colour, mask, ...) do not change the key.
 */

export interface MixChunk {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv64(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(36);
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Float32Array || v instanceof Float64Array) return `typed:${v.length}`;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

// Projects are edited in place by the action system, so a hash must never be
// memoised by object identity: it is recomputed from the current contents.
function hashOf(_object: object, compute: () => unknown): string {
  return fnv64(stable(compute()));
}

const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 1;
function blobId(blob: Blob | null | undefined): string {
  if (!blob) return "none";
  let id = blobIds.get(blob);
  if (id === undefined) {
    id = nextBlobId++;
    blobIds.set(blob, id);
  }
  return `${id}:${blob.size}:${blob.type}`;
}

/** Clip fields that can change what the clip sounds like. Visual fields are excluded. */
function audioClipHash(clip: Clip): string {
  return hashOf(clip, () => [
    clip.mediaId, clip.startTime, clip.duration, clip.inPoint, clip.outPoint,
    clip.volume, clip.fade, clip.automation, clip.speed, clip.reversed,
    clip.pitchCorrection, clip.audioTrackIndex, clip.speedKeyframes, clip.freezeFrames,
    clip.audioEffects, clip.effects, clip.keyframes, clip.metadata, clip.surroundPan, clip.channelMap,
  ]);
}

function trackLevelHash(track: Track): string {
  return hashOf(track, () => [
    track.id, track.hidden, track.muted, track.solo, track.soloSafe, track.audioRack, rackForFingerprint(track.pluginRack), track.transitions,
    // Output assignment and sends decide where this track's signal goes.
    track.output, track.sends, track.surroundPan,
  ]);
}

function hasAudioProcessing(project: Project): boolean {
  const rackActive = (rack: { effects?: readonly unknown[] } | undefined): boolean =>
    Boolean(rack && rack.effects && rack.effects.length > 0);
  if (rackActive(project.timeline.masterAudioRack)) return true;
  if (project.timeline.masterPluginRack?.plugins.length) return true;
  // Bus racks (and bus-fader automation) carry tails/history just like track racks.
  for (const bus of getAudioBuses(project.timeline)) if (rackActive(bus.rack) || bus.pluginRack?.plugins.length) return true;
  for (const track of project.timeline.tracks) {
    if (rackActive(track.audioRack)) return true;
    if (track.pluginRack?.plugins.length) return true;
    for (const clip of track.clips) {
      if (clip.audioEffects.length > 0) return true;
    }
  }
  return false;
}

function mediaHash(project: Project, ids: ReadonlySet<string>): string {
  const parts: string[] = [];
  for (const item of project.mediaLibrary.items) {
    if (!ids.has(item.id)) continue;
    parts.push(
      `${hashOf(item, () => [item.id, item.name, item.type, item.metadata, item.isPlaceholder, item.sourceFile, item.channelPreset])}:${blobId(item.blob)}`,
    );
  }
  return parts.join(",");
}

/**
 * Fingerprint of everything that decides the rendered PCM of
 * [start, start + duration). Equal fingerprints => identical mixdown.
 */
export function audioRangeFingerprint(project: Project, start: number, duration: number): string {
  const end = start + duration;
  const unbounded = hasAudioProcessing(project);
  const compound = project.compoundClips ?? [];
  const parts: string[] = [
    `sr${project.settings.sampleRate ?? 0}`,
    `ch${project.settings.channels ?? 0}`,
    // 5.1 and stereo mixes of the same project differ (channel count AND panning); stereo projects keep their old key text.
    ...(project.settings.channelLayout === "5.1" ? ["ly5.1"] : []),
    `w${start.toFixed(6)}+${duration.toFixed(6)}`,
    `m${project.timeline.masterAudioRack ? hashOf(project.timeline.masterAudioRack, () => project.timeline.masterAudioRack) : "none"}`,
    // Hosted plugins on the master (plugin, state chunk, values, automation): any edit changes every window's key.
    ...(project.timeline.masterPluginRack?.plugins.length ? [`mp${hashOf(project.timeline.masterPluginRack, () => rackForFingerprint(project.timeline.masterPluginRack))}`] : []),
  ];
  // Buses: only audio-relevant fields (rack, fader, mute/solo, output, automation), never names/colours.
  if ((project.timeline.audioBuses?.length ?? 0) > 0) {
    parts.push(`r${hashOf(project.timeline, () => routingFingerprintInput(project.timeline).buses)}`);
  }
  if (compound.length > 0) parts.push(`c${hashOf(compound, () => compound)}`);
  const mediaIds = new Set<string>();
  for (const definition of compound) {
    for (const t of definition.content.tracks) for (const c of t.clips) mediaIds.add(c.mediaId);
  }
  for (const track of project.timeline.tracks) {
    // Hidden/muted tracks still count: a linked clip on another track supplies
    // audio effects and automation (see resolveClipAudioEffects).
    const clips: string[] = [];
    for (const clip of track.clips) {
      const clipEnd = clip.startTime + clip.duration;
      const reaches = clip.startTime < end && (unbounded || clipEnd > start);
      if (!reaches) continue;
      clips.push(audioClipHash(clip));
      mediaIds.add(clip.mediaId);
    }
    parts.push(`t${trackLevelHash(track)}[${clips.join(",")}]`);
  }
  parts.push(`md${mediaHash(project, mediaIds)}`);
  return fnv64(parts.join("|"));
}

export interface MixdownCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly entries: number;
  readonly bytes: number;
}

export class MixdownCache {
  private readonly entries = new Map<string, MixChunk>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;

  constructor(private maxBytes = 256 * 1024 * 1024) {}

  get(key: string): MixChunk | undefined {
    const found = this.entries.get(key);
    if (!found) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.entries.delete(key);
    this.entries.set(key, found);
    return found;
  }

  set(key: string, chunk: MixChunk): void {
    const size = chunk.channels.reduce((sum, c) => sum + c.byteLength, 0);
    if (size > this.maxBytes) return;
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.channels.reduce((sum, c) => sum + c.byteLength, 0);
    this.entries.delete(key);
    this.entries.set(key, chunk);
    this.bytes += size;
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const evicted = this.entries.get(oldest)!;
      this.bytes -= evicted.channels.reduce((sum, c) => sum + c.byteLength, 0);
      this.entries.delete(oldest);
    }
  }

  setBudget(maxBytes: number): void {
    this.maxBytes = maxBytes;
    this.set("", { sampleRate: 0, channels: [] });
    this.entries.delete("");
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): MixdownCacheStats {
    return { hits: this.hits, misses: this.misses, entries: this.entries.size, bytes: this.bytes };
  }
}

let shared: MixdownCache | null = null;
export function getMixdownCache(): MixdownCache {
  shared ??= new MixdownCache();
  return shared;
}

/**
 * Cached `renderAudio`: returns a copy of the cached PCM so callers may process
 * the result in place without corrupting the cache.
 */
export async function renderMixdownCached<T extends { readonly numberOfChannels: number; readonly sampleRate: number; getChannelData(c: number): Float32Array }>(
  project: Project,
  start: number,
  duration: number,
  render: () => Promise<T>,
  fromChunk: (chunk: MixChunk) => T,
  cache: MixdownCache = getMixdownCache(),
): Promise<T> {
  const key = audioRangeFingerprint(project, start, duration);
  const hit = cache.get(key);
  if (hit) return fromChunk(hit);
  const buffer = await render();
  // Anything that is not real PCM (a stub renderer, a null mix) is passed through uncached.
  if (!buffer || typeof buffer.getChannelData !== "function" || !(buffer.numberOfChannels > 0)) return buffer;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => new Float32Array(buffer.getChannelData(c)));
  cache.set(key, { sampleRate: buffer.sampleRate, channels });
  return buffer;
}

/** AudioBuffer-backed adapter for `renderMixdownCached`. */
export function audioBufferFromChunk(chunk: MixChunk): AudioBuffer {
  const length = chunk.channels[0]?.length ?? 0;
  const buffer = new AudioBuffer({ length, numberOfChannels: chunk.channels.length, sampleRate: chunk.sampleRate });
  chunk.channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
  return buffer;
}

/** Wrap a mixdown renderer so repeated windows of an unchanged project are served from the cache. */
export function createCachedMixdownRenderer(
  renderer: MixdownRenderer,
  cache: MixdownCache = getMixdownCache(),
): MixdownRenderer {
  return {
    isInitialized: () => renderer.isInitialized(),
    initialize: () => renderer.initialize(),
    renderAudio: async (project, startTime, duration) => {
      const buffer = await renderMixdownCached(
        project,
        startTime,
        duration,
        async () => (await renderer.renderAudio(project, startTime, duration)).buffer,
        audioBufferFromChunk,
        cache,
      );
      return { buffer };
    },
  };
}
