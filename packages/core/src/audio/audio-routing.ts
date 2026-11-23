import { rackForFingerprint, sanitizePluginRack } from "./native-plugin/native-plugin-rack";
import type { Project } from "../types/project";
import type {
  AudioBus,
  AudioBusRole,
  AudioSend,
  AutomationPoint,
  Timeline,
  Track,
} from "../types/timeline";
import { sanitizeAudioRack } from "./track-audio-rack";

/**
 * Pure model of the Audio Track Mixer routing: buses, output assignment and
 * sends. Everything the realtime graph, the offline mixdown, the mixdown cache
 * and the UI/agent need to agree on lives here: validation (cycles, dangling
 * ids), audibility (mute/solo), signal-flow ordering, the edit planners (each
 * returns the params of ONE `audioRouting/set` action = one undo step) and
 * stem isolation.
 */

export const MASTER_OUTPUT = "master";
export const MAX_SENDS_PER_TRACK = 6;
export const MAX_BUSES = 16;
export const SEND_MAX_LEVEL = 4;
/** Muted bus that swallows the dry signal of tracks that only feed a stem through a send. */
const STEM_SINK_ID = "__stem_sink__";

type RoutingTimeline = Pick<Timeline, "tracks" | "audioBuses">;

export const getAudioBuses = (timeline: Pick<Timeline, "audioBuses">): readonly AudioBus[] =>
  timeline.audioBuses ?? [];

export const findBus = (timeline: Pick<Timeline, "audioBuses">, id: string | undefined): AudioBus | undefined =>
  id === undefined ? undefined : getAudioBuses(timeline).find((bus) => bus.id === id);

/** True when anything deviates from "every track plays into the master". */
export function hasAudioRouting(timeline: RoutingTimeline): boolean {
  if ((timeline.audioBuses?.length ?? 0) > 0) return true;
  return timeline.tracks.some((t) => t.output !== undefined || (t.sends?.length ?? 0) > 0);
}

/** Output a track/bus plays into after dangling ids are treated as master. */
export function resolveOutputBusId(timeline: Pick<Timeline, "audioBuses">, output: string | undefined): string | undefined {
  if (output === undefined || output === MASTER_OUTPUT) return undefined;
  return findBus(timeline, output) ? output : undefined;
}

export const trackOutputBusId = (timeline: Pick<Timeline, "audioBuses">, track: Pick<Track, "output">): string | undefined =>
  resolveOutputBusId(timeline, track.output);

export const busOutputBusId = (timeline: Pick<Timeline, "audioBuses">, bus: Pick<AudioBus, "output">): string | undefined =>
  resolveOutputBusId(timeline, bus.output);

const busLabel = (buses: readonly AudioBus[], id: string): string => buses.find((b) => b.id === id)?.name ?? id;

/**
 * Looks for a loop in bus-to-bus output routing. Returns the loop as a list of
 * bus ids (first id repeated at the end) or null.
 */
export function findBusCycle(buses: readonly AudioBus[]): string[] | null {
  const byId = new Map(buses.map((b) => [b.id, b]));
  const state = new Map<string, 1 | 2>();
  for (const start of buses) {
    if (state.get(start.id) === 2) continue;
    const path: string[] = [];
    let current: string | undefined = start.id;
    while (current !== undefined) {
      if (state.get(current) === 2) break;
      if (state.get(current) === 1) {
        const from = path.indexOf(current);
        return [...path.slice(from), current];
      }
      state.set(current, 1);
      path.push(current);
      const next: string | undefined = byId.get(current)?.output;
      current = next !== undefined && byId.has(next) ? next : undefined;
    }
    for (const id of path) state.set(id, 2);
  }
  return null;
}

export function describeBusCycle(buses: readonly AudioBus[], cycle: readonly string[]): string {
  return cycle.map((id) => busLabel(buses, id)).join(" → ");
}

/** Message for routing `busId` into `output`, or null when allowed. */
export function busOutputProblem(buses: readonly AudioBus[], busId: string, output: string | undefined): string | null {
  if (output === undefined || output === MASTER_OUTPUT) return null;
  if (!buses.some((b) => b.id === output)) return `Bus not found: ${output}`;
  const next = buses.map((b) => (b.id === busId ? { ...b, output } : b));
  const cycle = findBusCycle(next);
  if (!cycle) return null;
  return `Cannot route ${busLabel(buses, busId)} into ${busLabel(buses, output)}: that would create a routing loop (${describeBusCycle(next, cycle)}). Route it to the master or to a bus that does not feed it.`;
}

/**
 * Bus audibility with the same mute/solo rules the tracks use: a muted bus is
 * silent; while any bus is soloed only soloed buses (and the buses they play
 * into) are audible.
 */
export function computeBusAudibility(buses: readonly AudioBus[]): Map<string, boolean> {
  const byId = new Map(buses.map((b) => [b.id, b]));
  const anySolo = buses.some((b) => b.solo);
  const downstreamOfSolo = new Set<string>();
  if (anySolo) {
    for (const bus of buses) {
      if (!bus.solo) continue;
      const seen = new Set<string>();
      let next = bus.output;
      while (next !== undefined && byId.has(next) && !seen.has(next)) {
        seen.add(next);
        downstreamOfSolo.add(next);
        next = byId.get(next)?.output;
      }
    }
  }
  return new Map(
    buses.map((bus) => [bus.id, !bus.muted && (!anySolo || bus.solo || downstreamOfSolo.has(bus.id))]),
  );
}

/** Buses ordered so every bus comes before the bus it plays into (sources first). */
export function orderBusesBySignalFlow(buses: readonly AudioBus[]): AudioBus[] {
  const byId = new Map(buses.map((b) => [b.id, b]));
  const depth = (bus: AudioBus): number => {
    let d = 0;
    const seen = new Set<string>([bus.id]);
    let next = bus.output;
    while (next !== undefined && byId.has(next) && !seen.has(next)) {
      seen.add(next);
      d += 1;
      next = byId.get(next)?.output;
    }
    return d;
  };
  return [...buses].sort((a, b) => depth(b) - depth(a));
}

/** Every bus a track can reach through its output and sends (transitively). */
export function busesFedByTrack(timeline: RoutingTimeline, track: Pick<Track, "output" | "sends">): Set<string> {
  const reached = new Set<string>();
  const queue: string[] = [];
  const push = (id: string | undefined) => {
    if (id !== undefined && !reached.has(id) && findBus(timeline, id)) {
      reached.add(id);
      queue.push(id);
    }
  };
  push(trackOutputBusId(timeline, track));
  for (const send of track.sends ?? []) push(send.busId);
  while (queue.length) {
    const bus = findBus(timeline, queue.pop());
    if (bus) push(busOutputBusId(timeline, bus));
  }
  return reached;
}

export const trackFeedsBus = (timeline: RoutingTimeline, track: Pick<Track, "output" | "sends">, busId: string): boolean =>
  busesFedByTrack(timeline, track).has(busId);

const finite = (n: unknown, fallback: number): number => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function sanitizeAutomationPoints(points: unknown, max = SEND_MAX_LEVEL): AutomationPoint[] | undefined {
  if (!Array.isArray(points)) return undefined;
  const cleaned = points
    .filter((p): p is AutomationPoint => !!p && Number.isFinite((p as AutomationPoint).time) && Number.isFinite((p as AutomationPoint).value))
    .map((p) => ({ time: Math.max(0, p.time), value: clamp(p.value, 0, max) }))
    .sort((a, b) => a.time - b.time);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function sanitizeSend(raw: unknown): AudioSend | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Partial<AudioSend>;
  if (typeof s.id !== "string" || s.id.length === 0 || typeof s.busId !== "string" || s.busId.length === 0) return undefined;
  const automation = sanitizeAutomationPoints(s.automation);
  return {
    id: s.id,
    busId: s.busId,
    level: clamp(finite(s.level, 1), 0, SEND_MAX_LEVEL),
    preFader: s.preFader === true,
    ...(s.muted === true ? { muted: true } : {}),
    ...(automation ? { automation } : {}),
  };
}

export function sanitizeBus(raw: unknown): AudioBus | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Partial<AudioBus>;
  if (typeof b.id !== "string" || b.id.length === 0) return undefined;
  const rack = sanitizeAudioRack(b.rack);
  const pluginRack = sanitizePluginRack(b.pluginRack);
  const volume = sanitizeAutomationPoints(b.automation?.volume, 4);
  const role: AudioBusRole | undefined =
    b.role === "dialogue" || b.role === "music" || b.role === "effects" || b.role === "general" ? b.role : undefined;
  return {
    id: b.id,
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Bus",
    ...(role ? { role } : {}),
    ...(typeof b.color === "string" ? { color: b.color } : {}),
    ...(rack ? { rack } : {}),
    ...(pluginRack ? { pluginRack } : {}),
    muted: b.muted === true,
    solo: b.solo === true,
    ...(typeof b.output === "string" && b.output !== MASTER_OUTPUT ? { output: b.output } : {}),
    ...(volume ? { automation: { volume } } : {}),
  };
}

/**
 * Load-time repair: sanitises buses and sends, drops dangling output/send
 * references and breaks routing loops (the offending bus is sent to master).
 * Projects without routing are returned untouched (same object).
 */
function normalizeTimelineAudioRouting(timeline: Timeline): Timeline {
  if (!hasAudioRouting(timeline)) return timeline;
  let buses = (timeline.audioBuses ?? []).map(sanitizeBus).filter((b): b is AudioBus => !!b);
  const seen = new Set<string>();
  buses = buses.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
  const ids = new Set(buses.map((b) => b.id));
  buses = buses.map((b) => (b.output !== undefined && !ids.has(b.output) ? stripOutput(b) : b));
  for (let guard = 0; guard < buses.length + 1; guard++) {
    const cycle = findBusCycle(buses);
    if (!cycle) break;
    buses = buses.map((b) => (b.id === cycle[0] ? stripOutput(b) : b));
  }
  const tracks = timeline.tracks.map((t): Track => {
    if (t.output === undefined && t.sends === undefined) return t;
    const { output, sends, ...rest } = t;
    const nextOutput = output !== undefined && output !== MASTER_OUTPUT && ids.has(output) ? output : undefined;
    const nextSends = (sends ?? [])
      .map(sanitizeSend)
      .filter((s): s is AudioSend => !!s && ids.has(s.busId))
      .slice(0, MAX_SENDS_PER_TRACK);
    return {
      ...rest,
      ...(nextOutput ? { output: nextOutput } : {}),
      ...(nextSends.length ? { sends: nextSends } : {}),
    };
  });
  const { audioBuses: _drop, ...timelineRest } = timeline;
  void _drop;
  return { ...timelineRest, tracks, ...(buses.length ? { audioBuses: buses } : {}) };
}

export function normalizeProjectAudioRouting(project: Project): Project {
  const timeline = normalizeTimelineAudioRouting(project.timeline);
  // Inactive sequences are repaired too, so a looping or dangling file never reaches the graph once activated.
  const sequences = project.sequences?.map((sequence) => {
    const repaired = normalizeTimelineAudioRouting(sequence.timeline);
    return repaired === sequence.timeline ? sequence : { ...sequence, timeline: repaired };
  });
  const sequencesChanged = !!sequences && sequences.some((s, i) => s !== project.sequences?.[i]);
  if (timeline === project.timeline && !sequencesChanged) return project;
  return { ...project, timeline, ...(sequencesChanged ? { sequences } : {}) };
}

function stripOutput(bus: AudioBus): AudioBus {
  const { output: _o, ...rest } = bus;
  void _o;
  return rest;
}

// ---------------------------------------------------------------------------
// Edit planners: each result is the params of one `audioRouting/set` action.
// ---------------------------------------------------------------------------

export interface TrackRoutingPatch {
  /** Bus id, "master"/null to clear. */
  readonly output?: string | null;
  /** Replaces all sends; null/[] clears. */
  readonly sends?: readonly AudioSend[] | null;
}

export interface AudioRoutingSetParams {
  /** Full replacement of the bus list; null clears; undefined leaves it. */
  readonly buses?: readonly AudioBus[] | null;
  readonly tracks?: Readonly<Record<string, TrackRoutingPatch>>;
}

export type RoutingPlan =
  | { readonly ok: true; readonly params: AudioRoutingSetParams; readonly label: string; readonly busId?: string; readonly sendId?: string }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): RoutingPlan => ({ ok: false, message });

let idCounter = 0;
export function newRoutingId(prefix: string): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  idCounter += 1;
  return `${prefix}_${uuid ?? `${Date.now().toString(36)}${idCounter}${Math.random().toString(36).slice(2, 8)}`}`;
}

const BUS_COLORS = ["#38bdf8", "#f472b6", "#fbbf24", "#34d399", "#a78bfa", "#fb7185", "#22d3ee", "#f97316"];

function uniqueBusName(buses: readonly AudioBus[], base: string): string {
  const names = new Set(buses.map((b) => b.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n += 1) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

const trackById = (timeline: RoutingTimeline, id: string): Track | undefined => timeline.tracks.find((t) => t.id === id);

export function planAddBus(
  timeline: RoutingTimeline,
  options: { id?: string; name?: string; role?: AudioBusRole; output?: string } = {},
): RoutingPlan {
  const buses = getAudioBuses(timeline);
  if (buses.length >= MAX_BUSES) return fail(`A project holds at most ${MAX_BUSES} buses.`);
  const id = options.id ?? newRoutingId("bus");
  if (buses.some((b) => b.id === id)) return fail(`A bus with id ${id} already exists.`);
  const roleName = options.role === "dialogue" ? "Dialogue" : options.role === "music" ? "Music" : options.role === "effects" ? "FX" : "Bus";
  const bus: AudioBus = {
    id,
    name: uniqueBusName(buses, options.name?.trim() || roleName),
    ...(options.role ? { role: options.role } : {}),
    color: BUS_COLORS[buses.length % BUS_COLORS.length],
    muted: false,
    solo: false,
    ...(options.output && options.output !== MASTER_OUTPUT ? { output: options.output } : {}),
  };
  const problem = busOutputProblem([...buses, bus], id, bus.output);
  if (problem) return fail(problem);
  return { ok: true, params: { buses: [...buses, bus] }, label: `Add bus ${bus.name}`, busId: id };
}

export function planRemoveBus(timeline: RoutingTimeline, busId: string): RoutingPlan {
  const buses = getAudioBuses(timeline);
  const bus = buses.find((b) => b.id === busId);
  if (!bus) return fail(`Bus not found: ${busId}`);
  const parent = bus.output && bus.output !== busId && buses.some((b) => b.id === bus.output) ? bus.output : undefined;
  const nextBuses = buses
    .filter((b) => b.id !== busId)
    .map((b) => (b.output === busId ? (parent ? { ...b, output: parent } : stripOutput(b)) : b));
  const tracks: Record<string, TrackRoutingPatch> = {};
  for (const track of timeline.tracks) {
    const feeds = track.output === busId;
    const sends = (track.sends ?? []).filter((s) => s.busId !== busId);
    const dropsSends = sends.length !== (track.sends?.length ?? 0);
    if (!feeds && !dropsSends) continue;
    tracks[track.id] = {
      ...(feeds ? { output: parent ?? null } : {}),
      ...(dropsSends ? { sends: sends.length ? sends : null } : {}),
    };
  }
  return { ok: true, params: { buses: nextBuses.length ? nextBuses : null, tracks }, label: `Remove bus ${bus.name}`, busId };
}

export interface BusFlagsPatch {
  readonly name?: string;
  readonly role?: AudioBusRole | null;
  readonly muted?: boolean;
  readonly solo?: boolean;
  readonly color?: string;
}

export function planUpdateBus(timeline: RoutingTimeline, busId: string, patch: BusFlagsPatch): RoutingPlan {
  const buses = getAudioBuses(timeline);
  const bus = buses.find((b) => b.id === busId);
  if (!bus) return fail(`Bus not found: ${busId}`);
  const next: AudioBus = {
    ...bus,
    ...(patch.name !== undefined && patch.name.trim() ? { name: patch.name.trim() } : {}),
    ...(patch.muted !== undefined ? { muted: patch.muted } : {}),
    ...(patch.solo !== undefined ? { solo: patch.solo } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
  };
  const withRole: AudioBus =
    patch.role === undefined
      ? next
      : patch.role === null
        ? (({ role: _r, ...rest }) => (void _r, rest))(next)
        : { ...next, role: patch.role };
  return {
    ok: true,
    params: { buses: buses.map((b) => (b.id === busId ? withRole : b)) },
    label: patch.solo !== undefined ? `Solo bus ${bus.name}` : patch.muted !== undefined ? `Mute bus ${bus.name}` : `Edit bus ${bus.name}`,
    busId,
  };
}

export function planSetBusOutput(timeline: RoutingTimeline, busId: string, output: string | null | undefined): RoutingPlan {
  const buses = getAudioBuses(timeline);
  const bus = buses.find((b) => b.id === busId);
  if (!bus) return fail(`Bus not found: ${busId}`);
  const target = output === null || output === undefined || output === MASTER_OUTPUT ? undefined : output;
  const problem = busOutputProblem(buses, busId, target);
  if (problem) return fail(problem);
  return {
    ok: true,
    params: { buses: buses.map((b) => (b.id === busId ? (target ? { ...b, output: target } : stripOutput(b)) : b)) },
    label: `Route bus ${bus.name} to ${target ? busLabel(buses, target) : "Master"}`,
    busId,
  };
}

export function planSetBusAutomation(timeline: RoutingTimeline, busId: string, points: readonly AutomationPoint[] | null): RoutingPlan {
  const buses = getAudioBuses(timeline);
  const bus = buses.find((b) => b.id === busId);
  if (!bus) return fail(`Bus not found: ${busId}`);
  const cleaned = points ? sanitizeAutomationPoints(points, 4) : undefined;
  const { automation: _a, ...rest } = bus;
  void _a;
  const next: AudioBus = cleaned ? { ...rest, automation: { volume: cleaned } } : rest;
  return { ok: true, params: { buses: buses.map((b) => (b.id === busId ? next : b)) }, label: `Edit ${bus.name} automation`, busId };
}

export function planSetTrackOutput(timeline: RoutingTimeline, trackId: string, output: string | null | undefined): RoutingPlan {
  const track = trackById(timeline, trackId);
  if (!track) return fail(`Track not found: ${trackId}`);
  const target = output === null || output === undefined || output === MASTER_OUTPUT ? undefined : output;
  if (target !== undefined && !findBus(timeline, target)) return fail(`Bus not found: ${target}`);
  const buses = getAudioBuses(timeline);
  return {
    ok: true,
    params: { tracks: { [trackId]: { output: target ?? null } } },
    label: `Route ${track.name} to ${target ? busLabel(buses, target) : "Master"}`,
  };
}

export function planAddSend(
  timeline: RoutingTimeline,
  trackId: string,
  busId: string,
  options: { level?: number; preFader?: boolean; id?: string } = {},
): RoutingPlan {
  const track = trackById(timeline, trackId);
  if (!track) return fail(`Track not found: ${trackId}`);
  const bus = findBus(timeline, busId);
  if (!bus) return fail(`Bus not found: ${busId}`);
  const sends = track.sends ?? [];
  if (sends.length >= MAX_SENDS_PER_TRACK) return fail(`A track holds at most ${MAX_SENDS_PER_TRACK} sends.`);
  if (sends.some((s) => s.busId === busId)) return fail(`${track.name} already sends to ${bus.name}.`);
  const send: AudioSend = {
    id: options.id ?? newRoutingId("send"),
    busId,
    level: clamp(finite(options.level, 1), 0, SEND_MAX_LEVEL),
    preFader: options.preFader === true,
  };
  return { ok: true, params: { tracks: { [trackId]: { sends: [...sends, send] } } }, label: `Add send ${track.name} → ${bus.name}`, sendId: send.id, busId };
}

export function planRemoveSend(timeline: RoutingTimeline, trackId: string, sendId: string): RoutingPlan {
  const track = trackById(timeline, trackId);
  if (!track) return fail(`Track not found: ${trackId}`);
  const sends = track.sends ?? [];
  if (!sends.some((s) => s.id === sendId)) return fail(`Send not found: ${sendId}`);
  const next = sends.filter((s) => s.id !== sendId);
  return { ok: true, params: { tracks: { [trackId]: { sends: next.length ? next : null } } }, label: `Remove send from ${track.name}`, sendId };
}

export interface SendPatch {
  readonly level?: number;
  readonly preFader?: boolean;
  readonly muted?: boolean;
  /** Replace the send-level automation; null clears it. */
  readonly automation?: readonly AutomationPoint[] | null;
}

export function planSetSend(timeline: RoutingTimeline, trackId: string, sendId: string, patch: SendPatch): RoutingPlan {
  const track = trackById(timeline, trackId);
  if (!track) return fail(`Track not found: ${trackId}`);
  const sends = track.sends ?? [];
  const existing = sends.find((s) => s.id === sendId);
  if (!existing) return fail(`Send not found: ${sendId}`);
  let next: AudioSend = {
    ...existing,
    ...(patch.level !== undefined ? { level: clamp(finite(patch.level, existing.level), 0, SEND_MAX_LEVEL) } : {}),
    ...(patch.preFader !== undefined ? { preFader: patch.preFader } : {}),
  };
  if (patch.muted !== undefined) {
    const { muted: _m, ...rest } = next;
    void _m;
    next = patch.muted ? { ...rest, muted: true } : rest;
  }
  if (patch.automation !== undefined) {
    const { automation: _a, ...rest } = next;
    void _a;
    const cleaned = patch.automation ? sanitizeAutomationPoints(patch.automation) : undefined;
    next = cleaned ? { ...rest, automation: cleaned } : rest;
  }
  return {
    ok: true,
    params: { tracks: { [trackId]: { sends: sends.map((s) => (s.id === sendId ? next : s)) } } },
    label: `Edit send on ${track.name}`,
    sendId,
  };
}

const STEM_PRESET: readonly { role: AudioBusRole; name: string; test: RegExp }[] = [
  { role: "dialogue", name: "Dialogue", test: /dial|voice|\bvo\b|narrat|interview|speech|talk/i },
  { role: "music", name: "Music", test: /music|score|song|bgm|soundtrack/i },
  { role: "effects", name: "FX", test: /fx|effect|sfx|foley|ambien|atmos/i },
];

function presetRoleOf(track: Track): AudioBusRole | undefined {
  if (track.role === "dialogue") return "dialogue";
  if (track.role === "music") return "music";
  if (track.role === "effects" || track.role === "ambience") return "effects";
  return STEM_PRESET.find((p) => p.test.test(track.name))?.role;
}

/**
 * "Dialogue / Music / FX" stems preset: ensures the three buses exist and
 * routes every unrouted audio track whose role (or name) says which stem it
 * belongs to. Tracks with an explicit output keep it.
 */
export function planStemsPreset(timeline: RoutingTimeline): RoutingPlan {
  const buses = [...getAudioBuses(timeline)];
  const ensured = new Map<AudioBusRole, string>();
  for (const preset of STEM_PRESET) {
    const existing = buses.find((b) => b.role === preset.role) ?? buses.find((b) => b.name === preset.name);
    if (existing) {
      ensured.set(preset.role, existing.id);
      continue;
    }
    if (buses.length >= MAX_BUSES) return fail(`A project holds at most ${MAX_BUSES} buses.`);
    const id = newRoutingId("bus");
    buses.push({
      id,
      name: uniqueBusName(buses, preset.name),
      role: preset.role,
      color: BUS_COLORS[buses.length % BUS_COLORS.length],
      muted: false,
      solo: false,
    });
    ensured.set(preset.role, id);
  }
  const tracks: Record<string, TrackRoutingPatch> = {};
  for (const track of timeline.tracks) {
    if (track.output !== undefined || track.role === "captions") continue;
    const role = presetRoleOf(track);
    const busId = role ? ensured.get(role) : undefined;
    if (busId) tracks[track.id] = { output: busId };
  }
  const unchanged = buses.length === getAudioBuses(timeline).length && Object.keys(tracks).length === 0;
  if (unchanged) return fail("The Dialogue / Music / FX stems are already set up.");
  return {
    ok: true,
    params: { buses: buses.length === getAudioBuses(timeline).length ? undefined : buses, tracks },
    label: "Set up Dialogue / Music / FX stems",
  };
}

/** Apply plan params to a timeline (pure). Used by the action handler and tests. */
export function applyRoutingParams<T extends RoutingTimeline>(timeline: T, params: AudioRoutingSetParams): T {
  let next: T = timeline;
  if (params.buses !== undefined) {
    const { audioBuses: _old, ...rest } = next as T & { audioBuses?: AudioBus[] };
    void _old;
    next = (params.buses && params.buses.length ? { ...rest, audioBuses: params.buses.map((b) => b) } : rest) as T;
  }
  if (params.tracks) {
    const patches = params.tracks;
    next = {
      ...next,
      tracks: next.tracks.map((track) => {
        const patch = patches[track.id];
        if (!patch) return track;
        const { output: _o, sends: _s, ...rest } = track;
        const output = patch.output !== undefined ? (patch.output && patch.output !== MASTER_OUTPUT ? patch.output : undefined) : _o;
        const sends = patch.sends !== undefined ? (patch.sends && patch.sends.length ? [...patch.sends] : undefined) : _s;
        return { ...rest, ...(output ? { output } : {}), ...(sends ? { sends } : {}) };
      }),
    };
  }
  return next;
}

/** Validates the timeline that `params` would produce. Returns the first problem or null. */
export function validateRoutingParams(timeline: RoutingTimeline, params: AudioRoutingSetParams): string | null {
  for (const id of Object.keys(params.tracks ?? {})) {
    if (!trackById(timeline, id)) return `Track not found: ${id}`;
  }
  const next = applyRoutingParams(timeline, params);
  const buses = getAudioBuses(next);
  const ids = new Set<string>();
  for (const bus of buses) {
    if (ids.has(bus.id)) return `Duplicate bus id: ${bus.id}`;
    ids.add(bus.id);
  }
  if (buses.length > MAX_BUSES) return `A project holds at most ${MAX_BUSES} buses.`;
  for (const bus of buses) {
    if (bus.output !== undefined && !ids.has(bus.output)) return `Bus not found: ${bus.output}`;
  }
  const cycle = findBusCycle(buses);
  if (cycle) {
    return `That routing creates a loop (${describeBusCycle(buses, cycle)}). A bus cannot feed itself; route one of them to the master instead.`;
  }
  const touched = new Set(Object.keys(params.tracks ?? {}));
  for (const track of next.tracks) {
    // Untouched tracks may carry stale ids (e.g. a nest made from routed tracks); they resolve to the master.
    if (!touched.has(track.id)) continue;
    if (track.output !== undefined && !ids.has(track.output)) return `Bus not found: ${track.output}`;
    if ((track.sends?.length ?? 0) > MAX_SENDS_PER_TRACK) return `A track holds at most ${MAX_SENDS_PER_TRACK} sends.`;
    const seen = new Set<string>();
    for (const send of track.sends ?? []) {
      if (!ids.has(send.busId)) return `Bus not found: ${send.busId}`;
      if (seen.has(send.id)) return `Duplicate send id: ${send.id}`;
      seen.add(send.id);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

/** Buses that carry signal: at least one track (or a bus carrying one) feeds them. */
export function busesWithSignal(timeline: RoutingTimeline): AudioBus[] {
  const fed = new Set<string>();
  for (const track of timeline.tracks) {
    if (!track.clips.length) continue;
    for (const id of busesFedByTrack(timeline, track)) fed.add(id);
  }
  return getAudioBuses(timeline).filter((b) => fed.has(b.id));
}

/**
 * A project whose master mix IS the post-fader output of `busId`: the master
 * rack is removed, the bus (and nothing after it) is kept, and tracks that do
 * not feed it are muted (they stay so linked-clip audio still resolves). Mute
 * and solo of tracks are ignored by solo; track mutes stay. Rendering it with
 * the ordinary mixdown yields the stem, so caching, loudness analysis and the
 * export pipeline all work on it unchanged.
 */
export function isolateBusStem(project: Project, busId: string): Project | undefined {
  const timeline = project.timeline;
  const bus = findBus(timeline, busId);
  if (!bus) return undefined;
  const upstream = new Set<string>([busId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of getAudioBuses(timeline)) {
      if (!upstream.has(b.id) && b.output !== undefined && upstream.has(b.output)) {
        upstream.add(b.id);
        changed = true;
      }
    }
  }
  const buses: AudioBus[] = getAudioBuses(timeline)
    .filter((b) => upstream.has(b.id))
    .map((b) => ({ ...(b.id === busId ? stripOutput(b) : b), solo: false }));
  // A track that reaches the bus only through a send must not also leak its dry
  // (post-fader) signal to the master, which IS the stem here: park it on a muted sink bus.
  let needsSink = false;
  const tracks = timeline.tracks.map((track): Track => {
    const feeds = trackFeedsBus(timeline, track, busId);
    const outputBus = trackOutputBusId(timeline, track);
    const dryReachesStem = outputBus !== undefined && upstream.has(outputBus);
    const sends = (track.sends ?? []).filter((s) => upstream.has(s.busId));
    const { sends: _s, output: _o, ...rest } = track;
    void _s;
    void _o;
    const parkDry = feeds && !dryReachesStem;
    if (parkDry) needsSink = true;
    return {
      ...rest,
      ...(dryReachesStem ? { output: outputBus } : parkDry ? { output: STEM_SINK_ID } : {}),
      ...(sends.length ? { sends } : {}),
      muted: track.muted || !feeds,
      solo: false,
    };
  });
  if (needsSink) buses.push({ id: STEM_SINK_ID, name: "Stem sink", muted: true, solo: false });
  const { masterAudioRack: _m, masterPluginRack: _mp, audioBuses: _b, ...timelineRest } = timeline;
  void _m;
  void _mp;
  void _b;
  return { ...project, timeline: { ...timelineRest, tracks, audioBuses: buses } };
}

export interface RoutingFingerprintInput {
  readonly buses: unknown;
  readonly tracks: unknown;
}

/** Audio-relevant routing state only (names/colours excluded) for the mixdown cache key. */
export function routingFingerprintInput(timeline: RoutingTimeline): RoutingFingerprintInput {
  return {
    buses: getAudioBuses(timeline).map((b) => [b.id, b.rack, b.muted, b.solo, b.output, b.automation, rackForFingerprint(b.pluginRack)]),
    tracks: timeline.tracks.map((t) => [t.id, t.output, t.sends]),
  };
}
