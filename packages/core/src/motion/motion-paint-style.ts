import type { CornerRadii, GradientStop, ShadowStyle } from "../graphics/types";

export interface MotionColorRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface MotionResolvedGradientStop {
  readonly offset: number;
  readonly color: string;
}

const NAMED_RGBA: Record<string, MotionColorRgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

export function parseMotionColor(color: string | undefined): MotionColorRgba | null {
  if (!color) return null;
  const trimmed = color.trim().toLowerCase();
  if (trimmed in NAMED_RGBA) {
    return NAMED_RGBA[trimmed];
  }
  if (trimmed.startsWith("#")) {
    return parseHexColor(trimmed);
  }
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    trimmed,
  );
  if (rgbMatch) {
    const r = clampChannel(Number(rgbMatch[1]));
    const g = clampChannel(Number(rgbMatch[2]));
    const b = clampChannel(Number(rgbMatch[3]));
    const a = rgbMatch[4] === undefined ? 1 : clampUnit(Number(rgbMatch[4]));
    if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
      return null;
    }
    return { r, g, b, a };
  }
  return null;
}

export function motionRgbaToCss(rgba: MotionColorRgba): string {
  const a = clampUnit(rgba.a);
  return `rgba(${Math.round(clampChannel(rgba.r))}, ${Math.round(
    clampChannel(rgba.g),
  )}, ${Math.round(clampChannel(rgba.b))}, ${a})`;
}

export function applyMotionStopOpacity(
  color: string,
  opacity: number | undefined,
): string {
  if (opacity === undefined || !Number.isFinite(opacity)) {
    return color;
  }
  const parsed = parseMotionColor(color);
  if (!parsed) {
    return color;
  }
  return motionRgbaToCss({ ...parsed, a: parsed.a * clampUnit(opacity) });
}

export function resolveMotionGradientStops(
  stops: readonly GradientStop[] | undefined,
): MotionResolvedGradientStop[] {
  const resolved = (stops ?? [])
    .map((stop) => ({
      offset: clampUnit(stop.offset),
      color: applyMotionStopOpacity(stop.color || "#ffffff", stop.opacity),
    }))
    .sort((a, b) => a.offset - b.offset);

  if (resolved.length === 0) {
    return [
      { offset: 0, color: "#14b8a6" },
      { offset: 1, color: "#ffffff" },
    ];
  }
  if (resolved.length === 1) {
    return [
      { offset: 0, color: resolved[0].color },
      { offset: 1, color: resolved[0].color },
    ];
  }
  return resolved;
}

export function getMotionGradientCenter(
  width: number,
  height: number,
  center: { readonly x: number; readonly y: number } | undefined,
): { readonly x: number; readonly y: number } {
  const safeWidth = Math.max(1, finite(width, 1));
  const safeHeight = Math.max(1, finite(height, 1));
  const normalizedX = clampUnit(finite(center?.x, 0.5));
  const normalizedY = clampUnit(finite(center?.y, 0.5));
  return {
    x: (normalizedX - 0.5) * safeWidth,
    y: (normalizedY - 0.5) * safeHeight,
  };
}

export function getMotionConicAngleRadians(angleDegrees: number | undefined): number {
  return (finite(angleDegrees, 0) * Math.PI) / 180;
}

export function expandMotionShadowColor(shadow: ShadowStyle): string {
  return shadow.color || "rgba(0, 0, 0, 0.35)";
}

export interface MotionClampedCornerRadii {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
}

export function clampMotionCornerRadii(
  radii: CornerRadii,
  width: number,
  height: number,
): MotionClampedCornerRadii {
  const limit = Math.max(0, Math.min(width, height) / 2);
  const sanitize = (value: number): number =>
    Math.min(limit, Math.max(0, finite(value, 0)));
  return {
    topLeft: sanitize(radii.topLeft),
    topRight: sanitize(radii.topRight),
    bottomRight: sanitize(radii.bottomRight),
    bottomLeft: sanitize(radii.bottomLeft),
  };
}

function parseHexColor(hex: string): MotionColorRgba | null {
  const value = hex.slice(1);
  if (value.length === 3 || value.length === 4) {
    const r = parseInt(value[0] + value[0], 16);
    const g = parseInt(value[1] + value[1], 16);
    const b = parseInt(value[2] + value[2], 16);
    const a = value.length === 4 ? parseInt(value[3] + value[3], 16) / 255 : 1;
    return validRgba(r, g, b, a);
  }
  if (value.length === 6 || value.length === 8) {
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const a = value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
    return validRgba(r, g, b, a);
  }
  return null;
}

function validRgba(r: number, g: number, b: number, a: number): MotionColorRgba | null {
  if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b, a };
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}
