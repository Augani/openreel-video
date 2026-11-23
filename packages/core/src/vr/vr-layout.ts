/**
 * The small, dependency-free part of the VR geometry: frame layout, the wrap of an angle and the fitted view window.
 * Everything the effect specs, the monitor view state and the project types need lives here, so none of that code has
 * to pull the CPU reference maths (vr-math.ts) into an eagerly loaded chunk.
 */

export type VrFrameLayout = "mono" | "over-under" | "side-by-side";

export const VR_LAYOUT_FLAGS: Readonly<Record<VrFrameLayout, number>> = {
  mono: 0,
  "over-under": 1,
  "side-by-side": 2,
};


export interface EyeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Wraps an angle in degrees into [-180, 180). */
export function wrapDegrees(a: number): number {
  if (!Number.isFinite(a)) return 0;
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** Largest rectangle of the given aspect (width / height) that fits the buffer, centred. */
export function fitRect(width: number, height: number, aspect: number): EyeRect {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : width / height;
  if (width / height >= a) {
    const w = height * a;
    return { x: (width - w) / 2, y: 0, w, h: height };
  }
  const h = width / a;
  return { x: 0, y: (height - h) / 2, w: width, h };
}

