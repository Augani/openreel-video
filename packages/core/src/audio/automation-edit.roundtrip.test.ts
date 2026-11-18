import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Clip, Project } from "../types";
import type { AutomationPoint } from "../types/timeline";
import { insertPoint, movePoint, dbToVolume } from "./automation-edit";
import { resolveClipVolumeAutomation } from "./clip-audio-resolution";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";

function project(locked = false): Project {
  const clip: Clip = {
    id: "clip", mediaId: "media", trackId: "track", startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    volume: 1, effects: [], audioEffects: [], keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
  };
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      tracks: [{ id: "track", name: "A", type: "audio", locked, hidden: false, muted: false, solo: false, clips: [clip], transitions: [] }],
      duration: 4, markers: [], subtitles: [],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const lane = (p: Project) => p.timeline.tracks[0].clips[0].automation?.volume;
const commit = (executor: ActionExecutor, p: Project, points: AutomationPoint[] | null) =>
  executor.execute({ type: "audio/addAutomation", id: crypto.randomUUID(), timestamp: 1, params: { clipId: "clip", points } }, p);

type Recorded = { set: Array<[number, number]>; ramps: Array<[number, number]> };

/** Value at `t` of the schedule a fake AudioParam recorded (setValueAtTime + linear ramps). */
function valueFromEvents({ set, ramps }: Recorded, t: number): number {
  const events = [...set.map(([v, time]) => ({ v, time, ramp: false })), ...ramps.map(([v, time]) => ({ v, time, ramp: true }))].sort((a, b) => a.time - b.time);
  let prev = events[0];
  for (const e of events.slice(1)) {
    if (t <= e.time) return e.ramp && e.time > prev.time ? prev.v + ((e.v - prev.v) * (t - prev.time)) / (e.time - prev.time) : prev.v;
    prev = e;
  }
  return prev.v;
}

function graphGainEvents(points: AutomationPoint[]): Recorded {
  const params: Recorded[] = [];
  const parameter = () => {
    const rec: Recorded = { set: [], ramps: [] };
    params.push(rec);
    return {
      value: 1,
      setValueAtTime: vi.fn((v: number, t: number) => rec.set.push([v, t])),
      cancelScheduledValues: vi.fn(),
      linearRampToValueAtTime: vi.fn((v: number, t: number) => rec.ramps.push([v, t])),
    };
  };
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const context = {
    currentTime: 0, destination: {}, sampleRate: 8000,
    createGain: () => ({ ...node(), gain: parameter() }),
    createStereoPanner: () => ({ ...node(), pan: { value: 0 } }),
    createBufferSource: () => ({ ...node(), buffer: null, playbackRate: parameter(), start: vi.fn(), stop: vi.fn(), onended: null }),
  };
  const clock = { getAudioContext: () => context, get currentTime() { return 0; } } as unknown as MasterTimelineClock;
  const graph = new RealtimeAudioGraph(clock);
  const schedule: AudioClipSchedule = {
    clipId: "clip", trackId: "root", audioBuffer: { duration: 20 } as AudioBuffer, startTime: 0, endTime: 4,
    mediaOffset: 0, volume: 1, volumeAutomation: points, pan: 0, effects: [], speed: 1,
  };
  graph.scheduleClip(schedule);
  // The clip gain is the parameter that received the lane's ramps.
  const gain = params.find((p) => p.ramps.length >= points.length && p.set.length > 0);
  if (!gain) throw new Error("clip gain was not scheduled");
  return gain;
}

describe("gain-line edits round-trip", () => {
  it("resolveClipVolumeAutomation and the realtime graph agree after insert + move", async () => {
    const p = project();
    const executor = new ActionExecutor();
    let points = insertPoint([], 1, 1);
    points = insertPoint(points, 2, 1);
    points = movePoint(points, 1, 0, dbToVolume(-12) - 1);
    expect((await commit(executor, p, points)).success).toBe(true);

    const resolved = resolveClipVolumeAutomation(p.timeline.tracks[0].clips[0], p.timeline);
    expect(resolved).toEqual(points);
    const events = graphGainEvents(resolved);
    const expected = (t: number) => {
      if (t <= 1) return 1;
      if (t >= 2) return dbToVolume(-12);
      return 1 + (dbToVolume(-12) - 1) * (t - 1);
    };
    for (const t of [0, 0.9, 1.5, 2, 3.5]) expect(valueFromEvents(events, t)).toBeCloseTo(expected(t), 6);
  });

  it("undo and redo restore the exact points, including absence", async () => {
    const p = project();
    const executor = new ActionExecutor();
    const first = insertPoint([], 1, 1);
    const second = movePoint(insertPoint(first, 2, 1), 1, 0, dbToVolume(-12) - 1);
    await commit(executor, p, first);
    await commit(executor, p, second);
    expect(lane(p)).toEqual(second);
    await executor.undo(p);
    expect(lane(p)).toEqual(first);
    await executor.undo(p);
    expect(Object.hasOwn(p.timeline.tracks[0].clips[0], "automation")).toBe(false);
    await executor.redo(p);
    expect(lane(p)).toEqual(first);
    await executor.redo(p);
    expect(lane(p)).toEqual(second);
  });

  it("removing the last point with null restores a flat clip and is undoable", async () => {
    const p = project();
    const executor = new ActionExecutor();
    await commit(executor, p, [{ time: 1, value: 0.5 }]);
    expect((await commit(executor, p, null)).success).toBe(true);
    expect(p.timeline.tracks[0].clips[0].automation).toBeUndefined();
    await executor.undo(p);
    expect(lane(p)).toEqual([{ time: 1, value: 0.5 }]);
  });

  it("refuses an edit on a locked track and rejects malformed points", async () => {
    const locked = project(true);
    const result = await commit(new ActionExecutor(), locked, [{ time: 1, value: 1 }]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/locked/i);
    expect(lane(locked)).toBeUndefined();
    const bad = await commit(new ActionExecutor(), project(), [{ time: -1, value: 1 }]);
    expect(bad.success).toBe(false);
  });
});
