import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { AutomationPoint, Track } from "../types/timeline";
import {
  LaneRecorder,
  applyRecordedPass,
  effectiveTrackAutomation,
  isRecordingMode,
  thinLanePoints,
  trackAutomationMode,
  TOUCH_RETURN_SECONDS,
} from "./track-automation-modes";
import { buildParamSchedule, laneValueAt, sanitizeRackEffectAutomation } from "./rack-effect-automation";
import { AUDIO_RACK_EFFECT_DEFINITIONS, AudioRackBus, createRackEffect, sanitizeAudioRack } from "./track-audio-rack";

const db = (linear: number) => 20 * Math.log10(linear);
const lin = (decibel: number) => Math.pow(10, decibel / 20);
const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
const project = (tracks: Track[]): Project =>
  ({
    id: "p", name: "T", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 20, markers: [], subtitles: [], tracks },
    mediaLibrary: { items: [] },
  }) as unknown as Project;
const act = (type: string, params: Record<string, unknown>): Action => ({ type, id: `a-${Math.random()}`, timestamp: Date.now(), params });

/** A fader sweeping from `fromDb` to `toDb` over [t0, t1], sampled every `step` seconds. */
const sweep = (t0: number, t1: number, fromDb: number, toDb: number, step = 0.02): AutomationPoint[] => {
  const points: AutomationPoint[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += step) points.push({ time: t, value: lin(fromDb + ((toDb - fromDb) * (t - t0)) / (t1 - t0)) });
  return points;
};

describe("automation modes", () => {
  it("defaults to read, ignores the lanes in off, and only write / touch / latch record", () => {
    const lanes = { volume: [{ time: 0, value: 1 }] };
    expect(trackAutomationMode(track("a"))).toBe("read");
    expect(effectiveTrackAutomation(track("a", { automation: lanes }))).toEqual(lanes);
    expect(effectiveTrackAutomation(track("a", { automation: lanes, automationMode: "off" }))).toBeUndefined();
    expect(["off", "read", "write", "touch", "latch"].map((m) => isRecordingMode(m as never))).toEqual([false, false, true, true, true]);
  });
});

describe("point thinning", () => {
  it("thins a straight dB ramp and keeps every dropped point within the dB tolerance", () => {
    const dense = sweep(0, 4, 0, -24);
    expect(dense.length).toBeGreaterThan(150);
    const thin = thinLanePoints("volume", dense);
    expect(thin.length).toBeLessThan(dense.length / 4);
    expect(thin[0]).toEqual(dense[0]);
    expect(thin[thin.length - 1]).toEqual(dense[dense.length - 1]);
    for (const point of dense) {
      expect(Math.abs(db(laneValueAt(thin, point.time, 1)) - db(point.value))).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });

  it("keeps the corners of a move-hold-move gesture and drops the flat part", () => {
    const gesture = [...sweep(0, 1, 0, -12), ...sweep(1.02, 3, -12, -12), ...sweep(3.02, 4, -12, 0)];
    const thin = thinLanePoints("volume", gesture);
    // The lane interpolates in linear gain, so a dB ramp needs a few points to stay within 0.25 dB; the flat hold needs none.
    expect(thin.length).toBeLessThanOrEqual(14);
    expect(thin.length).toBeLessThan(gesture.length / 8);
    expect(db(laneValueAt(thin, 2, 1))).toBeCloseTo(-12, 0);
  });

  it("thins pan in pan units and leaves two points alone", () => {
    const pan = Array.from({ length: 100 }, (_, i) => ({ time: i * 0.02, value: -1 + (2 * i) / 99 }));
    expect(thinLanePoints("pan", pan)).toHaveLength(2);
    const two = [{ time: 0, value: 0 }, { time: 1, value: 1 }];
    expect(thinLanePoints("volume", two)).toEqual(two);
  });
});

describe("recording semantics", () => {
  const existing: AutomationPoint[] = [{ time: 0, value: 1 }, { time: 10, value: 1 }];

  it("read (and off) never change the lane", () => {
    for (const mode of ["read", "off"] as const) {
      const rec = new LaneRecorder("volume", mode, existing, 0.5, 0);
      rec.touch(1, 0.5);
      rec.value(2, 0.25);
      expect(rec.finish(5)).toBeNull();
    }
  });

  it("write overwrites from the start of the pass, held or not, and keeps what lies after the pass", () => {
    const rec = new LaneRecorder("volume", "write", existing, 0.5, 2);
    expect(rec.isWriting).toBe(true);
    rec.advance(3);
    rec.touch(3, 0.5);
    rec.value(3.5, 0.25);
    rec.advance(5);
    const lane = rec.finish(5) as AutomationPoint[];
    expect(lane[0]).toEqual({ time: 0, value: 1 }); // before the pass: untouched
    expect(laneValueAt(lane, 2, 1)).toBeCloseTo(0.5, 6); // the old 1.0 was replaced from the first sample
    expect(laneValueAt(lane, 4, 1)).toBeCloseTo(0.25, 6);
    expect(laneValueAt(lane, 5, 1)).toBeCloseTo(0.25, 6);
    expect(lane[lane.length - 1]).toEqual({ time: 10, value: 1 }); // after the pass: untouched
  });

  it("touch writes only while held and ramps back onto the existing curve on release", () => {
    const rec = new LaneRecorder("volume", "touch", existing, 1, 0);
    expect(rec.isWriting).toBe(false);
    rec.value(1, 0.7); // not held: nothing recorded
    rec.touch(2, 1);
    rec.value(2.5, 0.4);
    rec.value(3, 0.4);
    rec.release(3);
    rec.value(4, 0.9); // after release: ignored
    rec.advance(8);
    const lane = rec.finish(8) as AutomationPoint[];
    expect(laneValueAt(lane, 1, 1)).toBeCloseTo(1, 6);
    expect(laneValueAt(lane, 2.8, 1)).toBeCloseTo(0.4, 6);
    expect(laneValueAt(lane, 3, 1)).toBeCloseTo(0.4, 6);
    // Back on the existing curve (1.0) after the return ramp, and stays there.
    expect(laneValueAt(lane, 3 + TOUCH_RETURN_SECONDS, 1)).toBeCloseTo(1, 6);
    expect(laneValueAt(lane, 6, 1)).toBeCloseTo(1, 6);
    expect(lane.filter((p) => p.time > 3 + TOUCH_RETURN_SECONDS && p.time < 10)).toHaveLength(0);
  });

  it("touch released after the pass ended (still held at stop) does not ramp back", () => {
    const rec = new LaneRecorder("volume", "touch", existing, 1, 0);
    rec.touch(2, 1);
    rec.value(3, 0.3);
    const lane = rec.finish(4) as AutomationPoint[];
    expect(laneValueAt(lane, 4, 1)).toBeCloseTo(0.3, 6);
    expect(lane[lane.length - 1]).toEqual({ time: 10, value: 1 });
  });

  it("latch starts on touch, holds the last value after release and to the end of the pass", () => {
    const rec = new LaneRecorder("volume", "latch", existing, 1, 0);
    rec.advance(1);
    expect(rec.isWriting).toBe(false);
    rec.touch(2, 1);
    rec.value(3, 0.5);
    rec.release(3.5);
    rec.advance(6);
    const lane = rec.finish(7) as AutomationPoint[];
    expect(laneValueAt(lane, 1, 1)).toBeCloseTo(1, 6);
    expect(laneValueAt(lane, 5, 1)).toBeCloseTo(0.5, 6);
    expect(laneValueAt(lane, 7, 1)).toBeCloseTo(0.5, 6);
    expect(lane[lane.length - 1]).toEqual({ time: 10, value: 1 });
  });

  it("a loop wrap closes the span and a later lap overwrites the earlier one", () => {
    const rec = new LaneRecorder("volume", "write", undefined, 1, 0);
    rec.value(0.5, 0.2);
    rec.advance(2);
    rec.jump(2, 0); // loop wraps
    rec.value(0.5, 0.8);
    rec.advance(2);
    const lane = rec.finish(2) as AutomationPoint[];
    expect(laneValueAt(lane, 1, 1)).toBeCloseTo(0.8, 6);
    expect(lane.every((p, i, all) => i === 0 || p.time > all[i - 1].time)).toBe(true);
  });

  it("a dense recording is thinned before it is stored", () => {
    const rec = new LaneRecorder("volume", "touch", undefined, 1, 0);
    rec.touch(0, 1);
    for (const p of sweep(0, 3, 0, -18)) rec.value(p.time, p.value);
    rec.release(3);
    const lane = rec.finish(3) as AutomationPoint[];
    expect(lane.length).toBeLessThanOrEqual(9);
    expect(lane.length).toBeLessThan(15);
    expect(db(laneValueAt(lane, 1.5, 1))).toBeCloseTo(-9, 0);
  });

  it("applyRecordedPass leaves the lane alone without spans", () => {
    expect(applyRecordedPass({ lane: "pan", mode: "write", existing: [{ time: 1, value: 0.5 }], spans: [] })).toEqual([{ time: 1, value: 0.5 }]);
  });
});

describe("trackAutomation/record (one undo step per pass)", () => {
  const record = (passes: unknown): Action => act("trackAutomation/record", { passes });

  it("commits every lane of every track as one undo step and undo / redo restore them", async () => {
    const executor = new ActionExecutor();
    const p = project([
      track("a1", { automation: { volume: [{ time: 0, value: 1 }] } }),
      track("a2"),
    ]);
    const volume = thinLanePoints("volume", sweep(0, 4, 0, -18));
    const pan = [{ time: 0, value: -1 }, { time: 4, value: 1 }];
    const result = await executor.execute(record([{ trackId: "a1", lanes: { volume, pan } }, { trackId: "a2", lanes: { pan } }]), p);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(executor.getHistory().getUndoStackSize()).toBe(1);
    expect(p.timeline.tracks[0].automation?.volume).toEqual(volume);
    expect(p.timeline.tracks[0].automation?.pan).toEqual(pan);
    expect(p.timeline.tracks[1].automation?.pan).toEqual(pan);
    await executor.undo(p);
    expect(p.timeline.tracks[0].automation).toEqual({ volume: [{ time: 0, value: 1 }] });
    expect(p.timeline.tracks[1].automation).toBeUndefined();
    await executor.redo(p);
    expect(p.timeline.tracks[0].automation?.volume).toEqual(volume);
    expect(p.timeline.tracks[1].automation?.pan).toEqual(pan);
  });

  it("carries rack effect keyframes in the same step and rejects params that cannot be automated", async () => {
    const executor = new ActionExecutor();
    const gain = createRackEffect("gain");
    const reverb = createRackEffect("reverb");
    const p = project([track("a1", { audioRack: { effects: [gain, reverb] } })]);
    const points = [{ time: 0, value: 0 }, { time: 2, value: -12 }];
    expect((await executor.execute(record([{ trackId: "a1", effects: [{ effectId: reverb.id, param: "wetLevel", points }] }]), p)).success).toBe(false);
    const ok = await executor.execute(record([{ trackId: "a1", lanes: { volume: [{ time: 0, value: 1 }, { time: 1, value: 2 }] }, effects: [{ effectId: gain.id, param: "gainDb", points }] }]), p);
    expect(ok.success, JSON.stringify(ok)).toBe(true);
    expect(executor.getHistory().getUndoStackSize()).toBe(1);
    expect(p.timeline.tracks[0].audioRack?.effects[0].automation).toEqual({ gainDb: points });
    await executor.undo(p);
    expect(p.timeline.tracks[0].audioRack?.effects[0].automation).toBeUndefined();
    expect(p.timeline.tracks[0].automation).toBeUndefined();
  });

  it("setMode is one undo step and read is the absent default", async () => {
    const executor = new ActionExecutor();
    const p = project([track("a1")]);
    await executor.execute(act("trackAutomation/setMode", { trackId: "a1", mode: "latch" }), p);
    expect(p.timeline.tracks[0].automationMode).toBe("latch");
    expect((await executor.execute(act("trackAutomation/setMode", { trackId: "a1", mode: "bogus" }), p)).success).toBe(false);
    await executor.execute(act("trackAutomation/setMode", { trackId: "a1", mode: "read" }), p);
    expect("automationMode" in p.timeline.tracks[0]).toBe(false);
    await executor.undo(p);
    expect(p.timeline.tracks[0].automationMode).toBe("latch");
    await executor.undo(p);
    expect(p.timeline.tracks[0].automationMode).toBeUndefined();
  });
});

describe("rack effect keyframes", () => {
  const ranges = (type: "gain" | "eq" | "compressor") => (key: string) => {
    const spec = AUDIO_RACK_EFFECT_DEFINITIONS[type].params.find((x) => x.key === key);
    return spec ? { min: spec.min, max: spec.max } : undefined;
  };

  it("sanitises: only gain / EQ / compressor params, clamped, ordered", () => {
    expect(
      sanitizeRackEffectAutomation("gain", { gainDb: [{ time: 2, value: 99 }, { time: 1, value: -3 }], bogus: [{ time: 0, value: 1 }] }, ranges("gain")),
    ).toEqual({ gainDb: [{ time: 1, value: -3 }, { time: 2, value: 24 }] });
    expect(sanitizeRackEffectAutomation("compressor", { threshold: [{ time: 0, value: -80 }] }, ranges("compressor"))?.threshold[0].value).toBe(-60);
    const rack = sanitizeAudioRack({ effects: [{ id: "g", type: "gain", params: {}, bypassed: false, automation: { gainDb: [{ time: 0, value: -6 }] } }] });
    expect(rack?.effects[0].automation).toEqual({ gainDb: [{ time: 0, value: -6 }] });
    expect(sanitizeAudioRack({ effects: [{ id: "r", type: "reverb", params: {}, bypassed: false, automation: { wetLevel: [{ time: 0, value: 1 }] } }] })?.effects[0].automation).toBeUndefined();
  });

  it("schedules identically for a window mid-lane and holds the base before the first point", () => {
    const points = [{ time: 2, value: -6 }, { time: 6, value: 6 }];
    const mid = buildParamSchedule(points, 0, 4, 10);
    expect(mid[0]).toEqual({ time: 0, value: 0 }); // 4 s is a quarter... halfway: -6 + 12 * 0.5 = 0
    expect(mid[mid.length - 1].time).toBeCloseTo(2, 6);
    expect(mid[mid.length - 1].value).toBeCloseTo(6, 6);
    const early = buildParamSchedule(points, -3, 0, 10);
    expect(early[0]).toEqual({ time: 0, value: -3 });
    expect(early.some((e) => e.time > 1.9 && e.time < 2.01 && e.value === -3)).toBe(true);
  });

  /** A bus on a fake context; every AudioParam records the events scheduled onto it. */
  function fakeBus(live: boolean, currentTime: number) {
    const events = new Map<string, Array<[string, number, number]>>();
    const param = (name: string, value = 1) => {
      const list: Array<[string, number, number]> = [];
      events.set(name + events.size, list);
      return {
        value,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: (v: number, t: number) => list.push(["set", v, t]),
        linearRampToValueAtTime: (v: number, t: number) => list.push(["ramp", v, t]),
        setTargetAtTime: vi.fn(),
      };
    };
    const node = (extra: Record<string, unknown> = {}) => ({ ...extra, connect: vi.fn(), disconnect: vi.fn() });
    const ctx = {
      currentTime,
      sampleRate: 48000,
      createGain: () => node({ gain: param("gain") }),
      createBiquadFilter: () => node({ type: "", frequency: param("f"), gain: param("bg"), Q: param("q") }),
    } as unknown as BaseAudioContext;
    const effect = createRackEffect("gain", { id: "fx" });
    const withLane = { ...effect, automation: { gainDb: [{ time: 1, value: 0 }, { time: 3, value: -12 }] } };
    const bus = new AudioRackBus(ctx, { effects: [withLane] }, { live });
    return { bus, events };
  }
  const gainEvents = (events: Map<string, Array<[string, number, number]>>) =>
    [...events.values()].find((list) => list.some(([kind, v]) => kind === "ramp" && v < 0.3 && v > 0.2)) ?? [];

  it("live and offline buses place the same curve, so preview equals export", () => {
    const offline = fakeBus(false, 0);
    offline.bus.scheduleAutomation(0, 4, 0);
    const live = fakeBus(true, 10);
    live.bus.scheduleAutomation(0, 4, 10);
    const rel = (list: Array<[string, number, number]>, origin: number) => list.map(([k, v, t]) => [k, +v.toFixed(9), +(t - origin).toFixed(9)]);
    const off = rel(gainEvents(offline.events), 0);
    const on = rel(gainEvents(live.events), 10);
    expect(off.length).toBeGreaterThan(4);
    expect(on).toEqual(off);
    // -12 dB at the end of the lane, as linear gain.
    const last = off[off.length - 1];
    expect(last[1]).toBeCloseTo(lin(-12), 6);
    expect(last[2]).toBeCloseTo(3, 6);
  });

  it("does not accumulate a sample per call for a control stream faster than the record interval", () => {
    const rec = new LaneRecorder("volume", "touch", undefined, 1, 0);
    rec.touch(0, 1);
    for (let i = 1; i <= 1000; i += 1) rec.value(i * 0.001, 1 - i * 0.0003);
    rec.release(1);
    const spans = (rec as unknown as { spans: { samples: unknown[] }[] }).spans;
    expect(spans[0].samples.length).toBeLessThan(230);
    expect(rec.finish(1)).not.toBeNull();
  });

  it("clearAutomation returns keyframed params to their static value", () => {
    const { bus, events } = fakeBus(true, 5);
    bus.scheduleAutomation(0, 4, 5);
    const before = gainEvents(events).length;
    bus.clearAutomation();
    expect(before).toBeGreaterThan(0);
    const after = [...events.values()].flat().filter(([kind, , t]) => kind === "set" && t === 5);
    expect(after.length).toBeGreaterThan(0);
  });
});
