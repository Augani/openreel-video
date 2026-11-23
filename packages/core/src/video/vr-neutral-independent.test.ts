import { describe, expect, it } from "vitest";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_SPECS,
  PRO_EFFECT_TYPES,
  applyProEffect,
  isProEffectNeutral,
  proEffectActingParams,
  withProEffectDefaults,
} from "./pro-effects";
import { VR_PRO_EFFECT_TYPES } from "./vr-effects";
import { VR_IMAGE_EFFECT_TYPES } from "./vr-image-effects";
import { smoothSphereImage } from "../vr/vr-test-images";

const eq = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
};

describe("independent: VR neutral defaults", () => {
  for (const [w, h, layout] of [
    [360, 180, "mono"],
    [97, 53, "mono"],
    [120, 120, "over-under"],
    [200, 50, "side-by-side"],
  ] as const) {
    for (const type of [...VR_PRO_EFFECT_TYPES, ...VR_IMAGE_EFFECT_TYPES]) {
      it(`${type} added with defaults leaves ${w}x${h} ${layout} bit-identical`, () => {
        const src = smoothSphereImage(w, h);
        const out = new Uint8ClampedArray(src);
        const params = withProEffectDefaults(type, { layout })!;
        expect(isProEffectNeutral(type, params)).toBe(true);
        applyProEffect(type, params, out, w, h);
        expect(eq(src, out)).toBe(0);
        // and via an empty-params add and via bare defaults
        const out2 = new Uint8ClampedArray(src);
        applyProEffect(type, { ...PRO_EFFECT_DEFAULTS[type] }, out2, w, h);
        expect(eq(src, out2)).toBe(0);
      });
    }
  }

  it("saved pan 30 (JSON round trip) still rotates by 30 degrees on the equator", () => {
    const w = 360, h = 180;
    const src = smoothSphereImage(w, h);
    const stored = JSON.parse(JSON.stringify({ layout: "mono", tilt: 0, pan: 30, roll: 0 }));
    expect(isProEffectNeutral("vr-rotate-sphere", stored)).toBe(false);
    const out = new Uint8ClampedArray(src);
    applyProEffect("vr-rotate-sphere", withProEffectDefaults("vr-rotate-sphere", stored)!, out, w, h);
    expect(eq(src, out)).toBeGreaterThan(20);
    const row = 90;
    const rowDiff = (shift: number) => {
      let d = 0;
      for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
        const o = (row * w + x) * 4 + c;
        const s = (row * w + (((x + shift) % w) + w) % w) * 4 + c;
        d = Math.max(d, Math.abs(out[o] - src[s]));
      }
      return d;
    };
    const best = Math.min(rowDiff(30), rowDiff(-30));
    expect(best).toBeLessThan(6);
    expect(Math.max(rowDiff(0), rowDiff(60 * 0 + 90))).toBeGreaterThan(best);
  });

  it("old saved VR Projection rectilinear, Blur radius 2, Plane enabled still act", () => {
    const w = 128, h = 64;
    for (const [type, stored] of [
      ["vr-projection", { mode: "rectilinear", layout: "mono", fov: 90, pan: 0, tilt: 0, roll: 0, aspect: 16 / 9 }],
      ["vr-blur", { layout: "mono", radius: 2 }],
      ["vr-plane-to-sphere", { width: 60, pan: 0, tilt: 0, roll: 0, enabled: true }],
    ] as const) {
      const src = smoothSphereImage(w, h);
      const out = new Uint8ClampedArray(src);
      applyProEffect(type, JSON.parse(JSON.stringify(stored)), out, w, h);
      expect(eq(src, out), type).toBeGreaterThan(0);
    }
  });

  it("proEffectActingParams is non-neutral, in range, and changes pixels for every VR effect", () => {
    for (const type of [...VR_PRO_EFFECT_TYPES, ...VR_IMAGE_EFFECT_TYPES]) {
      const p = proEffectActingParams(type);
      expect(isProEffectNeutral(type, p), type).toBe(false);
      const src = smoothSphereImage(160, 80);
      const out = new Uint8ClampedArray(src);
      applyProEffect(type, p, out, 160, 80);
      expect(eq(src, out), type).toBeGreaterThan(0);
    }
  });

  it("proEffectActingParams is non-neutral and within range for EVERY pro effect", () => {
    for (const type of PRO_EFFECT_TYPES) {
      const p = proEffectActingParams(type);
      expect(isProEffectNeutral(type, p), type).toBe(false);
      for (const s of PRO_EFFECT_SPECS[type].params) {
        if (s.kind === "number" && s.min !== undefined && s.max !== undefined) {
          const v = p[s.key] as number;
          expect(v, `${type}.${s.key}`).toBeGreaterThanOrEqual(s.min);
          expect(v, `${type}.${s.key}`).toBeLessThanOrEqual(s.max);
        }
      }
    }
  });

  it("non-VR default behaviour unchanged: defaults of non-VR effects are returned as-is when acting", () => {
    for (const type of PRO_EFFECT_TYPES) {
      if ((VR_PRO_EFFECT_TYPES as readonly string[]).includes(type)) continue;
      if ((VR_IMAGE_EFFECT_TYPES as readonly string[]).includes(type)) continue;
      if (!isProEffectNeutral(type, PRO_EFFECT_DEFAULTS[type])) {
        expect(proEffectActingParams(type)).toEqual({ ...PRO_EFFECT_DEFAULTS[type] });
      }
    }
  });
});
