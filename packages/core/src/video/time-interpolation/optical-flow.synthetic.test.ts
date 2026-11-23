import { describe, expect, it } from "vitest";
import { blendRGBA } from "./frame-blend";
import { computeFlowPair, synthesizeFrame, interpolateOpticalFlowCPU } from "./optical-flow-cpu";
import { crossDissolve, fade, pan, psnr, renderScene, rotatingDisc, translatingSquare } from "./synthetic-scenes";
import { flowParamsFor } from "./types";

const W = 128;
const H = 96;

function trial(name: string, scene: ReturnType<typeof pan>, t: number, quality: "low" | "medium" | "high" = "medium") {
  const a = renderScene(scene, W, H, 0);
  const b = renderScene(scene, W, H, 1);
  const truth = renderScene(scene, W, H, t);
  const flow = interpolateOpticalFlowCPU(a, b, t, flowParamsFor(quality));
  const blend = blendRGBA(a, b, t);
  const result = { name, t, flowDb: psnr(flow, truth.data), blendDb: psnr(blend, truth.data), flow, blend, truth };
  console.log(`[optical-flow] ${name} t=${t}: flow ${result.flowDb.toFixed(2)} dB, blend ${result.blendDb.toFixed(2)} dB, margin ${(result.flowDb - result.blendDb).toFixed(2)} dB`);
  return result;
}

describe("optical flow vs analytic ground truth", () => {
  it("beats frame blending by a clear margin on a subpixel pan", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const r = trial("pan(3.4,-1.7)", pan(3.4, -1.7), t);
      expect(r.flowDb - r.blendDb).toBeGreaterThan(6);
      expect(r.flowDb).toBeGreaterThan(30);
    }
  });

  it("beats frame blending on a textured square translating over a background (with occlusions)", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const r = trial("square(4.6,2.3)", translatingSquare(W, H, 4.6, 2.3), t);
      expect(r.flowDb - r.blendDb).toBeGreaterThan(3);
      expect(r.flowDb).toBeGreaterThan(24);
    }
  });

  it("beats frame blending on a rotating disc", () => {
    const r = trial("rotate(5deg)", rotatingDisc(W, H, 5), 0.5);
    expect(r.flowDb - r.blendDb).toBeGreaterThan(3);
    expect(r.flowDb).toBeGreaterThan(26);
  });

  it("does not make a fade worse than the blend it should equal", () => {
    const r = trial("fade", fade(), 0.5);
    // the blend IS the truth here; the flow must stay near-lossless (it reads the brightness change as no motion)
    expect(r.flowDb).toBeGreaterThan(35);
  });

  it("reports (does not hide) the unrelated cross dissolve case", () => {
    const r = trial("crossDissolve", crossDissolve(), 0.5);
    // Unrelated pictures have no motion to find; the confidence gating has to fall back towards the blend.
    expect(r.flowDb).toBeGreaterThan(18);
  });

  it("occlusion: the covered/uncovered band stays close to the blend fallback (no tearing)", () => {
    const scene = translatingSquare(W, H, 6, 0);
    const a = renderScene(scene, W, H, 0);
    const b = renderScene(scene, W, H, 1);
    const t = 0.5;
    const truth = renderScene(scene, W, H, t);
    const flow = interpolateOpticalFlowCPU(a, b, t);
    const blend = blendRGBA(a, b, t);
    // pixels that are background in one frame and square in the other
    const mask = new Uint8Array(W * H);
    const sw = Math.round(W * 0.38);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const left0 = W * 0.28;
        const left1 = left0 + 6;
        const inA = x >= left0 && x < left0 + sw && y >= H * 0.3 && y < H * 0.3 + Math.round(H * 0.42);
        const inB = x >= left1 && x < left1 + sw && y >= H * 0.3 && y < H * 0.3 + Math.round(H * 0.42);
        if (inA !== inB) mask[y * W + x] = 1;
      }
    }
    const flowDb = psnr(flow, truth.data, mask);
    const blendDb = psnr(blend, truth.data, mask);
    console.log(`[optical-flow] occlusion band: flow ${flowDb.toFixed(2)} dB, blend ${blendDb.toFixed(2)} dB`);
    expect(flowDb).toBeGreaterThan(blendDb - 2);
    // no tearing: no pixel is far outside the colour range of the two source frames around it
    let worst = 0;
    for (let i = 0; i < W * H; i++) {
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(flow[i * 4 + c] - truth.data[i * 4 + c]));
    }
    console.log(`[optical-flow] occlusion worst abs error ${worst}`);
    expect(worst).toBeLessThan(120);
  });

  it("is deterministic and symmetric in time: t and the swapped frames at 1-t agree within a small tolerance", () => {
    const scene = pan(3.4, -1.7);
    const a = renderScene(scene, W, H, 0);
    const b = renderScene(scene, W, H, 1);
    const one = interpolateOpticalFlowCPU(a, b, 0.4);
    const two = interpolateOpticalFlowCPU(a, b, 0.4);
    expect(Array.from(one)).toEqual(Array.from(two));
    const swapped = interpolateOpticalFlowCPU(b, a, 0.6);
    expect(psnr(one, swapped)).toBeGreaterThan(30);
  });

  it("reports flow close to the true motion", () => {
    const a = renderScene(pan(3.4, -1.7), W, H, 0);
    const b = renderScene(pan(3.4, -1.7), W, H, 1);
    const pair = computeFlowPair(a, b);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 8; y < pair.height - 8; y++) {
      for (let x = 8; x < pair.width - 8; x++) {
        sx += pair.ab[(y * pair.width + x) * 2] * pair.factor;
        sy += pair.ab[(y * pair.width + x) * 2 + 1] * pair.factor;
        n++;
      }
    }
    console.log(`[optical-flow] mean flow (${(sx / n).toFixed(2)}, ${(sy / n).toFixed(2)}) vs true (3.40, -1.70)`);
    expect(sx / n).toBeCloseTo(3.4, 0);
    expect(sy / n).toBeCloseTo(-1.7, 0);
    // synthesis equals t=0 / t=1 sources at the endpoints
    expect(psnr(synthesizeFrame(a, b, pair, 0.001), a.data)).toBeGreaterThan(40);
  });
});
