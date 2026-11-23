/** VR monitor view parameters: pure data and clamping, no renderer, so the app state can import it eagerly. */
import { fitRect, type EyeRect, type VrFrameLayout } from "../vr/vr-layout";

export interface VrViewParams {
  readonly layout: VrFrameLayout;
  /** Horizontal field of view of the view, degrees (10-170). */
  readonly fov: number;
  /** Pan right, degrees. */
  readonly pan: number;
  /** Tilt up, degrees. */
  readonly tilt: number;
  readonly roll: number;
  /** Width / height of the view window. */
  readonly aspect: number;
}

export const DEFAULT_VR_VIEW: VrViewParams = { layout: "mono", fov: 90, pan: 0, tilt: 0, roll: 0, aspect: 16 / 9 };
export const VR_VIEW_FOV_RANGE = { min: 20, max: 140 } as const;

/** Keeps a view inside what a viewer can reach: tilt stops at the poles, pan wraps, field of view is limited. */
export function clampVrView(view: VrViewParams): VrViewParams {
  const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
  return {
    ...view,
    fov: Math.min(VR_VIEW_FOV_RANGE.max, Math.max(VR_VIEW_FOV_RANGE.min, view.fov)),
    pan: wrap(view.pan),
    tilt: Math.min(89, Math.max(-89, view.tilt)),
    roll: wrap(view.roll),
  };
}

/** The window of the result (same size as the source) that holds the view. */
export function vrViewWindow(width: number, height: number, aspect: number): EyeRect {
  return fitRect(width, height, aspect);
}
