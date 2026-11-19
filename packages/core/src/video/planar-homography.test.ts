import { describe, expect, it } from "vitest";
import {
  applyHomography, estimateHomography, homographyBetweenQuads, invertHomography, isConvexQuad, multiplyHomography,
  quadArea, ransacHomography, seededRandom, squareToQuad, transformQuad, type Homography, type PointPair, type Pt, type Quad,
} from "./planar-homography";

const TRUTH: Homography = [1.1, 0.12, 14, -0.08, 0.95, -6, 0.0004, -0.0002, 1];
const grid = (n: number): Pt[] => Array.from({ length: n * n }, (_, i) => ({ x: 20 + (i % n) * 31, y: 15 + Math.floor(i / n) * 27 }));
const close = (a: Pt, b: Pt, eps = 1e-6) => { expect(a.x).toBeCloseTo(b.x, 4); expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(eps * 1e3); };

describe("homography estimation", () => {
  it("recovers an exact homography from four points", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
    const h = estimateHomography(pts.map(p => ({ from: p, to: applyHomography(TRUTH, p) })))!;
    expect(h).not.toBeNull();
    for (const p of grid(6)) close(applyHomography(h, p), applyHomography(TRUTH, p));
  });

  it("least squares over noisy points stays within the noise", () => {
    const rand = seededRandom(7);
    const pairs: PointPair[] = grid(8).map(p => { const q = applyHomography(TRUTH, p); return { from: p, to: { x: q.x + (rand() - 0.5), y: q.y + (rand() - 0.5) } }; });
    const h = estimateHomography(pairs)!;
    for (const p of grid(5)) { const a = applyHomography(h, p), b = applyHomography(TRUTH, p); expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.6); }
  });

  it("rejects degenerate input", () => {
    expect(estimateHomography([])).toBeNull();
    const line = [0, 1, 2, 3, 4].map(i => ({ from: { x: i, y: i }, to: { x: i * 2, y: i * 2 } }));
    expect(estimateHomography(line)).toBeNull();
  });

  it("inverts and composes", () => {
    const inv = invertHomography(TRUTH)!;
    const id = multiplyHomography(TRUTH, inv);
    for (const p of grid(4)) close(applyHomography(id, p), p);
    expect(invertHomography([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });

  it("maps quads and the unit square", () => {
    const a: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const b: Quad = [{ x: 3, y: 2 }, { x: 18, y: 4 }, { x: 15, y: 20 }, { x: 1, y: 14 }];
    const h = homographyBetweenQuads(a, b)!;
    transformQuad(h, a).forEach((p, i) => close(p, b[i]));
    const s = squareToQuad(b)!;
    close(applyHomography(s, { x: 1, y: 1 }), b[2]);
    expect(quadArea(a)).toBe(100);
    expect(isConvexQuad(b)).toBe(true);
    expect(isConvexQuad([a[0], a[2], a[1], a[3]])).toBe(false);
  });
});

describe("RANSAC", () => {
  const outliered = (): PointPair[] => {
    const rand = seededRandom(3);
    return grid(9).map((p, i) => i % 4 === 0 ? { from: p, to: { x: rand() * 400, y: rand() * 300 } } : { from: p, to: applyHomography(TRUTH, p) });
  };

  it("finds the model despite 25% gross outliers", () => {
    const pairs = outliered();
    const r = ransacHomography(pairs, { threshold: 1, seed: 5 })!;
    expect(r).not.toBeNull();
    expect(r.inlierCount).toBeGreaterThanOrEqual(pairs.length - Math.ceil(pairs.length / 4) - 1);
    for (const p of grid(5)) close(applyHomography(r.homography, p), applyHomography(TRUTH, p), 1e-4);
    expect(r.rmsError).toBeLessThan(1e-3);
  });

  it("is deterministic for a seed", () => {
    const pairs = outliered();
    expect(ransacHomography(pairs, { seed: 11 })).toEqual(ransacHomography(pairs, { seed: 11 }));
  });

  it("returns null with too few points or no consensus", () => {
    expect(ransacHomography(grid(1).map(p => ({ from: p, to: p })))).toBeNull();
    const rand = seededRandom(9);
    const noise = grid(6).map(p => ({ from: p, to: { x: rand() * 500, y: rand() * 500 } }));
    expect(ransacHomography(noise, { threshold: 0.5, minInliers: 20 })).toBeNull();
  });
});
