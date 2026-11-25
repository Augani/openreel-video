import { describe, expect, it } from "vitest";
import { maskPathAtTime, type BezierPath, type MaskKeyframe } from "../mask-engine";
import { simplifyMaskKeyframes } from "./simplify";

const W = 1920;
const H = 1080;
const FPS = 30;
const FRAMES = 600;

/** A 32-point outline of an ellipse that drifts, bobs and breathes: a smooth track with a little sub-pixel jitter. */
function pathAt(frame: number): BezierPath {
  const cx = 0.5 + 0.1 * Math.sin((2 * Math.PI * frame) / 400);
  const cy = 0.5 + 0.08 * Math.sin((2 * Math.PI * frame) / 250 + 1);
  const r = 0.1 + 0.015 * Math.sin((2 * Math.PI * frame) / 220);
  const jitter = 0.1 / W;
  const points = Array.from({ length: 32 }, (_, i) => {
    const a = (2 * Math.PI * i) / 32;
    const noise = jitter * Math.sin(frame * 12.9898 + i * 78.233);
    return { x: cx + r * Math.cos(a) * (H / W) + noise, y: cy + r * Math.sin(a) };
  });
  return { closed: true, points };
}

const track = (): MaskKeyframe[] => Array.from({ length: FRAMES }, (_, f) => ({ id: `k${f}`, time: f / FPS, path: pathAt(f), easing: "linear" as const }));

function shapeError(original: readonly MaskKeyframe[], simplified: readonly MaskKeyframe[]): number {
  let worst = 0;
  for (const key of original) {
    const rebuilt = maskPathAtTime({ path: simplified[0].path, keyframes: [...simplified] }, key.time);
    key.path.points.forEach((p, i) => {
      worst = Math.max(worst, Math.hypot((p.x - rebuilt.points[i].x) * W, (p.y - rebuilt.points[i].y) * H));
    });
  }
  return worst;
}

describe("tracked keyframe simplification", () => {
  it("reduces a 600-frame track at least 5x with every outline point within 1 px", () => {
    const original = track();
    const simplified = simplifyMaskKeyframes(original, { tolerance: 1, width: W, height: H });
    expect(original.length / simplified.length).toBeGreaterThanOrEqual(5);
    expect(shapeError(original, simplified)).toBeLessThanOrEqual(1 + 1e-9);
    expect(simplified[0].time).toBe(original[0].time);
    expect(simplified.at(-1)!.time).toBe(original.at(-1)!.time);
  });

  it("a tighter tolerance keeps more keyframes and a looser one fewer", () => {
    const original = track();
    const tight = simplifyMaskKeyframes(original, { tolerance: 0.5, width: W, height: H });
    const loose = simplifyMaskKeyframes(original, { tolerance: 4, width: W, height: H });
    expect(tight.length).toBeGreaterThan(loose.length);
    expect(shapeError(original, loose)).toBeLessThanOrEqual(4 + 1e-9);
  });

  it("tolerance 0 keeps every keyframe, and a hand-eased track is left alone", () => {
    const original = track().slice(0, 40);
    expect(simplifyMaskKeyframes(original, { tolerance: 0, width: W, height: H })).toHaveLength(40);
    const eased = original.map((k, i) => (i === 5 ? { ...k, easing: "ease-in" as const } : k));
    expect(simplifyMaskKeyframes(eased, { tolerance: 3, width: W, height: H })).toHaveLength(40);
  });

  it("keeps a sharp change of direction", () => {
    const keys: MaskKeyframe[] = Array.from({ length: 41 }, (_, f) => {
      const x = f <= 20 ? f * 0.01 : 0.2 - (f - 20) * 0.01;
      return { id: `k${f}`, time: f / FPS, easing: "linear" as const, path: { closed: true, points: [{ x, y: 0.5 }, { x: x + 0.1, y: 0.5 }, { x: x + 0.05, y: 0.6 }] } };
    });
    const simplified = simplifyMaskKeyframes(keys, { tolerance: 1, width: W, height: H });
    expect(simplified.map((k) => k.id)).toEqual(["k0", "k20", "k40"]);
  });
});
