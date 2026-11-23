/**
 * Premiere's Time Interpolation for retimed footage: how a frame is produced when the source time of a
 * program frame falls between two source frames (slow motion, speed ramps, frame-rate conform, reverse).
 *
 *  - frameSampling: repeat the nearest earlier source frame (the default, the behaviour before this setting).
 *  - frameBlending: weighted blend of the two nearest source frames.
 *  - opticalFlow:   dense motion estimation + warp of both frames to the in-between instant.
 */
export const TIME_INTERPOLATION_MODES = ["frameSampling", "frameBlending", "opticalFlow"] as const;
export type TimeInterpolation = (typeof TIME_INTERPOLATION_MODES)[number];

export const TIME_INTERPOLATION_LABELS: Readonly<Record<TimeInterpolation, string>> = {
  frameSampling: "Frame Sampling",
  frameBlending: "Frame Blending",
  opticalFlow: "Optical Flow",
};

export function isTimeInterpolation(value: unknown): value is TimeInterpolation {
  return typeof value === "string" && (TIME_INTERPOLATION_MODES as readonly string[]).includes(value);
}

export interface TimeInterpolationClipFields {
  readonly timeInterpolation?: TimeInterpolation;
  /** Legacy (before timeInterpolation): "Smooth Slow Motion" meant optical flow on slowed clips. */
  readonly smoothSlowMo?: boolean;
  readonly speed?: number;
}

/**
 * The mode a clip renders with. An explicit setting wins; projects saved before the setting existed
 * carry smoothSlowMo, which meant optical flow on a slowed clip.
 */
export function effectiveTimeInterpolation(clip: TimeInterpolationClipFields): TimeInterpolation {
  if (isTimeInterpolation(clip.timeInterpolation)) return clip.timeInterpolation;
  if (clip.smoothSlowMo === true && (clip.speed ?? 1) < 1) return "opticalFlow";
  return "frameSampling";
}

/** True when the clip's frames between two source frames are made rather than sampled (it must render through the engine). */
export function clipHasTimeInterpolation(clip: TimeInterpolationClipFields): boolean {
  return effectiveTimeInterpolation(clip) !== "frameSampling";
}

export type InterpolationQuality = "low" | "medium" | "high";

/** Tunables of the dense-flow interpolator; every one changes the pixels so all are part of cache keys. */
export interface FlowParams {
  /** The flow is estimated on a luma image no larger than this on its long side (integer box downsample). */
  readonly maxDim: number;
  readonly levels: number;
  /** Lucas-Kanade refinements per pyramid level. */
  readonly iterations: number;
  /** Window radius (window is 2r+1 square). */
  readonly radius: number;
}

export const FLOW_QUALITY_PRESETS: Readonly<Record<InterpolationQuality, FlowParams>> = {
  low: { maxDim: 240, levels: 3, iterations: 2, radius: 3 },
  medium: { maxDim: 384, levels: 4, iterations: 3, radius: 3 },
  high: { maxDim: 512, levels: 5, iterations: 4, radius: 3 },
};

export function flowParamsFor(quality: InterpolationQuality | undefined): FlowParams {
  return FLOW_QUALITY_PRESETS[quality ?? "medium"] ?? FLOW_QUALITY_PRESETS.medium;
}

export function flowParamsKey(p: FlowParams): string {
  return `${p.maxDim}.${p.levels}.${p.iterations}.${p.radius}`;
}

/** Fixed numeric constants shared by the CPU reference and the WGSL kernels (see optical-flow-wgsl.ts). */
export const FLOW_CONSTANTS = {
  /** Tikhonov term per window tap, in (luma/px)^2 units. */
  lambdaPerTap: 0.01,
  /** Local contrast normalisation of the luma the flow is estimated on (radius, floor of the local deviation). */
  normRadius: 4,
  normEps: 0.03,
  /** Windowed mean |A' - B'(x+f)| (contrast-normalised luma): confidence is 1 below Lo and 0 above Hi. */
  matchLo: 0.35,
  matchHi: 0.9,
  matchRadius: 2,
  /** A warped match only counts while its error is below this multiple of the unmoved error. */
  gateRatio: 0.9,
  gateSoftness: 0.3,
  /** Largest single LK update, flow-resolution pixels. */
  maxStep: 1.5,
  /** Forward-backward threshold: e2 < thrBase + thrRel*(|f|^2+|g|^2) is consistent. */
  consistencyBase: 0.5,
  consistencyRel: 0.01,
  /** Photometric sigma for the matched pair (mean abs RGB difference / 255). */
  photometricSigma: 0.25,
  /** Weight of the plain blend that always takes part so a zero-confidence pixel is never empty. */
  blendFloor: 0.01,
  fixedPointIterations: 3,
} as const;

/** Two source frames and the position of the sampled source time between them. */
export interface SourceSamplePlan {
  readonly needsInterpolation: boolean;
  readonly frameBefore: number;
  readonly frameAfter: number;
  /** Source time of the earlier / later frame, seconds. */
  readonly timeBefore: number;
  readonly timeAfter: number;
  /** 0..1 position between them. */
  readonly t: number;
}

/** Fractions this close to a source frame are that frame (no blend), like the existing sampling. */
export const INTERPOLATION_SNAP = 0.01;

export function planSourceSamples(sourceTime: number, sourceFps: number): SourceSamplePlan {
  const fps = sourceFps > 0 ? sourceFps : 30;
  const exact = sourceTime * fps;
  const nearest = Math.round(exact);
  if (Math.abs(exact - nearest) <= INTERPOLATION_SNAP) {
    return { needsInterpolation: false, frameBefore: nearest, frameAfter: nearest, timeBefore: nearest / fps, timeAfter: nearest / fps, t: 0 };
  }
  const before = Math.floor(exact);
  return {
    needsInterpolation: true,
    frameBefore: before,
    frameAfter: before + 1,
    timeBefore: before / fps,
    timeAfter: (before + 1) / fps,
    t: exact - before,
  };
}
