import { describe, expect, it } from "vitest";
import type { AudioRack, Track } from "../types/timeline";
import {
  compressorLookaheadSamples,
  effectChainLatencySamples,
  effectLatencySamples,
  listEffectLatencies,
  planDelayCompensation,
  planTimelineDelayCompensation,
  rackLatencySamples,
} from "./effect-latency";
import { REPAIR_EFFECT_TYPES, createRepairProcessor, processChannels } from "./repair/repair-dsp";

const SR = 48000;

describe("effect latency report", () => {
  it("compressor and limiter report the Web Audio lookahead; zero-latency effects report 0", () => {
    expect(effectLatencySamples("compressor", {}, SR)).toBe(compressorLookaheadSamples(SR));
    expect(effectLatencySamples("limiter", {}, SR)).toBe(288);
    for (const type of ["eq", "gain", "reverb", "delay", "deHum", "deEss", "gate"]) {
      expect(effectLatencySamples(type, {}, SR)).toBe(0);
    }
  });

  it("repair effects report exactly what their processor delays by", () => {
    for (const type of REPAIR_EFFECT_TYPES) {
      expect(effectLatencySamples(type, {}, SR)).toBe(createRepairProcessor(type, SR, {}).latency);
    }
    expect(effectLatencySamples("deReverb", {}, SR)).toBeGreaterThan(0);
    expect(effectLatencySamples("deClick", {}, SR)).toBeGreaterThan(0);
  });

  it("a tone burst through each latent repair effect is late by exactly the reported latency, and processChannels removes it", () => {
    const lagOf = (a: Float32Array, b: Float32Array): number => {
      let best = 0;
      let bestLag = 0;
      for (let lag = -64; lag <= 1200; lag++) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) if (i + lag >= 0 && i + lag < b.length) sum += a[i] * b[i + lag];
        if (sum > best) {
          best = sum;
          bestLag = lag;
        }
      }
      return bestLag;
    };
    for (const type of REPAIR_EFFECT_TYPES) {
      const latency = effectLatencySamples(type, {}, SR);
      if (latency === 0) continue;
      const n = 8192;
      const input = new Float32Array(n);
      for (let i = 0; i < 2048; i++) input[3000 + i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR) * Math.sin((Math.PI * i) / 2048) ** 2;
      const proc = createRepairProcessor(type, SR, {});
      const out = new Float32Array(n + latency);
      const padded = new Float32Array(n + latency);
      padded.set(input);
      for (let at = 0; at < padded.length; at += 128) {
        const m = Math.min(128, padded.length - at);
        proc.process([padded.subarray(at, at + m)], [out.subarray(at, at + m)], m);
      }
      expect(lagOf(input, out)).toBe(latency);
      expect(lagOf(input, processChannels(type, [input], SR)[0])).toBe(0);
    }
  });

  it("chains add up and skip disabled and bypassed effects", () => {
    expect(
      effectChainLatencySamples(
        [
          { type: "compressor", enabled: true },
          { type: "limiter", bypassed: true },
          { type: "deReverb" },
          { type: "eq", enabled: false },
        ],
        SR,
      ),
    ).toBe(288 + effectLatencySamples("deReverb", {}, SR));
    const rack: AudioRack = { effects: [{ id: "a", type: "limiter", params: {}, bypassed: false }] };
    expect(rackLatencySamples(rack, SR)).toBe(288);
    expect(rackLatencySamples(undefined, SR)).toBe(0);
  });

  it("lists a latency for every effect that can have one", () => {
    const rows = listEffectLatencies(SR);
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(["compressor", "limiter", "deEss", "deReverb", "deClick", "deClip"]));
    expect(rows.find((r) => r.type === "limiter")!.milliseconds).toBeCloseTo(6, 6);
  });
});

describe("planDelayCompensation", () => {
  it("delays every faster track to the slowest one at the master", () => {
    const plan = planDelayCompensation(
      [
        { id: "a", latency: 0.006 },
        { id: "b", latency: 0 },
        { id: "c", latency: 0.021 },
      ],
      [],
    );
    expect(plan.masterLatency).toBeCloseTo(0.021, 12);
    expect(plan.trackDelay.get("a")).toBeCloseTo(0.015, 12);
    expect(plan.trackDelay.get("b")).toBeCloseTo(0.021, 12);
    expect(plan.trackDelay.get("c")).toBe(0);
  });

  it("aligns sends with the dry path through a bus with its own latency", () => {
    // Track t (limiter, 6 ms) plays to master AND sends to reverb bus r (DeReverb-like 21 ms rack).
    const plan = planDelayCompensation(
      [{ id: "t", latency: 0.006, sends: [{ id: "s", busId: "r" }] }, { id: "u", latency: 0 }],
      [{ id: "r", latency: 0.021 }],
    );
    // Bus r input has one input (the send): nothing to align there.
    expect(plan.sendDelay.get("s")).toBe(0);
    // Master inputs: t dry 6 ms, u 0 ms, bus r at 6 + 21 = 27 ms -> everything meets at 27 ms.
    expect(plan.masterLatency).toBeCloseTo(0.027, 12);
    expect(plan.trackDelay.get("t")).toBeCloseTo(0.021, 12);
    expect(plan.trackDelay.get("u")).toBeCloseTo(0.027, 12);
    expect(plan.busDelay.get("r")).toBe(0);
    expect(plan.busArrival.get("r")).toBeCloseTo(0.027, 12);
  });

  it("aligns several inputs of one bus before the bus rack", () => {
    const plan = planDelayCompensation(
      [
        { id: "a", latency: 0.01, output: "bus" },
        { id: "b", latency: 0.002, output: "bus" },
        { id: "c", latency: 0.004, sends: [{ id: "sc", busId: "bus" }] },
      ],
      [{ id: "bus", latency: 0.006 }],
    );
    expect(plan.trackDelay.get("a")).toBe(0);
    expect(plan.trackDelay.get("b")).toBeCloseTo(0.008, 12);
    expect(plan.sendDelay.get("sc")).toBeCloseTo(0.006, 12);
    expect(plan.masterLatency).toBeCloseTo(0.016, 12);
  });

  it("chains buses (bus -> bus -> master)", () => {
    const plan = planDelayCompensation(
      [{ id: "t", latency: 0, output: "b1" }, { id: "u", latency: 0 }],
      [
        { id: "b1", latency: 0.01, output: "b2" },
        { id: "b2", latency: 0.005 },
      ],
    );
    expect(plan.masterLatency).toBeCloseTo(0.015, 12);
    expect(plan.trackDelay.get("u")).toBeCloseTo(0.015, 12);
    expect(plan.busDelay.get("b1")).toBe(0);
  });

  it("is all zeros for a graph with no latency", () => {
    const plan = planDelayCompensation([{ id: "a", latency: 0 }, { id: "b", latency: 0, output: "x" }], [{ id: "x", latency: 0 }]);
    expect(plan.masterLatency).toBe(0);
    expect([...plan.trackDelay.values(), ...plan.busDelay.values(), ...plan.sendDelay.values()].every((v) => v === 0)).toBe(true);
  });

  it("derives latencies from racks on a timeline and survives routing loops", () => {
    const limiter: AudioRack = { effects: [{ id: "l", type: "limiter", params: {}, bypassed: false }] };
    const track = (id: string, extra: Partial<Track> = {}): Track =>
      ({ id, name: id, type: "audio", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
    const timeline = {
      tracks: [track("a", { audioRack: limiter }), track("b")],
      audioBuses: [
        { id: "x", name: "x", output: "y", rack: undefined },
        { id: "y", name: "y", output: "x", rack: limiter },
      ],
    } as unknown as Parameters<typeof planTimelineDelayCompensation>[0];
    const plan = planTimelineDelayCompensation(timeline, SR);
    expect(plan.trackDelay.get("a")).toBe(0);
    expect(plan.trackDelay.get("b")).toBeCloseTo(0.006, 9);
  });
});
