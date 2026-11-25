import { describe, expect, it } from "vitest";
import { detectSceneTransitions, type TransitionDetectionResult } from "./transition-detection";
import type { FrameLike, FrameSampler } from "./scene-detection";
import { detectSceneTransitionsInWorker, serveSceneDetection, type MessagePortLike } from "./scene-detection-worker";

const FPS = 30;
const W = 64;
const H = 36;

/** Deterministic pseudo-random in [0, 1). */
function rand(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const PALETTE: Array<[number, number, number]> = [
  [200, 60, 40],
  [40, 160, 220],
  [90, 200, 80],
  [230, 200, 60],
  [160, 50, 200],
  [30, 90, 120],
];

/** A textured scene frame: a base colour, a diagonal gradient and bands, so scenes differ in layout too. */
function scenePixel(scene: number, x: number, y: number): [number, number, number] {
  const [r, g, b] = PALETTE[scene % PALETTE.length];
  const band = Math.floor((x + scene * 5) / 8) % 2 === 0 ? 1 : 0.7;
  const grad = 0.75 + 0.25 * ((x * (scene % 2 ? 1 : -1) + y * 0.5 + 64) / 128);
  return [r * band * grad, g * band * grad, b * band * grad];
}

type Segment =
  | { type: "scene"; scene: number; frames: number }
  | { type: "dissolve"; from: number; to: number; frames: number }
  | { type: "fadeOut"; scene: number; frames: number }
  | { type: "black"; frames: number }
  | { type: "fadeIn"; scene: number; frames: number };

interface Truth {
  cuts: number[];
  dissolves: Array<[number, number]>;
  fades: Array<{ direction: "out" | "in"; start: number; end: number }>;
}

/** Builds a clip from segments; frame k of the clip is returned by `frameAt`. Truth is in seconds. */
function buildClip(segments: Segment[], options: { motion?: boolean } = {}) {
  const starts: number[] = [];
  let frame = 0;
  const truth: Truth = { cuts: [], dissolves: [], fades: [] };
  let lastScene: number | null = null;
  segments.forEach((s, i) => {
    starts.push(frame);
    const at = frame / FPS;
    if (s.type === "scene") {
      if (lastScene !== null && segments[i - 1].type === "scene" && lastScene !== s.scene) truth.cuts.push(at);
      lastScene = s.scene;
    } else if (s.type === "dissolve") {
      truth.dissolves.push([at, (frame + s.frames) / FPS]);
      lastScene = s.to;
    } else if (s.type === "fadeOut") truth.fades.push({ direction: "out", start: at, end: (frame + s.frames) / FPS });
    else if (s.type === "fadeIn") {
      truth.fades.push({ direction: "in", start: at, end: (frame + s.frames) / FPS });
      lastScene = s.scene;
    }
    frame += s.frames;
  });
  const totalFrames = frame;

  const frameAt = (index: number): FrameLike => {
    const k = Math.min(totalFrames - 1, Math.max(0, index));
    let si = starts.length - 1;
    while (starts[si] > k) si--;
    const s = segments[si];
    const local = k - starts[si];
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const shift = options.motion ? Math.floor(k / 3) : 0;
        const sx = (x + shift) % 64;
        let px: [number, number, number];
        if (s.type === "scene") px = scenePixel(s.scene, sx, y);
        else if (s.type === "black") px = [0, 0, 0];
        else if (s.type === "dissolve") {
          const a = (local + 0) / s.frames;
          const p = scenePixel(s.from, sx, y);
          const q = scenePixel(s.to, sx, y);
          px = [0, 1, 2].map((c) => p[c] * (1 - a) + q[c] * a) as [number, number, number];
        } else if (s.type === "fadeOut") {
          const a = local / s.frames;
          px = scenePixel(s.scene, sx, y).map((v) => v * (1 - a)) as [number, number, number];
        } else {
          const a = local / s.frames;
          px = scenePixel(s.scene, sx, y).map((v) => v * a) as [number, number, number];
        }
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const noise = (rand(k * 7919 + y * 131 + x * 17 + c) - 0.5) * 6;
          data[i + c] = px[c] + noise;
        }
        data[i + 3] = 255;
      }
    }
    return { data, width: W, height: H };
  };
  const sampler: FrameSampler = async (time) => frameAt(Math.floor(time * FPS + 1e-6));
  return { sampler, truth, seconds: totalFrames / FPS, frameAt };
}

const f = (seconds: number) => Math.round(seconds * FPS);

/** hard cuts at 4 and 20, dissolves at 8 and 25, fade out / black / fade in around 13. */
function mixedClip() {
  return buildClip([
    { type: "scene", scene: 0, frames: f(4) },
    { type: "scene", scene: 1, frames: f(4) },
    { type: "dissolve", from: 1, to: 2, frames: 15 },
    { type: "scene", scene: 2, frames: f(13 - 8.5) },
    { type: "fadeOut", scene: 2, frames: 20 },
    { type: "black", frames: 12 },
    { type: "fadeIn", scene: 3, frames: 20 },
    { type: "scene", scene: 3, frames: f(20 - 14.7) },
    { type: "scene", scene: 4, frames: f(5) },
    { type: "dissolve", from: 4, to: 0, frames: 12 },
    { type: "scene", scene: 0, frames: f(4.6) },
  ]);
}

interface Score {
  tp: number;
  fp: number;
  fn: number;
}
const tally = (found: number[], truth: number[], tolerance: number, into: Score) => {
  const used = new Set<number>();
  for (const t of found) {
    const hit = truth.findIndex((g, i) => !used.has(i) && Math.abs(g - t) <= tolerance);
    if (hit >= 0) {
      used.add(hit);
      into.tp++;
    } else into.fp++;
  }
  into.fn += truth.length - used.size;
};
const precision = (s: Score) => (s.tp + s.fp === 0 ? 1 : s.tp / (s.tp + s.fp));
const recall = (s: Score) => (s.tp + s.fn === 0 ? 1 : s.tp / (s.tp + s.fn));

async function detect(clip: ReturnType<typeof buildClip>): Promise<TransitionDetectionResult> {
  return detectSceneTransitions({ sampler: clip.sampler, startTime: 0, endTime: clip.seconds - 1 / FPS, frameRate: FPS });
}

describe("scene transition detection on generated clips", () => {
  it("finds hard cuts, cross-dissolves and fades to / from black with precision and recall >= 0.9", async () => {
    const clip = mixedClip();
    const result = await detect(clip);
    const tol = 3 / FPS;

    const cuts: Score = { tp: 0, fp: 0, fn: 0 };
    tally(result.cuts.map((c) => c.time), clip.truth.cuts, 1.5 / FPS, cuts);
    const dissolves: Score = { tp: 0, fp: 0, fn: 0 };
    tally(result.dissolves.map((d) => (d.start + d.end) / 2), clip.truth.dissolves.map(([s, e]) => (s + e) / 2), tol, dissolves);
    const fades: Score = { tp: 0, fp: 0, fn: 0 };
    tally(result.fades.map((x) => (x.start + x.end) / 2), clip.truth.fades.map((x) => (x.start + x.end) / 2), tol, fades);

    for (const [name, s] of [["cuts", cuts], ["dissolves", dissolves], ["fades", fades]] as const) {
      expect(precision(s), `${name} precision`).toBeGreaterThanOrEqual(0.9);
      expect(recall(s), `${name} recall`).toBeGreaterThanOrEqual(0.9);
    }
    expect(result.cuts).toHaveLength(2);
    expect(result.dissolves).toHaveLength(2);
    expect(result.fades).toHaveLength(2);
  });

  it("reports dissolve and fade ranges within 3 frames of the truth", async () => {
    const clip = mixedClip();
    const result = await detect(clip);
    const within = 3 / FPS + 1e-9;
    clip.truth.dissolves.forEach(([start, end], i) => {
      expect(Math.abs(result.dissolves[i].start - start)).toBeLessThanOrEqual(within);
      expect(Math.abs(result.dissolves[i].end - end)).toBeLessThanOrEqual(within);
    });
    clip.truth.fades.forEach((truth, i) => {
      expect(result.fades[i].direction).toBe(truth.direction);
      expect(Math.abs(result.fades[i].start - truth.start)).toBeLessThanOrEqual(within);
      expect(Math.abs(result.fades[i].end - truth.end)).toBeLessThanOrEqual(within);
    });
  });

  it("places hard cuts on the exact frame", async () => {
    const clip = mixedClip();
    const result = await detect(clip);
    clip.truth.cuts.forEach((t, i) => expect(result.cuts[i].time).toBeCloseTo(t, 6));
  });

  it("merges a fade out and fade in through black into one edit at the middle of the black", async () => {
    const clip = mixedClip();
    const result = await detect(clip);
    const through = result.edits.filter((e) => e.kind === "fade-through-black");
    expect(through).toHaveLength(1);
    expect(Math.abs(through[0].time - (13 + 20 / FPS + 6 / FPS))).toBeLessThanOrEqual(3 / FPS);
    expect(result.edits.map((e) => e.kind)).toEqual(["cut", "dissolve", "fade-through-black", "cut", "dissolve"]);
    expect(result.edits.map((e) => e.time)).toEqual([...result.edits.map((e) => e.time)].sort((a, b) => a - b));
  });

  it("holds up across several layouts: long dissolves, short fades and slow fades", async () => {
    const layouts: Segment[][] = [
      [
        { type: "scene", scene: 0, frames: 90 },
        { type: "dissolve", from: 0, to: 1, frames: 45 },
        { type: "scene", scene: 1, frames: 90 },
        { type: "fadeOut", scene: 1, frames: 60 },
        { type: "black", frames: 20 },
      ],
      [
        { type: "fadeIn", scene: 2, frames: 24 },
        { type: "scene", scene: 2, frames: 80 },
        { type: "scene", scene: 5, frames: 80 },
        { type: "dissolve", from: 5, to: 3, frames: 9 },
        { type: "scene", scene: 3, frames: 90 },
      ],
      [
        { type: "scene", scene: 1, frames: 100 },
        { type: "scene", scene: 4, frames: 100 },
        { type: "scene", scene: 2, frames: 100 },
        { type: "scene", scene: 0, frames: 100 },
      ],
    ];
    const cuts: Score = { tp: 0, fp: 0, fn: 0 };
    const gradual: Score = { tp: 0, fp: 0, fn: 0 };
    let worstRange = 0;
    for (const layout of layouts) {
      const clip = buildClip(layout);
      const result = await detect(clip);
      tally(result.cuts.map((c) => c.time), clip.truth.cuts, 1.5 / FPS, cuts);
      const found = [
        ...result.dissolves.map((d) => ({ start: d.start, end: d.end })),
        ...result.fades.map((x) => ({ start: x.start, end: x.end })),
      ];
      const truth = [
        ...clip.truth.dissolves.map(([start, end]) => ({ start, end })),
        ...clip.truth.fades.map((x) => ({ start: x.start, end: x.end })),
      ];
      tally(found.map((x) => (x.start + x.end) / 2), truth.map((x) => (x.start + x.end) / 2), 3 / FPS, gradual);
      for (const t of truth) {
        const match = found.find((x) => Math.abs((x.start + x.end) / 2 - (t.start + t.end) / 2) <= 3 / FPS);
        if (match) worstRange = Math.max(worstRange, Math.abs(match.start - t.start), Math.abs(match.end - t.end));
      }
    }
    expect(precision(cuts)).toBeGreaterThanOrEqual(0.9);
    expect(recall(cuts)).toBeGreaterThanOrEqual(0.9);
    expect(precision(gradual)).toBeGreaterThanOrEqual(0.9);
    expect(recall(gradual)).toBeGreaterThanOrEqual(0.9);
    expect(worstRange).toBeLessThanOrEqual(3 / FPS + 1e-9);
  });

  it("does not report camera-like motion inside one shot as a transition", async () => {
    const clip = buildClip([{ type: "scene", scene: 2, frames: 300 }], { motion: true });
    const result = await detect(clip);
    expect(result.cuts).toHaveLength(0);
    expect(result.dissolves).toHaveLength(0);
    expect(result.fades).toHaveLength(0);
  });

  it("can switch dissolves or fades off", async () => {
    const clip = mixedClip();
    const noDissolve = await detectSceneTransitions({ sampler: clip.sampler, startTime: 0, endTime: clip.seconds - 1 / FPS, frameRate: FPS, detectDissolves: false });
    expect(noDissolve.dissolves).toHaveLength(0);
    expect(noDissolve.fades).toHaveLength(2);
    const noFades = await detectSceneTransitions({ sampler: clip.sampler, startTime: 0, endTime: clip.seconds - 1 / FPS, frameRate: FPS, detectFades: false });
    expect(noFades.fades).toHaveLength(0);
    expect(noFades.dissolves).toHaveLength(2);
  });

  it("is abortable and reports progress up to 1", async () => {
    const clip = mixedClip();
    const progress: number[] = [];
    await detectSceneTransitions({ sampler: clip.sampler, startTime: 0, endTime: clip.seconds - 1 / FPS, frameRate: FPS, onProgress: (p) => progress.push(p.fraction) });
    expect(progress[progress.length - 1]).toBeCloseTo(1, 5);
    const controller = new AbortController();
    const run = detectSceneTransitions({ sampler: async (t) => { controller.abort(); return clip.sampler(t); }, startTime: 0, endTime: 10, frameRate: FPS, signal: controller.signal });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("scene detection worker protocol", () => {
  const channel = () => {
    const { port1, port2 } = new MessageChannel();
    serveSceneDetection(port1 as unknown as MessagePortLike);
    return { worker: port2 as unknown as MessagePortLike, close: () => { port1.close(); port2.close(); } };
  };

  it("runs the analysis behind a message channel and returns the same result", async () => {
    const clip = mixedClip();
    const direct = await detect(clip);
    const { worker, close } = channel();
    const progress: number[] = [];
    const viaWorker = await detectSceneTransitionsInWorker({
      port: worker,
      sampler: clip.sampler,
      options: { startTime: 0, endTime: clip.seconds - 1 / FPS, frameRate: FPS },
      onProgress: (p) => progress.push(p.fraction),
    });
    close();
    expect(viaWorker).toEqual(direct);
    expect(progress.length).toBeGreaterThan(5);
  });

  it("aborts through the signal and rejects with an AbortError", async () => {
    const clip = mixedClip();
    const { worker, close } = channel();
    const controller = new AbortController();
    let served = 0;
    const run = detectSceneTransitionsInWorker({
      port: worker,
      sampler: async (t) => {
        if (++served === 5) controller.abort();
        return clip.sampler(t);
      },
      options: { startTime: 0, endTime: clip.seconds - 1 / FPS, frameRate: FPS },
      signal: controller.signal,
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    close();
  });
});
