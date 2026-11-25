import { maskPathAtTime, type BezierPath, type BezierPoint, type Mask, type MaskPoint } from "../../mask-engine";
import { resolveCanvasFitDimensions } from "../../canvas-fit";
import type { FitMode } from "../../../types/timeline";
import { applyMat3, frameAt, rowDelta, rowMatrix, sourceOf, type RowDelta } from "./plan";
import { warpPlanFor, type WarpClipLike } from "./apply";

/**
 * Where masks live on a stabilized clip.
 *
 * Object masks are segmented and tracked on the clip's decoded source frames, so their outline follows the object
 * in the picture as it was shot (`Mask.space === "source"`). The Warp Stabilizer then moves that picture, and the
 * matte is composited after the warp, so the outline has to move with it: the same per-frame correction (shift,
 * rotation, scale, the auto-scale zoom) is applied to the mask path at render time, in the Program monitor and in
 * the export alike. Because the warp is derived from the clip's analysis and settings, re-analysing the clip or
 * changing a setting keeps the masks on their objects without touching them.
 *
 * Masks without `space` (hand drawn on the stabilized picture, shapes) are in what the monitor shows, and are not
 * mapped.
 */
export interface PointMap {
  /** Raw source side to stabilized side. */
  forward(point: MaskPoint): MaskPoint;
  /** Stabilized side to raw source side. */
  inverse(point: MaskPoint): MaskPoint;
}

export const isSourceSpaceMask = (mask: Pick<Mask, "space">): boolean => mask.space === "source";

/** The slice of a clip transform that decides where the frame lands on the canvas (the render and preview maths). */
export interface PlacementTransform {
  readonly position: { readonly x: number; readonly y: number };
  readonly scale: { readonly x: number; readonly y: number };
  readonly rotation: number;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly fitMode?: FitMode;
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/**
 * Normalised frame position (0..1 of the decoded picture) to normalised canvas position, exactly where the
 * compositor draws it for `transform` (the same layout as `drawFrameToContext`).
 */
export function framePlacement(transform: PlacementTransform, frameWidth: number, frameHeight: number, canvasWidth: number, canvasHeight: number): PointMap | null {
  const crop = transform.crop;
  const sourceWidth = crop ? crop.width * frameWidth : frameWidth;
  const sourceHeight = crop ? crop.height * frameHeight : frameHeight;
  const fitted = resolveCanvasFitDimensions(transform.fitMode, sourceWidth, sourceHeight, canvasWidth, canvasHeight);
  const sx = transform.scale.x;
  const sy = transform.scale.y;
  if (!(fitted.width > 0) || !(fitted.height > 0) || Math.abs(sx) < 1e-9 || Math.abs(sy) < 1e-9) return null;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cropX = crop?.x ?? 0;
  const cropY = crop?.y ?? 0;
  const cropW = crop?.width ?? 1;
  const cropH = crop?.height ?? 1;
  const originX = canvasWidth / 2 + transform.position.x;
  const originY = canvasHeight / 2 + transform.position.y;
  return {
    forward: (p) => {
      const lx = (-fitted.width * transform.anchor.x + ((p.x - cropX) / cropW) * fitted.width) * sx;
      const ly = (-fitted.height * transform.anchor.y + ((p.y - cropY) / cropH) * fitted.height) * sy;
      return { x: (originX + lx * cos - ly * sin) / canvasWidth, y: (originY + lx * sin + ly * cos) / canvasHeight };
    },
    inverse: (p) => {
      const dx = p.x * canvasWidth - originX;
      const dy = p.y * canvasHeight - originY;
      const lx = (dx * cos + dy * sin) / sx;
      const ly = (-dx * sin + dy * cos) / sy;
      return {
        x: cropX + ((lx / fitted.width + transform.anchor.x) * cropW),
        y: cropY + ((ly / fitted.height + transform.anchor.y) * cropH),
      };
    },
  };
}

const SCRATCH: RowDelta = { dx: 0, dy: 0, rotation: 0, logScale: 0, px: 0, py: 0 };

/**
 * The stabilizing warp of one frame on normalised frame positions: where a point of the raw picture lands in the
 * stabilized picture, and back. Null when the clip has no finished analysis or the time is outside it (the frame is
 * then shown unmoved). Rolling shutter rows are honoured; the perspective terms are included in the forward map.
 */
export function warpFrameMap(clip: WarpClipLike, sourceTime: number, frameWidth: number, frameHeight: number): PointMap | null {
  const plan = warpPlanFor(clip);
  if (!plan || !(frameWidth > 0) || !(frameHeight > 0)) return null;
  const shown = frameAt(plan, sourceTime);
  if (shown === null) return null;
  const w = frameWidth;
  const h = frameHeight;
  return {
    forward: (p) => {
      const v = Math.min(1, Math.max(0, p.y));
      const matrix = rowMatrix(plan, rowDelta(plan, shown, shown, v, SCRATCH), w, h, plan.zoom);
      const [x, y] = applyMat3(matrix, p.x * w, p.y * h);
      return { x: x / w, y: y / h };
    },
    inverse: (p) => {
      const source = sourceOf(plan, shown, shown, p.x * w, p.y * h, w, h, plan.zoom);
      return source ? { x: source[0] / w, y: source[1] / h } : p;
    },
  };
}

/**
 * The warp as a map on composition positions, given where the clip's frame sits on the canvas (`placement`, the
 * frame <-> canvas map of the clip at this time). `forward` takes a mask point that is on the raw picture to where
 * that picture point is drawn once stabilized; `inverse` goes back.
 */
export function warpCompositionMap(clip: WarpClipLike, sourceTime: number, frameWidth: number, frameHeight: number, placement: PointMap | null): PointMap | null {
  if (!placement) return null;
  const warp = warpFrameMap(clip, sourceTime, frameWidth, frameHeight);
  if (!warp) return null;
  return {
    forward: (p) => placement.forward(warp.forward(placement.inverse(p))),
    inverse: (p) => placement.forward(warp.inverse(placement.inverse(p))),
  };
}

export function mapBezierPath(path: BezierPath, map: (point: MaskPoint) => MaskPoint): BezierPath {
  return {
    closed: path.closed,
    points: path.points.map((point): BezierPoint => ({
      ...map(point),
      ...(point.handleIn ? { handleIn: map(point.handleIn) } : {}),
      ...(point.handleOut ? { handleOut: map(point.handleOut) } : {}),
    })),
  };
}

/**
 * The masks as they are drawn at `time` over a stabilized frame: source-space masks follow the warp of this frame
 * (their path is sampled at `time` first, so keyframe interpolation still happens on the raw track), the others
 * are unchanged. Returns `masks` itself when nothing needs mapping.
 */
export function masksInStabilizedSpace(masks: readonly Mask[], map: PointMap | null, time: number): readonly Mask[] {
  if (!map || !masks.some(isSourceSpaceMask)) return masks;
  return masks.map((mask) => (isSourceSpaceMask(mask) ? { ...mask, path: mapBezierPath(maskPathAtTime(mask, time), map.forward), keyframes: [] } : mask));
}
