/**
 * Hosted audio plugins on TRACKS, submix BUSES and the MASTER bus (the Audio Track Mixer's effect slots), not only on clips.
 *
 * Same engine as the clip plugins: the helper renders offline (latency compensated, parameter automation applied block by
 * block), the result is cached, and the preview and the export play that same buffer. What differs is the input: a clip
 * plugin processes one decoded source; a rack plugin processes the track's (or bus's) MIXDOWN, so the mixdown is rendered
 * first as a "stem" covering the whole timeline, run through the plugin chain once and then substituted for the signal it
 * replaced:
 *
 *   track:  clips (summed)  -> [hosted plugins] -> built-in rack -> pan -> fader -> sends / output
 *   bus:    inputs (summed) -> [hosted plugins] -> built-in rack -> pan -> fader -> output
 *   master: every track and bus (summed, after their own plugins) -> [hosted plugins] -> master fader -> built-in master
 *           rack -> (export only) loudness normalisation -> true-peak limiter
 *
 * The master order follows Premiere's: the Master track's effects process the mix, the fader and the export-level
 * loudness normalisation and limiting come after them, so a plugin on the master can never push the exported file past
 * the true-peak ceiling the user asked for (the normaliser measures the mix AFTER the plugins).
 *
 * Everything in this file is pure data: the rack model, its undoable edits, the lanes baked from track keyframes, the
 * project transformations the offline mixdown and the live preview both apply, and the cache key of a stem.
 */
import type { Action } from "../../types/actions";
import type { AudioBus, AudioPluginRack, Effect, Keyframe, Timeline, Track } from "../../types/timeline";
import {
  NATIVE_PLUGIN_EFFECT_TYPE,
  MAX_NATIVE_PLUGINS_PER_CLIP,
  bakeNativePluginAutomation,
  createNativePluginEffect,
  getNativePluginEffects,
  nativePluginKeyframeProperty,
  nativePluginSteps,
  parseNativePluginKeyframeProperty,
  readNativePluginParams,
} from "./native-plugin-effect";
import { stepSignature } from "./native-plugin-cache";
import type { NativePluginDescriptor, NativePluginStep } from "./native-plugin-types";

/** Maximum hosted plugin instances on one track or bus. */
export const MAX_RACK_NATIVE_PLUGINS = MAX_NATIVE_PLUGINS_PER_CLIP;
/** Silence appended after the last signal so delay / reverb tails are rendered by the plugin. */
export const RACK_STEM_TAIL_SECONDS = 2;
/** Prefix of the synthetic track that plays a bus's processed input stem. */
export const RACK_STEM_TRACK_PREFIX = "__rackstem:";
/** Where the contributors of a plugin bus are parked while its processed stem replaces them (a muted bus). */
export const RACK_STEM_SINK_ID = "__rackstem-sink";

export type PluginRackKind = "track" | "bus" | "master";

/** The reserved target id of the master bus's plugin rack (`audioPluginRack/set` target, mixer strip, stem id). */
export const MASTER_RACK_TARGET = "__master__";
export const MASTER_RACK_NAME = "Master";

export const rackStemTrackId = (busId: string): string => `${RACK_STEM_TRACK_PREFIX}${busId}`;
export const isRackStemTrackId = (id: string): boolean => id.startsWith(RACK_STEM_TRACK_PREFIX);
export const busIdOfRackStemTrack = (id: string): string => id.slice(RACK_STEM_TRACK_PREFIX.length);

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Normalises a stored rack: only well-formed plugin effects, only keyframes of those effects. Undefined when empty. */
export function sanitizePluginRack(raw: unknown): AudioPluginRack | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<AudioPluginRack>;
  const plugins: Effect[] = [];
  const seen = new Set<string>();
  for (const effect of Array.isArray(r.plugins) ? r.plugins : []) {
    if (plugins.length >= MAX_RACK_NATIVE_PLUGINS) break;
    if (!effect || typeof effect !== "object" || effect.type !== NATIVE_PLUGIN_EFFECT_TYPE) continue;
    if (typeof effect.id !== "string" || !effect.id || seen.has(effect.id)) continue;
    if (readNativePluginParams(effect).pluginId === "") continue;
    const { automation: _baked, ...stored } = (effect.params ?? {}) as Record<string, unknown>;
    void _baked;
    seen.add(effect.id);
    plugins.push({ ...effect, enabled: effect.enabled !== false, params: stored });
  }
  const keyframes: Keyframe[] = [];
  for (const key of Array.isArray(r.keyframes) ? r.keyframes : []) {
    if (!key || typeof key !== "object" || typeof key.property !== "string" || !finite(key.time) || !finite(Number(key.value))) continue;
    const parsed = parseNativePluginKeyframeProperty(key.property);
    if (parsed && seen.has(parsed.effectId)) keyframes.push(key);
  }
  keyframes.sort((a, b) => a.time - b.time);
  if (plugins.length === 0) return undefined;
  return { plugins, ...(keyframes.length > 0 ? { keyframes } : {}), ...(r.livePreview === false ? { livePreview: false } : {}) };
}

/** Live is the default: only an explicit `livePreview: false` selects the rendered preview. */
export const rackIsLive = (rack: AudioPluginRack | undefined): boolean => rack?.livePreview !== false;

/**
 * The rack as a render fingerprint sees it. How the preview plays a rack (live or rendered) never changes the audio that is
 * rendered or exported, so toggling it must not invalidate a cached stem or mixdown.
 */
export function rackForFingerprint(rack: AudioPluginRack | undefined): Omit<AudioPluginRack, "livePreview"> | undefined {
  if (!rack || rack.livePreview === undefined) return rack;
  const { livePreview: _live, ...rest } = rack;
  void _live;
  return rest;
}

/** The rack's plugin effects (well-formed ones), chain order. */
export const rackPluginEffects = (rack: AudioPluginRack | undefined): Effect[] => getNativePluginEffects(rack?.plugins);

/** True when the rack has at least one enabled hosted plugin. */
export const pluginRackIsActive = (rack: AudioPluginRack | undefined): boolean => rackPluginEffects(rack).some((effect) => effect.enabled !== false);

/**
 * The enabled plugin steps in chain order with each plugin's automation baked from the rack's keyframes. Keyframe times are
 * timeline seconds and a stem starts at timeline 0, so a lane is the keyframes as they are.
 */
export function pluginRackSteps(rack: AudioPluginRack | undefined, options: { preview?: boolean } = {}): NativePluginStep[] {
  if (!rack) return [];
  const effects = rackPluginEffects(rack).filter((effect) => !(options.preview && effect.metadata?.previewBypass === true));
  const baked = bakeNativePluginAutomation(effects, { keyframes: rack.keyframes ?? [], inPoint: 0, outPoint: 0, speed: 1, reversed: false });
  return nativePluginSteps(baked);
}

export const pluginRackSignature = (steps: readonly NativePluginStep[]): string => steps.map(stepSignature).join(">");

export interface PluginRackTarget {
  readonly kind: PluginRackKind;
  readonly id: string;
  readonly name: string;
  readonly rack: AudioPluginRack;
}

/** Every track, bus and the master that carries hosted plugins (enabled or not), tracks first, master last. */
export function pluginRackTargets(timeline: Pick<Timeline, "tracks" | "audioBuses" | "masterPluginRack">): PluginRackTarget[] {
  const out: PluginRackTarget[] = [];
  for (const track of timeline.tracks) if (rackPluginEffects(track.pluginRack).length > 0) out.push({ kind: "track", id: track.id, name: track.name, rack: track.pluginRack as AudioPluginRack });
  for (const bus of timeline.audioBuses ?? []) if (rackPluginEffects(bus.pluginRack).length > 0) out.push({ kind: "bus", id: bus.id, name: bus.name, rack: bus.pluginRack as AudioPluginRack });
  if (rackPluginEffects(timeline.masterPluginRack).length > 0) out.push({ kind: "master", id: MASTER_RACK_TARGET, name: MASTER_RACK_NAME, rack: timeline.masterPluginRack as AudioPluginRack });
  return out;
}

/** Targets with at least one enabled plugin: the ones that need a stem. */
export const activePluginRackTargets = (timeline: Pick<Timeline, "tracks" | "audioBuses" | "masterPluginRack">): PluginRackTarget[] => pluginRackTargets(timeline).filter((target) => pluginRackIsActive(target.rack));

export const projectHasPluginRacks = (timeline: Pick<Timeline, "tracks" | "audioBuses" | "masterPluginRack">): boolean => activePluginRackTargets(timeline).length > 0;

/* ------------------------------------------------------------------ */
/* Undoable edits (every one is exactly one `audioPluginRack/set`)     */
/* ------------------------------------------------------------------ */

type RackOwner = Pick<Track, "id" | "pluginRack"> | Pick<AudioBus, "id" | "pluginRack">;

export function findRackOwner(timeline: Pick<Timeline, "tracks" | "audioBuses" | "masterPluginRack">, target: string): { kind: PluginRackKind; owner: Track | AudioBus | Pick<AudioBus, "id" | "pluginRack"> } | undefined {
  if (target === MASTER_RACK_TARGET) return { kind: "master", owner: { id: MASTER_RACK_TARGET, ...(timeline.masterPluginRack ? { pluginRack: timeline.masterPluginRack } : {}) } };
  const track = timeline.tracks.find((t) => t.id === target);
  if (track) return { kind: "track", owner: track };
  const bus = (timeline.audioBuses ?? []).find((b) => b.id === target);
  return bus ? { kind: "bus", owner: bus } : undefined;
}

export interface PluginRackActionIds {
  readonly actionId: string;
}

const setAction = (target: string, rack: AudioPluginRack | null, ids: PluginRackActionIds, timestamp: number): Action => ({
  id: ids.actionId,
  timestamp,
  type: "audioPluginRack/set",
  params: { target, rack },
});

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Replaces the whole rack. Null when it would not change anything. */
export function planSetPluginRack(owner: RackOwner, rack: AudioPluginRack | null, ids: PluginRackActionIds, timestamp = Date.now()): Action | null {
  const next = rack ? (sanitizePluginRack(rack) ?? null) : null;
  if (sameJson(next, owner.pluginRack ?? null)) return null;
  return setAction(owner.id, next, ids, timestamp);
}

export function planAddRackPlugin(
  owner: RackOwner,
  plugin: Pick<NativePluginDescriptor, "id" | "format" | "name" | "vendor" | "latencySamples">,
  ids: PluginRackActionIds & { effectId: string },
  timestamp = Date.now(),
): Action | null {
  const rack = owner.pluginRack ?? { plugins: [] };
  if (rackPluginEffects(rack).length >= MAX_RACK_NATIVE_PLUGINS) return null;
  return setAction(owner.id, { ...rack, plugins: [...rack.plugins, createNativePluginEffect(ids.effectId, plugin)] }, ids, timestamp);
}

export function planUpdateRackPlugin(
  owner: RackOwner,
  effectId: string,
  patch: { state?: string; values?: Record<string, number>; enabled?: boolean; latencySamples?: number },
  ids: PluginRackActionIds,
  timestamp = Date.now(),
): Action | null {
  const rack = owner.pluginRack;
  const existing = rack?.plugins.find((effect) => effect.id === effectId);
  if (!rack || !existing) return null;
  const current = readNativePluginParams(existing);
  const next: Record<string, unknown> = { ...existing.params };
  if (patch.state !== undefined) next.state = patch.state;
  if (patch.values) {
    const merged = { ...current.values };
    for (const [key, value] of Object.entries(patch.values)) if (finite(value)) merged[key] = value;
    next.values = merged;
  }
  if (patch.latencySamples !== undefined) next.latencySamples = patch.latencySamples;
  const enabled = patch.enabled ?? existing.enabled;
  const replaced: Effect = { ...existing, enabled, params: next };
  if (sameJson(replaced, existing)) return null;
  return setAction(owner.id, { ...rack, plugins: rack.plugins.map((effect) => (effect.id === effectId ? replaced : effect)) }, ids, timestamp);
}

/** Removes the plugin AND its keyframes, in the one action. An emptied rack is removed from the owner. */
export function planRemoveRackPlugin(owner: RackOwner, effectId: string, ids: PluginRackActionIds, timestamp = Date.now()): Action | null {
  const rack = owner.pluginRack;
  if (!rack?.plugins.some((effect) => effect.id === effectId)) return null;
  const prefix = nativePluginKeyframeProperty(effectId, "");
  const plugins = rack.plugins.filter((effect) => effect.id !== effectId);
  const keyframes = (rack.keyframes ?? []).filter((key) => !key.property.startsWith(prefix));
  return setAction(owner.id, plugins.length === 0 ? null : { plugins, ...(keyframes.length > 0 ? { keyframes } : {}), ...(rack.livePreview === false ? { livePreview: false } : {}) }, ids, timestamp);
}

/** Switches a rack's preview between live streaming and the cached render. One undoable action; null when nothing changes or there is no rack. */
export function planSetRackLivePreview(owner: RackOwner, live: boolean, ids: PluginRackActionIds, timestamp = Date.now()): Action | null {
  const rack = owner.pluginRack;
  if (!rack || rackIsLive(rack) === live) return null;
  const { livePreview: _old, ...rest } = rack;
  void _old;
  return setAction(owner.id, live ? rest : { ...rest, livePreview: false }, ids, timestamp);
}

/** Moves one plugin to a new position in the chain. */
export function planMoveRackPlugin(owner: RackOwner, effectId: string, toIndex: number, ids: PluginRackActionIds, timestamp = Date.now()): Action | null {
  const rack = owner.pluginRack;
  const from = rack?.plugins.findIndex((effect) => effect.id === effectId) ?? -1;
  if (!rack || from < 0) return null;
  const to = Math.max(0, Math.min(rack.plugins.length - 1, Math.floor(toIndex)));
  if (to === from) return null;
  const plugins = [...rack.plugins];
  const [moved] = plugins.splice(from, 1);
  plugins.splice(to, 0, moved);
  return setAction(owner.id, { ...rack, plugins }, ids, timestamp);
}

/** Inserts (or, within 10 ms of an existing key, edits) a keyframe of one parameter at `time` timeline seconds. */
export function planKeyframeRackParameter(
  owner: RackOwner,
  effectId: string,
  key: string,
  time: number,
  value: number,
  ids: PluginRackActionIds & { keyframeId: string },
  timestamp = Date.now(),
): Action | null {
  const rack = owner.pluginRack;
  if (!rack?.plugins.some((effect) => effect.id === effectId) || !finite(time) || !finite(value) || time < 0) return null;
  const property = nativePluginKeyframeProperty(effectId, key);
  const existing = rack.keyframes ?? [];
  const at = existing.find((frame) => frame.property === property && Math.abs(frame.time - time) < 0.01);
  const keyframes = at
    ? existing.map((frame) => (frame === at ? { ...frame, value } : frame))
    : [...existing, { id: ids.keyframeId, time, property, value, easing: "linear" as const }].sort((a, b) => a.time - b.time);
  return setAction(owner.id, { ...rack, keyframes }, ids, timestamp);
}

export function planClearRackParameterKeyframes(owner: RackOwner, effectId: string, key: string, ids: PluginRackActionIds, timestamp = Date.now()): Action | null {
  const rack = owner.pluginRack;
  if (!rack) return null;
  const property = nativePluginKeyframeProperty(effectId, key);
  const keyframes = (rack.keyframes ?? []).filter((frame) => frame.property !== property);
  if (keyframes.length === (rack.keyframes ?? []).length) return null;
  return setAction(owner.id, { plugins: rack.plugins, ...(keyframes.length > 0 ? { keyframes } : {}), ...(rack.livePreview === false ? { livePreview: false } : {}) }, ids, timestamp);
}

/* ------------------------------------------------------------------ */
/* Plugins the host cannot run                                         */
/* ------------------------------------------------------------------ */

export interface MissingRackPlugin {
  readonly kind: PluginRackKind;
  readonly target: string;
  readonly targetName: string;
  readonly effectId: string;
  readonly pluginId: string;
  readonly name: string;
}

/** Rack plugins whose plugin the host cannot run (not installed, blocked or no host at all). `usable` null = every one is missing. */
export function findMissingRackPlugins(timeline: Pick<Timeline, "tracks" | "audioBuses" | "masterPluginRack">, usable: ReadonlySet<string> | null): MissingRackPlugin[] {
  const missing: MissingRackPlugin[] = [];
  for (const target of pluginRackTargets(timeline)) {
    for (const effect of rackPluginEffects(target.rack)) {
      const params = readNativePluginParams(effect);
      if (usable?.has(params.pluginId)) continue;
      missing.push({ kind: target.kind, target: target.id, targetName: target.name, effectId: effect.id, pluginId: params.pluginId, name: params.name });
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ */
/* Stems: the projects the mixdown renders                             */
/* ------------------------------------------------------------------ */

/** What the stem renderer needs of a project (the Project type itself lives above this module). */
interface StemSource {
  readonly timeline: Timeline;
}

const stripTrackRouting = <T extends Track>(track: T): T => {
  const { audioRack: _r, output: _o, sends: _s, automation: _a, pluginRack: _p, ...rest } = track;
  void _r; void _o; void _s; void _a; void _p;
  return rest as unknown as T;
};

/** Timeline seconds covered by a bus or master stem: the last clip end anywhere plus the plugin tail. */
export function rackStemSeconds(timeline: Pick<Timeline, "tracks" | "audioBuses" | "duration">): number {
  let end = Number.isFinite(timeline.duration) ? timeline.duration : 0;
  for (const track of timeline.tracks) for (const clip of track.clips) end = Math.max(end, clip.startTime + clip.duration);
  return Math.max(0.001, end) + RACK_STEM_TAIL_SECONDS;
}

/**
 * Timeline seconds covered by the stem of ONE track: that track's own last clip end plus the plugin tail. Unlike
 * {@link rackStemSeconds} it ignores the rest of the timeline, so an edit that only lengthens another track (or rippling
 * another track's speed) neither changes this stem's window nor invalidates its cached render.
 */
export function trackStemSeconds(track: Pick<Track, "clips">): number {
  let end = 0;
  for (const clip of track.clips) end = Math.max(end, clip.startTime + clip.duration);
  return Math.max(0.001, end) + RACK_STEM_TAIL_SECONDS;
}

/**
 * The project whose mixdown is the TRACK's signal at the input of its plugin rack: only that track, with no rack, fader,
 * pan, sends, output or automation, no buses and no master rack. `audible` is the track's audibility in the real project
 * (mute / solo / solo-safe), which a stem must honour.
 */
export function buildTrackStemProject<P extends StemSource>(project: P, trackId: string, audible: boolean): P | undefined {
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  if (!track) return undefined;
  const { masterAudioRack: _m, audioBuses: _b, ...rest } = project.timeline;
  void _m; void _b;
  const isolated: Track = { ...stripTrackRouting(track), hidden: track.hidden, muted: !audible, solo: false };
  return { ...project, timeline: { ...rest, tracks: [isolated] } };
}

/**
 * The project whose mixdown is the BUS's summed input (pre plugins, rack, pan and fader): everything that feeds the bus
 * stays, the bus keeps no rack/plugins/automation and plays into the master, and tracks that do not feed it are muted.
 * Tracks and buses upstream keep their plugin racks (the renderer resolves those stems first). `audible` maps track ids
 * to their audibility in the real project.
 */
export function buildBusStemProject<P extends StemSource>(project: P, busId: string, audible: ReadonlyMap<string, boolean>): P | undefined {
  const timeline = project.timeline;
  const buses = timeline.audioBuses ?? [];
  if (!buses.some((b) => b.id === busId)) return undefined;
  const upstream = new Set<string>([busId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const bus of buses) {
      if (!upstream.has(bus.id) && bus.output !== undefined && upstream.has(bus.output)) {
        upstream.add(bus.id);
        changed = true;
      }
    }
  }
  const stemBuses: AudioBus[] = buses
    .filter((bus) => upstream.has(bus.id))
    .map((bus) => {
      if (bus.id !== busId) return { ...bus, solo: false };
      const { rack: _r, pluginRack: _p, output: _o, automation: _a, ...rest } = bus;
      void _r; void _p; void _o; void _a;
      return { ...rest, muted: false, solo: false };
    });
  let sinkNeeded = false;
  const feedsBus = (track: Track): boolean => {
    const reaches = (id: string | undefined): boolean => id !== undefined && upstream.has(id);
    if (reaches(track.output) || (track.sends ?? []).some((s) => upstream.has(s.busId))) return true;
    return false;
  };
  const tracks = timeline.tracks.map((track): Track => {
    const feeds = feedsBus(track);
    const outputInside = track.output !== undefined && upstream.has(track.output);
    const sends = (track.sends ?? []).filter((s) => upstream.has(s.busId));
    const { sends: _s, output: _o, ...rest } = track;
    void _s; void _o;
    const parkDry = feeds && !outputInside;
    if (parkDry) sinkNeeded = true;
    return {
      ...rest,
      ...(outputInside ? { output: track.output } : parkDry ? { output: RACK_STEM_SINK_ID } : {}),
      ...(sends.length > 0 ? { sends } : {}),
      muted: !feeds || audible.get(track.id) === false,
      solo: false,
    };
  });
  if (sinkNeeded) stemBuses.push({ id: RACK_STEM_SINK_ID, name: "Rack stem sink", muted: true, solo: false });
  const { masterAudioRack: _m, audioBuses: _b, ...rest } = timeline;
  void _m; void _b;
  return { ...project, timeline: { ...rest, tracks, audioBuses: stemBuses } };
}

/**
 * The project whose mixdown is the MASTER's summed input: every track and bus exactly as they are (their own plugin racks
 * stay and are resolved first by the renderer), but with no master fader / built-in master rack and no master plugins.
 */
export function buildMasterStemProject<P extends StemSource>(project: P): P {
  const { masterAudioRack: _m, masterPluginRack: _mp, ...rest } = project.timeline;
  void _m; void _mp;
  return { ...project, timeline: rest };
}

/**
 * The timeline a mixdown (or the live graph) uses once the stems of `stemmed` targets replace their signal:
 *  - a stemmed TRACK loses its pluginRack (its clips are replaced by the stem, which then runs through the track's own
 *    built-in rack, pan, fader and sends exactly as the clips did);
 *  - a stemmed BUS loses its pluginRack, everything that fed it is parked on a muted sink bus, and a synthetic track plays the
 *    processed stem into it, so the bus's rack, pan, fader, mute / solo, automation and output apply unchanged.
 * Unstemmed targets (plugin bypassed, no host) are left exactly as they were: they play dry.
 */
export function applyRackStemsToTimeline(timeline: Timeline, stemmed: ReadonlySet<string>): Timeline {
  if (stemmed.size === 0) return timeline;
  if (stemmed.has(MASTER_RACK_TARGET)) {
    // The master stem IS the whole mix (tracks, buses and their plugins included): it replaces every track and bus, and plays
    // into the master, where the built-in master rack and fader apply unchanged.
    const { masterPluginRack: _mp, audioBuses: _b, ...rest } = timeline;
    void _mp; void _b;
    return { ...rest, tracks: [syntheticStemTrack(MASTER_RACK_TARGET, undefined)] };
  }
  const stemmedBuses = new Set((timeline.audioBuses ?? []).filter((b) => stemmed.has(b.id)).map((b) => b.id));
  const tracks: Track[] = timeline.tracks.map((track): Track => {
    let next: Track = track;
    if (stemmed.has(track.id) && track.pluginRack) {
      const { pluginRack: _p, ...rest } = next;
      void _p;
      next = rest as Track;
    }
    const output = next.output !== undefined && stemmedBuses.has(next.output) ? RACK_STEM_SINK_ID : undefined;
    const sends = next.sends?.some((s) => stemmedBuses.has(s.busId));
    if (output !== undefined || sends) {
      next = {
        ...next,
        ...(output !== undefined ? { output } : {}),
        ...(sends ? { sends: next.sends?.map((s) => (stemmedBuses.has(s.busId) ? { ...s, busId: RACK_STEM_SINK_ID } : s)) } : {}),
      };
    }
    return next;
  });
  if (stemmedBuses.size === 0) return { ...timeline, tracks };
  const buses: AudioBus[] = (timeline.audioBuses ?? []).map((bus) => {
    let next = bus;
    if (stemmedBuses.has(bus.id)) {
      const { pluginRack: _p, ...rest } = bus;
      void _p;
      next = rest as AudioBus;
    }
    return next.output !== undefined && stemmedBuses.has(next.output) ? { ...next, output: RACK_STEM_SINK_ID } : next;
  });
  buses.push({ id: RACK_STEM_SINK_ID, name: "Rack stem sink", muted: true, solo: false });
  for (const id of stemmedBuses) tracks.push(syntheticStemTrack(id, id));
  return { ...timeline, tracks, audioBuses: buses };
}

function syntheticStemTrack(busId: string, output: string | undefined): Track {
  return {
    id: rackStemTrackId(busId),
    type: "audio",
    name: "Rack stem",
    clips: [],
    transitions: [],
    locked: true,
    hidden: false,
    muted: false,
    solo: false,
    ...(output !== undefined ? { output } : {}),
  };
}

/** A track whose whole signal ends on the rack-stem sink: its clips need not be rendered into the mix at all. */
export function isSunkTrack(track: Pick<Track, "output" | "sends">): boolean {
  return track.output === RACK_STEM_SINK_ID && (track.sends ?? []).every((s) => s.busId === RACK_STEM_SINK_ID);
}

/** True when any clip effect is set to "hear dry" in the preview: only then does a preview render differ from an export render. */
export function timelineHasClipPreviewBypass(timeline: Pick<Timeline, "tracks">): boolean {
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if ((clip.audioEffects ?? []).some((effect) => effect.metadata?.previewBypass === true)) return true;
    }
  }
  return false;
}
