import { describe, expect, it } from "vitest";
import { PRO_EFFECT_DEFAULTS, applyProEffect } from "./pro-effects";
import { applyHomography, homographyBetweenQuads, invertHomography, type Quad } from "./planar-homography";

/** A smooth colour ramp so every output pixel has a known source colour: r = 4x, g = 5y, b = 128. */
const W = 64, H = 48;
const ramp = (): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; d[o] = 4 * x; d[o + 1] = 5 * y; d[o + 2] = 128; d[o + 3] = 255; }
  return d;
};
const pin = (q: number[]) => ({ ...PRO_EFFECT_DEFAULTS["corner-pin"], x0: q[0], y0: q[1], x1: q[2], y1: q[3], x2: q[4], y2: q[5], x3: q[6], y3: q[7] });
const percentQuad = (q: number[]): Quad => [0, 1, 2, 3].map((i) => ({ x: q[i * 2] / 100 * W, y: q[i * 2 + 1] / 100 * H })) as unknown as Quad;

const QUADS: Record<string, number[]> = {
  keystone: [12, 6, 88, 14, 96, 92, 4, 84],
  rotated: [30, 5, 95, 30, 70, 95, 5, 70],
  "tracked-like": [18.4, 22.9, 71.2, 27.3, 74.8, 80.1, 15.9, 71.6],
};

describe("corner pin CPU warp", () => {
  for (const [name, q] of Object.entries(QUADS)) {
    it(`${name}: pixels inside the pinned quad sample the source at the inverse homography`, () => {
      const img = ramp();
      applyProEffect("corner-pin", pin(q), img, W, H);
      const quad = percentQuad(q), h = homographyBetweenQuads(quad, [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }])!;
      let checked = 0, worst = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = applyHomography(h, { x: x + 0.5, y: y + 0.5 });
        if (s.x < 2 || s.x > W - 2 || s.y < 2 || s.y > H - 2) continue; // away from the quad edge
        const o = (y * W + x) * 4, wantR = 4 * (s.x - 0.5), wantG = 5 * (s.y - 0.5);
        worst = Math.max(worst, Math.abs(img[o] - wantR), Math.abs(img[o + 1] - wantG));
        expect(img[o + 3]).toBe(255);
        checked++;
      }
      expect(checked).toBeGreaterThan(W * H * 0.2);
      expect(worst).toBeLessThan(3.5);
    });
    it(`${name}: outside the quad is transparent and the corners land where pinned`, () => {
      const img = ramp();
      applyProEffect("corner-pin", pin(q), img, W, H);
      const quad = percentQuad(q);
      const inv = invertHomography(homographyBetweenQuads([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], quad)!)!;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = applyHomography(inv, { x: x + 0.5, y: y + 0.5 });
        const margin = 1.5;
        if (s.x < -margin || s.x > W + margin || s.y < -margin || s.y > H + margin) expect(img[(y * W + x) * 4 + 3]).toBe(0);
      }
      // The pinned top-left corner pixel is the source's top-left colour.
      const tl = percentQuad(q)[0], o = (Math.ceil(tl.y + 1) * W + Math.ceil(tl.x + 1)) * 4;
      expect(img[o + 3]).toBeGreaterThan(0);
      expect(img[o]).toBeLessThan(40);
    });
  }
  it("a degenerate quad (all corners equal) renders nothing instead of NaN garbage", () => {
    const img = ramp();
    applyProEffect("corner-pin", pin([50, 50, 50, 50, 50, 50, 50, 50]), img, W, H);
    expect(img.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });
  it("the neutral pin is an identity", () => {
    const img = ramp(), before = new Uint8ClampedArray(img);
    applyProEffect("corner-pin", pin([0, 0, 100, 0, 100, 100, 0, 100]), img, W, H);
    let worst = 0; for (let i = 0; i < img.length; i++) worst = Math.max(worst, Math.abs(img[i] - before[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });
});
