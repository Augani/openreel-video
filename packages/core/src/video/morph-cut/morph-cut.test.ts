import { describe, expect, it } from "vitest";
import { blendRGBA, type RGBAFrame } from "../time-interpolation/frame-blend";
import { synthesizeFrame } from "../time-interpolation/optical-flow-cpu";
import { psnr, renderScene, texture } from "../time-interpolation/synthetic-scenes";
import { alignFrames, applySimilarity, fitSimilarity, invertSimilarity, similarityRotationDeg, similarityScale } from "./alignment";
import { analyseMorphCut, composeFields, cpuDenseBackend, MorphCutCancelled } from "./analysis";
import { cancelMorphCutAnalysis, restartMorphCutAnalysis, runMorphCutAnalysis, morphCutCacheKey } from "./analyse-job";
import { getMorphCutRegistry } from "./registry";
import { fieldToFlowPair } from "./render";
import { darkBlob, eyePosition, gradientCorrelation, headOutlineMask, jumpCut, NEUTRAL_CAMERA, type CameraPose, type FacePose } from "./synthetic-faces";
import { MORPH_CUT_FAILED_MESSAGE } from "./types";

const W = 256;
const H = 144;
const A: FacePose = { x: 0.5, y: 0.5, scale: 1, rotationDeg: 0, blink: 0 };
const B: FacePose = { x: 0.54, y: 0.53, scale: 1.08, rotationDeg: 6, blink: 0 };
const BLINK_B: FacePose = { ...B, blink: 0.9 };

const frameOf = (data: Uint8ClampedArray): RGBAFrame => ({ width: W, height: H, data });

async function analyse(a: FacePose, b: FacePose, ca: CameraPose = NEUTRAL_CAMERA, cb: CameraPose = ca) {
  const cut = jumpCut(W, H, a, b, ca, cb);
  const analysis = await analyseMorphCut(cut.a, cut.b, { key: "t", quality: "low", backend: cpuDenseBackend });
  return { cut, analysis };
}

const morphAt = (cut: { a: RGBAFrame; b: RGBAFrame }, analysis: { field: import("./types").MorphField | null }, t: number): RGBAFrame =>
  frameOf(synthesizeFrame(cut.a, cut.b, fieldToFlowPair(analysis.field!, W), t));

describe("Morph Cut: head move over a static wall", () => {
  it("the morph is geometrically between A and B (feature positions), a dissolve is not", async () => {
    const { cut, analysis } = await analyse(A, B);
    expect(analysis.ok).toBe(true);
    const rows: string[] = [];
    for (const t of [0.25, 0.5, 0.75]) {
      const morph = morphAt(cut, analysis, t);
      const dissolve = frameOf(blendRGBA(cut.a, cut.b, t));
      const truth = cut.truth(t);
      for (const eye of [0, 1] as const) {
        const p = eyePosition(W, H, A, B, NEUTRAL_CAMERA, NEUTRAL_CAMERA, t, eye);
        const box = { x0: Math.round(p.x - 16), y0: Math.round(p.y - 12), x1: Math.round(p.x + 16), y1: Math.round(p.y + 12) };
        const m = darkBlob(morph, box);
        const d = darkBlob(dissolve, box);
        const tr = darkBlob(truth, box);
        rows.push(`t=${t} eye${eye}: analytic (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) morph (${m.x.toFixed(2)}, ${m.y.toFixed(2)}) spread ${m.spread.toFixed(2)} | dissolve (${d.x.toFixed(2)}, ${d.y.toFixed(2)}) spread ${d.spread.toFixed(2)} | truth spread ${tr.spread.toFixed(2)}`);
        // feature positions of the morph match the analytic pose between A and B
        expect(Math.hypot(m.x - p.x, m.y - p.y), `morph feature t=${t} eye${eye}`).toBeLessThan(0.8);
        // one blob, not two: no wider than the true blob
        expect(m.spread).toBeLessThan(tr.spread * 1.15 + 0.2);
        if (t === 0.5 && eye === 1) {
          // the dissolve's blob is two half-strength blobs: clearly wider
          expect(d.spread).toBeGreaterThan(tr.spread * 1.5);
        }
      }
    }
    console.log(`[morph-cut] feature positions\n  ${rows.join("\n  ")}`);
  });

  it("is closer to the analytic midpoint than a dissolve and has no double edges on the silhouette", async () => {
    const { cut, analysis } = await analyse(A, B);
    const morph = morphAt(cut, analysis, 0.5);
    const dissolve = frameOf(blendRGBA(cut.a, cut.b, 0.5));
    const truth = cut.truth(0.5);
    const morphDb = psnr(morph.data, truth.data);
    const dissolveDb = psnr(dissolve.data, truth.data);
    const band = headOutlineMask(W, H, A, B, [0, 0.5, 1], 3);
    const gm = gradientCorrelation(morph, truth, band);
    const gd = gradientCorrelation(dissolve, truth, band);
    console.log(`[morph-cut] midpoint PSNR morph ${morphDb.toFixed(2)} dB vs dissolve ${dissolveDb.toFixed(2)} dB; silhouette gradient correlation morph ${gm.toFixed(3)} vs dissolve ${gd.toFixed(3)}; analysis ${analysis.analysisMs.toFixed(0)} ms, confidence ${analysis.metrics.confidence.toFixed(2)}`);
    expect(morphDb).toBeGreaterThan(dissolveDb + 3);
    expect(morphDb).toBeGreaterThan(28);
    expect(gm).toBeGreaterThan(gd + 0.08);
  });

  it("endpoints are the live frames: progress 0 is the outgoing frame, 1 the incoming one", async () => {
    const { cut, analysis } = await analyse(A, B);
    expect(psnr(morphAt(cut, analysis, 0).data, cut.a.data)).toBeGreaterThan(45);
    expect(psnr(morphAt(cut, analysis, 1).data, cut.b.data)).toBeGreaterThan(45);
  });

  it("a blink (local change, not motion) is still a successful morph; elsewhere it beats a dissolve", async () => {
    const { cut, analysis } = await analyse(A, BLINK_B);
    console.log(`[morph-cut] blink: ok=${analysis.ok} confident ${analysis.metrics.confidentFraction.toFixed(2)} confidence ${analysis.metrics.confidence.toFixed(2)}`);
    expect(analysis.ok).toBe(true);
    const morph = morphAt(cut, analysis, 0.5);
    const dissolve = frameOf(blendRGBA(cut.a, cut.b, 0.5));
    const truth = cut.truth(0.5);
    const outsideEyes = new Uint8Array(W * H).fill(1);
    for (const eye of [0, 1] as const) {
      const p = eyePosition(W, H, A, BLINK_B, NEUTRAL_CAMERA, NEUTRAL_CAMERA, 0.5, eye);
      for (let y = Math.round(p.y) - 9; y <= Math.round(p.y) + 9; y++) for (let x = Math.round(p.x) - 14; x <= Math.round(p.x) + 14; x++) if (x >= 0 && x < W && y >= 0 && y < H) outsideEyes[y * W + x] = 0;
    }
    const m = psnr(morph.data, truth.data, outsideEyes);
    const d = psnr(dissolve.data, truth.data, outsideEyes);
    console.log(`[morph-cut] blink, outside the eyes: morph ${m.toFixed(2)} dB, dissolve ${d.toFixed(2)} dB`);
    expect(m).toBeGreaterThan(d + 2);
    // the eyes themselves never tear: the half-closed eye is a plain blend of open and closed, within a few levels of the truth
    const p0 = eyePosition(W, H, A, BLINK_B, NEUTRAL_CAMERA, NEUTRAL_CAMERA, 0.5, 0);
    const eyeBox = { x0: Math.round(p0.x - 10), y0: Math.round(p0.y - 6), x1: Math.round(p0.x + 10), y1: Math.round(p0.y + 6) };
    const em = new Uint8Array(W * H);
    for (let y = eyeBox.y0; y < eyeBox.y1; y++) for (let x = eyeBox.x0; x < eyeBox.x1; x++) em[y * W + x] = 1;
    const eyeM = psnr(morph.data, truth.data, em);
    const eyeD = psnr(dissolve.data, truth.data, em);
    console.log(`[morph-cut] blinking eye region: morph ${eyeM.toFixed(2)} dB, dissolve ${eyeD.toFixed(2)} dB`);
    expect(eyeM).toBeGreaterThan(eyeD - 2);
  });
});

describe("Morph Cut: reframed shot (global similarity)", () => {
  it("recovers scale, rotation and translation of a re-framed jump cut and morphs through it", async () => {
    const camB: CameraPose = { tx: 0.035, ty: 0.02, scale: 1.06, rotationDeg: 3 };
    const cut = jumpCut(W, H, A, A, NEUTRAL_CAMERA, camB);
    const alignment = alignFrames(cut.a, cut.b);
    expect(alignment.accepted).toBe(true);
    // ground truth: a camera pose maps the scene about the frame centre
    const s = similarityScale(alignment.similarity);
    const r = similarityRotationDeg(alignment.similarity);
    console.log(`[morph-cut] similarity: scale ${s.toFixed(4)} (true 1.06) rotation ${r.toFixed(2)} deg (true 3) inliers ${alignment.inliers}/${alignment.matches}`);
    expect(s).toBeGreaterThan(1.045);
    expect(s).toBeLessThan(1.075);
    expect(r).toBeGreaterThan(2.2);
    expect(r).toBeLessThan(3.8);
    const analysis = await analyseMorphCut(cut.a, cut.b, { key: "cam", quality: "low", backend: cpuDenseBackend });
    expect(analysis.ok).toBe(true);
    const morph = morphAt(cut, analysis, 0.5);
    const dissolve = frameOf(blendRGBA(cut.a, cut.b, 0.5));
    const truth = cut.truth(0.5);
    const m = psnr(morph.data, truth.data);
    const d = psnr(dissolve.data, truth.data);
    console.log(`[morph-cut] reframe midpoint: morph ${m.toFixed(2)} dB, dissolve ${d.toFixed(2)} dB`);
    expect(m).toBeGreaterThan(d + 4);
  });

  it("composeFields: the A->B and B->A fields of a pure similarity are consistent inverses", () => {
    const s = fitSimilarity([
      { a: { x: 0, y: 0 }, b: { x: 3, y: 2 } },
      { a: { x: 10, y: 0 }, b: { x: 13.2, y: 3 } },
    ])!;
    const w = 16;
    const h = 12;
    const zero = { width: w, height: h, ab: new Float32Array(w * h * 2), ba: new Float32Array(w * h * 2), confAB: new Float32Array(w * h).fill(1), confBA: new Float32Array(w * h).fill(1) };
    const field = composeFields(zero, s, new Uint8Array(w * h).fill(1));
    // x + ab(x) = S(x); and for y = S(x): y + ba(y) = x
    for (const [x, y] of [[4, 4], [6, 5], [2, 3]]) {
      const i = y * w + x;
      const [bx, by] = applySimilarity(s, x, y);
      expect(x + field.ab[i * 2]).toBeCloseTo(bx, 4);
      expect(y + field.ab[i * 2 + 1]).toBeCloseTo(by, 4);
    }
    const inv = invertSimilarity(s);
    const [ux, uy] = applySimilarity(inv, 8, 6);
    // bilinear read of a field that is linear in position is exact
    const i = 6 * w + 8;
    expect(8 + field.ba[i * 2]).toBeCloseTo(ux, 3);
    expect(6 + field.ba[i * 2 + 1]).toBeCloseTo(uy, 3);
  });
});

describe("Morph Cut: confidence and fallback", () => {
  const unrelated = (): { a: RGBAFrame; b: RGBAFrame } => ({
    a: renderScene((x, y) => texture(x, y, 0.9), W, H, 0, 1),
    b: renderScene((x, y) => texture(x * 1.7 + 40, y * 0.6, 7.7), W, H, 0, 1),
  });

  it("unrelated shots fail the gate with a reason (the caller dissolves)", async () => {
    const { a, b } = unrelated();
    const analysis = await analyseMorphCut(a, b, { key: "unrelated", quality: "low", backend: cpuDenseBackend });
    console.log(`[morph-cut] unrelated: ok=${analysis.ok} reason="${analysis.reason}" confidence ${analysis.metrics.confidence.toFixed(2)} confident ${analysis.metrics.confidentFraction.toFixed(2)}`);
    expect(analysis.ok).toBe(false);
    expect(analysis.field).toBeNull();
    expect(analysis.reason).toBeTruthy();
  });

  it("a flat frame against a textured one fails", async () => {
    const a = renderScene(() => [120, 120, 120], W, H, 0, 1);
    const b = renderScene((x, y) => texture(x, y, 2.2), W, H, 0, 1);
    const analysis = await analyseMorphCut(a, b, { key: "flat", quality: "low", backend: cpuDenseBackend });
    expect(analysis.ok).toBe(false);
  });

  it("two frames of different size cannot be analysed", async () => {
    const a = renderScene((x, y) => texture(x, y, 0.9), 64, 48, 0, 1);
    const b = renderScene((x, y) => texture(x, y, 0.9), 80, 48, 0, 1);
    expect((await analyseMorphCut(a, b, { key: "size", backend: cpuDenseBackend })).ok).toBe(false);
  });

  it("identical frames are a successful, motionless morph", async () => {
    const cut = jumpCut(W, H, A, A);
    const analysis = await analyseMorphCut(cut.a, cut.a, { key: "same", quality: "low", backend: cpuDenseBackend });
    expect(analysis.ok).toBe(true);
    expect(analysis.metrics.maxDisplacementFraction).toBeLessThan(0.01);
  });

  it("is deterministic", async () => {
    const x = await analyse(A, B);
    const y = await analyse(A, B);
    expect(Array.from(x.analysis.field!.ab)).toEqual(Array.from(y.analysis.field!.ab));
    expect(x.analysis.metrics.confidence).toBe(y.analysis.metrics.confidence);
  });
});

describe("Morph Cut: analysis job, registry and cache", () => {
  it("publishes analysing then ready, caches by key and reuses the result across transitions", async () => {
    const registry = getMorphCutRegistry();
    registry.clear();
    const cut = jumpCut(W, H, A, B);
    let loads = 0;
    const key = morphCutCacheKey({ sourceKeyA: "m1#1@256x144", timeA: 1.5, sourceKeyB: "m1#1@256x144", timeB: 4, width: W, height: H, quality: "low" });
    const states: string[] = [];
    const unsub = registry.subscribe(() => states.push(registry.getState("t1").status));
    const job = { transitionId: "t1", key, quality: "low" as const, loadFrames: async () => { loads++; return { a: cut.a, b: cut.b }; } };
    expect(registry.resolve("t1")).toBeNull();
    const pending = runMorphCutAnalysis(job);
    expect(registry.getState("t1")).toMatchObject({ status: "analysing", message: "Analysing in background" });
    const analysis = await pending;
    expect(analysis?.ok).toBe(true);
    expect(registry.getState("t1").status).toBe("ready");
    expect(registry.resolve("t1")).toBe(analysis);
    unsub();
    expect(states[0]).toBe("analysing");
    expect(states.at(-1)).toBe("ready");
    expect(states.some((s) => s === "analysing")).toBe(true);

    // a second transition on the same cut (or the same one after undo/redo) is served from the cache: no decode, no analysis
    const again = await runMorphCutAnalysis({ ...job, transitionId: "t2" });
    expect(loads).toBe(1);
    expect(again).toBe(analysis);
    expect(registry.resolve("t2")).toBe(analysis);

    // a different cut key is a different analysis
    expect(morphCutCacheKey({ sourceKeyA: "m1#1@256x144", timeA: 1.5, sourceKeyB: "m1#1@256x144", timeB: 4.0334, width: W, height: H, quality: "low" })).not.toBe(key);
    registry.clear();
  });

  it("a failed analysis is reported on the transition and never resolves for rendering", async () => {
    const registry = getMorphCutRegistry();
    registry.clear();
    const a = renderScene((x, y) => texture(x, y, 0.9), W, H, 0, 1);
    const b = renderScene((x, y) => texture(x * 1.7 + 40, y * 0.6, 7.7), W, H, 0, 1);
    const result = await runMorphCutAnalysis({ transitionId: "bad", key: "bad-key", quality: "low", loadFrames: async () => ({ a, b }) });
    expect(result?.ok).toBe(false);
    expect(registry.getState("bad")).toMatchObject({ status: "failed", message: MORPH_CUT_FAILED_MESSAGE });
    expect(registry.resolve("bad")).toBeNull();
    registry.clear();
  });

  it("frames that cannot be read fail the transition instead of hanging", async () => {
    const registry = getMorphCutRegistry();
    registry.clear();
    await runMorphCutAnalysis({ transitionId: "nf", key: "nf-key", quality: "low", loadFrames: async () => null });
    expect(registry.getState("nf").status).toBe("failed");
    registry.clear();
  });
});

const lumaOf = (f: RGBAFrame): Float32Array => {
  const out = new Float32Array(f.width * f.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.2126 * f.data[i * 4] + 0.7152 * f.data[i * 4 + 1] + 0.0722 * f.data[i * 4 + 2];
  return out;
};
/** Mean absolute luma change between two consecutive output frames. */
const lumaStep = (x: RGBAFrame, y: RGBAFrame): number => {
  const a = lumaOf(x);
  const b = lumaOf(y);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

describe("Morph Cut: temporal smoothness of a talking-head jump cut", () => {
  it("the largest per-frame luma jump across the transition is at least 3x smaller than the hard cut", async () => {
    const { cut, analysis } = await analyse(A, B);
    expect(analysis.ok).toBe(true);
    const N = 12;
    const hard = lumaStep(cut.a, cut.b);
    const frames: RGBAFrame[] = [cut.a];
    for (let i = 1; i < N; i++) frames.push(morphAt(cut, analysis, i / N));
    frames.push(cut.b);
    let maxStep = 0;
    for (let i = 1; i < frames.length; i++) maxStep = Math.max(maxStep, lumaStep(frames[i - 1], frames[i]));
    console.log(`[morph-cut] hard cut luma jump ${hard.toFixed(3)}, max per-frame jump across ${N}-frame morph ${maxStep.toFixed(3)} (${(hard / maxStep).toFixed(1)}x)`);
    expect(hard).toBeGreaterThan(0.5);
    expect(hard / maxStep).toBeGreaterThanOrEqual(3);
  });
});

describe("Morph Cut: cancelling the analysis", () => {
  it("analyseMorphCut rejects with MorphCutCancelled when its signal is aborted", async () => {
    const cut = jumpCut(W, H, A, B);
    const controller = new AbortController();
    controller.abort();
    await expect(analyseMorphCut(cut.a, cut.b, { key: "c", quality: "low", backend: cpuDenseBackend, signal: controller.signal })).rejects.toBeInstanceOf(MorphCutCancelled);
  });

  it("cancelling a running job publishes cancelled, caches nothing, and is not restarted until asked", async () => {
    const registry = getMorphCutRegistry();
    registry.clear();
    const cut = jumpCut(W, H, A, B);
    const key = "cancel-key";
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const job = { transitionId: "tc", key, quality: "low" as const, loadFrames: async () => { await gate; return { a: cut.a, b: cut.b }; } };
    const pending = runMorphCutAnalysis(job);
    expect(registry.getState("tc").status).toBe("analysing");
    expect(cancelMorphCutAnalysis("tc")).toBe(true);
    release();
    expect(await pending).toBeNull();
    expect(registry.getState("tc").status).toBe("cancelled");
    expect(registry.hasResult(key)).toBe(false);
    expect(registry.resolve("tc")).toBeNull();
    expect(cancelMorphCutAnalysis("tc")).toBe(false);

    // the background scan asking again for the same cut does not restart it
    let loads = 0;
    const again = { ...job, loadFrames: async () => { loads++; return { a: cut.a, b: cut.b }; } };
    expect(await runMorphCutAnalysis(again)).toBeNull();
    expect(loads).toBe(0);

    // Analyse again clears the cancelled state and the same job then completes and caches
    restartMorphCutAnalysis("tc");
    expect(registry.getState("tc").status).toBe("idle");
    const done = await runMorphCutAnalysis(again);
    expect(done?.ok).toBe(true);
    expect(loads).toBe(1);
    expect(registry.getState("tc").status).toBe("ready");
    registry.clear();
  });
});
