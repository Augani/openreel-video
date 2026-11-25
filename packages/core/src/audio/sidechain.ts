/**
 * Sidechain keys for rack compressors: a compressor can detect on another track's or bus's signal instead of its own
 * (duck music under a voice, pump a pad under a kick). The key is stored on the compressor as a string param
 * `keySource` ("track:<id>" or "bus:<id>") plus `keyHpf` (Hz, high-pass on the key before detection).
 *
 * Live and offline share this file: `computeSidechainPlan` decides which keys are legal (a key that would close a
 * feedback loop through the routing is dropped, so the graph never has a cycle), and `SidechainKeyHub` is the
 * order-independent meeting point where a source publishes its output and a compressor taps it.
 */
import type { AudioRack, Timeline } from "../types";
import { resolveOutputBusId } from "./audio-routing";

export const KEY_SOURCE_PARAM = "keySource";
export const KEY_HPF_PARAM = "keyHpf";
export const MASTER_OWNER = "master";

export type KeySourceKind = "track" | "bus";

export const keySourceId = (kind: KeySourceKind, id: string): string => `${kind}:${id}`;
export const trackOwnerId = (id: string): string => keySourceId("track", id);
export const busOwnerId = (id: string): string => keySourceId("bus", id);

export function parseKeySource(value: unknown): { kind: KeySourceKind; id: string } | null {
  if (typeof value !== "string") return null;
  const match = /^(track|bus):(.+)$/.exec(value);
  return match ? { kind: match[1] as KeySourceKind, id: match[2] } : null;
}

/** The compressor's configured key, or null when it detects on its own signal. */
export const compressorKeySource = (params: Record<string, number | string | boolean>): string | null => {
  const value = params[KEY_SOURCE_PARAM];
  return parseKeySource(value) ? (value as string) : null;
};

type SidechainTimeline = Pick<Timeline, "tracks" | "audioBuses" | "masterAudioRack">;

export interface SidechainPlan {
  /** `${ownerId}|${keySource}` for every key that is legal. */
  readonly valid: ReadonlySet<string>;
  /** Source ids (track:/bus:) that at least one legal key listens to. */
  readonly sources: ReadonlySet<string>;
}

const EMPTY_PLAN: SidechainPlan = { valid: new Set(), sources: new Set() };

const rackKeys = (rack: AudioRack | undefined): string[] =>
  (rack?.effects ?? []).filter((fx) => fx.type === "compressor").flatMap((fx) => compressorKeySource(fx.params) ?? []);

/**
 * Which keys are legal for this timeline. A key is dropped when its source does not exist, is the owner itself, or
 * depends on the owner (the source is fed, directly or through buses, sends or other keys, by the owner), since that
 * would be a feedback loop.
 */
export function computeSidechainPlan(timeline: SidechainTimeline): SidechainPlan {
  const owners: Array<{ id: string; keys: string[] }> = [];
  const masterKeys = rackKeys(timeline.masterAudioRack);
  if (masterKeys.length) owners.push({ id: MASTER_OWNER, keys: masterKeys });
  for (const bus of timeline.audioBuses ?? []) {
    const keys = rackKeys(bus.rack);
    if (keys.length) owners.push({ id: busOwnerId(bus.id), keys });
  }
  for (const track of timeline.tracks) {
    const keys = rackKeys(track.audioRack);
    if (keys.length) owners.push({ id: trackOwnerId(track.id), keys });
  }
  if (owners.length === 0) return EMPTY_PLAN;

  // dependsOn.get(X) = nodes whose signal reaches X.
  const dependsOn = new Map<string, Set<string>>();
  const add = (to: string, from: string) => {
    let set = dependsOn.get(to);
    if (!set) dependsOn.set(to, (set = new Set()));
    set.add(from);
  };
  const destination = (output: string | undefined): string => {
    const bus = resolveOutputBusId(timeline, output);
    return bus ? busOwnerId(bus) : MASTER_OWNER;
  };
  for (const track of timeline.tracks) {
    add(destination(track.output), trackOwnerId(track.id));
    for (const send of track.sends ?? []) add(busOwnerId(send.busId), trackOwnerId(track.id));
  }
  for (const bus of timeline.audioBuses ?? []) add(destination(bus.output), busOwnerId(bus.id));

  const exists = new Set<string>([
    ...timeline.tracks.map((t) => trackOwnerId(t.id)),
    ...(timeline.audioBuses ?? []).map((b) => busOwnerId(b.id)),
  ]);
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const node = stack.pop() as string;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const dep of dependsOn.get(node) ?? []) stack.push(dep);
    }
    return false;
  };

  const valid = new Set<string>();
  const sources = new Set<string>();
  for (const owner of owners) {
    for (const key of owner.keys) {
      if (!exists.has(key) || key === owner.id || reaches(key, owner.id)) continue;
      valid.add(`${owner.id}|${key}`);
      sources.add(key);
      add(owner.id, key);
    }
  }
  return { valid, sources };
}

/** Candidate key sources for the compressor owned by `ownerId`: every track/bus that would not make a loop. */
export function listSidechainCandidates(
  timeline: SidechainTimeline,
  ownerId: string,
): Array<{ id: string; kind: KeySourceKind; label: string }> {
  const out: Array<{ id: string; kind: KeySourceKind; label: string }> = [];
  const candidates = [
    ...timeline.tracks.map((t) => ({ id: trackOwnerId(t.id), kind: "track" as const, label: t.name || t.id })),
    ...(timeline.audioBuses ?? []).map((b) => ({ id: busOwnerId(b.id), kind: "bus" as const, label: b.name || b.id })),
  ];
  for (const candidate of candidates) {
    if (candidate.id === ownerId) continue;
    // Test the candidate as a hypothetical key on an otherwise empty rack of the owner.
    const probe = withProbeKey(timeline, ownerId, candidate.id);
    if (computeSidechainPlan(probe).valid.has(`${ownerId}|${candidate.id}`)) out.push(candidate);
  }
  return out;
}

function withProbeKey(timeline: SidechainTimeline, ownerId: string, key: string): SidechainTimeline {
  const probeRack: AudioRack = { effects: [{ id: "probe", type: "compressor", bypassed: false, params: { [KEY_SOURCE_PARAM]: key } }] };
  const addTo = <T extends { audioRack?: AudioRack }>(item: T): T => ({ ...item, audioRack: { effects: [...(item.audioRack?.effects ?? []), ...probeRack.effects] } });
  if (ownerId === MASTER_OWNER) return { ...timeline, masterAudioRack: { effects: [...(timeline.masterAudioRack?.effects ?? []), ...probeRack.effects] } };
  const parsed = parseKeySource(ownerId);
  if (parsed?.kind === "bus") {
    return {
      ...timeline,
      audioBuses: (timeline.audioBuses ?? []).map((b) => (b.id === parsed.id ? { ...b, rack: { effects: [...(b.rack?.effects ?? []), ...probeRack.effects] } } : b)),
    };
  }
  return { ...timeline, tracks: timeline.tracks.map((t) => (parsed && t.id === parsed.id ? addTo(t) : t)) };
}

/**
 * Where key sources meet compressors. A source calls `publish(key, node)` with its output (post-fader); a compressor
 * calls `tap(key)` and connects the returned gain to its key input. Either side can come first or be rebuilt later:
 * the tap node persists for the life of the hub.
 */
export class SidechainKeyHub {
  private readonly taps = new Map<string, GainNode>();
  private readonly published = new Map<string, Set<AudioNode>>();
  private plan: SidechainPlan = EMPTY_PLAN;

  constructor(private readonly ctx: BaseAudioContext) {}

  /** Recomputes which keys are legal. Returns true when that set changed (racks must then be re-applied). */
  setTimeline(timeline: SidechainTimeline): boolean {
    const next = computeSidechainPlan(timeline);
    const signature = (plan: SidechainPlan) => [...plan.valid].sort().join("\n");
    const changed = signature(next) !== signature(this.plan);
    this.plan = next;
    return changed;
  }

  /** Whether the compressor owned by `ownerId` may listen to `key` right now. */
  isValidKey(ownerId: string, key: string): boolean {
    return this.plan.valid.has(`${ownerId}|${key}`);
  }

  /** True when some legal compressor listens to this source, so it must be built (and published). */
  isKeySource(key: string): boolean {
    return this.plan.sources.has(key);
  }

  tap(key: string): GainNode {
    let node = this.taps.get(key);
    if (!node) {
      node = this.ctx.createGain();
      this.taps.set(key, node);
    }
    return node;
  }

  publish(key: string, node: AudioNode): void {
    let set = this.published.get(key);
    if (!set) this.published.set(key, (set = new Set()));
    if (set.has(node)) return;
    set.add(node);
    node.connect(this.tap(key));
  }

  unpublish(key: string, node: AudioNode): void {
    const set = this.published.get(key);
    if (!set?.delete(node)) return;
    try {
      node.disconnect(this.tap(key));
    } catch {
      /* already disconnected */
    }
  }

  dispose(): void {
    for (const [key, set] of this.published) for (const node of set) this.unpublish(key, node);
    for (const tap of this.taps.values()) {
      try {
        tap.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.taps.clear();
    this.published.clear();
  }
}

/** True when any compressor in the timeline has a key configured (cheap pre-check before building a hub). */
export const timelineHasSidechain = (timeline: SidechainTimeline): boolean =>
  computeSidechainPlan(timeline).valid.size > 0;
