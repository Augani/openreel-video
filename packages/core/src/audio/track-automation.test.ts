import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { AutomationPoint, Track } from "../types/timeline";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import { RealtimeAudioGraph } from "./realtime-audio-graph";
import { buildOfflineTrackChain } from "./audio-routing-graph";
import { planSetTrackAutomation, sanitizeTrackAutomation, withTrackLane } from "./track-automation";

const makeTrack = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id.toUpperCase(), clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;

const makeProject = (): Project =>
  ({
    id: "p",
    name: "T",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 10, markers: [], subtitles: [], tracks: [makeTrack("a1"), makeTrack("a2")] },
    mediaLibrary: { items: [] },
  }) as unknown as Project;

const act = (params: Record<string, unknown>): Action => ({
  type: "trackAutomation/set",
  id: `a-${Math.random()}`,
  timestamp: Date.now(),
  params,
});

describe("track automation model", () => {
  it("sanitises lanes: sorted, de-duplicated, volume 0..4, pan -1..1; empty lanes vanish", () => {
    expect(
      sanitizeTrackAutomation({
        volume: [{ time: 2, value: 9 }, { time: 1, value: 0.5 }, { time: NaN, value: 1 }],
        pan: [{ time: 0, value: -3 }],
      }),
    ).toEqual({ volume: [{ time: 1, value: 0.5 }, { time: 2, value: 4 }], pan: [{ time: 0, value: -1 }] });
    expect(sanitizeTrackAutomation({ volume: [], pan: [] })).toBeUndefined();
  });

  it("withTrackLane sets and clears one lane and drops an empty automation object", () => {
    const track = makeTrack("a");
    const withVolume = withTrackLane(track, "volume", [{ time: 1, value: 2 }]);
    expect(withVolume.automation).toEqual({ volume: [{ time: 1, value: 2 }] });
    const both = withTrackLane(withVolume, "pan", [{ time: 0, value: 0.5 }]);
    expect(both.automation?.volume).toHaveLength(1);
    const cleared = withTrackLane(withTrackLane(both, "volume", null), "pan", []);
    expect("automation" in cleared).toBe(false);
  });

  it("plans refuse an unknown track and label the edit", () => {
    const timeline = makeProject().timeline;
    expect(planSetTrackAutomation(timeline, "nope", "volume", []).ok).toBe(false);
    const plan = planSetTrackAutomation(timeline, "a1", "pan", [{ time: 0, value: 0 }]);
    expect(plan.ok && plan.label).toBe("Edit A1 pan automation");
  });
});

describe("trackAutomation/set action", () => {
  it("is one undo step per edit and restores the previous lane", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const first: AutomationPoint[] = [{ time: 0, value: 1 }, { time: 2, value: 0.5 }];
    expect((await executor.execute(act({ trackId: "a1", lane: "volume", points: first }), project)).success).toBe(true);
    await executor.execute(act({ trackId: "a1", lane: "volume", points: [{ time: 1, value: 3 }] }), project);
    expect(executor.getHistory().getUndoStackSize()).toBe(2);
    expect(project.timeline.tracks[0].automation?.volume).toEqual([{ time: 1, value: 3 }]);
    await executor.undo(project);
    expect(project.timeline.tracks[0].automation?.volume).toEqual(first);
    await executor.undo(project);
    expect(project.timeline.tracks[0].automation).toBeUndefined();
    await executor.redo(project);
    expect(project.timeline.tracks[0].automation?.volume).toEqual(first);
  });

  it("rejects a bad lane or unknown track", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    expect((await executor.execute(act({ trackId: "a1", lane: "width", points: [] }), project)).success).toBe(false);
    expect((await executor.execute(act({ trackId: "zz", lane: "pan", points: [] }), project)).success).toBe(false);
  });
});

interface Event { kind: "set" | "ramp" | "cancel"; value: number; time: number }
const fakeParam = (value = 1) => {
  const events: Event[] = [];
  return {
    value,
    events,
    cancelScheduledValues: (t: number) => events.push({ kind: "cancel", value: 0, time: t }),
    setValueAtTime: (v: number, t: number) => events.push({ kind: "set", value: v, time: t }),
    linearRampToValueAtTime: (v: number, t: number) => events.push({ kind: "ramp", value: v, time: t }),
  };
};

describe("offline mixdown reads track automation", () => {
  const makeCtx = () => {
    const gains: ReturnType<typeof fakeParam>[] = [];
    const pans: ReturnType<typeof fakeParam>[] = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const ctx = {
      sampleRate: 48000,
      destination: node(),
      createGain: () => { const gain = fakeParam(); gains.push(gain); return { ...node(), gain }; },
      createStereoPanner: () => { const pan = fakeParam(0); pans.push(pan); return { ...node(), pan }; },
      createDelay: () => ({ ...node(), delayTime: fakeParam(0) }),
    };
    return { ctx: ctx as unknown as BaseAudioContext, gains, pans, master: ctx.destination as unknown as AudioNode };
  };

  it("builds a chain for an otherwise plain track and schedules the lanes in the rendered window", () => {
    const { ctx, gains, pans, master } = makeCtx();
    const track = makeTrack("a", {
      automation: { volume: [{ time: 4, value: 0 }, { time: 6, value: 2 }], pan: [{ time: 5, value: -1 }, { time: 7, value: 1 }] },
    });
    const input = buildOfflineTrackChain(ctx, null, track, master, 0, false, { timelineStart: 5, duration: 10 });
    expect(input).toBeDefined();
    const fader = gains[gains.length - 1];
    // Window starts at 5 s: the fader is mid-ramp between (4 s, 0) and (6 s, 2), i.e. 1 at context time 0, reaching 2 at 1 s.
    expect(fader.events.find((e) => e.kind === "set")?.value).toBeCloseTo(1, 6);
    expect(fader.events.some((e) => e.kind === "ramp" && Math.abs(e.time - 1) < 1e-9 && Math.abs(e.value - 2) < 1e-9)).toBe(true);
    expect(pans[0].events.find((e) => e.kind === "set")?.value).toBeCloseTo(-1, 6);
    expect(pans[0].events.some((e) => e.kind === "ramp" && Math.abs(e.time - 2) < 1e-9 && e.value === 1)).toBe(true);
  });

  it("stays chain-free without automation and without a window (bit-exact with before)", () => {
    const { ctx, master } = makeCtx();
    expect(buildOfflineTrackChain(ctx, null, makeTrack("a"), master, 0, false, { timelineStart: 0, duration: 5 })).toBeUndefined();
    const automated = makeTrack("b", { automation: { volume: [{ time: 0, value: 1 }] } });
    expect(buildOfflineTrackChain(ctx, null, automated, master)).toBeUndefined();
  });
});

describe("realtime graph reads track automation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fixture = () => {
    const gains: ReturnType<typeof fakeParam>[] = [];
    const pans: ReturnType<typeof fakeParam>[] = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const context = {
      currentTime: 10,
      sampleRate: 48000,
      destination: {},
      createGain: () => { const gain = fakeParam(); gains.push(gain); return { ...node(), gain }; },
      createStereoPanner: () => { const pan = fakeParam(0); pans.push(pan); return { ...node(), pan }; },
      createBufferSource: () => ({ ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: fakeParam(), buffer: null }),
    };
    const state = { position: 2 };
    const clock = {
      getAudioContext: () => context,
      get currentTime() { return state.position; },
      isPlaying: false,
    } as unknown as MasterTimelineClock;
    return { graph: new RealtimeAudioGraph(clock), state };
  };

  it("schedules the fader and pan lanes from the playhead, re-anchors on seek and clears on removal", () => {
    const { graph, state } = fixture();
    graph.createTrack({ trackId: "t", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
    const out = graph.getTrackOutputGain("t") as unknown as { gain: ReturnType<typeof fakeParam> };
    const track = makeTrack("t", { automation: { volume: [{ time: 0, value: 1 }, { time: 4, value: 0 }], pan: [{ time: 0, value: -1 }, { time: 4, value: 1 }] } });
    graph.setRouting({ tracks: [track] });
    const ramps = out.gain.events.filter((e) => e.kind === "ramp");
    // Playhead at 2 s: the gain starts at 0.5 and reaches 0 two seconds of context time later.
    expect(out.gain.events.find((e) => e.kind === "set" && e.time === 10 && Math.abs(e.value - 0.5) < 1e-9)).toBeDefined();
    expect(ramps.some((e) => Math.abs(e.time - 12) < 1e-9 && e.value === 0)).toBe(true);

    state.position = 3;
    out.gain.events.length = 0;
    graph.seekTo(3);
    expect(out.gain.events.find((e) => e.kind === "set" && Math.abs(e.value - 0.25) < 1e-9)).toBeDefined();

    out.gain.events.length = 0;
    graph.setRouting({ tracks: [makeTrack("t")] });
    expect(out.gain.events.some((e) => e.kind === "cancel")).toBe(true);
    expect(out.gain.events.some((e) => e.kind === "set" && e.value === 1)).toBe(true);
    graph.dispose();
  });

  it("does not automate a muted track", () => {
    const { graph } = fixture();
    graph.createTrack({ trackId: "t", volume: 1, pan: 0, muted: true, solo: false, effects: [] });
    const out = graph.getTrackOutputGain("t") as unknown as { gain: ReturnType<typeof fakeParam> };
    graph.setRouting({ tracks: [makeTrack("t", { automation: { volume: [{ time: 0, value: 1 }, { time: 4, value: 2 }] } })] });
    expect(out.gain.events.some((e) => e.kind === "ramp")).toBe(false);
    graph.dispose();
  });
});

describe("lane point editing", () => {
  const pts = [{ time: 1, value: 1 }, { time: 3, value: 0.5 }, { time: 5, value: 2 }];

  it("inserts in time order and replaces a point at the same time", async () => {
    const { insertLanePoint } = await import("./track-automation");
    expect(insertLanePoint("volume", pts, 2, 0.25).map((p) => p.time)).toEqual([1, 2, 3, 5]);
    expect(insertLanePoint("volume", pts, 3, 9).find((p) => p.time === 3)?.value).toBe(4);
    expect(insertLanePoint("pan", [], 0, -5)).toEqual([{ time: 0, value: -1 }]);
  });

  it("moves a point but never past its neighbours, and clamps the value", async () => {
    const { moveLanePoint, LANE_POINT_GAP } = await import("./track-automation");
    const moved = moveLanePoint("volume", pts, 1, 99, 7);
    expect(moved).toHaveLength(3);
    expect(moved[1].time).toBeCloseTo(5 - LANE_POINT_GAP, 9);
    expect(moved[1].value).toBe(4);
    expect(moveLanePoint("volume", pts, 0, -4, 0)[0].time).toBe(0);
    expect(moveLanePoint("volume", pts, 9, 1, 1)).toEqual(pts);
  });

  it("deletes by index", async () => {
    const { deleteLanePoint } = await import("./track-automation");
    expect(deleteLanePoint("volume", pts, 1)).toEqual([pts[0], pts[2]]);
  });
});
