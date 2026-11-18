import { describe, expect, it, vi } from "vitest";
import { WaveformGenerator } from "./waveform-generator";
import type { MediaBunnyEngine } from "./mediabunny-engine";
import type { WaveformData } from "./types";
const waveform = (peak: number): WaveformData => ({
  peaks: new Float32Array([peak, peak]),
  rms: new Float32Array([peak, peak]),
  duration: 2,
  sampleRate: 1,
  samplesPerSecond: 1,
});
describe("waveform cache and cancellation", () => {
  it("bypasses an earlier source cache when disabled and does not replace that cache", async () => {
    const old = waveform(0.2),
      fresh = waveform(0.8);
    const decode = vi
      .fn()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(fresh);
    const generator = new WaveformGenerator({
      generateWaveform: decode,
    } as unknown as MediaBunnyEngine);
    const original = new Blob(["old"]),
      replacement = new Blob(["new"]);
    expect(
      await generator.generateWaveform(original, "media", {
        samplesPerSecond: 1,
      }),
    ).toBe(old);
    expect(
      await generator.generateWaveform(replacement, "media", {
        samplesPerSecond: 1,
        enableCaching: false,
      }),
    ).toBe(fresh);
    expect(
      await generator.generateWaveform(original, "media", {
        samplesPerSecond: 1,
      }),
    ).toBe(old);
    expect(decode).toHaveBeenCalledTimes(2);
  });
  it("rejects an already cancelled request before decoding", async () => {
    const decode = vi.fn(),
      controller = new AbortController();
    controller.abort();
    const generator = new WaveformGenerator({
      generateWaveform: decode,
    } as unknown as MediaBunnyEngine);
    await expect(
      generator.generateWaveform(new Blob(["audio"]), "media", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(decode).not.toHaveBeenCalled();
  });
  it("propagates cancellation and rejects late decoded data", async () => {
    let finish!: (data: WaveformData) => void;
    const decode = vi.fn(
      () =>
        new Promise<WaveformData>((resolve) => {
          finish = resolve;
        }),
    );
    const generator = new WaveformGenerator({
      generateWaveform: decode,
    } as unknown as MediaBunnyEngine);
    const controller = new AbortController(),
      source = new Blob(["audio"]);
    const result = generator.generateWaveform(source, "media", {
      signal: controller.signal,
      enableCaching: false,
    });
    expect(decode).toHaveBeenCalledWith(source, 100, controller.signal);
    controller.abort();
    finish(waveform(0.7));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
