import type { Project } from "../types/project";
import type {
  AudioBus,
  AudioRack,
  MixerBusState,
  MixerSnapshot,
  MixerTrackState,
  Timeline,
  Track,
} from "../types/timeline";
import { sanitizeAudioRack } from "./track-audio-rack";

/**
 * Mixer snapshots: named copies of every fader, pan, mute, solo and effect rack of the Audio Track Mixer.
 * Pure model (capture, apply, sanitize, planners); the `audioMixer/snapshot` action handler wraps it so
 * save, recall, rename and delete are each one undo step.
 */

export const MAX_MIXER_SNAPSHOTS = 32;

type SnapshotTimeline = Pick<Timeline, "tracks" | "audioBuses" | "masterAudioRack" | "mixerSnapshots">;

export const getMixerSnapshots = (timeline: Pick<Timeline, "mixerSnapshots">): readonly MixerSnapshot[] =>
  timeline.mixerSnapshots ?? [];

const cloneRack = (rack: AudioRack | undefined): AudioRack | undefined => (rack ? structuredClone(rack) : undefined);

function trackState(track: Track): MixerTrackState {
  const audioRack = cloneRack(track.audioRack);
  return {
    muted: track.muted,
    solo: track.solo,
    ...(track.soloSafe !== undefined ? { soloSafe: track.soloSafe } : {}),
    ...(audioRack ? { audioRack } : {}),
  };
}

function busState(bus: AudioBus): MixerBusState {
  const rack = cloneRack(bus.rack);
  return { muted: bus.muted, solo: bus.solo, ...(rack ? { rack } : {}) };
}

export function newSnapshotId(): string {
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Captures the current mixer state of the timeline. Audio tracks only: video tracks carry no mixer strip. */
export function captureMixerState(timeline: SnapshotTimeline): Pick<MixerSnapshot, "tracks" | "buses" | "masterRack"> {
  const tracks: Record<string, MixerTrackState> = {};
  for (const track of timeline.tracks) tracks[track.id] = trackState(track);
  const buses: Record<string, MixerBusState> = {};
  for (const bus of timeline.audioBuses ?? []) buses[bus.id] = busState(bus);
  const masterRack = cloneRack(timeline.masterAudioRack);
  return { tracks, buses, ...(masterRack ? { masterRack } : {}) };
}

export function createMixerSnapshot(timeline: SnapshotTimeline, name: string, id = newSnapshotId(), createdAt = Date.now()): MixerSnapshot {
  return { id, name: name.trim() || "Snapshot", createdAt, ...captureMixerState(timeline) };
}

/** Restores snapshot state onto tracks, buses and the master. Anything the snapshot does not know is left alone. */
export function applyMixerState<T extends SnapshotTimeline>(timeline: T, state: Pick<MixerSnapshot, "tracks" | "buses" | "masterRack">): T {
  const tracks = timeline.tracks.map((track): Track => {
    const saved = state.tracks[track.id];
    if (!saved) return track;
    const { audioRack: _rack, soloSafe: _safe, ...rest } = track;
    void _rack;
    void _safe;
    return {
      ...rest,
      muted: saved.muted,
      solo: saved.solo,
      ...(saved.soloSafe !== undefined ? { soloSafe: saved.soloSafe } : {}),
      ...(saved.audioRack ? { audioRack: structuredClone(saved.audioRack) } : {}),
    } as Track;
  });
  const next: T = { ...timeline, tracks };
  if (timeline.audioBuses) {
    (next as { audioBuses?: AudioBus[] }).audioBuses = timeline.audioBuses.map((bus): AudioBus => {
      const saved = state.buses[bus.id];
      if (!saved) return bus;
      const { rack: _rack, ...rest } = bus;
      void _rack;
      return { ...rest, muted: saved.muted, solo: saved.solo, ...(saved.rack ? { rack: structuredClone(saved.rack) } : {}) };
    });
  }
  const mutable = next as { masterAudioRack?: AudioRack };
  if (state.masterRack) mutable.masterAudioRack = structuredClone(state.masterRack);
  else delete mutable.masterAudioRack;
  return next;
}

export function sanitizeMixerSnapshot(raw: unknown): MixerSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Partial<MixerSnapshot>;
  if (typeof s.id !== "string" || s.id.length === 0) return undefined;
  const tracks: Record<string, MixerTrackState> = {};
  for (const [id, t] of Object.entries(s.tracks ?? {})) {
    if (!t || typeof t !== "object") continue;
    const audioRack = sanitizeAudioRack((t as MixerTrackState).audioRack);
    tracks[id] = {
      muted: (t as MixerTrackState).muted === true,
      solo: (t as MixerTrackState).solo === true,
      ...((t as MixerTrackState).soloSafe !== undefined ? { soloSafe: (t as MixerTrackState).soloSafe === true } : {}),
      ...(audioRack ? { audioRack } : {}),
    };
  }
  const buses: Record<string, MixerBusState> = {};
  for (const [id, b] of Object.entries(s.buses ?? {})) {
    if (!b || typeof b !== "object") continue;
    const rack = sanitizeAudioRack((b as MixerBusState).rack);
    buses[id] = { muted: (b as MixerBusState).muted === true, solo: (b as MixerBusState).solo === true, ...(rack ? { rack } : {}) };
  }
  const masterRack = sanitizeAudioRack(s.masterRack);
  return {
    id: s.id,
    name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 80) : "Snapshot",
    createdAt: typeof s.createdAt === "number" && Number.isFinite(s.createdAt) ? s.createdAt : 0,
    tracks,
    buses,
    ...(masterRack ? { masterRack } : {}),
  };
}

export type MixerSnapshotOp =
  | { readonly op: "save"; readonly snapshot: MixerSnapshot }
  | { readonly op: "recall"; readonly snapshotId: string }
  | { readonly op: "rename"; readonly snapshotId: string; readonly name: string }
  | { readonly op: "delete"; readonly snapshotId: string }
  /** Inverse of recall/save/delete: puts back the exact prior mixer state and snapshot list. */
  | {
      readonly op: "restore";
      readonly state: Pick<MixerSnapshot, "tracks" | "buses" | "masterRack">;
      readonly snapshots: readonly MixerSnapshot[] | null;
    };

export interface MixerSnapshotParams {
  readonly op: MixerSnapshotOp["op"];
  readonly snapshot?: MixerSnapshot;
  readonly snapshotId?: string;
  readonly name?: string;
  readonly state?: Pick<MixerSnapshot, "tracks" | "buses" | "masterRack">;
  readonly snapshots?: readonly MixerSnapshot[] | null;
  readonly label?: string;
}

export type SnapshotPlan = { readonly ok: true; readonly params: MixerSnapshotParams; readonly label: string } | { readonly ok: false; readonly message: string };

export function planSaveSnapshot(timeline: SnapshotTimeline, name: string): SnapshotPlan {
  if (getMixerSnapshots(timeline).length >= MAX_MIXER_SNAPSHOTS) {
    return { ok: false, message: `A project holds at most ${MAX_MIXER_SNAPSHOTS} mixer snapshots.` };
  }
  const snapshot = createMixerSnapshot(timeline, name);
  return { ok: true, label: `Save mixer snapshot "${snapshot.name}"`, params: { op: "save", snapshot } };
}

export function planRecallSnapshot(timeline: SnapshotTimeline, snapshotId: string): SnapshotPlan {
  const snap = getMixerSnapshots(timeline).find((s) => s.id === snapshotId);
  if (!snap) return { ok: false, message: `Mixer snapshot not found: ${snapshotId}` };
  return { ok: true, label: `Recall mixer snapshot "${snap.name}"`, params: { op: "recall", snapshotId } };
}

export function planRenameSnapshot(timeline: SnapshotTimeline, snapshotId: string, name: string): SnapshotPlan {
  if (!getMixerSnapshots(timeline).some((s) => s.id === snapshotId)) return { ok: false, message: `Mixer snapshot not found: ${snapshotId}` };
  if (!name.trim()) return { ok: false, message: "A snapshot needs a name." };
  return { ok: true, label: "Rename mixer snapshot", params: { op: "rename", snapshotId, name } };
}

export function planDeleteSnapshot(timeline: SnapshotTimeline, snapshotId: string): SnapshotPlan {
  const snap = getMixerSnapshots(timeline).find((s) => s.id === snapshotId);
  if (!snap) return { ok: false, message: `Mixer snapshot not found: ${snapshotId}` };
  return { ok: true, label: `Delete mixer snapshot "${snap.name}"`, params: { op: "delete", snapshotId } };
}

/** Applies a snapshot operation to a (mutable) timeline. Returns an error message or null. */
export function applySnapshotOp(timeline: Project["timeline"], params: MixerSnapshotParams): string | null {
  const t = timeline as { tracks: Track[]; audioBuses?: AudioBus[]; masterAudioRack?: AudioRack; mixerSnapshots?: MixerSnapshot[] };
  const list = [...(t.mixerSnapshots ?? [])];
  const setList = (next: MixerSnapshot[]) => {
    if (next.length) t.mixerSnapshots = next;
    else delete t.mixerSnapshots;
  };
  switch (params.op) {
    case "save": {
      const snap = sanitizeMixerSnapshot(params.snapshot);
      if (!snap) return "Invalid snapshot";
      setList([...list.filter((s) => s.id !== snap.id), snap]);
      return null;
    }
    case "recall": {
      const snap = list.find((s) => s.id === params.snapshotId);
      if (!snap) return `Mixer snapshot not found: ${params.snapshotId}`;
      Object.assign(t, applyMixerState(t, snap));
      if (!snap.masterRack) delete t.masterAudioRack;
      return null;
    }
    case "rename": {
      if (!list.some((s) => s.id === params.snapshotId)) return `Mixer snapshot not found: ${params.snapshotId}`;
      setList(list.map((s) => (s.id === params.snapshotId ? { ...s, name: (params.name ?? "").trim().slice(0, 80) || s.name } : s)));
      return null;
    }
    case "delete": {
      if (!list.some((s) => s.id === params.snapshotId)) return `Mixer snapshot not found: ${params.snapshotId}`;
      setList(list.filter((s) => s.id !== params.snapshotId));
      return null;
    }
    case "restore": {
      if (!params.state) return "restore needs a state";
      Object.assign(t, applyMixerState(t, params.state));
      if (!params.state.masterRack) delete t.masterAudioRack;
      const snaps = (params.snapshots ?? []).map(sanitizeMixerSnapshot).filter((s): s is MixerSnapshot => !!s);
      setList(snaps);
      return null;
    }
    default:
      return "Unknown mixer snapshot operation";
  }
}
