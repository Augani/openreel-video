import { describe, expect, it } from "vitest";
import { analyzeSequence } from "./analysis";
import { buildPyramid, estimateFrameMotion, type GrayFrame } from "./motion-estimate";
import { applyMat3, buildPlan, rawPathOf, rowDelta, rowMatrix, smoothPathGaussian, type RowDelta, type WarpPlan } from "./plan";
import { neighbourIndices, warpFrameCpu, type RasterFrame } from "./render-cpu";
import { jitter, renderScene, STILL_CAMERA, type Camera } from "./synthetic-scene";
import { DEFAULT_WARP_SETTINGS, normalizeWarpSettings, type WarpSettings } from "./types";

const W = 160;
const H = 96;
const N = 36;

const rms = (values: number[]): number => Math.sqrt(values.reduce((s, v) => s + v * v, 0) / Math.max(1, values.length));

/** Known camera: a slow intended drift plus high-frequency shake in translation, rotation and scale. */
function shakyCamera(t: number): Camera {
  return {
    dx: 0.25 * t + jitter(t, 4, 0.3),
    dy: 0.05 * t + jitter(t, 3, 1.1),
    rotation: jitter(t, 0.012, 2.2),
    logScale: jitter(t, 0.008, 3.3),
  };
}

async function* frames(count: number, cameraAt: (t: number, row: number) => Camera): AsyncGenerator<GrayFrame> {
  for (let t = 0; t < count; t++) yield renderScene(W, H, (row) => cameraAt(t, row));
}

const toRaster = (g: GrayFrame): RasterFrame => ({ width: g.width, height: g.height, channels: 1, data: g.data });

const settings = (patch: Partial<WarpSettings>): WarpSettings => normalizeWarpSettings({ ...DEFAULT_WARP_SETTINGS, ...patch });

async function shakyAnalysis() {
  return analyzeSequence(frames(N, (t) => shakyCamera(t)), { fps: 30, startTime: 0, width: W, height: H });
}

describe("motion estimation", () => {
  it("measures a known translation, rotation and scale between two frames", () => {
    const a = renderScene(W, H, () => STILL_CAMERA);
    const cam: Camera = { dx: 3.4, dy: -2.2, rotation: 0.02, logScale: 0.015 };
    const b = renderScene(W, H, () => cam);
    const m = estimateFrameMotion(buildPyramid(a), buildPyramid(b));
    // the rotation/scale are about the centre, so dx/dy are the centre displacement
    expect(m.dx).toBeCloseTo(cam.dx, 1);
    expect(m.dy).toBeCloseTo(cam.dy, 1);
    expect(m.rotation).toBeCloseTo(cam.rotation, 2);
    expect(m.logScale).toBeCloseTo(cam.logScale, 2);
    expect(m.confidence).toBeGreaterThan(0.5);
  });

  it("is not pulled by a moving block that covers a fifth of the picture", () => {
    const a = renderScene(W, H, () => STILL_CAMERA);
    const b = renderScene(W, H, () => ({ ...STILL_CAMERA, dx: 2.5, dy: 1.5 }));
    for (let y = 10; y < 40; y++) for (let x = 100; x < 140; x++) b.data[y * W + x] = ((x >> 2) + (y >> 2)) % 2 ? 0.95 : 0.05;
    const m = estimateFrameMotion(buildPyramid(a), buildPyramid(b));
    expect(m.dx).toBeCloseTo(2.5, 0);
    expect(m.dy).toBeCloseTo(1.5, 0);
  });
});

describe("Smooth Motion and No Motion on shaky footage", () => {
  it("recovers the camera path and removes the shake", async () => {
    const analysis = await shakyAnalysis();
    const raw = rawPathOf(analysis);
    const trueX = Array.from({ length: N }, (_, t) => shakyCamera(t).dx - shakyCamera(0).dx);
    const trueY = Array.from({ length: N }, (_, t) => shakyCamera(t).dy - shakyCamera(0).dy);
    expect(rms(Array.from(raw[0], (v, i) => v - trueX[i]))).toBeLessThan(0.45);
    expect(rms(Array.from(raw[1], (v, i) => v - trueY[i]))).toBeLessThan(0.45);

    const plan = buildPlan(analysis, settings({ result: "smoothMotion", smoothness: 50 }));
    // the picture's path after correction (true camera + applied correction) vs the ideal smooth path
    const idealX = smoothPathGaussian(Float64Array.from(trueX), 15);
    const idealY = smoothPathGaussian(Float64Array.from(trueY), 15);
    const afterX = trueX.map((v, i) => v + (plan.target[0][i] - plan.raw[0][i]) * plan.strength);
    const afterY = trueY.map((v, i) => v + (plan.target[1][i] - plan.raw[1][i]) * plan.strength);
    const before = rms(trueX.map((v, i) => v - idealX[i]));
    const after = rms(afterX.map((v, i) => v - idealX[i]));
    expect(before).toBeGreaterThan(2);
    expect(after).toBeLessThan(before * 0.2);
    expect(rms(afterY.map((v, i) => v - idealY[i]))).toBeLessThan(rms(trueY.map((v, i) => v - idealY[i])) * 0.25);
  });

  it("No Motion holds the camera still and Smooth Motion keeps the intended drift", async () => {
    const analysis = await shakyAnalysis();
    const still = buildPlan(analysis, settings({ result: "noMotion", framing: "stabilizeOnly" }));
    const smooth = buildPlan(analysis, settings({ result: "smoothMotion", smoothness: 20, framing: "stabilizeOnly" }));
    const trueX = Array.from({ length: N }, (_, t) => shakyCamera(t).dx - shakyCamera(0).dx);
    const stillAfter = trueX.map((v, i) => v + still.target[0][i] - still.raw[0][i]);
    const smoothAfter = trueX.map((v, i) => v + smooth.target[0][i] - smooth.raw[0][i]);
    expect(rms(stillAfter.map((v) => v - stillAfter[0]))).toBeLessThan(0.7);
    const drift = smoothAfter[N - 5] - smoothAfter[5];
    expect(drift).toBeGreaterThan(0.25 * (N - 10) * 0.55);
  });

  it("measures near-zero motion in the frames it renders", async () => {
    const analysis = await shakyAnalysis();
    const plan = buildPlan(analysis, settings({ result: "noMotion", framing: "stabilizeCropAutoScale", cropLessSmoothMore: 100 }));
    expect(plan.strength).toBeGreaterThan(0.9);
    const corrected: GrayFrame[] = [];
    for (let t = 0; t < N; t++) {
      const raw = renderScene(W, H, () => shakyCamera(t));
      const out = warpFrameCpu(toRaster(raw), plan, t);
      const covered = out.coverage.reduce((s, v) => s + v, 0);
      expect(covered / (W * H)).toBeGreaterThan(0.995);
      corrected.push({ width: W, height: H, data: out.frame.data as Float32Array });
    }
    const residual: number[] = [];
    const original: number[] = [];
    for (let t = 1; t < N; t += 3) {
      const m = estimateFrameMotion(buildPyramid(corrected[t - 1]), buildPyramid(corrected[t]));
      residual.push(Math.hypot(m.dx, m.dy));
      const r = estimateFrameMotion(buildPyramid(renderScene(W, H, () => shakyCamera(t - 1))), buildPyramid(renderScene(W, H, () => shakyCamera(t))));
      original.push(Math.hypot(r.dx, r.dy));
    }
    const meanResidual = residual.reduce((s, v) => s + v, 0) / residual.length;
    const meanOriginal = original.reduce((s, v) => s + v, 0) / original.length;
    expect(meanOriginal).toBeGreaterThan(2);
    expect(meanResidual).toBeLessThan(meanOriginal * 0.2);
  });

  it("Position only leaves rotation and scale alone; Perspective adds terms", async () => {
    const analysis = await shakyAnalysis();
    const position = buildPlan(analysis, settings({ method: "position", framing: "stabilizeOnly" }));
    expect(position.target[2]).toEqual(position.raw[2]);
    expect(position.target[3]).toEqual(position.raw[3]);
    const full = buildPlan(analysis, settings({ method: "positionScaleRotation", framing: "stabilizeOnly" }));
    expect(full.target[2]).not.toEqual(full.raw[2]);
    const persp = buildPlan(analysis, settings({ method: "perspective", framing: "stabilizeOnly" }));
    expect(persp.active[4]).toBe(true);
    expect(full.active[4]).toBe(false);
  });
});

describe("auto-scale", () => {
  it("keeps a fixed point of the scene still while it magnifies (the correction scales with the picture)", async () => {
    const analysis = await shakyAnalysis();
    const plan = buildPlan(analysis, settings({ result: "noMotion", method: "position", framing: "stabilizeCropAutoScale", cropLessSmoothMore: 100 }));
    expect(plan.zoom).toBeGreaterThan(1.03);
    const scratch: RowDelta = { dx: 0, dy: 0, rotation: 0, logScale: 0, px: 0, py: 0 };
    const shown: Array<[number, number]> = [];
    for (let t = 0; t < N; t++) {
      // a scene point near the centre sits at (world + the camera's displacement) in frame t
      const camera = shakyCamera(t);
      const source: [number, number] = [W / 2 + 20 + camera.dx - shakyCamera(0).dx, H / 2 - 10 + camera.dy - shakyCamera(0).dy];
      shown.push(applyMat3(rowMatrix(plan, rowDelta(plan, t, t, 0.5, scratch), W, H, plan.zoom), source[0], source[1]));
    }
    const xs = shown.map((p) => p[0]);
    const ys = shown.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1.0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.0);
  });
});

describe("framing", () => {
  async function shakyPlan(framing: WarpSettings["framing"], extra: Partial<WarpSettings> = {}): Promise<WarpPlan> {
    const analysis = await shakyAnalysis();
    return buildPlan(analysis, settings({ result: "noMotion", framing, ...extra }));
  }

  it("Stabilize Only leaves empty borders, Auto-scale and Crop do not stay empty", async () => {
    const only = await shakyPlan("stabilizeOnly");
    const autoscale = await shakyPlan("stabilizeCropAutoScale", { cropLessSmoothMore: 100 });
    const crop = await shakyPlan("stabilizeCrop", { cropLessSmoothMore: 100 });
    expect(only.zoom).toBe(1);
    expect(only.cropFraction).toBe(1);
    expect(autoscale.zoom).toBeGreaterThan(1.02);
    expect(crop.cropFraction).toBeLessThan(0.98);
    expect(crop.zoom).toBe(1);
    const t = 11;
    const raw = toRaster(renderScene(W, H, () => shakyCamera(t)));
    const empty = (plan: WarpPlan): number => {
      const out = warpFrameCpu(raw, plan, t);
      return 1 - out.coverage.reduce((s, v) => s + v, 0) / (W * H);
    };
    expect(empty(only)).toBeGreaterThan(0.01);
    expect(empty(autoscale)).toBeLessThan(0.005);
    // crop empties the frame outside the crop rectangle but leaves everything inside it filled
    const out = warpFrameCpu(raw, crop, t);
    const x0 = Math.ceil((W * (1 - crop.cropFraction)) / 2) + 1;
    const y0 = Math.ceil((H * (1 - crop.cropFraction)) / 2) + 1;
    let hole = 0;
    for (let y = y0; y < H - y0; y++) for (let x = x0; x < W - x0; x++) if (!out.coverage[y * W + x]) hole++;
    expect(hole).toBe(0);
    expect(out.coverage[0]).toBe(0);
  });

  it("Crop Less / Smooth More trades smoothing for crop", async () => {
    const analysis = await shakyAnalysis();
    const base = { result: "noMotion" as const, framing: "stabilizeCropAutoScale" as const };
    const cropLess = buildPlan(analysis, settings({ ...base, cropLessSmoothMore: 0 }));
    const smoothMore = buildPlan(analysis, settings({ ...base, cropLessSmoothMore: 100 }));
    expect(cropLess.zoom).toBeLessThanOrEqual(1.05 + 1e-6);
    expect(cropLess.strength).toBeLessThan(smoothMore.strength);
    expect(smoothMore.zoom).toBeGreaterThan(cropLess.zoom);
    // a clip that needs more than the budget is held to it, not scaled past it
    expect(smoothMore.zoom).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it("Synthesize Edges fills the empty borders from neighbouring frames, close to the true scene", async () => {
    const analysis = await shakyAnalysis();
    const plan = buildPlan(analysis, settings({ result: "noMotion", framing: "synthesizeEdges" }));
    const t = 17;
    const sources = new Map<number, RasterFrame>();
    const rasterAt = (i: number): RasterFrame => {
      let r = sources.get(i);
      if (!r) {
        r = toRaster(renderScene(W, H, () => shakyCamera(i)));
        sources.set(i, r);
      }
      return r;
    };
    const current = rasterAt(t);
    const withoutNeighbours = warpFrameCpu(current, plan, t);
    const neighbours = neighbourIndices(plan, t).map((index) => ({ index, frame: rasterAt(index) }));
    expect(neighbours.length).toBeGreaterThan(3);
    const filled = warpFrameCpu(current, plan, t, neighbours);
    const emptyBefore = 1 - withoutNeighbours.coverage.reduce((s, v) => s + v, 0) / (W * H);
    const emptyAfter = 1 - filled.coverage.reduce((s, v) => s + v, 0) / (W * H);
    expect(emptyBefore).toBeGreaterThan(0.01);
    expect(emptyAfter).toBeLessThan(emptyBefore * 0.35);
    // what was filled is the same picture: compare with the scene seen by the stabilized (still) camera
    const reference = renderScene(W, H, () => ({ ...STILL_CAMERA, dx: plan.target[0][t] + shakyCamera(0).dx, dy: plan.target[1][t] + shakyCamera(0).dy }));
    let error = 0;
    let count = 0;
    for (let i = 0; i < W * H; i++) {
      if (filled.coverage[i] && !withoutNeighbours.coverage[i]) {
        error += Math.abs((filled.frame.data[i] as number) - reference.data[i]);
        count++;
      }
    }
    expect(count).toBeGreaterThan(100);
    expect(error / count).toBeLessThan(0.08);
  });
});

describe("Rolling Shutter Ripple", () => {
  const READOUT = 0.8;
  /** Horizontal shake whose rows are captured over READOUT frames. */
  const camera = (t: number, row: number): Camera => {
    const time = t + (row / H) * READOUT;
    return { dx: jitter(time * 0.5, 9, 0.9), dy: jitter(time * 0.5, 1.5, 2.4), rotation: 0, logScale: 0 };
  };

  /** Horizontal offset of each row band against a reference, by sub-pixel SAD search. */
  function bandShifts(frame: GrayFrame, coverage: Uint8Array | null, reference: GrayFrame): number[] {
    const shifts: number[] = [];
    const bands = 6;
    for (let b = 0; b < bands; b++) {
      const y0 = Math.floor((b * H) / bands) + 2;
      const y1 = Math.floor(((b + 1) * H) / bands) - 2;
      const cost: number[] = [];
      const range = 9;
      for (let s = -range; s <= range; s++) {
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = 24; x < W - 24; x++) {
            if (coverage && !coverage[y * W + x]) continue;
            sum += Math.abs(frame.data[y * W + x] - reference.data[y * W + x + s]);
            n++;
          }
        }
        cost.push(sum / Math.max(1, n));
      }
      let best = 0;
      for (let i = 1; i < cost.length; i++) if (cost[i] < cost[best]) best = i;
      const l = cost[Math.max(0, best - 1)];
      const r = cost[Math.min(cost.length - 1, best + 1)];
      const c = cost[best];
      const denom = l - 2 * c + r;
      shifts.push(best - range + (denom > 1e-9 && best > 0 && best < cost.length - 1 ? (0.5 * (l - r)) / denom : 0));
    }
    return shifts;
  }

  it("estimates the readout and straightens the skew within each frame", async () => {
    const analysis = await analyzeSequence(frames(N, camera), { fps: 30, startTime: 0, width: W, height: H });
    const off = buildPlan(analysis, settings({ result: "noMotion", framing: "stabilizeOnly", rollingShutter: "off", method: "position" }));
    const on = buildPlan(analysis, settings({ result: "noMotion", framing: "stabilizeOnly", rollingShutter: "automatic", method: "position" }));
    expect(off.readout).toBe(0);
    expect(on.readout).toBeGreaterThan(READOUT * 0.5);
    expect(on.readout).toBeLessThan(READOUT * 1.6);

    // the true still picture: the scene with the camera at the plan's constant position
    const skewOf = (plan: WarpPlan, t: number): number => {
      const raw = renderScene(W, H, (row) => camera(t, row));
      const out = warpFrameCpu(toRaster(raw), plan, t);
      const still: GrayFrame = renderScene(W, H, () => ({ ...STILL_CAMERA, dx: plan.target[0][t], dy: plan.target[1][t] }));
      const shifts = bandShifts({ width: W, height: H, data: out.frame.data as Float32Array }, out.coverage, still);
      // skew = slope of the band shifts over the picture height
      const mean = shifts.reduce((s, v) => s + v, 0) / shifts.length;
      let num = 0;
      let den = 0;
      shifts.forEach((v, i) => {
        const x = i - (shifts.length - 1) / 2;
        num += (v - mean) * x;
        den += x * x;
      });
      return (num / den) * shifts.length;
    };
    const frames_ = [8, 11, 14, 17, 20, 23, 26];
    const skewOff = frames_.map((t) => Math.abs(skewOf(off, t)));
    const skewOn = frames_.map((t) => Math.abs(skewOf(on, t)));
    const meanOff = skewOff.reduce((s, v) => s + v, 0) / skewOff.length;
    const meanOn = skewOn.reduce((s, v) => s + v, 0) / skewOn.length;
    expect(meanOff).toBeGreaterThan(1.5);
    expect(meanOn).toBeLessThan(meanOff * 0.4);
  });
});

describe("settings", () => {
  it("normalizes anything stored into valid settings", () => {
    expect(normalizeWarpSettings(undefined)).toEqual(DEFAULT_WARP_SETTINGS);
    const s = normalizeWarpSettings({ result: "bogus" as never, smoothness: 400, framing: "synthesizeEdges", cropLessSmoothMore: -5 });
    expect(s).toMatchObject({ result: "smoothMotion", smoothness: 100, framing: "synthesizeEdges", cropLessSmoothMore: 0 });
  });
});
