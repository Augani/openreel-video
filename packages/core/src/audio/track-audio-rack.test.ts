import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import { normalizeProjectStoredFields } from "../storage/project-serializer";
import {
  getRackImpulseResponse,
  AUDIO_RACK_EFFECT_DEFINITIONS,
  AUDIO_RACK_EFFECT_TYPES,
  AudioRackBus,
  MAX_RACK_EFFECTS,
  createRackEffect,
  estimateRackTailSeconds,
  sanitizeAudioRack,
  sanitizeRackEffectParams,
} from "./track-audio-rack";

function makeProject(): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 5,
      markers: [],
      subtitles: [],
      tracks: [
        { id: "a1", type: "audio", name: "A1", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
        { id: "a2", type: "audio", name: "A2", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const act = (params: Record<string, unknown>): Action => ({
  type: "audioRack/set",
  id: `a-${Math.random()}`,
  timestamp: Date.now(),
  params,
});

/** Records connections and AudioParam writes so graph edits can be asserted. */
function fakeContext() {
  const created: Array<{ kind: string; connects: number; disconnects: number }> = [];
  const params: Array<{ value: number; setTargetAtTime: ReturnType<typeof vi.fn>; setValueAtTime: ReturnType<typeof vi.fn> }> = [];
  const param = (value = 1) => {
    const p = {
      value,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
    };
    params.push(p);
    return p;
  };
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    const record = { kind, connects: 0, disconnects: 0 };
    created.push(record);
    return {
      ...extra,
      connect: vi.fn(() => { record.connects += 1; }),
      disconnect: vi.fn(() => { record.disconnects += 1; }),
    };
  };
  const ctx = {
    currentTime: 1,
    sampleRate: 48000,
    createGain: () => node("gain", { gain: param() }),
    createBiquadFilter: () => node("biquad", { type: "", frequency: param(), gain: param(), Q: param() }),
    createDynamicsCompressor: () => node("comp", { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createWaveShaper: () => node("shaper", { curve: null, oversample: "none" }),
    createDelay: () => node("delay", { delayTime: param() }),
    createConvolver: () => node("convolver", { buffer: null }),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length), duration: length / 48000 }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, created, params };
}

describe("rack sanitising", () => {
  it("clamps params, drops unknown ones and caps the rack at the slot limit", () => {
    const params = sanitizeRackEffectParams("compressor", { threshold: -999, ratio: 99, bogus: 1 });
    expect(params.threshold).toBe(-60);
    expect(params.ratio).toBe(20);
    expect(params.bogus).toBeUndefined();
    const rack = sanitizeAudioRack({
      effects: Array.from({ length: MAX_RACK_EFFECTS + 4 }, () => ({ type: "gain", params: {}, bypassed: false })),
      volume: 9,
      pan: -3,
    });
    expect(rack?.effects).toHaveLength(MAX_RACK_EFFECTS);
    expect(new Set(rack?.effects.map((e) => e.id)).size).toBe(MAX_RACK_EFFECTS);
    expect(rack?.volume).toBe(4);
    expect(rack?.pan).toBe(-1);
  });

  it("treats an empty default rack as no rack", () => {
    expect(sanitizeAudioRack({ effects: [], volume: 1, pan: 0 })).toBeUndefined();
    expect(sanitizeAudioRack(undefined)).toBeUndefined();
  });

  it("defines every effect type with in-range defaults", () => {
    for (const type of AUDIO_RACK_EFFECT_TYPES) {
      for (const spec of AUDIO_RACK_EFFECT_DEFINITIONS[type].params) {
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it("estimates tails only for active time-based effects", () => {
    const reverb = createRackEffect("reverb");
    expect(estimateRackTailSeconds({ effects: [reverb] })).toBeGreaterThan(1);
    expect(estimateRackTailSeconds({ effects: [{ ...reverb, bypassed: true }] })).toBe(0);
    expect(estimateRackTailSeconds({ effects: [createRackEffect("gain")] })).toBe(0);
  });
});

describe("audioRack/set action", () => {
  it("is exactly one undo step per edit and restores the previous rack", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const eq = createRackEffect("eq", { id: "fx1" });
    const r1 = await executor.execute(act({ target: "a1", rack: { effects: [eq] } }), project);
    expect(r1.success).toBe(true);
    const bypassed = { effects: [{ ...eq, bypassed: true }] };
    await executor.execute(act({ target: "a1", rack: bypassed }), project);
    expect(executor.getHistory().getUndoStackSize()).toBe(2);
    expect(project.timeline.tracks[0].audioRack?.effects[0].bypassed).toBe(true);
    await executor.undo(project);
    expect(project.timeline.tracks[0].audioRack?.effects[0].bypassed).toBe(false);
    await executor.undo(project);
    expect(project.timeline.tracks[0].audioRack).toBeUndefined();
    expect(executor.getHistory().getUndoStackSize()).toBe(0);
  });

  it("edits the master rack and leaves other tracks alone", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act({ target: "master", rack: { effects: [createRackEffect("limiter")], volume: 0.5 } }), project);
    expect(project.timeline.masterAudioRack?.effects[0].type).toBe("limiter");
    expect(project.timeline.masterAudioRack?.volume).toBe(0.5);
    expect(project.timeline.tracks.every((t) => t.audioRack === undefined)).toBe(true);
    await executor.undo(project);
    expect(project.timeline.masterAudioRack).toBeUndefined();
  });

  it("rejects unknown tracks, more slots than the limit and unknown effects", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    expect((await executor.execute(act({ target: "nope", rack: { effects: [] } }), project)).success).toBe(false);
    const six = Array.from({ length: MAX_RACK_EFFECTS + 1 }, () => createRackEffect("gain"));
    expect((await executor.execute(act({ target: "a1", rack: { effects: six } }), project)).success).toBe(false);
    expect((await executor.execute(act({ target: "a1", rack: { effects: [{ id: "x", type: "wah", params: {}, bypassed: false }] } }), project)).success).toBe(false);
  });
});

describe("project migration", () => {
  it("loads projects without racks untouched", () => {
    const project = makeProject();
    expect(normalizeProjectStoredFields(project).timeline.tracks).toEqual(project.timeline.tracks);
    expect(normalizeProjectStoredFields(project).timeline.masterAudioRack).toBeUndefined();
  });

  it("sanitises malformed stored racks", () => {
    const project = makeProject();
    const dirty = {
      ...project,
      timeline: {
        ...project.timeline,
        masterAudioRack: { effects: [{ id: "m", type: "gain", params: { gainDb: 500 }, bypassed: false }] },
        tracks: [
          { ...project.timeline.tracks[0], audioRack: { effects: [{ type: "nope" }], volume: 2 } },
          project.timeline.tracks[1],
        ],
      },
    } as unknown as Project;
    const out = normalizeProjectStoredFields(dirty);
    expect(out.timeline.masterAudioRack?.effects[0].params.gainDb).toBe(24);
    expect(out.timeline.tracks[0].audioRack).toEqual({ effects: [], volume: 2 });
  });
});

describe("AudioRackBus incremental updates", () => {
  it("toggling bypass or editing params never rebuilds the graph", () => {
    const { ctx, created } = fakeContext();
    const eq = createRackEffect("eq", { id: "eq" });
    const lim = createRackEffect("limiter", { id: "lim" });
    const bus = new AudioRackBus(ctx, { effects: [eq, lim] }, { live: true });
    const rebuilds = bus.rebuildCount;
    const nodes = created.length;
    bus.update({ effects: [{ ...eq, bypassed: true }, lim] });
    bus.update({ effects: [{ ...eq, bypassed: true }, { ...lim, params: { ...lim.params, ceiling: -6 } }] });
    bus.update({ effects: [eq, lim] });
    expect(bus.rebuildCount).toBe(rebuilds);
    expect(created.length).toBe(nodes);
  });

  it("bypass is a smoothed crossfade, not a hard switch", () => {
    const { ctx, params } = fakeContext();
    const gainFx = createRackEffect("gain", { id: "g" });
    const bus = new AudioRackBus(ctx, { effects: [gainFx] }, { live: true });
    const before = params.reduce((n, p) => n + p.setTargetAtTime.mock.calls.length, 0);
    bus.update({ effects: [{ ...gainFx, bypassed: true }] });
    const ramps = params.flatMap((p) => p.setTargetAtTime.mock.calls);
    expect(ramps.length - before).toBe(2);
    expect(ramps.slice(-2).map((c) => c[0]).sort()).toEqual([0, 1]);
    expect(ramps.slice(-2).every((c) => c[2] > 0)).toBe(true);
  });

  it("only rewires when slots are added, removed or reordered", () => {
    const { ctx } = fakeContext();
    const a = createRackEffect("gain", { id: "a" });
    const b = createRackEffect("compressor", { id: "b" });
    const bus = new AudioRackBus(ctx, { effects: [a] }, { live: true });
    const base = bus.rebuildCount;
    bus.update({ effects: [a, b] });
    expect(bus.rebuildCount).toBe(base + 1);
    bus.update({ effects: [b, a] });
    expect(bus.rebuildCount).toBe(base + 2);
    bus.update({ effects: [b] });
    expect(bus.getSlotCount()).toBe(1);
    expect(bus.rebuildCount).toBe(base + 3);
  });

  it("builds bypassed slots lazily and skips their effect nodes", () => {
    const { ctx, created } = fakeContext();
    const bypassedComp = createRackEffect("compressor", { bypassed: true });
    new AudioRackBus(ctx, { effects: [bypassedComp] }, { live: false });
    expect(created.some((n) => n.kind === "comp")).toBe(false);
  });
});

describe("reverb impulse cache", () => {
  it("stays bounded while room size is dragged, and reuses an identical request", () => {
    let built = 0;
    const ctx = {
      sampleRate: 8000,
      createBuffer: (_c: number, length: number, rate: number) => {
        built += 1;
        return { length, sampleRate: rate, getChannelData: () => new Float32Array(length) };
      },
    } as unknown as BaseAudioContext;
    const first = getRackImpulseResponse(ctx, 0.5, 0.5);
    expect(getRackImpulseResponse(ctx, 0.5, 0.5)).toBe(first);
    for (let i = 0; i <= 100; i++) getRackImpulseResponse(ctx, i / 100, 0.5);
    expect(built).toBeLessThan(110);
    // Oldest entries were evicted, so the first key is rebuilt rather than retained forever.
    expect(getRackImpulseResponse(ctx, 0.5, 0.5)).not.toBe(first);
  });
});
