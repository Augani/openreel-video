import { describe, expect, it, vi } from "vitest";
import { SpectralRepairCache } from "./spectral-repair-cache";
import { createInlineSpectralBackend, type SpectralBackend } from "./spectral-worker-client";
import { applySpectralRegions } from "./spectral-dsp";
import type { SpectralRegion } from "./spectral-regions";

const SR = 8000;
const REGION: SpectralRegion = { id: "a", mode: "remove", startTime: 0.5, endTime: 1.5, lowHz: 400, highHz: 600, gainDb: -120, enabled: true };

const buffer = (seconds: number): AudioBuffer => {
  const data = Float32Array.from({ length: SR * seconds }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 500 * i) / SR) + 0.2 * Math.sin((2 * Math.PI * 2000 * i) / SR));
  return { numberOfChannels: 1, sampleRate: SR, length: data.length, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
};
const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
  ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;

describe("SpectralRepairCache", () => {
  it("computes once per source and region set, shares running jobs, and peeks without computing", async () => {
    const backend = createInlineSpectralBackend();
    const repair = vi.spyOn(backend, "repair");
    const cache = new SpectralRepairCache({ backend, makeBuffer });
    const source = buffer(2);
    expect(cache.peek({ buffer: source, regions: [REGION] })).toBeNull();
    expect(repair).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([cache.request({ buffer: source, regions: [REGION] }), cache.request({ buffer: source, regions: [{ ...REGION, id: "other-id" }] })]);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(cache.peek({ buffer: source, regions: [REGION] })).toBe(a);
    expect(await cache.request({ buffer: source, regions: [REGION] })).toBe(a);
    expect(repair).toHaveBeenCalledTimes(1);
    // A different region set is a different entry; no active region is the source itself.
    const other = await cache.request({ buffer: source, regions: [{ ...REGION, highHz: 700 }] });
    expect(other).not.toBe(a);
    expect(await cache.request({ buffer: source, regions: [{ ...REGION, enabled: false }] })).toBe(source);
    expect(cache.peek({ buffer: source, regions: [] })).toBeNull();
  });

  it("produces exactly what the DSP produces (the export and the preview share these samples)", async () => {
    const cache = new SpectralRepairCache({ backend: createInlineSpectralBackend(), makeBuffer });
    const source = buffer(2);
    const out = (await cache.request({ buffer: source, regions: [REGION] }))!;
    const direct = applySpectralRegions([source.getChannelData(0)], SR, [REGION])[0];
    expect(Array.from(out.getChannelData(0))).toEqual(Array.from(direct));
  });

  it("notifies listeners, and remembers a failure for a while", async () => {
    let now = 0;
    const failing: SpectralBackend = { repair: vi.fn(() => Promise.reject(new Error("no"))), load: async () => undefined, view: async () => { throw new Error("x"); }, drop: async () => undefined };
    const cache = new SpectralRepairCache({ backend: failing, makeBuffer, now: () => now });
    const source = buffer(1);
    expect(await cache.request({ buffer: source, regions: [REGION] })).toBeNull();
    expect(await cache.request({ buffer: source, regions: [REGION] })).toBeNull();
    expect(failing.repair).toHaveBeenCalledTimes(1);
    now = 31_000;
    await cache.request({ buffer: source, regions: [REGION] });
    expect(failing.repair).toHaveBeenCalledTimes(2);

    const ok = new SpectralRepairCache({ backend: createInlineSpectralBackend(), makeBuffer });
    const heard = vi.fn();
    ok.onReady(heard);
    await ok.request({ buffer: buffer(1), regions: [REGION] });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("inline spectral backend", () => {
  it("serves spectrograms of a loaded source and refuses unknown keys", async () => {
    const backend = createInlineSpectralBackend();
    await expect(backend.view("missing", {})).rejects.toThrow();
    await backend.load("k", Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR)), SR);
    const view = await backend.view("k", { maxFrames: 20 });
    expect(view.frames).toBeGreaterThan(0);
    expect(view.sampleRate).toBe(SR);
    await backend.drop("k");
    await expect(backend.view("k", {})).rejects.toThrow();
  });
});
