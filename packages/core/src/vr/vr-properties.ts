/**
 * Immersive video (VR / 360) properties, Premiere's "VR Properties": the projection of the picture, the frame layout
 * of stereo footage and the captured field of view. They live on the sequence (`ProjectSettings.vr`), on a clip's
 * source (`MediaItem.vrProperties`, the user's override of what the file says) and, as detected from the file, on
 * `MediaMetadata.vr`.
 */
import type { VrFrameLayout } from "./vr-layout";

export type VrProjection = "none" | "equirectangular";

export const VR_PROJECTIONS: readonly VrProjection[] = ["none", "equirectangular"];
export const VR_LAYOUTS: readonly VrFrameLayout[] = ["mono", "over-under", "side-by-side"];

/** Where a detected value came from: spherical metadata in the file, a 2:1 picture, or the user. */
export type VrSource = "metadata" | "aspect" | "user";

/** Where a player looks when it opens the video (degrees): heading to the right, pitch up, roll clockwise. */
export interface VrInitialView {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export interface VrProperties {
  readonly projection: VrProjection;
  /** Frame layout: monoscopic, or stereo with the left eye on top (over/under) or on the left (side by side). */
  readonly layout: VrFrameLayout;
  /** Captured horizontal field of view in degrees (360 for a full sphere). */
  readonly horizontalFov: number;
  /** Captured vertical field of view in degrees (180 for a full sphere). */
  readonly verticalFov: number;
  /**
   * Initial view direction a 360 player opens at, written into exports as the sv3d projection header pose (V2) and
   * the InitialView* fields (V1). Absent means straight ahead (0, 0, 0). Sequence only; it never changes the picture.
   */
  readonly initialView?: VrInitialView;
  /** Only on detected values. Absent on user settings. */
  readonly source?: VrSource;
}

export const DEFAULT_VR_PROPERTIES: VrProperties = {
  projection: "equirectangular",
  layout: "mono",
  horizontalFov: 360,
  verticalFov: 180,
};

export const NO_VR: VrProperties = { projection: "none", layout: "mono", horizontalFov: 360, verticalFov: 180 };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Error message for an invalid VR property object, or null when valid. */
export function validateVrProperties(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "VR properties must be an object.";
  const v = value as Record<string, unknown>;
  if (v.projection !== undefined && !VR_PROJECTIONS.includes(v.projection as VrProjection)) {
    return `VR projection must be one of ${VR_PROJECTIONS.join(", ")}.`;
  }
  if (v.layout !== undefined && !VR_LAYOUTS.includes(v.layout as VrFrameLayout)) {
    return `VR layout must be one of ${VR_LAYOUTS.join(", ")}.`;
  }
  if (v.horizontalFov !== undefined && !(finite(v.horizontalFov) && v.horizontalFov >= 1 && v.horizontalFov <= 360)) {
    return "VR horizontal field of view must be between 1 and 360 degrees.";
  }
  if (v.verticalFov !== undefined && !(finite(v.verticalFov) && v.verticalFov >= 1 && v.verticalFov <= 180)) {
    return "VR vertical field of view must be between 1 and 180 degrees.";
  }
  if (v.initialView !== undefined) {
    const iv = v.initialView as Record<string, unknown> | null;
    if (typeof iv !== "object" || iv === null || Array.isArray(iv)) return "VR initial view must be an object with yaw, pitch and roll.";
    for (const key of ["yaw", "pitch", "roll"] as const) {
      if (iv[key] !== undefined && !finite(iv[key])) return `VR initial view ${key} must be a number of degrees.`;
    }
    if (finite(iv.pitch) && Math.abs(iv.pitch) > 90) return "VR initial view pitch must be between -90 and 90 degrees.";
  }
  return null;
}

/** An initial view with yaw and roll wrapped into [-180, 180) and pitch clamped to +/-90; undefined when it is straight ahead. */
export function normalizeInitialView(value: Partial<VrInitialView> | undefined | null): VrInitialView | undefined {
  if (!value) return undefined;
  const fix = (v: unknown): number => (finite(v) ? v : 0);
  const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
  const view = {
    yaw: Math.round(wrap(fix(value.yaw)) * 1000) / 1000,
    pitch: Math.round(Math.min(90, Math.max(-90, fix(value.pitch))) * 1000) / 1000,
    roll: Math.round(wrap(fix(value.roll)) * 1000) / 1000,
  };
  return view.yaw === 0 && view.pitch === 0 && view.roll === 0 ? undefined : view;
}

/** Fills missing fields from the defaults (a plain equirectangular monoscopic 360 x 180 sphere). */
export function normalizeVrProperties(value: Partial<VrProperties> | undefined | null): VrProperties {
  if (!value) return NO_VR;
  const projection = VR_PROJECTIONS.includes(value.projection as VrProjection) ? (value.projection as VrProjection) : "equirectangular";
  if (projection === "none") return NO_VR;
  return {
    projection,
    layout: VR_LAYOUTS.includes(value.layout as VrFrameLayout) ? (value.layout as VrFrameLayout) : "mono",
    horizontalFov: finite(value.horizontalFov) ? Math.min(360, Math.max(1, value.horizontalFov)) : 360,
    verticalFov: finite(value.verticalFov) ? Math.min(180, Math.max(1, value.verticalFov)) : 180,
    ...(normalizeInitialView(value.initialView) ? { initialView: normalizeInitialView(value.initialView) } : {}),
    ...(value.source ? { source: value.source } : {}),
  };
}

export function isVrProperties(value: VrProperties | undefined | null): value is VrProperties {
  return !!value && value.projection !== "none";
}

/** True when a sequence is a VR sequence (exports then carry spherical metadata). */
export function isVrSequence(settings: { readonly vr?: VrProperties } | undefined): boolean {
  return isVrProperties(settings?.vr);
}

/**
 * The VR properties a clip's source is read with: the user's override, else what the file's metadata said, else
 * (only when the picture is 2:1) a suggestion that is NOT treated as VR until the user confirms it.
 */
export function effectiveVrProperties(item: {
  readonly vrProperties?: VrProperties;
  readonly metadata?: { readonly vr?: VrProperties };
}): VrProperties {
  if (item.vrProperties) return normalizeVrProperties(item.vrProperties);
  const detected = item.metadata?.vr;
  if (detected && detected.source !== "aspect") return normalizeVrProperties(detected);
  return NO_VR;
}

/** 2:1 pictures are likely equirectangular 360 (stereo over/under 1:1, side-by-side 4:1). */
export function guessVrFromAspect(width: number, height: number): VrProperties | null {
  if (!(width > 0 && height > 0)) return null;
  const ratio = width / height;
  if (Math.abs(ratio - 2) < 0.02) return { ...DEFAULT_VR_PROPERTIES, source: "aspect" };
  return null;
}

/** One-line description for panels and tool results. */
export function describeVrProperties(vr: VrProperties): string {
  if (vr.projection === "none") return "Not VR";
  const layout = vr.layout === "mono" ? "monoscopic" : vr.layout === "over-under" ? "stereo over/under" : "stereo side by side";
  const view = vr.initialView ? `, initial view heading ${vr.initialView.yaw} pitch ${vr.initialView.pitch} roll ${vr.initialView.roll}` : "";
  return `Equirectangular ${layout}, ${vr.horizontalFov} x ${vr.verticalFov} degrees${view}`;
}
