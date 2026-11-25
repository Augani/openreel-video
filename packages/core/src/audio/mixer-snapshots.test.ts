import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { AudioBus, AudioRack, Track } from "../types/timeline";
import { planAddBus, planSetTrackOutput, type RoutingPlan } from "./audio-routing";
import {
  getMixerSnapshots,
  planDeleteSnapshot,
  planRecallSnapshot,
  planRenameSnapshot,
  planSaveSnapshot,
  type SnapshotPlan,
} from "./mixer-snapshots";

const rack = (volume: number, pan?: number): AudioRack => ({ effects: [], volume, ...(pan !== undefined ? { pan } : {}) });
const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });

const project = (): Project =>
  ({
    id: "p", name: "Mix", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 10, markers: [], subtitles: [],
      tracks: [track("a", { output: "sub", audioRack: rack(0.8, -0.2) }), track("b", { output: "sub" })],
      audioBuses: [bus("sub", { rack: rack(0.5) })],
      masterAudioRack: rack(0.9),
    },
    mediaLibrary: { items: [] },
  }) as unknown as Project;

let seq = 0;
async function snap(executor: ActionExecutor, p: Project, plan: SnapshotPlan) {
  if (!plan.ok) throw new Error(plan.message);
  const action: Action = {
    type: "audioMixer/snapshot",
    id: `s${seq++}`,
    timestamp: Date.now(),
    params: { ...plan.params, label: plan.label } as unknown as Action["params"],
  };
  return executor.execute(action, p);
}
async function route(executor: ActionExecutor, p: Project, plan: RoutingPlan) {
  if (!plan.ok) throw new Error(plan.message);
  return executor.execute(
    { type: "audioRouting/set", id: `r${seq++}`, timestamp: Date.now(), params: { ...plan.params, label: plan.label } as unknown as Action["params"] },
    p,
  );
}

const mixerView = (p: Project) =>
  JSON.stringify({
    tracks: p.timeline.tracks.map((t) => [t.id, t.muted, t.solo, t.soloSafe ?? null, t.audioRack ?? null]),
    buses: (p.timeline.audioBuses ?? []).map((b) => [b.id, b.muted, b.solo, b.rack ?? null]),
    master: p.timeline.masterAudioRack ?? null,
  });

describe("mixer snapshots", () => {
  it("saves every fader, pan, mute, solo and rack, and recalls them after the mixer moved", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const before = mixerView(p);
    const saved = await snap(executor, p, planSaveSnapshot(p.timeline, "Dialogue up"));
    expect(saved.success).toBe(true);
    const [first] = getMixerSnapshots(p.timeline);
    expect(first.name).toBe("Dialogue up");
    expect(first.tracks.a.audioRack?.pan).toBe(-0.2);
    expect(first.buses.sub.rack?.volume).toBe(0.5);
    expect(first.masterRack?.volume).toBe(0.9);

    // Move everything.
    const t = p.timeline as unknown as { tracks: Track[]; audioBuses: AudioBus[]; masterAudioRack?: AudioRack };
    t.tracks = t.tracks.map((x) => ({ ...x, muted: true, solo: x.id === "b", audioRack: rack(0.1, 0.9) }));
    t.audioBuses = t.audioBuses.map((b) => ({ ...b, muted: true, solo: true, rack: rack(2) }));
    t.masterAudioRack = rack(0.3);
    expect(mixerView(p)).not.toBe(before);

    const recalled = await snap(executor, p, planRecallSnapshot(p.timeline, first.id));
    expect(recalled.success).toBe(true);
    expect(mixerView(p)).toBe(before);
  });

  it("recall is one undo step that restores the moved mixer exactly, redo re-applies it", async () => {
    const executor = new ActionExecutor();
    const p = project();
    await snap(executor, p, planSaveSnapshot(p.timeline, "A"));
    const t = p.timeline as unknown as { tracks: Track[] };
    t.tracks = t.tracks.map((x) => ({ ...x, muted: true, audioRack: rack(0.4, 0.5) }));
    const moved = mixerView(p);
    const id = getMixerSnapshots(p.timeline)[0].id;
    await snap(executor, p, planRecallSnapshot(p.timeline, id));
    const recalled = mixerView(p);
    expect(recalled).not.toBe(moved);
    expect((await executor.undo(p)).success).toBe(true);
    expect(mixerView(p)).toBe(moved);
    expect((await executor.redo(p)).success).toBe(true);
    expect(mixerView(p)).toBe(recalled);
  });

  it("save, rename and delete each undo to the previous snapshot list", async () => {
    const executor = new ActionExecutor();
    const p = project();
    await snap(executor, p, planSaveSnapshot(p.timeline, "One"));
    const id = getMixerSnapshots(p.timeline)[0].id;
    await snap(executor, p, planRenameSnapshot(p.timeline, id, "Uno"));
    expect(getMixerSnapshots(p.timeline)[0].name).toBe("Uno");
    await executor.undo(p);
    expect(getMixerSnapshots(p.timeline)[0].name).toBe("One");
    await snap(executor, p, planDeleteSnapshot(p.timeline, id));
    expect(getMixerSnapshots(p.timeline)).toHaveLength(0);
    await executor.undo(p);
    expect(getMixerSnapshots(p.timeline).map((s) => s.name)).toEqual(["One"]);
    await executor.undo(p);
    expect(getMixerSnapshots(p.timeline)).toHaveLength(0);
    expect(p.timeline.mixerSnapshots).toBeUndefined();
  });

  it("recall leaves routing alone and skips tracks and buses that no longer exist", async () => {
    const executor = new ActionExecutor();
    const p = project();
    await snap(executor, p, planSaveSnapshot(p.timeline, "Before routing change"));
    const id = getMixerSnapshots(p.timeline)[0].id;
    const added = await route(executor, p, planAddBus(p.timeline, { name: "FX" }));
    expect(added.success).toBe(true);
    await route(executor, p, planSetTrackOutput(p.timeline, "b", undefined));
    expect(p.timeline.tracks.find((x) => x.id === "b")?.output).toBeUndefined();
    const tl = p.timeline as unknown as { tracks: Track[] };
    tl.tracks = tl.tracks.filter((x) => x.id !== "a");
    const result = await snap(executor, p, planRecallSnapshot(p.timeline, id));
    expect(result.success).toBe(true);
    expect(p.timeline.tracks.find((x) => x.id === "b")?.output).toBeUndefined();
    expect(p.timeline.audioBuses).toHaveLength(2);
  });

  it("refuses unknown snapshots and survives a JSON round trip", async () => {
    const p = project();
    expect(planRecallSnapshot(p.timeline, "nope").ok).toBe(false);
    const executor = new ActionExecutor();
    await snap(executor, p, planSaveSnapshot(p.timeline, "Persisted"));
    const copy = JSON.parse(JSON.stringify(p)) as Project;
    expect(getMixerSnapshots(copy.timeline)[0].tracks.a.audioRack?.volume).toBe(0.8);
    expect(planRecallSnapshot(copy.timeline, getMixerSnapshots(copy.timeline)[0].id).ok).toBe(true);
  });
});
