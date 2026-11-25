import { describe, expect, it } from "vitest";
import { growMask } from "../object-mask/raster-ops";
import type { RGBAFrame } from "../time-interpolation/frame-blend";
import { patchMatchInpaint } from "./patch-match";
import { applyFillPatch } from "./render";
import { getRemovalAnalysis, registerRemovalAnalysis, setRemovalAnalysisLoader, clearRemovalAnalyses } from "./registry";
import { analysisKeyOf } from "./signature";
import { FillSession } from "./session";

/** A smooth, colourful, aperiodic texture: every region has gradients and a different colour. */
function texture(u: number, v: number): [number, number, number] {
  const r = 128 + 50 * Math.sin(u * 0.19 + 0.6 * Math.sin(v * 0.07)) + 30 * Math.sin((u + v) * 0.11 + 2);
  const g = 128 + 50 * Math.sin(v * 0.23 + 1.1 + 0.5 * Math.sin(u * 0.05)) + 30 * Math.sin((u - 1.3 * v) * 0.13 + 0.4);
  const b = 128 + 45 * Math.sin(u * 0.13 + v * 0.17 + 1.7) + 35 * Math.sin(u * 0.045 - v * 0.09);
  return [r, g, b];
}

function render(width: number, height: number, panX: number, panY: number): RGBAFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = texture(x + panX, y + panY);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function psnr(a: RGBAFrame, b: RGBAFrame, inside: Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    for (let c = 0; c < 3; c++) {
      const d = a.data[i * 4 + c] - b.data[i * 4 + c];
      sum += d * d;
      n++;
    }
  }
  const mse = sum / Math.max(1, n);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array => {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
};

/** Composite what the render path does with one frame's patch over the (object-bearing) frame. */
function renderFilled(frame: RGBAFrame, session: FillSession, index: number): { image: RGBAFrame; temporalShare: number } {
  const report = session.fill(index);
  const image = { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) };
  if (report.patch) applyFillPatch(image, report.patch, frame.width, frame.height);
  return { image, temporalShare: report.temporalShare };
}

describe("temporal propagation", () => {
  it("fills the hole of a pan from the frames that see the background there (PSNR >= 30 dB inside the mask)", () => {
    const W = 160, H = 96, FRAMES = 21;
    // The camera pans 4.1 px / frame. An object sits still on the screen, hiding a different bit of the world each frame.
    const pans = Array.from({ length: FRAMES }, (_, i) => ({ x: i * 4.1, y: i * 0.6 }));
    const mask = rect(W, H, 68, 30, 92, 66);
    const truth = pans.map((p) => render(W, H, p.x, p.y));
    const withObject = truth.map((f) => {
      const copy = { width: W, height: H, data: new Uint8ClampedArray(f.data) };
      for (let i = 0; i < mask.length; i++) if (mask[i]) copy.data.set([230, 40, 40, 255], i * 4);
      return copy;
    });
    const session = new FillSession({ dilate: 2, feather: 1, offsets: [1, -1, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10] });
    withObject.forEach((f, i) => session.push(i, f, mask));
    const target = 10;
    const { image, temporalShare } = renderFilled(withObject[target], session, target);
    expect(temporalShare).toBeGreaterThan(0.99);
    const score = psnr(image, truth[target], mask);
    expect(score).toBeGreaterThanOrEqual(30);
    // nothing outside the grown mask changed
    const outside = growMask(mask, W, H, 6).map((v) => 1 - v);
    expect(psnr(image, withObject[target], outside)).toBe(Infinity);
  });

  it("a mask with nothing to remove produces no patch", () => {
    const frame = render(64, 48, 0, 0);
    const session = new FillSession({ dilate: 1, feather: 1 });
    session.push(0, frame, new Uint8Array(64 * 48));
    expect(session.fill(0).patch).toBeNull();
  });
});

describe("patch based spatial inpainting", () => {
  const W = 128, H = 96;
  const truth = render(W, H, 11, 5);
  const hole = rect(W, H, 50, 34, 80, 62);
  const damaged = { width: W, height: H, data: new Uint8ClampedArray(truth.data) };
  for (let i = 0; i < hole.length; i++) if (hole[i]) damaged.data.set([0, 0, 0, 255], i * 4);
  const out = patchMatchInpaint(damaged, hole, { seed: 7 });
  const filled: RGBAFrame = { width: W, height: H, data: out };

  it("returns finite, in-range pixels and leaves the known ones alone", () => {
    expect(out.length).toBe(W * H * 4);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
    for (let i = 0; i < hole.length; i++) {
      for (let c = 0; c < 4; c++) if (!hole[i]) expect(out[i * 4 + c]).toBe(damaged.data[i * 4 + c]);
      if (hole[i]) expect(out[i * 4 + 3]).toBe(255);
    }
  });

  it("is deterministic", () => {
    const again = patchMatchInpaint(damaged, hole, { seed: 7 });
    expect(Array.from(again)).toEqual(Array.from(out));
  });

  it("has no seam: the step across the hole border is no bigger than the picture's own steps", () => {
    const border = new Uint8Array(W * H);
    const inner = growMask(hole, W, H, -1);
    for (let i = 0; i < border.length; i++) border[i] = hole[i] && !inner[i] ? 1 : 0;
    let seam = 0, seamN = 0, own = 0, ownN = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const step = (j: number): number => (Math.abs(filled.data[i * 4] - filled.data[j * 4]) + Math.abs(filled.data[i * 4 + 1] - filled.data[j * 4 + 1]) + Math.abs(filled.data[i * 4 + 2] - filled.data[j * 4 + 2])) / 3;
        if (border[i]) {
          for (const j of [i - 1, i + 1, i - W, i + W]) if (!hole[j]) { seam += step(j); seamN++; }
        } else if (!hole[i] && !hole[i + 1]) {
          own += step(i + 1);
          ownN++;
        }
      }
    }
    const seamStep = seam / seamN;
    const ownStep = own / ownN;
    expect(seamStep).toBeLessThan(ownStep * 2.5 + 2);
  });

  it("recovers the texture closely (PSNR >= 20 dB against the original)", () => {
    expect(psnr(filled, truth, hole)).toBeGreaterThanOrEqual(20);
  });

  it("handles holes at the border, a fully known frame and a frame with no known pixel", () => {
    const edge = rect(W, H, 0, 0, 20, 20);
    const a = patchMatchInpaint(damaged, edge, { seed: 1 });
    for (const v of a) expect(Number.isFinite(v)).toBe(true);
    expect(Array.from(patchMatchInpaint(truth, new Uint8Array(W * H)))).toEqual(Array.from(truth.data));
    const all = patchMatchInpaint(truth, new Uint8Array(W * H).fill(1));
    expect(all[0]).toBe(128);
  });
});

describe("a static scene where nothing is ever revealed", () => {
  it("falls back to spatial inpainting, keeps the picture outside and blends softly", () => {
    const W = 128, H = 80, FRAMES = 6;
    const world = render(W, H, 0, 0);
    const mask = rect(W, H, 52, 28, 76, 52);
    const withObject = { width: W, height: H, data: new Uint8ClampedArray(world.data) };
    for (let i = 0; i < mask.length; i++) if (mask[i]) withObject.data.set([240, 30, 30, 255], i * 4);
    const session = new FillSession({ dilate: 3, feather: 2, offsets: [1, -1, 2, -2] });
    for (let i = 0; i < FRAMES; i++) session.push(i, withObject, mask);
    const report = session.fill(2);
    expect(report.temporalShare).toBeLessThan(0.05);
    expect(report.patch).not.toBeNull();
    const image = { width: W, height: H, data: new Uint8ClampedArray(withObject.data) };
    applyFillPatch(image, report.patch!, W, H);
    for (const v of image.data) expect(Number.isFinite(v)).toBe(true);
    // the red object is gone
    let red = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] && image.data[i * 4] > 200 && image.data[i * 4 + 1] < 80) red++;
    expect(red).toBe(0);
    // it is texture again, not a flat or smeared patch: similar mean colour and contrast to the real picture there
    const stats = (frame: RGBAFrame): { mean: number; spread: number } => {
      let sum = 0, sq = 0, n = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i]) for (let c = 0; c < 3; c++) { const v = frame.data[i * 4 + c]; sum += v; sq += v * v; n++; }
      const mean = sum / n;
      return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
    };
    const got = stats(image), real = stats(world);
    expect(Math.abs(got.mean - real.mean)).toBeLessThan(25);
    expect(got.spread).toBeGreaterThan(real.spread * 0.4);
    expect(got.spread).toBeLessThan(real.spread * 1.6);
    // far from the removed area the frame is untouched
    const far = growMask(mask, W, H, 12).map((v) => 1 - v);
    expect(psnr(image, withObject, far)).toBe(Infinity);
  });
});

describe("the fill patch on frames of another size", () => {
  it("scales with the frame so preview and export agree", () => {
    const patchData = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) patchData.set([200, 100, 50, 255], i * 4);
    const patch = { x: 4, y: 4, width: 4, height: 4, data: patchData };
    const small = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(0) };
    const big = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(0) };
    applyFillPatch(small, patch, 16, 16);
    applyFillPatch(big, patch, 16, 16);
    const at = (f: { width: number; data: Uint8ClampedArray }, x: number, y: number): number => f.data[(y * f.width + x) * 4];
    expect(at(small, 5, 5)).toBe(200);
    expect(at(big, 22, 22)).toBe(200);
    expect(at(small, 2, 2)).toBe(0);
    expect(at(big, 8, 8)).toBe(0);
  });
});

describe("analysis cache", () => {
  it("keys depend on every input, and the registry falls back to the loader", async () => {
    expect(analysisKeyOf({ a: 1, b: [2, 3] })).toBe(analysisKeyOf({ a: 1, b: [2, 3] }));
    expect(analysisKeyOf({ a: 1 })).not.toBe(analysisKeyOf({ a: 1.001 }));
    clearRemovalAnalyses();
    const analysis = { key: "k1", width: 4, height: 4, fps: 30, frames: [null] };
    let loads = 0;
    setRemovalAnalysisLoader(async () => { loads++; return analysis; });
    expect(await getRemovalAnalysis("clip", "k1")).toBe(analysis);
    expect(await getRemovalAnalysis("clip", "k1")).toBe(analysis);
    expect(loads).toBe(1);
    registerRemovalAnalysis("other", analysis);
    expect(await getRemovalAnalysis("other", "k1")).toBe(analysis);
    setRemovalAnalysisLoader(null);
    clearRemovalAnalyses();
  });
});
