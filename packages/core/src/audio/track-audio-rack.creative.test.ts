import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import { AUDIO_EFFECT_TYPES } from "../types/effects";
import { AUTOMATABLE_RACK_PARAMS, isAutomatableRackParam, sanitizeRackEffectAutomation } from "./rack-effect-automation";
import { CREATIVE_FX_TYPES } from "./creative/creative-fx-definitions";
import { SidechainKeyHub, trackOwnerId } from "./sidechain";
import { buildOfflineTrackChain } from "./audio-routing-graph";
import {
  AUDIO_RACK_EFFECT_DEFINITIONS,
  AUDIO_RACK_EFFECT_TYPES,
  AudioRackBus,
  MAX_RACK_EFFECTS,
  RACK_EFFECTS_HARD_LIMIT,
  createRackEffect,
  estimateRackTailSeconds,
  getMaxRackEffects,
  sanitizeAudioRack,
  setMaxRackEffects,
} from "./track-audio-rack";

function fakeContext() {
  const created: string[] = [];
  const param = (value = 1) => ({ value, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    created.push(kind);
    return { ...extra, connect: vi.fn(), disconnect: vi.fn() };
  };
  const ctx = {
    currentTime: 1,
    sampleRate: 48000,
    createGain: () => node("gain", { gain: param() }),
    createBiquadFilter: () => node("biquad", { type: "", frequency: param(), gain: param(), Q: param() }),
    createDynamicsCompressor: () => node("comp", { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createWaveShaper: () => node("shaper", { curve: null, oversample: "none" }),
    createDelay: () => node("delay", { delayTime: param() }),
    createStereoPanner: () => node("panner", { pan: param(0) }),
    createConvolver: () => node("convolver", { buffer: null }),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length), duration: length / 48000 }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, created };
}

afterEach(() => {
  setMaxRackEffects(MAX_RACK_EFFECTS);
});

describe("creative effects in the rack", () => {
  it("are rack effect types with definitions, labels and descriptions", () => {
    for (const type of CREATIVE_FX_TYPES) {
      expect(AUDIO_RACK_EFFECT_TYPES).toContain(type);
      expect(AUDIO_RACK_EFFECT_DEFINITIONS[type].creative).toBe(true);
      expect(AUDIO_RACK_EFFECT_DEFINITIONS[type].label.length).toBeGreaterThan(3);
    }
  });

  it("are valid clip audio effect types too", () => {
    for (const type of CREATIVE_FX_TYPES) expect(AUDIO_EFFECT_TYPES).toContain(type);
  });

  it("sanitise their params and keep them through a rack round trip", () => {
    const rack = sanitizeAudioRack({ effects: [{ type: "phaser", params: { stages: 7, depth: 9, bogus: 1 }, bypassed: false }, { type: "channelMap", params: { mode: 2 }, bypassed: true }] });
    expect(rack?.effects.map((e) => e.type)).toEqual(["phaser", "channelMap"]);
    expect(rack?.effects[0].params.stages).toBe(7);
    expect(rack?.effects[0].params.depth).toBe(1);
    expect(rack?.effects[0].params.bogus).toBeUndefined();
    expect(rack?.effects[1].bypassed).toBe(true);
  });

  it("build in a graph without AudioWorklet support as a pass-through instead of throwing, and rebuild incrementally on edits", () => {
    const { ctx } = fakeContext();
    const rack = { effects: CREATIVE_FX_TYPES.map((type) => createRackEffect(type, { id: type })) };
    const bus = new AudioRackBus(ctx, rack, { live: false });
    expect(bus.getSlotCount()).toBe(CREATIVE_FX_TYPES.length);
    const rebuilds = bus.rebuildCount;
    bus.update({ effects: rack.effects.map((e) => (e.type === "phaser" ? { ...e, params: { ...e.params, depth: 0.2 } } : e)) });
    expect(bus.rebuildCount).toBe(rebuilds);
    bus.update({ effects: rack.effects.map((e) => ({ ...e, bypassed: true })) });
    expect(bus.rebuildCount).toBe(rebuilds);
    bus.dispose();
  });

  it("add their tails to the rack tail estimate only while active", () => {
    const flanger = createRackEffect("flanger", { params: { feedback: 0.9, delay: 20 } });
    expect(estimateRackTailSeconds({ effects: [flanger] })).toBeGreaterThan(0.1);
    expect(estimateRackTailSeconds({ effects: [{ ...flanger, bypassed: true }] })).toBe(0);
    expect(estimateRackTailSeconds({ effects: [createRackEffect("invertPolarity")] })).toBe(0);
  });

  it("expose every continuous parameter for automation, and no switch or mode selector", () => {
    for (const type of CREATIVE_FX_TYPES) {
      for (const spec of AUDIO_RACK_EFFECT_DEFINITIONS[type].params) {
        const discrete = !!spec.toggle || !!spec.options || spec.key === "stages";
        expect(isAutomatableRackParam(type, spec.key), `${type}.${spec.key}`).toBe(!discrete);
      }
    }
    expect(AUTOMATABLE_RACK_PARAMS.stereoWidth).toEqual(["width", "midGain"]);
    const lane = sanitizeRackEffectAutomation("stereoWidth", { width: [{ time: 2, value: 5 }, { time: 0, value: 0.5 }], mode: [{ time: 0, value: 1 }] }, (key) => {
      const spec = AUDIO_RACK_EFFECT_DEFINITIONS.stereoWidth.params.find((s) => s.key === key);
      return spec ? { min: spec.min, max: spec.max } : undefined;
    });
    expect(lane).toEqual({ width: [{ time: 0, value: 0.5 }, { time: 2, value: 2 }] });
  });
});

describe("rack size", () => {
  it("defaults to twelve slots and can be configured within a hard limit", () => {
    expect(getMaxRackEffects()).toBe(12);
    const many = { effects: Array.from({ length: 40 }, () => ({ type: "gain", params: {}, bypassed: false })) };
    expect(sanitizeAudioRack(many)?.effects).toHaveLength(12);
    expect(setMaxRackEffects(20)).toBe(20);
    expect(sanitizeAudioRack(many)?.effects).toHaveLength(20);
    expect(setMaxRackEffects(500)).toBe(RACK_EFFECTS_HARD_LIMIT);
    expect(setMaxRackEffects(0)).toBe(1);
    expect(setMaxRackEffects(Number.NaN)).toBe(MAX_RACK_EFFECTS);
  });
});

describe("keyed compressor in a rack", () => {
  const hubFor = (ctx: BaseAudioContext, keyOwner = "m") => {
    const hub = new SidechainKeyHub(ctx);
    hub.setTimeline({
      tracks: [
        { id: keyOwner, audioRack: { effects: [createRackEffect("compressor", { params: { keySource: "track:v" } })] } },
        { id: "v" },
      ] as never,
    });
    return hub;
  };
  const compressorWithKey = (key?: string) => ({ effects: [createRackEffect("compressor", { id: "c", params: { keySource: key } })] });

  it("uses the native node without a key and the sidechain worklet voice with a legal one", () => {
    const plain = fakeContext();
    new AudioRackBus(plain.ctx, compressorWithKey(), { live: false, sidechain: { hub: hubFor(plain.ctx), ownerId: trackOwnerId("m") } });
    expect(plain.created).toContain("comp");

    const keyedCtx = fakeContext();
    const hub = hubFor(keyedCtx.ctx);
    new AudioRackBus(keyedCtx.ctx, compressorWithKey("track:v"), { live: false, sidechain: { hub, ownerId: trackOwnerId("m") } });
    expect(keyedCtx.created).not.toContain("comp");
  });

  it("falls back to the native compressor when the key is illegal (missing source or a loop)", () => {
    const { ctx, created } = fakeContext();
    const hub = hubFor(ctx);
    new AudioRackBus(ctx, compressorWithKey("track:nowhere"), { live: false, sidechain: { hub, ownerId: trackOwnerId("m") } });
    expect(created).toContain("comp");
  });

  it("rebuilds the voice when the key is set or cleared, and not on ordinary param edits", () => {
    const { ctx } = fakeContext();
    const hub = hubFor(ctx);
    const options = { live: false, sidechain: { hub, ownerId: trackOwnerId("m") } };
    const bus = new AudioRackBus(ctx, compressorWithKey(), options);
    const base = bus.rebuildCount;
    bus.update(compressorWithKey("track:v"));
    expect(bus.rebuildCount).toBe(base + 1);
    const withThreshold = { effects: [createRackEffect("compressor", { id: "c", params: { keySource: "track:v", threshold: -30 } })] };
    bus.update(withThreshold);
    expect(bus.rebuildCount).toBe(base + 1);
    bus.update(compressorWithKey());
    expect(bus.rebuildCount).toBe(base + 2);
  });
});

describe("offline track chain with sidechain keys", () => {
  it("builds a chain for a track that something keys on (even with no rack of its own) and not otherwise", () => {
    const { ctx } = fakeContext();
    const hub = new SidechainKeyHub(ctx);
    const keyed = { id: "m", audioRack: { effects: [createRackEffect("compressor", { params: { keySource: "track:v" } })] } };
    const voice = { id: "v" };
    hub.setTimeline({ tracks: [keyed, voice] as never });
    const masterIn = ctx.destination ?? ({ connect: vi.fn() } as unknown as AudioNode);
    expect(buildOfflineTrackChain(ctx, null, voice as never, masterIn, 0, false, undefined, hub)).toBeDefined();
    expect(buildOfflineTrackChain(ctx, null, voice as never, masterIn, 0, false, undefined, undefined)).toBeUndefined();
    expect(buildOfflineTrackChain(ctx, null, { id: "other" } as never, masterIn, 0, false, undefined, hub)).toBeUndefined();
  });
});

describe("audioRack/set with creative effects", () => {
  it("is one undo step per edit", async () => {
    const project = {
      id: "p",
      name: "t",
      createdAt: 0,
      modifiedAt: 0,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
      timeline: { duration: 5, markers: [], subtitles: [], tracks: [{ id: "a1", type: "audio", name: "A1", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false }] },
      mediaLibrary: { items: [] },
    } as unknown as Project;
    const executor = new ActionExecutor();
    const action = (rack: unknown): Action => ({ type: "audioRack/set", id: `a-${Math.random()}`, timestamp: Date.now(), params: { target: "a1", rack } });
    const chorus = createRackEffect("chorus", { id: "c1" });
    expect((await executor.execute(action({ effects: [chorus] }), project)).success).toBe(true);
    const widened = createRackEffect("stereoWidth", { id: "w1", params: { width: 1.5 } });
    expect((await executor.execute(action({ effects: [chorus, widened] }), project)).success).toBe(true);
    expect(project.timeline.tracks[0].audioRack?.effects.map((e) => e.type)).toEqual(["chorus", "stereoWidth"]);
    await executor.undo(project);
    expect(project.timeline.tracks[0].audioRack?.effects.map((e) => e.type)).toEqual(["chorus"]);
    await executor.undo(project);
    expect(project.timeline.tracks[0].audioRack).toBeUndefined();
  });
});
