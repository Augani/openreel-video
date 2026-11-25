import { describe, expect, it } from "vitest";
import { I420_CHROMA_TAPS, i420ByteLength, rgbaToI420Bt709 } from "./yuv420-sdr";

const solid = (w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, 255], i * 4);
  return data;
};
const planes = (out: ArrayBuffer, w: number, h: number) => {
  const bytes = new Uint8Array(out);
  const c = (w / 2) * (h / 2);
  return { y: bytes[0], u: bytes[w * h], v: bytes[w * h + c], length: bytes.length };
};

describe("rgbaToI420Bt709", () => {
  it("sizes the frame as Y + Cb + Cr", () => {
    expect(i420ByteLength(1920, 1080)).toBe(1920 * 1080 * 1.5);
    expect(rgbaToI420Bt709(solid(4, 2, 0, 0, 0), 4, 2).byteLength).toBe(12);
  });

  it("maps black, white and grey to limited-range codes with neutral chroma", () => {
    expect(planes(rgbaToI420Bt709(solid(4, 4, 0, 0, 0), 4, 4), 4, 4)).toMatchObject({ y: 16, u: 128, v: 128 });
    expect(planes(rgbaToI420Bt709(solid(4, 4, 255, 255, 255), 4, 4), 4, 4)).toMatchObject({ y: 235, u: 128, v: 128 });
    expect(planes(rgbaToI420Bt709(solid(4, 4, 128, 128, 128), 4, 4), 4, 4)).toMatchObject({ y: 126, u: 128, v: 128 });
  });

  it("uses the BT.709 matrix (not BT.601) for the primaries", () => {
    // Red: Y 16 + 219 * 0.2126 = 62.6 -> 63, Cb 128 - 25.7 -> 102, Cr clamps at 240.
    expect(planes(rgbaToI420Bt709(solid(2, 2, 255, 0, 0), 2, 2), 2, 2)).toMatchObject({ y: 63, u: 102, v: 240 });
    // Green: Y 16 + 219 * 0.7152 = 172.6 -> 173, Cb 128 - 86.3 -> 42, Cr 128 - 101.7 -> 26.
    expect(planes(rgbaToI420Bt709(solid(2, 2, 0, 255, 0), 2, 2), 2, 2)).toMatchObject({ y: 173, u: 42, v: 26 });
    // Blue: Y 16 + 219 * 0.0722 = 31.8 -> 32, Cb clamps at 240, Cr 128 - 10.2 -> 118.
    expect(planes(rgbaToI420Bt709(solid(2, 2, 0, 0, 255), 2, 2), 2, 2)).toMatchObject({ y: 32, u: 240, v: 118 });
  });

  it("subsamples chroma like swscale: pair mean horizontally, symmetric 8-tap bicubic vertically, luma per pixel", () => {
    expect(I420_CHROMA_TAPS).toHaveLength(8);
    expect(I420_CHROMA_TAPS.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 12);
    for (let k = 0; k < 4; k++) expect(I420_CHROMA_TAPS[k]).toBeCloseTo(I420_CHROMA_TAPS[7 - k], 12);
    expect(I420_CHROMA_TAPS[3]).toBeGreaterThan(I420_CHROMA_TAPS[2]);
    expect(I420_CHROMA_TAPS[0]).toBeLessThan(0);
    // One red and one blue pixel side by side on every row: chroma is their mean, luma stays per pixel.
    const w = 2;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      data.set([255, 0, 0, 255], y * w * 4);
      data.set([0, 0, 255, 255], y * w * 4 + 4);
    }
    const out = new Uint8Array(rgbaToI420Bt709(data, w, h));
    expect([out[0], out[1]]).toEqual([63, 32]);
    expect(out[w * h]).toBe(171);
    expect(out[w * h + (w / 2) * (h / 2)]).toBe(179);
  });

  it("lets a hard vertical colour edge bleed across the chroma rows around it (the 8-tap filter), but not far", () => {
    const w = 2;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(y < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * w + x) * 4);
    const out = new Uint8Array(rgbaToI420Bt709(data, w, h));
    const cb = Array.from({ length: h / 2 }, (_, i) => out[w * h + i]);
    // Rows 0..3 are chroma rows of the red half, 4..7 of the blue half; the edge sits between rows 3 and 4.
    expect(cb[0]).toBe(102);
    expect(cb[7]).toBe(240);
    expect(cb[3]).toBeGreaterThan(102);
    expect(cb[4]).toBeLessThan(240);
    // The negative lobes of the bicubic ring a little past the plateau, never far.
    expect(cb[2]).toBeGreaterThanOrEqual(98);
    expect(cb[5]).toBeLessThanOrEqual(240);
  });

  it("reuses a target buffer of the right size and refuses odd dimensions", () => {
    const target = new ArrayBuffer(i420ByteLength(4, 4));
    expect(rgbaToI420Bt709(solid(4, 4, 9, 9, 9), 4, 4, target)).toBe(target);
    expect(() => rgbaToI420Bt709(solid(3, 2, 0, 0, 0), 3, 2)).toThrow(/even/);
  });
});
