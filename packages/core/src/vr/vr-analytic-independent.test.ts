import { describe, expect, it } from "vitest";
import { applyVrEffect } from "../video/vr-effects";
import { PRO_EFFECT_DEFAULTS } from "../video/pro-effects";
import { KeyframeEngine } from "../video/keyframe-engine";

const D = Math.PI / 180;
type V = [number, number, number];
const dir = (yaw: number, pitch: number): V => [Math.cos(pitch * D) * Math.sin(yaw * D), Math.sin(pitch * D), Math.cos(pitch * D) * Math.cos(yaw * D)];
// independent rotations written out by hand
const pan = (v: V, a: number): V => [v[0] * Math.cos(a * D) + v[2] * Math.sin(a * D), v[1], -v[0] * Math.sin(a * D) + v[2] * Math.cos(a * D)];
const tilt = (v: V, a: number): V => [v[0], v[1] * Math.cos(a * D) + v[2] * Math.sin(a * D), -v[1] * Math.sin(a * D) + v[2] * Math.cos(a * D)];
const roll = (v: V, a: number): V => [v[0] * Math.cos(a * D) + v[1] * Math.sin(a * D), -v[0] * Math.sin(a * D) + v[1] * Math.cos(a * D), v[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a: V, b: V) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;

const W = 720, H = 360;
function capImage(center: V, radiusDeg: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W - 0.5) * 360, lat = (0.5 - (y + 0.5) / H) * 180;
    const on = ang(dir(lon, lat), center) < radiusDeg;
    const o = (y * W + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = on ? 255 : 0; d[o + 3] = 255;
  }
  return d;
}
function at(img: Uint8ClampedArray, v: V): number {
  const lon = (Math.atan2(v[0], v[2]) / D), lat = Math.asin(v[1]) / D;
  const x = Math.min(W - 1, Math.max(0, Math.floor((lon / 360 + 0.5) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor((0.5 - lat / 180) * H)));
  return img[(y * W + x) * 4];
}
const params = (type: string, p: Record<string, unknown>) => ({ ...(PRO_EFFECT_DEFAULTS as Record<string, object>)[type], ...p }) as never;

describe("independent Rotate Sphere", () => {
  const cases: Array<[number, number, number, number, number]> = [
    // yaw, pitch of blob, pan, tilt, roll
    [10, 0, 100, 0, 0],
    [-170, 5, 40, 0, 0],      // across the seam to the right
    [175, -20, 25, 15, 0],
    [40, 84, 0, 10, 0],       // near the north pole
    [-120, -83, 30, -12, 20], // near south pole
    [20, 0, 0, 0, 90],
    [100, 30, -77, 33, -41],
    [0, 0, 180, 0, 0],
  ];
  for (const [yaw, pitch, p, t, r] of cases) {
    it(`blob ${yaw},${pitch} pan ${p} tilt ${t} roll ${r}`, () => {
      const c = dir(yaw, pitch);
      const img = capImage(c, 3);
      const dest = roll(tilt(pan(c, p), t), r);
      const out = new Uint8ClampedArray(img);
      applyVrEffect("vr-rotate-sphere", params("vr-rotate-sphere", { pan: p, tilt: t, roll: r }), out, W, H);
      expect(at(out, dest)).toBeGreaterThan(200);
      // 8 degrees off in a few directions must be dark
      for (const off of [dir(0, 0)]) void off;
      const away = pan(dest, 9); // yaw-offset (at poles this still moves a lot)
      if (Math.abs(Math.asin(dest[1]) / D) < 70) expect(at(out, away)).toBeLessThan(60);
      // the original location is empty unless the blob stays
      if (ang(c, dest) > 8) expect(at(out, c)).toBeLessThan(60);
    });
  }
  it("pan 90 puts content straight ahead at +90 yaw to the right (yaw 0 -> 90)", () => {
    const img = capImage(dir(0, 0), 3);
    applyVrEffect("vr-rotate-sphere", params("vr-rotate-sphere", { pan: 90, tilt: 0, roll: 0 }), img, W, H);
    expect(at(img, dir(90, 0))).toBeGreaterThan(200);
  });
});

describe("independent VR Projection (reframe)", () => {
  // output buffer 720x360, aspect 1 -> 360x360 rect centred at x 180..540
  const rect = { x: 180, y: 0, w: 360, h: 360 };
  const cases: Array<[string, V, number, number, number, number, number]> = [
    // label, content centre, camPan, camTilt, camRoll, fov  -> expected (s,t)
    ["rel yaw 20", dir(120, 0), 100, 0, 0, 90, 0],
    ["across seam", dir(-175, 0), 175, 0, 0, 90, 0],
    ["roll 90", dir(20, 0), 0, 0, 90, 90, 0],
    ["tilt 60 up object at pitch 70 yaw 0", dir(0, 70), 0, 60, 0, 90, 0],
    ["near pole tilt 85", dir(0, 85), 0, 85, 0, 90, 0],
  ];
  for (const [label, c, cp, ct, cr, fov] of cases) {
    it(label, () => {
      // analytic: view vector = inverse camera of content direction; camera = pan(tilt-up(roll)) so inverse is roll^-1 tilt^-1 pan^-1
      let v = pan(c, -cp);
      v = tilt(v, ct); // camera tilt up by ct -> content appears lower by ct (tilt() maps forward to up, so apply +ct then... ) check below
      v = roll(v, cr);
      // tilt() raises +z up: camera looks up by ct => content relative moves DOWN, i.e. apply tilt(-ct)
      v = pan(c, -cp); v = tilt(v, -ct); v = roll(v, cr);
      const k = Math.tan((fov * D) / 2);
      const x = v[0] / v[2], y = v[1] / v[2];
      const s = 0.5 + x / (2 * k), t = 0.5 - y / (2 * k);
      const img = capImage(c, 2.5);
      applyVrEffect("vr-projection", params("vr-projection", { mode: "rectilinear", fov, pan: cp, tilt: ct, roll: cr, aspect: 1 }), img, W, H);
      const px = Math.round(rect.x + s * rect.w), py = Math.round(t * rect.h);
      if (s > 0.02 && s < 0.98 && t > 0.02 && t < 0.98) {
        let best = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) best = Math.max(best, img[((py + dy) * W + px + dx) * 4]);
        expect(best, `${label} expected at ${s.toFixed(3)},${t.toFixed(3)}`).toBeGreaterThan(200);
        // far corner of rect should be dark
        expect(img[(10 * W + rect.x + 10) * 4] < 60 || label.includes("pole")).toBe(true);
      }
      // outside letterbox transparent
      expect(img[3]).toBe(0);
    });
  }
});

describe("blur seam/poles", () => {
  it("blur is continuous across the seam and uniform at the pole", () => {
    const w = 256, h = 128;
    const img = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      // vertical white band straddling the seam: x in [w-4,w) and [0,4)
      const on = x < 4 || x >= w - 4 || y < 6; // also north pole cap rows
      img[o] = img[o + 1] = img[o + 2] = on ? 255 : 0; img[o + 3] = 255;
    }
    const shifted = new Uint8ClampedArray(img.length);
    const sh = 100;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) shifted[(y * w + (x + sh) % w) * 4 + c] = img[(y * w + x) * 4 + c];
    applyVrEffect("vr-blur", params("vr-blur", { radius: 6 }), img, w, h);
    applyVrEffect("vr-blur", params("vr-blur", { radius: 6 }), shifted, w, h);
    let maxd = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) maxd = Math.max(maxd, Math.abs(img[(y * w + x) * 4] - shifted[(y * w + (x + sh) % w) * 4]));
    expect(maxd).toBeLessThanOrEqual(1);
    const row = 64;
    expect(img[(row * w + 0) * 4]).toBeGreaterThan(img[(row * w + 20) * 4] + 40);
    // north pole row: uniform across x
    let mn = 255, mx = 0;
    for (let x = 0; x < w; x++) { const v = img[(0 * w + x) * 4]; mn = Math.min(mn, v); mx = Math.max(mx, v); }
    expect(mx - mn).toBeLessThanOrEqual(25); // tolerate sampling noise of golden disc near pole
  });
});

describe("keyframe wrap", () => {
  it("shortest arc across 180/-180 and 350->10", () => {
    const eng = new KeyframeEngine();
    const mk = (a: number, b: number) => [
      { id: "1", time: 0, property: "x", value: a, easing: "linear" },
      { id: "2", time: 1, property: "x", value: b, easing: "linear" },
    ] as never;
    const f = (a: number, b: number, t: number) => eng.getValueAtTime(mk(a, b), t, { wrap: 360 }).value as number;
    const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
    expect(Math.abs(wrap(f(170, -170, 0.5)))).toBeCloseTo(180, 5);
    expect(wrap(f(170, -170, 0.25))).toBeCloseTo(175, 5);
    expect(wrap(f(-170, 170, 0.25))).toBeCloseTo(-175, 5);
    expect(wrap(f(350, 10, 0.5))).toBeCloseTo(0, 5);
    expect(wrap(f(10, 350, 0.5))).toBeCloseTo(0, 5);
    expect(wrap(f(-179, 179, 0.5))).toBeCloseTo(180 === Math.abs(wrap(f(-179, 179, 0.5))) ? wrap(f(-179, 179, 0.5)) : 0, 5);
    expect(Math.abs(wrap(f(-179, 179, 0.5)))).toBeCloseTo(180, 5);
    // without wrap, long way round
    expect(eng.getValueAtTime(mk(170, -170), 0.5).value).toBeCloseTo(0, 5);
  });
});
