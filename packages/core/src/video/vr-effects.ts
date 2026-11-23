/**
 * Premiere "Immersive Video" (VR / 360) effects for equirectangular footage: VR Rotate Sphere, VR Projection
 * (Reframe to flat, little planet, fisheye), VR Blur and VR Plane to Sphere. They plug into the pro effects library
 * (pro-effects.ts) next to the wave 7 batch, so specs, neutral values, keyframes, the inspector and the agent
 * schemas come for free. Everything an effect needs lives here:
 *
 *  - VR_PRO_EFFECT_SPECS: labels, ranges, defaults, neutral values (every effect is an exact no-op when neutral).
 *    The three angle parameters are keyframable and flagged `wrap: 360`, so keyframes interpolate along the shorter arc.
 *  - applyVrEffect: the pure CPU reference (the software fallback and the reference of the GLSL in
 *    vr-effect-shaders.ts). The geometry itself is in vr/vr-math.ts.
 *  - vrEffectGpuUniforms: the single mapping from stored params to shader uniforms (rotation matrices are built once,
 *    here, for both paths).
 */
import {
  IDENTITY3,
  VR_LAYOUT_FLAGS,
  apply3,
  cameraRotation,
  contentRotation,
  dirFromEquirect,
  equirectFromDir,
  eyeRect,
  fitRect,
  sampleEquirect,
  sampleEquirectPremult,
  sampleSpherePixel,
  transpose3,
  viewDirection,
  type EyeRect,
  type Mat3,
  type ViewProjection,
  type VrFrameLayout,
} from "../vr/vr-math";
import type { ResolvedProParams } from "./pro-effects";

import {
  VR_BLUR_MAX_SAMPLES,
  isVrNeutral,
  isVrProEffectType,
  normalizeVrParams,
  type VrProEffectType,
} from "./vr-effect-specs";

// The spec half (types, labels, defaults, neutral test) is re-exported so this module stays the one place to import
// everything about the VR effects from; the app's startup code imports vr-effect-specs.ts instead.
export {
  VR_BLUR_MAX_DEGREES,
  VR_BLUR_MAX_SAMPLES,
  VR_EFFECTS_WRITING_ALPHA,
  VR_PRO_EFFECT_SPECS,
  VR_PRO_EFFECT_TYPES,
  isVrNeutral,
  isVrProEffectType,
  normalizeVrParams,
  withVrSequenceLayout,
  type VrProEffectType,
} from "./vr-effect-specs";

const VR_BLUR_MIN_COS = 0.05;
const n = (p: ResolvedProParams, key: string): number => p[key] as number;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const layoutOf = (p: ResolvedProParams): VrFrameLayout => {
  const v = p.layout;
  return v === "over-under" || v === "side-by-side" ? v : "mono";
};

/** Disc sample count of VR Blur for a radius in pixels (shared by CPU and GPU). */
export function vrBlurSampleCount(radiusPx: number): number {
  return Math.min(VR_BLUR_MAX_SAMPLES, Math.max(16, Math.ceil(radiusPx * 2) + 8));
}
const GOLDEN_ANGLE = 2.399963229728653;

/** Blur radius in pixels at the equator of an eye of the given width. */
export function vrBlurRadiusPx(degrees: number, eyeWidth: number): number {
  return (degrees / 360) * eyeWidth;
}

const PROJECTION_MODES: Readonly<Record<string, ViewProjection | undefined>> = {
  rectilinear: "rectilinear",
  stereographic: "stereographic",
  fisheye: "fisheye",
};

/** Field of view limit of each projection (a rectilinear view cannot reach 180 degrees). */
export function vrProjectionFov(mode: string, fov: number): number {
  return mode === "rectilinear" ? Math.min(fov, 170) : fov;
}

/** The matrix the shader applies to a direction, and the flags it needs, for each effect. */
export function vrEffectMatrix(type: VrProEffectType, p: ResolvedProParams): Mat3 {
  switch (type) {
    case "vr-rotate-sphere":
      return transpose3(contentRotation(n(p, "pan"), n(p, "tilt"), n(p, "roll")));
    case "vr-projection":
      return cameraRotation(n(p, "pan"), n(p, "tilt"), n(p, "roll"));
    case "vr-plane-to-sphere":
      return transpose3(cameraRotation(n(p, "pan"), n(p, "tilt"), n(p, "roll")));
    case "vr-blur":
      return IDENTITY3;
  }
}

/* -------------------------------------------------------------------------- */
/* CPU reference                                                               */
/* -------------------------------------------------------------------------- */

function put(data: Uint8ClampedArray, o: number, px: readonly number[]): void {
  data[o] = Math.round(px[0]);
  data[o + 1] = Math.round(px[1]);
  data[o + 2] = Math.round(px[2]);
  data[o + 3] = Math.round(px[3]);
}

function eyeCount(layout: VrFrameLayout): number {
  return layout === "mono" ? 1 : 2;
}

function rotateSphere(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  layout: VrFrameLayout,
  m: Mat3,
): void {
  const src = new Uint8ClampedArray(data);
  const px = [0, 0, 0, 0];
  for (let e = 0; e < eyeCount(layout); e++) {
    const r = eyeRect(layout, e as 0 | 1, width, height);
    const sinLon = new Float64Array(r.w);
    const cosLon = new Float64Array(r.w);
    for (let x = 0; x < r.w; x++) {
      const lon = ((x + 0.5) / r.w - 0.5) * 2 * Math.PI;
      sinLon[x] = Math.sin(lon);
      cosLon[x] = Math.cos(lon);
    }
    for (let y = 0; y < r.h; y++) {
      const lat = (0.5 - (y + 0.5) / r.h) * Math.PI;
      const cl = Math.cos(lat);
      const sl = Math.sin(lat);
      for (let x = 0; x < r.w; x++) {
        const dx = cl * sinLon[x];
        const dz = cl * cosLon[x];
        const sx = m[0] * dx + m[1] * sl + m[2] * dz;
        const sy = m[3] * dx + m[4] * sl + m[5] * dz;
        const sz = m[6] * dx + m[7] * sl + m[8] * dz;
        const { u, v } = equirectFromDir([sx, sy, sz]);
        sampleEquirect(src, width, r, u, v, px);
        put(data, ((r.y + y) * width + r.x + x) * 4, px);
      }
    }
  }
}

function projectView(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  layout: VrFrameLayout,
  mode: ViewProjection,
  fov: number,
  aspectParam: number,
  cam: Mat3,
): void {
  const src = new Uint8ClampedArray(data);
  const source = eyeRect(layout, 0, width, height);
  const rect = fitRect(width, height, aspectParam);
  const aspect = rect.w / rect.h;
  const px = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = (x + 0.5 - rect.x) / rect.w;
      const t = (y + 0.5 - rect.y) / rect.h;
      const vd = s < 0 || s > 1 || t < 0 || t > 1 ? null : viewDirection(mode, s, t, fov, aspect);
      if (!vd) {
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
        continue;
      }
      const w = apply3(cam, vd);
      const { u, v } = equirectFromDir(w);
      sampleEquirect(src, width, source, u, v, px);
      put(data, o, px);
    }
  }
}

function vrBlur(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  layout: VrFrameLayout,
  degrees: number,
): void {
  const src = new Uint8ClampedArray(data);
  const px = [0, 0, 0, 0];
  const acc = [0, 0, 0, 0];
  for (let e = 0; e < eyeCount(layout); e++) {
    const r = eyeRect(layout, e as 0 | 1, width, height);
    const radius = vrBlurRadiusPx(degrees, r.w);
    const count = vrBlurSampleCount(radius);
    for (let y = 0; y < r.h; y++) {
      const lat = (0.5 - (y + 0.5) / r.h) * Math.PI;
      const hscale = 1 / Math.max(Math.cos(lat), VR_BLUR_MIN_COS);
      for (let x = 0; x < r.w; x++) {
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        for (let i = 0; i < count; i++) {
          const rho = radius * Math.sqrt((i + 0.5) / count);
          const th = i * GOLDEN_ANGLE;
          sampleSpherePixel(src, width, r, x + rho * Math.cos(th) * hscale, y + rho * Math.sin(th), px);
          acc[0] += px[0];
          acc[1] += px[1];
          acc[2] += px[2];
          acc[3] += px[3];
        }
        put(data, ((r.y + y) * width + r.x + x) * 4, [acc[0] / count, acc[1] / count, acc[2] / count, acc[3] / count]);
      }
    }
  }
}

/** Flat image sampled over the sphere: where the plane is, the pixel of the plane, else transparent. */
export function planeUv(
  d: readonly [number, number, number],
  widthDeg: number,
  aspect: number,
): { s: number; t: number } | null {
  if (d[2] <= 1e-6) return null;
  const k = Math.tan((widthDeg * Math.PI) / 360);
  const s = 0.5 + d[0] / d[2] / (2 * k);
  const t = 0.5 - (d[1] / d[2]) / (2 * (k / aspect));
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  return { s, t };
}

function planeToSphere(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  widthDeg: number,
  inv: Mat3,
): void {
  const src = new Uint8ClampedArray(data);
  const whole: EyeRect = { x: 0, y: 0, w: width, h: height };
  const aspect = width / height;
  const px = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const d = apply3(inv, dirFromEquirect((x + 0.5) / width, (y + 0.5) / height));
      const uv = planeUv(d, widthDeg, aspect);
      if (!uv) {
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
        continue;
      }
      sampleFlatPremult(src, width, whole, uv.s, uv.t, px);
      put(data, o, px);
    }
  }
}

/** Alpha-weighted bilinear sample of a flat image (clamped at the edges). */
export function sampleFlatPremult(
  data: Uint8ClampedArray,
  width: number,
  rect: EyeRect,
  s: number,
  t: number,
  out: number[],
): void {
  // Clamping u into the open range avoids the horizontal wrap of the equirect sampler.
  const half = 0.5 / rect.w;
  sampleEquirectPremult(data, width, rect, clamp(s, half, 1 - half), t, out);
}

export function applyVrEffect(
  type: string,
  resolved: ResolvedProParams,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  if (!isVrProEffectType(type)) return false;
  if (isVrNeutral(type, resolved)) return true;
  const p = normalizeVrParams(type, resolved);
  const layout = layoutOf(p);
  switch (type) {
    case "vr-rotate-sphere":
      rotateSphere(data, width, height, layout, vrEffectMatrix(type, p));
      break;
    case "vr-projection": {
      const mode = p.mode as string;
      const projection = PROJECTION_MODES[mode];
      if (projection) {
        projectView(data, width, height, layout, projection, vrProjectionFov(mode, n(p, "fov")), n(p, "aspect"), vrEffectMatrix(type, p));
      }
      break;
    }
    case "vr-blur":
      vrBlur(data, width, height, layout, n(p, "radius"));
      break;
    case "vr-plane-to-sphere":
      planeToSphere(data, width, height, n(p, "width"), vrEffectMatrix(type, p));
      break;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* GPU uniform mapping                                                         */
/* -------------------------------------------------------------------------- */

const MATRIX_UNIFORMS = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"] as const;

/** Uniform names (without `u_`) each VR shader consumes. */
export const VR_UNIFORMS: Readonly<Record<VrProEffectType, readonly string[]>> = {
  "vr-rotate-sphere": ["layout", ...MATRIX_UNIFORMS],
  "vr-projection": ["layout", "projection", "fov", "aspect", ...MATRIX_UNIFORMS],
  "vr-blur": ["layout", "degrees"],
  "vr-plane-to-sphere": ["kTan", ...MATRIX_UNIFORMS],
};

const matrixUniforms = (m: Mat3): Record<string, number> =>
  Object.fromEntries(MATRIX_UNIFORMS.map((name, i) => [name, m[i]]));

export function vrEffectGpuUniforms(type: VrProEffectType, resolved: ResolvedProParams): Record<string, number> {
  const p = normalizeVrParams(type, resolved);
  const layout = VR_LAYOUT_FLAGS[layoutOf(p)];
  switch (type) {
    case "vr-rotate-sphere":
      return { layout, ...matrixUniforms(vrEffectMatrix(type, p)) };
    case "vr-projection": {
      const mode = p.mode as string;
      const projection = mode === "stereographic" ? 1 : mode === "fisheye" ? 2 : 0;
      return {
        layout,
        projection,
        fov: vrProjectionFov(mode, n(p, "fov")),
        aspect: n(p, "aspect"),
        ...matrixUniforms(vrEffectMatrix(type, p)),
      };
    }
    case "vr-blur":
      return { layout, degrees: n(p, "radius") };
    case "vr-plane-to-sphere":
      return { kTan: Math.tan((n(p, "width") * Math.PI) / 360), ...matrixUniforms(vrEffectMatrix(type, p)) };
  }
}

