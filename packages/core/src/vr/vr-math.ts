/**
 * Spherical (360 / VR) geometry shared by the CPU reference of the VR effects, the monitor VR view, the
 * Reframe-to-flat export path and the tests. The GLSL ports in `video/vr-effect-shaders.ts` follow the same
 * definitions line for line.
 *
 * Conventions
 *  - Equirectangular frame: u = (x + 0.5) / width runs left to right, v = (y + 0.5) / height top to bottom.
 *    longitude (yaw) = (u - 0.5) * 2 pi, latitude (pitch) = (0.5 - v) * pi, so the frame centre is "straight ahead".
 *  - Directions are unit vectors with x to the right, y up, z straight ahead:
 *    d = (cos(lat) sin(lon), sin(lat), cos(lat) cos(lon)).
 *  - Rotate Sphere rotates the CONTENT. Pan > 0 moves content to the right (yaw increases), tilt > 0 moves content
 *    up, roll > 0 turns the picture clockwise. Angles are applied pan, then tilt, then roll.
 *  - A reframing camera (monitor VR view, VR Projection) is the dual: pan > 0 looks right, tilt > 0 looks up and
 *    roll > 0 turns the picture clockwise.
 *  - Sampling wraps horizontally (the 0/360 seam is not an edge) and clamps vertically. Stereo frames are two
 *    independent equirect images (over/under: top = left eye, side-by-side: left = left eye).
 */

import { VR_LAYOUT_FLAGS, fitRect, wrapDegrees, type EyeRect, type VrFrameLayout } from "./vr-layout";

export { VR_LAYOUT_FLAGS, fitRect, wrapDegrees, type EyeRect, type VrFrameLayout };

export type Vec3 = readonly [number, number, number];
/** Row-major 3x3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];


const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    }
  }
  return o as unknown as Mat3;
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Rotation about the vertical axis; maps yaw L to L + a. */
export function rotY(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
/** Rotation about the horizontal axis (positive a tilts +z towards -y). */
export function rotX(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
/** Rotation about the view axis (positive a is counter-clockwise on screen). */
export function rotZ(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Interpolates between two angles (degrees) along the shorter arc. Returns an unwrapped value. */
export function lerpAngleShortest(a: number, b: number, t: number): number {
  const delta = wrapDegrees(b - a);
  return a + delta * t;
}

/** Content rotation of Rotate Sphere (degrees): pan, then tilt, then roll. */
export function contentRotation(panDeg: number, tiltDeg: number, rollDeg: number): Mat3 {
  return mul3(rotZ(-rollDeg * DEG), mul3(rotX(-tiltDeg * DEG), rotY(panDeg * DEG)));
}

/** Camera orientation (degrees): view direction -> world direction. */
export function cameraRotation(panDeg: number, tiltDeg: number, rollDeg: number): Mat3 {
  return mul3(rotY(panDeg * DEG), mul3(rotX(-tiltDeg * DEG), rotZ(rollDeg * DEG)));
}

/** Direction at normalised equirect coordinates (u, v in 0-1). */
export function dirFromEquirect(u: number, v: number): Vec3 {
  const lon = (u - 0.5) * TWO_PI;
  const lat = (0.5 - v) * Math.PI;
  const cl = Math.cos(lat);
  return [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)];
}

/** Normalised equirect coordinates of a direction; u is in [0, 1], v in [0, 1]. */
export function equirectFromDir(d: Vec3): { u: number; v: number } {
  const y = d[1] > 1 ? 1 : d[1] < -1 ? -1 : d[1];
  return { u: 0.5 + Math.atan2(d[0], d[2]) / TWO_PI, v: 0.5 - Math.asin(y) / Math.PI };
}

/** Longitude / latitude (degrees) of a direction: yaw to the right, pitch up. */
export function yawPitchFromDir(d: Vec3): { yaw: number; pitch: number } {
  return {
    yaw: (Math.atan2(d[0], d[2]) * 180) / Math.PI,
    pitch: (Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI,
  };
}

export function dirFromYawPitch(yawDeg: number, pitchDeg: number): Vec3 {
  const lon = yawDeg * DEG;
  const lat = pitchDeg * DEG;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

/* -------------------------------------------------------------------------- */
/* Frame layout                                                                */
/* -------------------------------------------------------------------------- */


/** The pixel rectangle of one eye (0 = left, 1 = right). Mono frames have a single full-frame eye. */
export function eyeRect(layout: VrFrameLayout, eye: 0 | 1, width: number, height: number): EyeRect {
  if (layout === "over-under") {
    const h = Math.floor(height / 2);
    return eye === 0 ? { x: 0, y: 0, w: width, h } : { x: 0, y: h, w: width, h: height - h };
  }
  if (layout === "side-by-side") {
    const w = Math.floor(width / 2);
    return eye === 0 ? { x: 0, y: 0, w, h: height } : { x: w, y: 0, w: width - w, h: height };
  }
  return { x: 0, y: 0, w: width, h: height };
}

/** Which eye a pixel belongs to. */
export function eyeOfPixel(layout: VrFrameLayout, x: number, y: number, width: number, height: number): 0 | 1 {
  if (layout === "over-under") return y >= Math.floor(height / 2) ? 1 : 0;
  if (layout === "side-by-side") return x >= Math.floor(width / 2) ? 1 : 0;
  return 0;
}

/* -------------------------------------------------------------------------- */
/* Sampling                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Bilinear sample of an equirect eye image at normalised (u, v): horizontal wrap inside the eye rectangle, vertical
 * clamp. `out` receives straight-alpha RGBA in 0-255.
 */
export function sampleEquirect(
  data: Uint8ClampedArray,
  width: number,
  rect: EyeRect,
  u: number,
  v: number,
  out: number[],
): void {
  const sx = u * rect.w - 0.5;
  const sy = v * rect.h - 0.5;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = sx - x0;
  const ty = sy - y0;
  const xa = (((x0 % rect.w) + rect.w) % rect.w) + rect.x;
  const xb = ((((x0 + 1) % rect.w) + rect.w) % rect.w) + rect.x;
  const ya = Math.min(rect.h - 1, Math.max(0, y0)) + rect.y;
  const yb = Math.min(rect.h - 1, Math.max(0, y0 + 1)) + rect.y;
  const ia = (ya * width + xa) * 4;
  const ib = (ya * width + xb) * 4;
  const ic = (yb * width + xa) * 4;
  const id = (yb * width + xb) * 4;
  for (let ch = 0; ch < 4; ch++) {
    const top = data[ia + ch] * (1 - tx) + data[ib + ch] * tx;
    const bottom = data[ic + ch] * (1 - tx) + data[id + ch] * tx;
    out[ch] = top * (1 - ty) + bottom * ty;
  }
}

/** Same as `sampleEquirect` but interpolates colour weighted by alpha (for plane-to-sphere overlays). */
export function sampleEquirectPremult(
  data: Uint8ClampedArray,
  width: number,
  rect: EyeRect,
  u: number,
  v: number,
  out: number[],
): void {
  const sx = u * rect.w - 0.5;
  const sy = v * rect.h - 0.5;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = sx - x0;
  const ty = sy - y0;
  const xs = [
    (((x0 % rect.w) + rect.w) % rect.w) + rect.x,
    ((((x0 + 1) % rect.w) + rect.w) % rect.w) + rect.x,
  ];
  const ys = [Math.min(rect.h - 1, Math.max(0, y0)) + rect.y, Math.min(rect.h - 1, Math.max(0, y0 + 1)) + rect.y];
  const wts = [
    (1 - tx) * (1 - ty),
    tx * (1 - ty),
    (1 - tx) * ty,
    tx * ty,
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let k = 0; k < 4; k++) {
    const i = (ys[k >> 1] * width + xs[k & 1]) * 4;
    const al = data[i + 3] * wts[k];
    r += data[i] * al;
    g += data[i + 1] * al;
    b += data[i + 2] * al;
    a += al;
  }
  out[0] = a > 0 ? r / a : 0;
  out[1] = a > 0 ? g / a : 0;
  out[2] = a > 0 ? b / a : 0;
  out[3] = a;
}

/**
 * Sample at a (possibly out of range) equirect pixel position with seam wrap and pole reflection, in the pixel units
 * of the eye rectangle. Used by VR Blur: stepping over a pole continues on the opposite meridian.
 */
export function sampleSpherePixel(
  data: Uint8ClampedArray,
  width: number,
  rect: EyeRect,
  px: number,
  py: number,
  out: number[],
): void {
  let x = px;
  let y = py;
  // Reflect over the poles: row -0.5 is the north pole edge, row h - 0.5 the south pole edge.
  const period = rect.h * 2;
  y = ((y + 0.5) % period + period) % period;
  let flip = false;
  if (y >= rect.h) {
    y = period - y;
    flip = true;
  } else if (y < 0) {
    y = -y;
    flip = true;
  }
  y -= 0.5;
  if (flip) x += rect.w / 2;
  const u = (x + 0.5) / rect.w;
  const v = (y + 0.5) / rect.h;
  sampleEquirect(data, width, rect, u, v, out);
}

/* -------------------------------------------------------------------------- */
/* Rectilinear (flat) views                                                    */
/* -------------------------------------------------------------------------- */

/** View-space direction of a rectilinear pixel at normalised rect coordinates (s, t in 0-1, top-left origin). */
export function rectilinearViewDir(s: number, t: number, fovDeg: number, aspect: number): Vec3 {
  const k = Math.tan((fovDeg * DEG) / 2);
  const x = (s * 2 - 1) * k;
  const y = (1 - t * 2) * (k / aspect);
  const n = Math.hypot(x, y, 1);
  return [x / n, y / n, 1 / n];
}

/** Stereographic ("little planet") view direction; fov is the angular width of the picture across the shorter-side radius. */
export function stereographicViewDir(s: number, t: number, fovDeg: number, aspect: number): Vec3 {
  const k = 2 * Math.tan((fovDeg * DEG) / 4);
  const x = (s * 2 - 1) * k;
  const y = (1 - t * 2) * (k / aspect);
  const r2 = x * x + y * y;
  // Inverse stereographic projection onto the unit sphere centred on +z.
  const d = 4 + r2;
  return [(4 * x) / d, (4 * y) / d, (4 - r2) / d];
}

/** Equidistant fisheye: radius from the picture centre is proportional to the angle from the axis. */
export function fisheyeViewDir(s: number, t: number, fovDeg: number, aspect: number): Vec3 | null {
  const x = s * 2 - 1;
  const y = (1 - t * 2) / aspect;
  const r = Math.hypot(x, y);
  if (r > 1) return null;
  const theta = r * ((fovDeg * DEG) / 2);
  const sinT = Math.sin(theta);
  const inv = r > 1e-9 ? sinT / r : 0;
  return [x * inv, y * inv, Math.cos(theta)];
}

export type ViewProjection = "rectilinear" | "stereographic" | "fisheye";

export function viewDirection(
  projection: ViewProjection,
  s: number,
  t: number,
  fovDeg: number,
  aspect: number,
): Vec3 | null {
  if (projection === "stereographic") return stereographicViewDir(s, t, fovDeg, aspect);
  if (projection === "fisheye") return fisheyeViewDir(s, t, fovDeg, aspect);
  return rectilinearViewDir(s, t, fovDeg, aspect);
}

/** Vertical field of view (degrees) of a rectilinear view of the given horizontal FOV and aspect. */
export function verticalFov(hFovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((hFovDeg * DEG) / 2) / aspect)) / DEG;
}

/**
 * Renders a flat view of an equirect eye image into `out` (RGBA, `outW` x `outH`), straight CPU reference used by
 * the monitor fallback and the tests. `fitAspect` letterboxes inside the buffer exactly as the VR Projection effect
 * does; pixels outside the rectangle are transparent.
 */
export function renderFlatView(
  src: Uint8ClampedArray,
  srcW: number,
  srcRect: EyeRect,
  out: Uint8ClampedArray,
  outW: number,
  outH: number,
  view: {
    projection: ViewProjection;
    fov: number;
    pan: number;
    tilt: number;
    roll: number;
    aspect: number;
  },
): void {
  const cam = cameraRotation(view.pan, view.tilt, view.roll);
  const rect = fitRect(outW, outH, view.aspect);
  const aspect = rect.w / rect.h;
  const px = [0, 0, 0, 0];
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = (y * outW + x) * 4;
      const s = (x + 0.5 - rect.x) / rect.w;
      const t = (y + 0.5 - rect.y) / rect.h;
      if (s < 0 || s > 1 || t < 0 || t > 1) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
      const vd = viewDirection(view.projection, s, t, view.fov, aspect);
      if (!vd) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
      const { u, v } = equirectFromDir(apply3(cam, vd));
      sampleEquirect(src, srcW, srcRect, u, v, px);
      out[o] = Math.round(px[0]);
      out[o + 1] = Math.round(px[1]);
      out[o + 2] = Math.round(px[2]);
      out[o + 3] = Math.round(px[3]);
    }
  }
}
