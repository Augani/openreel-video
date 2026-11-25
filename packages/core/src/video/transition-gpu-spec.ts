/**
 * What the WebGPU transition renderer needs to draw one frame of a transition: the shader that runs it, its
 * parameters in the layout transition-gpu-shaders.ts reads, and any per-frame constants the shader cannot compute
 * as exactly as the Canvas2D engine does (double precision sine hashes). Pure functions of the transition, its
 * eased progress and the engine size, so they run (and are tested) without a GPU. Every parameter default here is
 * the one the Canvas2D engine's own switch uses, which is what keeps the preview, the export and the fallback equal.
 */
import { MASK_RASTER_MAX_WIDTH } from "./transition-extra-render";
import { additiveWeights } from "./transition-extra-render";
import { getDefaultTransitionParams } from "./transition-default-params";
import { isMaskTransition, rasterizeMaskTransition } from "./transition-masks";
import type { DrawPlan } from "./transition-plans";
import type { GpuPixelShader } from "./transition-gpu-shaders";
import type { Transition } from "../types/timeline";

export interface GpuMaskUpload {
  readonly width: number;
  readonly height: number;
  /** Interleaved coverage: red the incoming shot, green the border strip. */
  readonly rg: Uint8Array<ArrayBuffer>;
}

export type GpuTransitionSpec =
  | {
      readonly kind: "pixel";
      readonly shader: GpuPixelShader;
      readonly flag: number;
      /** Sixteen floats: u.a, u.b, u.c, u.d. */
      readonly v: readonly number[];
      readonly aux?: Float32Array<ArrayBuffer>;
      readonly mask?: GpuMaskUpload;
    }
  | { readonly kind: "plan"; readonly plan: DrawPlan };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const DIRECTION_CODE: Record<string, number> = { left: 0, right: 1, up: 2, down: 3, diagonal: 4 };

function pixel(shader: GpuPixelShader, v: number[] = [], flag = 0, extra: { aux?: Float32Array<ArrayBuffer>; mask?: GpuMaskUpload } = {}): GpuTransitionSpec {
  const padded = v.slice(0, 16);
  while (padded.length < 16) padded.push(0);
  return { kind: "pixel", shader, flag, v: padded, ...extra };
}

export const parseHexColor = (value: string): [number, number, number] => {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return [255, 255, 255];
  const raw = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
};

/** Types the WebGPU renderer draws. Everything else (Morph Cut, which works on analysed pixels) stays on Canvas2D. */
export function isGpuTransitionType(type: string): boolean {
  return type !== "morphCut";
}

/**
 * The GPU spec of a transition frame at eased progress `p`, or null when the transition has no GPU path.
 * `planFor` builds the draw plan of the geometric transitions (the engine's own, shared with Canvas2D).
 */
export function buildGpuTransitionSpec(
  transition: Transition,
  p: number,
  width: number,
  height: number,
  planFor: (transition: Transition, progress: number) => DrawPlan,
): GpuTransitionSpec | null {
  const params = transition.params as Record<string, unknown>;
  const str = (key: string, fallback: string): string => (params[key] as string) || fallback;
  const w = width;
  const h = height;
  switch (transition.type) {
    case "morphCut":
      return null;
    case "crossfade":
      return pixel("crossfade");
    case "dipToBlack":
    case "dipToWhite":
      return pixel("dip", [((params.holdDuration as number) || 0), transition.type === "dipToWhite" ? 1 : 0]);
    case "wipe":
      return pixel("wipe", [DIRECTION_CODE[str("direction", "left")] ?? 0, clamp(((params.softness as number) || 0), 0, 1)]);
    case "slide":
    case "push": {
      const pushOut = transition.type === "push" ? true : ((params.pushOut as boolean) || false);
      const direction = str("direction", "left");
      let outX = 0;
      let outY = 0;
      let inX = 0;
      let inY = 0;
      switch (direction) {
        case "left":
          inX = w * (1 - p);
          if (pushOut) outX = -w * p;
          break;
        case "right":
          inX = -w * (1 - p);
          if (pushOut) outX = w * p;
          break;
        case "up":
          inY = h * (1 - p);
          if (pushOut) outY = -h * p;
          break;
        case "down":
          inY = -h * (1 - p);
          if (pushOut) outY = h * p;
          break;
      }
      return pixel("slide", [outX, outY, inX, inY], pushOut || p < 1 ? 1 : 0);
    }
    case "zoom": {
      const scale = (params.scale as number) || 2;
      const center = (params.center as { x: number; y: number }) || { x: 0.5, y: 0.5 };
      return pixel("zoom", [1 + (scale - 1) * p, 1 / scale + (1 - 1 / scale) * p, w * center.x, h * center.y]);
    }
    case "circleReveal": {
      const center = (params.center as { x: number; y: number }) || { x: 0.5, y: 0.5 };
      const cx = w * clamp(center.x, 0, 1);
      const cy = h * clamp(center.y, 0, 1);
      const maxRadius = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
      return pixel("circleReveal", [cx, cy, maxRadius]);
    }
    case "blur": {
      const intensity = (params.intensity as number) ?? 1;
      const maxBlur = Math.max(w, h) * 0.04 * clamp(intensity, 0, 2);
      return pixel("blur", [Math.sin(p * Math.PI) * maxBlur]);
    }
    case "whipPan": {
      const direction = str("direction", "left");
      const horizontal = direction === "left" || direction === "right";
      const sign = direction === "right" || direction === "down" ? 1 : -1;
      const span = horizontal ? w : h;
      const outOffset = sign * span * p;
      const inOffset = sign * span * (p - 1);
      const blurIntensity = (params.blurIntensity as number) ?? 1;
      const sigma = Math.sin(p * Math.PI) * (span * 0.06) * clamp(blurIntensity, 0, 2);
      return pixel("whipPan", horizontal ? [outOffset, 0, inOffset, 0, sigma] : [0, outOffset, 0, inOffset, sigma]);
    }
    case "radialWipe": {
      const startAngle = (params.startAngle as number) ?? -90;
      const clockwise = (params.clockwise as boolean) ?? true;
      return pixel("radialWipe", [(startAngle * Math.PI) / 180, clockwise ? 1 : -1, w / 2, h / 2]);
    }
    case "pixelate": {
      const maxPixelSize = (params.maxPixelSize as number) || 48;
      const pixelSize = Math.max(1, Math.round(1 + Math.sin(p * Math.PI) * Math.max(1, maxPixelSize)));
      const smallW = Math.max(1, Math.ceil(w / pixelSize));
      const smallH = Math.max(1, Math.ceil(h / pixelSize));
      return pixel("pixelate", [w / smallW, h / smallH]);
    }
    case "glitch": {
      const intensity = (params.intensity as number) || 0.08;
      const slices = (params.slices as number) || 12;
      const strength = Math.sin(p * Math.PI) * Math.max(0, intensity) * w;
      const count = Math.max(4, Math.min(40, Math.round(slices)));
      const aux = new Float32Array(count * 4);
      for (let index = 0; index < count; index += 1) {
        const y = Math.floor((index / count) * h);
        const nextY = Math.ceil(((index + 1) / count) * h);
        aux[index * 4] = y;
        aux[index * 4 + 1] = y + Math.max(1, nextY - y);
        aux[index * 4 + 2] = Math.sin(index * 12.9898 + p * 31.7) * strength;
        aux[index * 4 + 3] = (index + Math.floor(p * 10)) % 2 === 0 ? 0 : 1;
      }
      return pixel("glitch", [count, Math.min(0.8, 0.25 + Math.sin(p * Math.PI) * 0.45)], 0, { aux });
    }
    case "blinds": {
      const count = Math.max(2, Math.min(32, Math.round((params.count as number) || 8)));
      return pixel("blinds", [str("direction", "vertical") === "horizontal" ? 1 : 0, count]);
    }
    case "diamondReveal": {
      const center = (params.center as { x: number; y: number }) || { x: 0.5, y: 0.5 };
      const cx = w * clamp(center.x, 0, 1);
      const cy = h * clamp(center.y, 0, 1);
      return pixel("diamondReveal", [cx, cy, Math.max(cx + cy, w - cx + cy, cx + h - cy, w - cx + h - cy)]);
    }
    case "spin": {
      const rotations = (params.rotations as number) ?? 1;
      const turn = Math.PI * 2 * rotations;
      return pixel("spin", [w / 2, h / 2, Math.max(0.05, 1 - p * 0.75), turn * p, 0.25 + p * 0.75, turn * (p - 1)]);
    }
    case "flip": {
      const horizontal = str("axis", "horizontal") !== "vertical";
      const firstHalf = p < 0.5;
      const phase = firstHalf ? 1 - p * 2 : (p - 0.5) * 2;
      return pixel("flip", [horizontal ? 1 : 0, Math.max(0.001, phase), firstHalf ? 0 : 1]);
    }
    case "splitReveal":
      return pixel("splitReveal", [str("orientation", "horizontal") === "vertical" ? 1 : 0]);
    case "flash": {
      const intensity = (params.intensity as number) ?? 1;
      return pixel("flash", [Math.min(1, Math.max(0, intensity) * Math.sin(p * Math.PI))]);
    }
    case "filmBurn": {
      const intensity = clamp((params.intensity as number) ?? 1, 0, 2);
      const warmth = clamp((params.warmth as number) ?? 0.75, 0, 1);
      const peak = Math.sin(p * Math.PI);
      const red = Math.round(70 + warmth * 185);
      const green = Math.round(180 - warmth * 105);
      const blue = Math.round(255 - warmth * 240);
      return pixel("filmBurn", [red / 255, green / 255, blue / 255, Math.min(1, peak * intensity * 0.9), Math.min(0.8, peak * peak * intensity * 0.55)]);
    }
    case "mosaic": {
      const tiles = (params.tiles as number) ?? 8;
      const randomness = (params.randomness as number) ?? 0.85;
      const columns = Math.max(2, Math.min(24, Math.round(tiles)));
      const rows = Math.max(2, Math.round(columns * (h / w)));
      const randomMix = clamp(randomness, 0, 1);
      const aux = new Float32Array(rows * columns);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const order = (row * columns + column) / Math.max(1, rows * columns - 1);
          const random = Math.abs(Math.sin((column + 1) * 12.9898 + (row + 1) * 78.233) * 43758.5453) % 1;
          aux[row * columns + column] = order * (1 - randomMix) + random * randomMix;
        }
      }
      return pixel("mosaic", [columns, rows, w / columns, h / rows], 0, { aux });
    }
    case "ripple": {
      const amplitude = (params.amplitude as number) ?? 0.04;
      const waves = (params.waves as number) ?? 3;
      const slices = 32;
      const displacement = clamp(amplitude, 0, 0.2) * w;
      const waveCount = clamp(waves, 0.5, 12);
      const aux = new Float32Array(slices);
      for (let index = 0; index < slices; index += 1) {
        const phase = (index / slices) * Math.PI * 2 * waveCount;
        aux[index] = Math.sin(phase + p * Math.PI * 2) * displacement * Math.sin(p * Math.PI);
      }
      return pixel("ripple", [slices, h / slices], 0, { aux });
    }
    case "pageTurn": {
      const turnLeft = str("direction", "left") !== "right";
      const shadow = (params.shadow as number) ?? 0.55;
      const remaining = Math.max(0.001, 1 - p);
      const foldX = turnLeft ? w * remaining : w * p;
      const shadowWidth = Math.max(2, w * 0.035);
      return pixel("pageTurn", [turnLeft ? 1 : 0, remaining, clamp(shadow, 0, 1) * Math.sin(p * Math.PI) * 0.65, shadowWidth, turnLeft ? foldX - shadowWidth : foldX]);
    }
    case "colorSplit": {
      const maxOffset = (params.maxOffset as number) ?? 18;
      const angle = (params.angle as number) ?? 0;
      const peak = Math.sin(p * Math.PI);
      const offset = clamp(maxOffset, 0, 80) * peak;
      const radians = (angle * Math.PI) / 180;
      return pixel("colorSplit", [Math.cos(radians) * offset, Math.sin(radians) * offset, peak * 0.24]);
    }
    case "filmDissolve":
      return pixel("filmDissolve");
    case "additiveDissolve": {
      const weights = additiveWeights(p);
      return pixel("additiveDissolve", [weights.outgoing, weights.incoming]);
    }
    case "cubeSpin":
    case "flipOver":
    case "split":
    case "crossZoom":
    case "pagePeel":
      return { kind: "plan", plan: planFor(transition, p) };
    default: {
      if (!isMaskTransition(transition.type)) return pixel("crossfade");
      const merged = { ...getDefaultTransitionParams(transition.type), ...params } as Record<string, unknown>;
      if (p <= 0 || p >= 1) return pixel("mask", [1, 1, 1, 0]);
      const mw = Math.min(w, MASK_RASTER_MAX_WIDTH);
      const mh = Math.max(1, Math.round((h * mw) / w));
      const borderWidth = num(merged.borderWidth, 0);
      const raster = rasterizeMaskTransition(transition.type, { ...merged, borderWidth: (borderWidth * mw) / w }, mw, mh, p);
      const rg = new Uint8Array(mw * mh * 2);
      for (let i = 0; i < mw * mh; i += 1) {
        rg[i * 2] = raster.incoming[i]!;
        rg[i * 2 + 1] = raster.border[i]!;
      }
      const [r, g, b] = parseHexColor(String(merged.borderColor ?? "#ffffff"));
      return pixel("mask", [r / 255, g / 255, b / 255, borderWidth > 0 ? 1 : 0], 0, { mask: { width: mw, height: mh, rg } });
    }
  }
}
