import { describe, expect, it } from "vitest";
import { cubeSpinPlan, rasterizePlan } from "./transition-plans";

const A: [number, number, number] = [220, 40, 40];
const B: [number, number, number] = [40, 60, 220];

/** Independent ray cast of a box (motion 1, cross cross/length, depth 1) turned about the cross axis. */
function castCube(p: number, sn: 1 | -1, W: number, H: number, vertical: boolean) {
  const L = vertical ? H : W;
  const C = vertical ? W : H;
  const th = (p * Math.PI) / 2;
  const c = Math.cos(th), s = Math.sin(th);
  const D = 3, f = D - 0.5;
  const dist = f + 0.5 * (c + s); // near corner stays at depth f
  const half = [0.5, 0.5 * C / L, 0.5];
  const out: { color: string; u: number }[] = [];
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const m = ((vertical ? py : px) + 0.5) / L - 0.5;
    const cr = ((vertical ? px : py) + 0.5 - C / 2) / L;
    const dir = [m, cr, f];
    const o = [0, 0, -dist]; // origin relative to centre
    const toLocal = (v: number[]) => [c * v[0] - s * sn * v[2], v[1], s * sn * v[0] + c * v[2]];
    const ol = toLocal(o), dl = toLocal(dir);
    let tmin = -Infinity, tmax = Infinity, entry = -1;
    for (let a = 0; a < 3; a++) {
      const t1 = (-half[a] - ol[a]) / dl[a], t2 = (half[a] - ol[a]) / dl[a];
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      if (lo > tmin) { tmin = lo; entry = a; }
      tmax = Math.min(tmax, hi);
    }
    if (tmin > tmax || tmax < 0) { out.push({ color: "black", u: -1 }); continue; }
    const hit = [0, 1, 2].map((a) => ol[a] + tmin * dl[a]);
    if (entry === 2 && hit[2] < 0) out.push({ color: "A", u: hit[0] + 0.5 });
    else if (entry === 0) out.push({ color: "B", u: sn === 1 ? hit[2] + 0.5 : 0.5 - hit[2] });
    else out.push({ color: "?" , u: -1 });
  }
  return out;
}

/** An independent check of the cube: a ray cast of a turned box against the plan, pixel for pixel, and its texture columns. */
describe("cube spin against an independent ray cast", () => {
  for (const dir of ["left", "right", "up", "down"] as const) {
    for (const p of [0.13, 0.5, 0.5001, 0.61, 0.97]) {
      it(`${dir} ${p}`, () => {
        const W = 320, H = 180;
        const vertical = dir === "up" || dir === "down";
        const sn: 1 | -1 = dir === "right" || dir === "down" ? -1 : 1;
        const ref = castCube(p, sn, W, H, vertical);
        expect(ref.some((r) => r.color === "?")).toBe(false);
        const plan = cubeSpinPlan({ width: W, height: H, progress: p, direction: dir, borderWidth: 0, borderColor: "#fff" });
        const img = rasterizePlan(plan, W, H, { A, B });
        let bad = 0;
        for (let i = 0; i < W * H; i++) {
          const px = [img[i * 3]!, img[i * 3 + 1]!, img[i * 3 + 2]!];
          const got = px.every((v) => v < 2) ? "black" : Math.abs(px[0]! - A[0]) < 3 && Math.abs(px[2]! - A[2]) < 3 ? "A" : Math.abs(px[2]! - B[2]) < 3 && Math.abs(px[0]! - B[0]) < 3 ? "B" : "mix";
          if (got !== ref[i]!.color) bad++;
        }
        // edge pixels only: allow a band of ~2px around boundaries
        const perimeter = 2 * (W + H) * 3;
        expect(bad).toBeLessThan(perimeter);
        // texture mapping: each column's source span contains u of my ray cast (sample middle row / column)
        const L = vertical ? H : W;
        const mid = vertical ? Math.floor(W / 2) : Math.floor(H / 2);
        let uBad = 0, checked = 0;
        for (const layer of plan) {
          if (layer.kind !== "rect" || layer.d[2] === 0 || layer.d[3] === 0) continue;
          const idx = vertical ? layer.d[1] : layer.d[0];
          const cross0 = vertical ? layer.d[0] : layer.d[1];
          const crossSize = vertical ? layer.d[2] : layer.d[3];
          const crossMid = vertical ? mid : mid;
          if (crossMid < cross0 || crossMid >= cross0 + crossSize) continue;
          const r = ref[vertical ? idx * W + mid : mid * W + idx]!;
          if (r.color !== layer.src) { uBad++; continue; }
          const from = (vertical ? layer.s[1] : layer.s[0]) / L;
          const to = from + (vertical ? layer.s[3] : layer.s[2]) / L;
          checked++;
          if (r.u < from - 1.5 / L - 0.01 || r.u > to + 1.5 / L + 0.01) uBad++;
        }
        expect(checked).toBeGreaterThan(20);
        expect(uBad).toBeLessThan(Math.max(4, checked * 0.02));
      });
    }
  }
});
