import { BLEND_MODES, type BlendMode } from "./types";

/**
 * Shared blend reference. Everything that has no native Canvas2D composite
 * operation (the ten modes added after the original eighteen) is defined here
 * once, in float space, and consumed by the CPU path (preview, export, Canvas2D
 * fallback). The WGSL mirror in motion/motion-gpu-blend.ts is parity-tested
 * against this module on fixed colour pairs.
 */

export interface BlendRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface BlendModeGroup {
  readonly label: string;
  readonly modes: readonly BlendMode[];
}

/** Premiere's Effect Controls grouping. */
export const BLEND_MODE_GROUPS: readonly BlendModeGroup[] = [
  { label: "Normal", modes: ["normal", "dissolve"] },
  {
    label: "Darken",
    modes: ["darken", "multiply", "color-burn", "linear-burn", "darker-color"],
  },
  {
    label: "Lighten",
    modes: [
      "lighten",
      "screen",
      "color-dodge",
      "linear-dodge",
      "add",
      "lighter-color",
    ],
  },
  {
    label: "Contrast",
    modes: [
      "overlay",
      "soft-light",
      "hard-light",
      "vivid-light",
      "linear-light",
      "pin-light",
      "hard-mix",
    ],
  },
  {
    label: "Inversion",
    modes: ["difference", "exclusion", "subtract", "divide"],
  },
  { label: "Component", modes: ["hue", "saturation", "color", "luminosity"] },
];

const CPU_ONLY_MODES: ReadonlySet<BlendMode> = new Set<BlendMode>([
  "linear-burn",
  "darker-color",
  "lighter-color",
  "linear-light",
  "vivid-light",
  "pin-light",
  "hard-mix",
  "subtract",
  "divide",
  "dissolve",
]);

/** True for modes Canvas2D cannot express, which are computed per pixel. */
export function needsCpuBlend(mode: BlendMode | undefined): boolean {
  return mode !== undefined && CPU_ONLY_MODES.has(mode);
}

export function isBlendMode(value: unknown): value is BlendMode {
  return (
    typeof value === "string" && (BLEND_MODES as readonly string[]).includes(value)
  );
}

/** Native Canvas2D operation, or null when the mode must go through the CPU path. */
export function getNativeCanvasBlendOperation(
  mode: BlendMode | undefined,
): GlobalCompositeOperation | null {
  if (mode === undefined || mode === "normal") return "source-over";
  if (mode === "add" || mode === "linear-dodge") return "lighter";
  if (CPU_ONLY_MODES.has(mode)) return null;
  return mode as GlobalCompositeOperation;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lum(c: BlendRgb): number {
  return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
}

function burn(cb: number, s: number): number {
  if (cb >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - cb) / s);
}

function dodge(cb: number, s: number): number {
  if (cb <= 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, cb / (1 - s));
}

function channel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case "linear-burn":
      return clamp01(cb + cs - 1);
    case "linear-light":
      return clamp01(cb + 2 * cs - 1);
    case "vivid-light":
      return cs <= 0.5 ? burn(cb, 2 * cs) : dodge(cb, 2 * (cs - 0.5));
    case "pin-light":
      return cs < 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * (cs - 0.5));
    case "hard-mix":
      return cb + cs >= 1 ? 1 : 0;
    case "subtract":
      return clamp01(cb - cs);
    case "divide":
      return cs <= 0 ? 1 : Math.min(1, cb / cs);
    default:
      return cs;
  }
}

/**
 * Blend function B(Cb, Cs) for the modes in CPU_ONLY_MODES. Dissolve has no
 * colour function (it is a stochastic alpha), so it returns the source colour.
 */
export function referenceBlend(
  mode: BlendMode,
  backdrop: BlendRgb,
  source: BlendRgb,
): BlendRgb {
  if (mode === "darker-color") return lum(source) < lum(backdrop) ? source : backdrop;
  if (mode === "lighter-color") return lum(source) > lum(backdrop) ? source : backdrop;
  return {
    r: channel(mode, backdrop.r, source.r),
    g: channel(mode, backdrop.g, source.g),
    b: channel(mode, backdrop.b, source.b),
  };
}

/**
 * Deterministic per pixel noise in [0, 1) from integer pixel coordinates.
 * Pure 32 bit integer maths so the WGSL twin (dissolveNoise) is bit identical.
 */
export function dissolveNoise(x: number, y: number): number {
  let h = (Math.imul(x >>> 0, 374761393) + Math.imul(y >>> 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65536;
}

/** Dissolve keeps a source pixel fully opaque when its noise falls under the alpha. */
export function dissolveAlpha(x: number, y: number, alpha: number): number {
  return dissolveNoise(x, y) < alpha ? 1 : 0;
}

/**
 * Composite one straight-alpha pixel (all channels 0..1) with the W3C blend
 * model. (x, y) are absolute canvas pixels and only matter for dissolve.
 */
export function compositeReferencePixel(
  mode: BlendMode,
  backdrop: BlendRgb & { readonly a: number },
  source: BlendRgb & { readonly a: number },
  x: number,
  y: number,
): BlendRgb & { readonly a: number } {
  const sa = mode === "dissolve" ? dissolveAlpha(x, y, source.a) : source.a;
  const ba = backdrop.a;
  const outA = sa + ba * (1 - sa);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const blended = referenceBlend(mode, backdrop, source);
  const mixR = (1 - ba) * source.r + ba * blended.r;
  const mixG = (1 - ba) * source.g + ba * blended.g;
  const mixB = (1 - ba) * source.b + ba * blended.b;
  return {
    r: clamp01((sa * mixR + (1 - sa) * ba * backdrop.r) / outA),
    g: clamp01((sa * mixG + (1 - sa) * ba * backdrop.g) / outA),
    b: clamp01((sa * mixB + (1 - sa) * ba * backdrop.b) / outA),
    a: clamp01(outA),
  };
}

/**
 * Blend a straight-alpha RGBA8 source buffer over a backdrop buffer in place
 * (the backdrop is overwritten). Both buffers are width * height * 4 long.
 */
export function blendPixelBuffers(
  backdrop: Uint8ClampedArray,
  source: Uint8ClampedArray,
  width: number,
  height: number,
  mode: BlendMode,
  alpha = 1,
): void {
  const layerAlpha = clamp01(alpha);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const sa = (source[i + 3] / 255) * layerAlpha;
      if (sa <= 0) continue;
      const out = compositeReferencePixel(
        mode,
        {
          r: backdrop[i] / 255,
          g: backdrop[i + 1] / 255,
          b: backdrop[i + 2] / 255,
          a: backdrop[i + 3] / 255,
        },
        { r: source[i] / 255, g: source[i + 1] / 255, b: source[i + 2] / 255, a: sa },
        x,
        y,
      );
      backdrop[i] = Math.round(out.r * 255);
      backdrop[i + 1] = Math.round(out.g * 255);
      backdrop[i + 2] = Math.round(out.b * 255);
      backdrop[i + 3] = Math.round(out.a * 255);
    }
  }
}

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function createScratch(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Draw `image` (same pixel size as the destination canvas, identity transform)
 * onto `ctx` with `mode` at the context's current globalAlpha. Native modes use
 * the Canvas2D composite op; the rest run the CPU reference over the full frame
 * so preview and export agree. The blended frame is written back through the
 * context's ACTIVE CLIP REGION (a mask, matte or crop), never over the whole
 * canvas. Falls back to source-over only if the 2D context cannot read pixels
 * back.
 */
export function drawImageWithBlend(
  ctx: AnyCtx,
  image: CanvasImageSource,
  mode: BlendMode | undefined,
  width: number = ctx.canvas.width,
  height: number = ctx.canvas.height,
): void {
  const native = getNativeCanvasBlendOperation(mode);
  if (native !== null) {
    ctx.globalCompositeOperation = native;
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }
  try {
    const scratch = createScratch(width, height);
    const sctx = scratch.getContext("2d") as AnyCtx | null;
    if (!sctx) throw new Error("no scratch context");
    sctx.drawImage(image, 0, 0, width, height);
    const src = sctx.getImageData(0, 0, width, height);
    const dst = ctx.getImageData(0, 0, width, height);
    blendPixelBuffers(
      dst.data,
      src.data,
      width,
      height,
      mode as BlendMode,
      ctx.globalAlpha,
    );
    // Reuse the scratch for the result: putImageData ignores the clip region, drawImage does not.
    sctx.putImageData(dst, 0, 0);
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if ("filter" in ctx) ctx.filter = "none";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      // Inside the clip the result replaces the frame (it already contains the backdrop); outside it nothing changes.
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(scratch, 0, 0, width, height);
    } finally {
      ctx.restore();
    }
  } catch {
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(image, 0, 0, width, height);
  }
}

/**
 * Composite a layer canvas that was rendered with NORMAL blending (an overlay: text, shape, SVG, sticker) onto `ctx`
 * with its own blend mode and blend opacity (0-100). Normal mode is a plain draw; the layer's own alpha (opacity,
 * animation) is already inside the canvas.
 */
export function drawOverlayLayerWithBlend(
  ctx: AnyCtx,
  layer: CanvasImageSource,
  clip: { readonly blendMode?: BlendMode; readonly blendOpacity?: number },
  width: number = ctx.canvas.width,
  height: number = ctx.canvas.height,
): void {
  if (!clip.blendMode || clip.blendMode === "normal") {
    ctx.drawImage(layer, 0, 0, width, height);
    return;
  }
  const opacity = clip.blendOpacity;
  const alpha = opacity === undefined || !Number.isFinite(opacity) ? 1 : clamp01(opacity / 100);
  ctx.save();
  try {
    ctx.globalAlpha = ctx.globalAlpha * alpha;
    drawImageWithBlend(ctx, layer, clip.blendMode, width, height);
  } finally {
    ctx.restore();
  }
}
