/**
 * Canvas2D renderers for the Premiere-style transitions added after the first set: the mask transitions
 * (iris, band, barn door, clock, gradient wipes), film / additive dissolves and the cube spin.
 *
 * Both the editor preview and the export go through TransitionEngine.renderTransitionToCanvas, which calls
 * these, so a preview frame and an exported frame are produced by the same code. WebGPU has no transition
 * path in this editor (it never did); this is the only renderer for them.
 */
import {
  isMaskTransition,
  rasterizeMaskTransition,
  type MaskTransitionType,
} from "./transition-masks";
import type { DrawPlan } from "./transition-plans";

type Ctx = OffscreenCanvasRenderingContext2D;

export interface ExtraRenderScratch {
  layer: OffscreenCanvas | null;
  layerCtx: Ctx | null;
  mask: OffscreenCanvas | null;
  maskCtx: Ctx | null;
  blendA: OffscreenCanvas | null;
  blendB: OffscreenCanvas | null;
}

export const createExtraRenderScratch = (): ExtraRenderScratch => ({
  layer: null,
  layerCtx: null,
  mask: null,
  maskCtx: null,
  blendA: null,
  blendB: null,
});

/** Mask rasters are built at most this wide and scaled up (the edge is resolved to about 1/960 of the width). */
export const MASK_RASTER_MAX_WIDTH = 960;

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function ensureCanvas(
  canvas: OffscreenCanvas | null,
  width: number,
  height: number,
): { canvas: OffscreenCanvas; ctx: Ctx } | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const target = canvas && canvas.width === width && canvas.height === height ? canvas : new OffscreenCanvas(width, height);
  const ctx = target.getContext("2d") as Ctx | null;
  return ctx ? { canvas: target, ctx } : null;
}

/** Builds an alpha-only white mask canvas from a 0..255 coverage plane. */
function uploadMask(
  scratch: ExtraRenderScratch,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  color: [number, number, number],
): OffscreenCanvas | null {
  const made = ensureCanvas(scratch.mask, width, height);
  if (!made) return null;
  scratch.mask = made.canvas;
  scratch.maskCtx = made.ctx;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < alpha.length; i += 1) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = alpha[i]!;
  }
  made.ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return made.canvas;
}

function parseColor(value: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const raw = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
    return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
  }
  return [255, 255, 255];
}

/** Draws `source` through a coverage mask onto `ctx` (source-over). */
function drawMasked(
  ctx: Ctx,
  scratch: ExtraRenderScratch,
  source: CanvasImageSource | null,
  color: [number, number, number] | null,
  mask: OffscreenCanvas,
  width: number,
  height: number,
): void {
  const made = ensureCanvas(scratch.layer, width, height);
  if (!made) return;
  scratch.layer = made.canvas;
  scratch.layerCtx = made.ctx;
  const layer = made.ctx;
  layer.globalCompositeOperation = "source-over";
  layer.clearRect(0, 0, width, height);
  if (source) layer.drawImage(source, 0, 0, width, height);
  else if (color) {
    layer.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    layer.fillRect(0, 0, width, height);
  }
  layer.globalCompositeOperation = "destination-in";
  layer.imageSmoothingEnabled = true;
  layer.drawImage(mask, 0, 0, width, height);
  layer.globalCompositeOperation = "source-over";
  ctx.drawImage(made.canvas, 0, 0, width, height);
}

export function renderMaskTransition(
  ctx: Ctx,
  scratch: ExtraRenderScratch,
  type: MaskTransitionType,
  params: Record<string, unknown>,
  outgoing: CanvasImageSource,
  incoming: CanvasImageSource,
  progress: number,
  width: number,
  height: number,
): void {
  ctx.drawImage(outgoing, 0, 0, width, height);
  if (progress <= 0) return;
  if (progress >= 1) {
    ctx.drawImage(incoming, 0, 0, width, height);
    return;
  }
  const mw = Math.min(width, MASK_RASTER_MAX_WIDTH);
  const mh = Math.max(1, Math.round((height * mw) / width));
  const raster = rasterizeMaskTransition(
    type,
    { ...params, borderWidth: (num(params.borderWidth, 0) * mw) / width },
    mw,
    mh,
    progress,
  );
  if (num(params.borderWidth, 0) > 0) {
    const ring = uploadMask(scratch, raster.border, mw, mh, [255, 255, 255]);
    if (ring) {
      drawMasked(ctx, scratch, null, parseColor(String(params.borderColor ?? "#ffffff")), ring, width, height);
    }
  }
  const mask = uploadMask(scratch, raster.incoming, mw, mh, [255, 255, 255]);
  if (mask) drawMasked(ctx, scratch, incoming, null, mask, width, height);
}

// ── Film dissolve: a crossfade computed in linear light ────────────────────────────────────────────────────────

let toLinear: Float32Array | null = null;
let toSrgb: Uint8ClampedArray | null = null;
const SRGB_STEPS = 4096;

function buildLuts(): void {
  if (toLinear && toSrgb) return;
  toLinear = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    toLinear[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  toSrgb = new Uint8ClampedArray(SRGB_STEPS + 1);
  for (let i = 0; i <= SRGB_STEPS; i += 1) {
    const l = i / SRGB_STEPS;
    toSrgb[i] = Math.round((l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055) * 255);
  }
}

/** Mixes two RGBA frames in linear light; alpha mixes linearly. Pure so it can be checked without a canvas. */
export function mixLinearLight(a: Uint8ClampedArray, b: Uint8ClampedArray, out: Uint8ClampedArray, progress: number): void {
  buildLuts();
  const lin = toLinear!;
  const enc = toSrgb!;
  const q = Math.max(0, Math.min(1, progress));
  const p = 1 - q;
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const mixed = p * lin[a[i + c]!]! + q * lin[b[i + c]!]!;
      out[i + c] = enc[Math.round(Math.min(1, mixed) * SRGB_STEPS)]!;
    }
    out[i + 3] = Math.round(p * a[i + 3]! + q * b[i + 3]!);
  }
}

export function renderFilmDissolve(
  ctx: Ctx,
  scratch: ExtraRenderScratch,
  outgoing: CanvasImageSource,
  incoming: CanvasImageSource,
  progress: number,
  width: number,
  height: number,
): void {
  if (progress <= 0) {
    ctx.drawImage(outgoing, 0, 0, width, height);
    return;
  }
  if (progress >= 1) {
    ctx.drawImage(incoming, 0, 0, width, height);
    return;
  }
  const a = ensureCanvas(scratch.blendA, width, height);
  const b = ensureCanvas(scratch.blendB, width, height);
  if (!a || !b) {
    ctx.globalAlpha = 1 - progress;
    ctx.drawImage(outgoing, 0, 0, width, height);
    ctx.globalAlpha = progress;
    ctx.drawImage(incoming, 0, 0, width, height);
    ctx.globalAlpha = 1;
    return;
  }
  scratch.blendA = a.canvas;
  scratch.blendB = b.canvas;
  a.ctx.clearRect(0, 0, width, height);
  b.ctx.clearRect(0, 0, width, height);
  a.ctx.drawImage(outgoing, 0, 0, width, height);
  b.ctx.drawImage(incoming, 0, 0, width, height);
  const dataA = a.ctx.getImageData(0, 0, width, height);
  const dataB = b.ctx.getImageData(0, 0, width, height);
  mixLinearLight(dataA.data, dataB.data, dataA.data, progress);
  ctx.putImageData(dataA, 0, 0);
}

// ── Additive dissolve ────────────────────────────────────────────────────────────────────────────────────────────

/** Weights of the outgoing and incoming shot: both reach full strength at the midpoint, so it brightens through it. */
export function additiveWeights(progress: number): { outgoing: number; incoming: number } {
  const p = Math.max(0, Math.min(1, progress));
  return { outgoing: Math.min(1, 2 * (1 - p)), incoming: Math.min(1, 2 * p) };
}

export function renderAdditiveDissolve(
  ctx: Ctx,
  outgoing: CanvasImageSource,
  incoming: CanvasImageSource,
  progress: number,
  width: number,
  height: number,
): void {
  const weights = additiveWeights(progress);
  ctx.save();
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = weights.outgoing;
  ctx.drawImage(outgoing, 0, 0, width, height);
  ctx.globalAlpha = weights.incoming;
  ctx.drawImage(incoming, 0, 0, width, height);
  ctx.restore();
}

// ── Geometric transitions: execute a draw plan ──────────────────────────────────────────────────────────────────

function polyPath(ctx: Ctx, poly: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** Pixel size of a shot as the browser draws it (a VideoFrame has display sizes, a video element its video size); 0 when unknown. */
function shotSize(source: CanvasImageSource): { w: number; h: number } {
  const s = source as { displayWidth?: number; displayHeight?: number; videoWidth?: number; videoHeight?: number; width?: unknown; height?: unknown };
  const w = s.displayWidth ?? s.videoWidth ?? (typeof s.width === "number" ? s.width : 0);
  const h = s.displayHeight ?? s.videoHeight ?? (typeof s.height === "number" ? s.height : 0);
  return { w, h };
}

/**
 * Draws a plan from transition-plans.ts: the one routine cube spin, flip over, split, cross zoom and page peel share.
 * Plan rectangles are in the engine's pixels; a shot of another size (a video frame the engine did not letterbox) is
 * sampled at the same fractions of its own size, so the preview and an export at another size draw the same picture.
 */
export function renderDrawPlan(
  ctx: Ctx,
  plan: DrawPlan,
  outgoing: CanvasImageSource,
  incoming: CanvasImageSource,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  const source = (src: "A" | "B") => (src === "A" ? outgoing : incoming);
  const sizes = { A: shotSize(outgoing), B: shotSize(incoming) };
  for (const layer of plan) {
    switch (layer.kind) {
      case "rect": {
        ctx.globalAlpha = layer.alpha ?? 1;
        const size = sizes[layer.src];
        const kx = size.w > 0 ? size.w / width : 1;
        const ky = size.h > 0 ? size.h / height : 1;
        ctx.drawImage(source(layer.src), layer.s[0] * kx, layer.s[1] * ky, layer.s[2] * kx, layer.s[3] * ky, layer.d[0], layer.d[1], layer.d[2], layer.d[3]);
        break;
      }
      case "poly": {
        ctx.save();
        polyPath(ctx, layer.poly);
        ctx.clip();
        ctx.globalAlpha = layer.alpha ?? 1;
        if (layer.matrix) ctx.transform(...layer.matrix);
        ctx.drawImage(source(layer.src), 0, 0, width, height);
        if (layer.tint) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = layer.tint.alpha;
          ctx.fillStyle = layer.tint.color;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.restore();
        break;
      }
      case "fill":
        ctx.globalAlpha = layer.alpha ?? 1;
        ctx.fillStyle = layer.color;
        polyPath(ctx, layer.poly);
        ctx.fill();
        break;
      case "stroke":
        ctx.globalAlpha = 1;
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = layer.width;
        ctx.lineJoin = "miter";
        polyPath(ctx, layer.poly);
        ctx.stroke();
        break;
      case "gradient": {
        const gradient = ctx.createLinearGradient(layer.from[0], layer.from[1], layer.to[0], layer.to[1]);
        gradient.addColorStop(0, `rgba(0,0,0,${layer.alpha0})`);
        gradient.addColorStop(1, `rgba(0,0,0,${layer.alpha1})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = gradient;
        polyPath(ctx, layer.poly);
        ctx.fill();
        break;
      }
    }
  }
  ctx.restore();
}

export { isMaskTransition };
