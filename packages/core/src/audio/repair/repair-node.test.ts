import { describe, expect, it, vi } from "vitest";
import { createRepairChainNode, ensureRepairWorklet, getRepairMeter, isRepairWorkletReady, registerGainReductionSource } from "./repair-node";
import { REPAIR_EFFECT_DEFINITIONS, projectUsesRepairEffects, sanitizeRepairParams } from "./repair-definitions";
import type { Project } from "../../types";

/** The smallest context createRepairChainNode touches: gain nodes and no AudioWorklet (like node / old browsers). */
function fakeContext() {
  const connections: Array<[unknown, unknown]> = [];
  const gain = () => ({
    connect: (to: unknown) => void connections.push([gain, to]),
    disconnect: vi.fn(),
  });
  return { ctx: { createGain: gain } as unknown as BaseAudioContext, connections };
}

describe("repair node without AudioWorklet support", () => {
  it("never loads and passes audio straight through", async () => {
    const { ctx } = fakeContext();
    expect(await ensureRepairWorklet(ctx)).toBe(false);
    expect(isRepairWorkletReady(ctx)).toBe(false);
    const chain = createRepairChainNode(ctx, "deHum", { frequency: 60 }, { meterId: "x" });
    expect(chain.nodes).toHaveLength(2);
    expect(() => chain.update({ frequency: 50 })).not.toThrow();
    expect(() => chain.dispose()).not.toThrow();
  });
});

describe("gain reduction meters", () => {
  it("reads registered sources and forgets them on unregister", () => {
    expect(getRepairMeter("none")).toBe(0);
    let value = 4.5;
    const unregister = registerGainReductionSource("fx-1", () => value);
    expect(getRepairMeter("fx-1")).toBe(4.5);
    value = 9;
    expect(getRepairMeter("fx-1")).toBe(9);
    unregister();
    expect(getRepairMeter("fx-1")).toBe(0);
  });
});

describe("repair definitions", () => {
  it("every preset is inside its parameter ranges", () => {
    for (const def of Object.values(REPAIR_EFFECT_DEFINITIONS)) {
      expect(def.presets.length).toBeGreaterThan(0);
      for (const preset of def.presets) {
        const clean = sanitizeRepairParams(def.type, preset.params);
        for (const [key, value] of Object.entries(preset.params)) expect(clean[key], `${def.type}/${preset.id}/${key}`).toBe(value);
      }
    }
  });

  it("sanitising clamps, fills defaults and accepts booleans for switches", () => {
    expect(sanitizeRepairParams("deEss", { listen: true, threshold: -999, bogus: 1 })).toMatchObject({ listen: 1, threshold: -60, ratio: 6 });
    expect(sanitizeRepairParams("gate", undefined).threshold).toBe(-50);
  });

  it("projectUsesRepairEffects sees clips, racks, buses and the master, and ignores disabled ones", () => {
    const base = { timeline: { tracks: [{ id: "t", clips: [{ audioEffects: [] }] }] } } as unknown as Project;
    expect(projectUsesRepairEffects(base)).toBe(false);
    const clip = { timeline: { tracks: [{ id: "t", clips: [{ audioEffects: [{ id: "a", type: "deClick", enabled: true, params: {} }] }] }] } } as unknown as Project;
    expect(projectUsesRepairEffects(clip)).toBe(true);
    const off = { timeline: { tracks: [{ id: "t", clips: [{ audioEffects: [{ id: "a", type: "deClick", enabled: false, params: {} }] }] }] } } as unknown as Project;
    expect(projectUsesRepairEffects(off)).toBe(false);
    const master = { timeline: { tracks: [], masterAudioRack: { effects: [{ id: "m", type: "gate", params: {}, bypassed: false }] } } } as unknown as Project;
    expect(projectUsesRepairEffects(master)).toBe(true);
    const bus = { timeline: { tracks: [], audioBuses: [{ id: "b", rack: { effects: [{ id: "e", type: "deEss", params: {}, bypassed: true }] } }] } } as unknown as Project;
    expect(projectUsesRepairEffects(bus)).toBe(false);
  });

  it("a 5.1 mix also needs the worklet for compressors and limiters (the linked six-channel compressor), a stereo mix does not", () => {
    const rackComp = { timeline: { tracks: [{ id: "t", clips: [], audioRack: { effects: [{ id: "c", type: "compressor", params: {}, bypassed: false }] } }] } } as unknown as Project;
    expect(projectUsesRepairEffects(rackComp)).toBe(false);
    expect(projectUsesRepairEffects(rackComp, true)).toBe(true);
    const clipComp = { timeline: { tracks: [{ id: "t", clips: [{ audioEffects: [{ id: "a", type: "compressor", enabled: true, params: {} }] }] }] } } as unknown as Project;
    expect(projectUsesRepairEffects(clipComp)).toBe(false);
    expect(projectUsesRepairEffects(clipComp, true)).toBe(true);
    const bypassed = { timeline: { tracks: [], masterAudioRack: { effects: [{ id: "l", type: "limiter", params: {}, bypassed: true }] } } } as unknown as Project;
    expect(projectUsesRepairEffects(bypassed, true)).toBe(false);
  });
});
