/**
 * Warp Stabilizer (Premiere): settings and the cached analysis of one clip.
 *
 * The analysis is the expensive, setting-independent half (the measured camera motion between consecutive
 * frames). Everything the user can switch afterwards (Result, Smoothness, Method, Framing, Rolling Shutter,
 * Crop Less / Smooth More) is derived from it in `plan.ts`, so changing a setting never re-analyses.
 */
export type WarpResult = "smoothMotion" | "noMotion";
export type WarpMethod = "position" | "positionScaleRotation" | "perspective";
export type WarpFraming = "stabilizeOnly" | "stabilizeCrop" | "stabilizeCropAutoScale" | "synthesizeEdges";
export type RollingShutterMode = "off" | "automatic" | "enhanced";

export const WARP_RESULTS: readonly WarpResult[] = ["smoothMotion", "noMotion"];
export const WARP_METHODS: readonly WarpMethod[] = ["position", "positionScaleRotation", "perspective"];
export const WARP_FRAMINGS: readonly WarpFraming[] = ["stabilizeOnly", "stabilizeCrop", "stabilizeCropAutoScale", "synthesizeEdges"];
export const ROLLING_SHUTTER_MODES: readonly RollingShutterMode[] = ["off", "automatic", "enhanced"];

export const WARP_RESULT_LABELS: Record<WarpResult, string> = { smoothMotion: "Smooth Motion", noMotion: "No Motion" };
export const WARP_METHOD_LABELS: Record<WarpMethod, string> = {
  position: "Position",
  positionScaleRotation: "Position, Scale, Rotation",
  perspective: "Perspective",
};
export const WARP_FRAMING_LABELS: Record<WarpFraming, string> = {
  stabilizeOnly: "Stabilize Only",
  stabilizeCrop: "Stabilize, Crop",
  stabilizeCropAutoScale: "Stabilize, Crop, Auto-scale",
  synthesizeEdges: "Stabilize, Synthesize Edges",
};
export const ROLLING_SHUTTER_LABELS: Record<RollingShutterMode, string> = {
  off: "Off",
  automatic: "Automatic Reduction",
  enhanced: "Enhanced Reduction",
};

export interface WarpSettings {
  readonly result: WarpResult;
  /** Smooth Motion only: 0 to 100 %. Higher follows the shot's intended camera move more loosely. */
  readonly smoothness: number;
  readonly method: WarpMethod;
  readonly framing: WarpFraming;
  readonly rollingShutter: RollingShutterMode;
  /** Crop framings only: 0 = crop less (smoothing gives way), 100 = smooth more (crop as much as it needs). */
  readonly cropLessSmoothMore: number;
}

export const DEFAULT_WARP_SETTINGS: WarpSettings = {
  result: "smoothMotion",
  smoothness: 50,
  method: "positionScaleRotation",
  framing: "stabilizeCropAutoScale",
  rollingShutter: "off",
  cropLessSmoothMore: 50,
};

export const WARP_ANALYSIS_VERSION = 4;
/** Motion values stored per analysed frame (see `FRAME_STRIDE`). */
export const FRAME_STRIDE = 8;

/**
 * Measured camera motion. `motion` holds `FRAME_STRIDE` numbers per analysed frame, the motion of the picture
 * from the previous frame to this one (frame 0 is all zeros), in analysis pixels / radians / log scale:
 * dx, dy, rotation, logScale, perspective x, perspective y (per analysis half-width), shear x, shear y (the
 * change of that frame's horizontal / vertical motion from its top row to its bottom row, in analysis pixels).
 */
export interface WarpAnalysis {
  readonly version: number;
  /** Analysed frames per second of source time. */
  readonly fps: number;
  /** Source time of analysed frame 0. */
  readonly startTime: number;
  readonly frameCount: number;
  /** Analysis picture size the pixel values are in. */
  readonly width: number;
  readonly height: number;
  readonly motion: number[];
  /** Mean alignment quality 0..1 (1 = every block agreed). */
  readonly confidence: number;
}

export function clampPercent(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
}

/** Any stored value into valid settings (project files and agent input are not trusted). */
export function normalizeWarpSettings(input: Partial<WarpSettings> | null | undefined): WarpSettings {
  const d = DEFAULT_WARP_SETTINGS;
  const value = input ?? {};
  return {
    result: WARP_RESULTS.includes(value.result as WarpResult) ? (value.result as WarpResult) : d.result,
    smoothness: clampPercent(value.smoothness, d.smoothness),
    method: WARP_METHODS.includes(value.method as WarpMethod) ? (value.method as WarpMethod) : d.method,
    framing: WARP_FRAMINGS.includes(value.framing as WarpFraming) ? (value.framing as WarpFraming) : d.framing,
    rollingShutter: ROLLING_SHUTTER_MODES.includes(value.rollingShutter as RollingShutterMode)
      ? (value.rollingShutter as RollingShutterMode)
      : d.rollingShutter,
    cropLessSmoothMore: clampPercent(value.cropLessSmoothMore, d.cropLessSmoothMore),
  };
}

const validatedAnalyses = new WeakSet<object>();

/** Structural check of a stored analysis (project files are not trusted: a NaN or zero size would poison every frame). */
export function isWarpAnalysis(value: unknown): value is WarpAnalysis {
  if (!value || typeof value !== "object") return false;
  if (validatedAnalyses.has(value)) return true;
  const a = value as Partial<WarpAnalysis>;
  const ok =
    a.version === WARP_ANALYSIS_VERSION &&
    typeof a.fps === "number" && Number.isFinite(a.fps) && a.fps > 0 &&
    typeof a.startTime === "number" && Number.isFinite(a.startTime) &&
    typeof a.frameCount === "number" && Number.isInteger(a.frameCount) && a.frameCount >= 1 &&
    typeof a.width === "number" && Number.isFinite(a.width) && a.width > 0 &&
    typeof a.height === "number" && Number.isFinite(a.height) && a.height > 0 &&
    Array.isArray(a.motion) && a.motion.length === a.frameCount * FRAME_STRIDE &&
    a.motion.every((v) => typeof v === "number" && Number.isFinite(v));
  if (ok) validatedAnalyses.add(value);
  return ok;
}
