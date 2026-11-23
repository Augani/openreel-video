import type { RGBAFrame } from "../time-interpolation/frame-blend";
import { renderScene, texture, type SceneFn } from "../time-interpolation/synthetic-scenes";

/**
 * Analytic talking-head scenes for the Morph Cut tests and the browser benchmark; nothing in the product imports
 * this file. A textured face-like ellipse (eyes, mouth, a hairline) sits over a static textured wall. The scene
 * parameter s in [0, 1] runs from pose A to pose B linearly in every pose parameter, so the true frame at the
 * midpoint of a jump cut (the thing Morph Cut should produce) is known exactly: render the scene at s = 0.5.
 */
export interface FacePose {
  /** Head centre, fractions of the frame. */
  readonly x: number;
  readonly y: number;
  /** Uniform scale of the head (1 = nominal). */
  readonly scale: number;
  readonly rotationDeg: number;
  /** 0 = eyes open, 1 = closed (a blink: a local change that is not motion). */
  readonly blink: number;
}

export interface CameraPose {
  /** Whole-frame reframe: translation (fractions of the frame), scale and rotation about the centre. */
  readonly tx: number;
  readonly ty: number;
  readonly scale: number;
  readonly rotationDeg: number;
}

export const NEUTRAL_CAMERA: CameraPose = { tx: 0, ty: 0, scale: 1, rotationDeg: 0 };

const lerp = (a: number, b: number, s: number): number => a + (b - a) * s;
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k];

export const HEAD_RX = 0.17;
export const HEAD_RY = 0.3;
/** Eye centres in head coordinates (units of the head radii). */
export const EYES: ReadonlyArray<{ u: number; v: number }> = [
  { u: -0.42, v: -0.18 },
  { u: 0.42, v: -0.18 },
];

/** Where an eye centre is in frame pixels at scene parameter s. */
export function eyePosition(width: number, height: number, a: FacePose, b: FacePose, ca: CameraPose, cb: CameraPose, s: number, eye: 0 | 1): { x: number; y: number } {
  const pose = { x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s), scale: lerp(a.scale, b.scale, s), rot: (lerp(a.rotationDeg, b.rotationDeg, s) * Math.PI) / 180 };
  const e = EYES[eye];
  const lx = e.u * HEAD_RX * width * pose.scale;
  const ly = e.v * HEAD_RY * height * pose.scale;
  const px = pose.x * width + lx * Math.cos(pose.rot) - ly * Math.sin(pose.rot);
  const py = pose.y * height + lx * Math.sin(pose.rot) + ly * Math.cos(pose.rot);
  // camera: the picture is scaled / rotated about the centre then shifted
  const cam = { tx: lerp(ca.tx, cb.tx, s) * width, ty: lerp(ca.ty, cb.ty, s) * height, scale: lerp(ca.scale, cb.scale, s), rot: (lerp(ca.rotationDeg, cb.rotationDeg, s) * Math.PI) / 180 };
  const dx = px - width / 2;
  const dy = py - height / 2;
  return {
    x: width / 2 + cam.tx + cam.scale * (dx * Math.cos(cam.rot) - dy * Math.sin(cam.rot)),
    y: height / 2 + cam.ty + cam.scale * (dx * Math.sin(cam.rot) + dy * Math.cos(cam.rot)),
  };
}

/**
 * `textureScale` multiplies the coordinates of every texture lookup (the textures are defined in pixels): pass
 * 256 / width to get the picture of the 256 px wide test scenes at any size, i.e. the same content at a higher resolution.
 */
export function talkingHead(width: number, height: number, a: FacePose, b: FacePose, ca: CameraPose = NEUTRAL_CAMERA, cb: CameraPose = ca, textureScale = 1): SceneFn {
  const skin: [number, number, number] = [214, 168, 140];
  const dark: [number, number, number] = [24, 22, 30];
  return (x, y, s) => {
    // undo the camera: scene coordinates of this pixel
    const cs = lerp(ca.scale, cb.scale, s);
    const cr = (lerp(ca.rotationDeg, cb.rotationDeg, s) * Math.PI) / 180;
    const ctx = lerp(ca.tx, cb.tx, s) * width;
    const cty = lerp(ca.ty, cb.ty, s) * height;
    let dx = x - width / 2 - ctx;
    let dy = y - height / 2 - cty;
    let sx = (dx * Math.cos(-cr) - dy * Math.sin(-cr)) / cs + width / 2;
    let sy = (dx * Math.sin(-cr) + dy * Math.cos(-cr)) / cs + height / 2;
    // wall
    const wall = texture(sx * textureScale, sy * textureScale, 0.5);
    // head frame
    const hs = lerp(a.scale, b.scale, s);
    const hr = (lerp(a.rotationDeg, b.rotationDeg, s) * Math.PI) / 180;
    dx = sx - lerp(a.x, b.x, s) * width;
    dy = sy - lerp(a.y, b.y, s) * height;
    const lx = (dx * Math.cos(-hr) - dy * Math.sin(-hr)) / hs;
    const ly = (dx * Math.sin(-hr) + dy * Math.cos(-hr)) / hs;
    const u = lx / (HEAD_RX * width);
    const v = ly / (HEAD_RY * height);
    if (u * u + v * v > 1) return wall;
    // skin: tone plus texture that travels with the head
    const tex = texture(lx * textureScale, ly * textureScale, 4.2);
    let colour = mix(skin, tex, 0.45);
    // hairline: darker textured cap
    if (v < -0.62) colour = mix([60, 44, 38], texture(lx * 1.3 * textureScale, ly * 1.3 * textureScale, 6.1), 0.35);
    // mouth
    const mu = u / 0.34;
    const mv = (v - 0.45) / 0.07;
    if (mu * mu + mv * mv < 1) colour = [170, 60, 70];
    // eyes: open ellipses that close to skin (a linear blend, so the midpoint truth is the blend of the two)
    const blink = lerp(a.blink, b.blink, s);
    for (const e of EYES) {
      const eu = (u - e.u) / 0.16;
      const ev = (v - e.v) / 0.075;
      if (eu * eu + ev * ev < 1) colour = mix(dark, mix(skin, tex, 0.45), blink);
    }
    return [clamp255(colour[0]), clamp255(colour[1]), clamp255(colour[2])];
  };
}

/** A and B frames of a jump cut and the analytic midpoint. */
export function jumpCut(width: number, height: number, a: FacePose, b: FacePose, ca: CameraPose = NEUTRAL_CAMERA, cb: CameraPose = ca): { a: RGBAFrame; b: RGBAFrame; truth: (s: number) => RGBAFrame; scene: SceneFn } {
  const scene = talkingHead(width, height, a, b, ca, cb);
  return { a: renderScene(scene, width, height, 0), b: renderScene(scene, width, height, 1), truth: (s) => renderScene(scene, width, height, s), scene };
}

export interface BlobStats {
  readonly x: number;
  readonly y: number;
  /** Standard deviation of the dark mass around its centroid, px. */
  readonly spread: number;
  readonly mass: number;
}

/** Centroid and spread of the dark (eye) mass inside a box; weights are how far a pixel is below `level` luma. */
export function darkBlob(frame: RGBAFrame, box: { x0: number; y0: number; x1: number; y1: number }, level = 110): BlobStats {
  let m = 0;
  let sx = 0;
  let sy = 0;
  for (let y = Math.max(0, box.y0); y < Math.min(frame.height, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x < Math.min(frame.width, box.x1); x++) {
      const i = (y * frame.width + x) * 4;
      const luma = 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2];
      const w = Math.max(0, level - luma);
      m += w;
      sx += w * x;
      sy += w * y;
    }
  }
  if (m === 0) return { x: NaN, y: NaN, spread: NaN, mass: 0 };
  const cx = sx / m;
  const cy = sy / m;
  let v = 0;
  for (let y = Math.max(0, box.y0); y < Math.min(frame.height, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x < Math.min(frame.width, box.x1); x++) {
      const i = (y * frame.width + x) * 4;
      const luma = 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2];
      const w = Math.max(0, level - luma);
      v += w * ((x - cx) ** 2 + (y - cy) ** 2);
    }
  }
  return { x: cx, y: cy, spread: Math.sqrt(v / m), mass: m };
}

/** Number of pixels whose gradient magnitude (luma, central differences) exceeds `threshold`. */
export function edgePixelCount(frame: RGBAFrame, threshold = 24, mask?: Uint8Array): number {
  const { width: w, height: h, data } = frame;
  const luma = (x: number, y: number): number => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (mask && !mask[y * w + x]) continue;
      const gx = (luma(x + 1, y) - luma(x - 1, y)) * 0.5;
      const gy = (luma(x, y + 1) - luma(x, y - 1)) * 0.5;
      if (Math.hypot(gx, gy) > threshold) count++;
    }
  }
  return count;
}

/** Pixels within `band` px of the head outline at scene parameters `ss` (the silhouette edges a dissolve would double). */
export function headOutlineMask(width: number, height: number, a: FacePose, b: FacePose, ss: readonly number[], band = 3): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const s of ss) {
    const cx = lerp(a.x, b.x, s) * width;
    const cy = lerp(a.y, b.y, s) * height;
    const sc = lerp(a.scale, b.scale, s);
    const rot = (lerp(a.rotationDeg, b.rotationDeg, s) * Math.PI) / 180;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const lx = (dx * Math.cos(-rot) - dy * Math.sin(-rot)) / sc;
        const ly = (dx * Math.sin(-rot) + dy * Math.cos(-rot)) / sc;
        const u = lx / (HEAD_RX * width);
        const v = ly / (HEAD_RY * height);
        const r = Math.hypot(u, v);
        if (Math.abs(r - 1) * Math.min(HEAD_RX * width, HEAD_RY * height) * sc < band) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Pearson correlation of the luma gradient magnitude of two frames over a mask. A double edge (ghost) puts gradient
 * where the true frame has none and removes it where it has, so a ghosted frame correlates less with the truth.
 */
export function gradientCorrelation(a: RGBAFrame, b: RGBAFrame, mask?: Uint8Array): number {
  const { width: w, height: h } = a;
  const grad = (f: RGBAFrame, x: number, y: number): number => {
    const l = (xx: number, yy: number): number => {
      const i = (yy * w + xx) * 4;
      return 0.299 * f.data[i] + 0.587 * f.data[i + 1] + 0.114 * f.data[i + 2];
    };
    return Math.hypot((l(x + 1, y) - l(x - 1, y)) * 0.5, (l(x, y + 1) - l(x, y - 1)) * 0.5);
  };
  const ga: number[] = [];
  const gb: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (mask && !mask[y * w + x]) continue;
      ga.push(grad(a, x, y));
      gb.push(grad(b, x, y));
    }
  }
  const n = ga.length;
  if (n === 0) return NaN;
  const ma = ga.reduce((s, v) => s + v, 0) / n;
  const mb = gb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ga[i] - ma) * (gb[i] - mb);
    va += (ga[i] - ma) ** 2;
    vb += (gb[i] - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}
