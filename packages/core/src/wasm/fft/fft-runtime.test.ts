import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FFT } from "../../audio/fft";
import { getWasmFFT, initWasmFFT, WasmFFT } from "./index";
beforeAll(async () => {
  const bytes = new Uint8Array(
    readFileSync(new URL("./build/fft.wasm", import.meta.url)),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  expect(await initWasmFFT()).toBe(true);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
function difference(actual: Float32Array, expected: Float32Array) {
  let max = 0,
    scale = 1;
  for (let i = 0; i < expected.length; i++) {
    max = Math.max(max, Math.abs(actual[i] - expected[i]));
    scale = Math.max(scale, Math.abs(expected[i]));
  }
  return max / scale;
}
const input = (size: number) =>
  Float32Array.from(
    { length: size },
    (_, i) =>
      Math.sin((2 * Math.PI * 7 * i) / size) * 0.2 +
      Math.cos((2 * Math.PI * 13 * i) / size) * 0.1,
  );
describe("real compiled FFT runtime", () => {
  it.each([64, 2048])(
    "matches JavaScript forward/inverse, magnitude/phase and windowing at size %s",
    async (size) => {
      const wasm = new WasmFFT(size),
        js = new FFT(size),
        data = input(size);
      expect(await wasm.ensureWasm()).toBe(true);
      const a = wasm.forward(data),
        b = js.forward(data);
      expect(difference(a.real, b.real)).toBeLessThan(0.00001);
      expect(difference(a.imag, b.imag)).toBeLessThan(0.00001);
      expect(difference(wasm.inverse(a.real, a.imag), data)).toBeLessThan(
        0.00001,
      );
      expect(
        difference(
          wasm.getMagnitude(a.real, a.imag),
          js.getMagnitude(a.real, a.imag),
        ),
      ).toBeLessThan(0.00001);
      const phase = wasm.getMagnitudeAndPhase(a.real, a.imag),
        reference = js.getMagnitudeAndPhase(a.real, a.imag);
      expect(difference(phase.magnitudes, reference.magnitudes)).toBeLessThan(
        0.00001,
      );
      const rebuilt = wasm.fromMagnitudeAndPhase(
        phase.magnitudes,
        phase.phases,
      );
      const expected = js.fromMagnitudeAndPhase(phase.magnitudes, phase.phases);
      expect(difference(rebuilt.real, expected.real)).toBeLessThan(0.00001);
      expect(difference(rebuilt.imag, expected.imag)).toBeLessThan(0.00001);
      expect(
        difference(wasm.applyHannWindow(data), js.applyHannWindow(data)),
      ).toBeLessThan(0.00001);
    },
  );
  it("retains independent size caches and stable results while sizes alternate", async () => {
    const first = getWasmFFT(64),
      second = getWasmFFT(128);
    await Promise.all([first.ensureWasm(), second.ensureWasm()]);
    expect(getWasmFFT(64)).toBe(first);
    expect(getWasmFFT(128)).toBe(second);
    for (let n = 0; n < 50; n++) {
      for (const size of [64, 128]) {
        const data = input(size),
          fft = getWasmFFT(size),
          spectrum = fft.forward(data);
        expect(
          difference(fft.inverse(spectrum.real, spectrum.imag), data),
        ).toBeLessThan(0.00001);
      }
    }
  });
  it("keeps WebAssembly memory constant through repeated inverse transforms and alternating sizes", async () => {
    const a = getWasmFFT(64),
      b = getWasmFFT(128);
    expect(await a.ensureWasm()).toBe(true);
    expect(await b.ensureWasm()).toBe(true);
    const before = [a.getWasmMemoryBytes(), b.getWasmMemoryBytes()];
    expect(before.every((bytes) => bytes > 0)).toBe(true);
    for (let n = 0; n < 1000; n++)
      for (const fft of [a, b]) {
        const data = input(fft.getSize()),
          spectrum = fft.forward(data);
        fft.inverse(spectrum.real, spectrum.imag);
      }
    expect([a.getWasmMemoryBytes(), b.getWasmMemoryBytes()]).toEqual(before);
  });
});
