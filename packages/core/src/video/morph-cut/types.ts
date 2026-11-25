/**
 * Morph Cut: a transition for jump cuts between two parts of the same (or a very similar) shot. The two
 * reference frames at the cut (the outgoing clip's last frame, the incoming clip's first frame) are analysed once:
 * a global similarity alignment from robust feature matches, then the dense bidirectional optical flow of
 * time-interpolation on what is left. The result is a displacement field in both directions that the renderer
 * applies to the live frames of the transition span (warp both toward each other, then a confidence weighted
 * cross dissolve). Until the analysis is ready the transition renders as a cross dissolve; if the two shots are
 * too different it stays one and says so.
 */
export type MorphCutQuality = "low" | "medium" | "high";

export const MORPH_CUT_QUALITIES: readonly MorphCutQuality[] = ["low", "medium", "high"];

/** Bumped whenever the analysis changes its output, so a cached field of an older algorithm is never reused. */
export const MORPH_CUT_VERSION = 1;

export const MORPH_CUT_FAILED_MESSAGE = "Morph Cut could not align these shots";
export const MORPH_CUT_ANALYSING_MESSAGE = "Analysing in background";

export interface MorphCutFlowSettings {
  /** The analysis runs on frames no larger than this on the long side. */
  readonly maxDim: number;
  readonly levels: number;
  readonly iterations: number;
  readonly radius: number;
}

/** Coarser, deeper pyramids than Time Interpolation: the pose difference of a jump cut can be tens of pixels. */
export const MORPH_CUT_FLOW: Readonly<Record<MorphCutQuality, MorphCutFlowSettings>> = {
  low: { maxDim: 256, levels: 5, iterations: 3, radius: 4 },
  medium: { maxDim: 384, levels: 6, iterations: 4, radius: 4 },
  high: { maxDim: 512, levels: 6, iterations: 5, radius: 4 },
};

export function morphCutQualityOf(params: Record<string, unknown> | undefined): MorphCutQuality {
  const q = params?.quality;
  return q === "low" || q === "high" ? q : "medium";
}

/** Constants of the quality gate and the global alignment; all of them change the verdict, so all are versioned with MORPH_CUT_VERSION. */
export const MORPH_CUT_CONSTANTS = {
  /** Feature detection: corners per frame, minimum spacing (px at analysis size), border margin. */
  maxFeatures: 300,
  featureSpacing: 6,
  featureMargin: 10,
  /** Patch radius used for normalised cross-correlation matching (patch is 2r+1 square). */
  patchRadius: 5,
  /** A match needs at least this NCC, and the best must beat the runner-up by this ratio of (1 - ncc). */
  minNcc: 0.8,
  ratio: 0.8,
  /** RANSAC similarity: iterations, inlier distance (px), deterministic seed. */
  ransacIterations: 400,
  inlierDistance: 2.5,
  seed: 0x9e3779b1,
  /** A global similarity outside this range is a different shot, not a reframe. */
  minScale: 0.6,
  maxScale: 1.7,
  maxRotationDeg: 35,
  /** Needs at least this many inliers to trust the global alignment; with fewer it is the identity. */
  minInliers: 8,
  /** Quality gate on the final field. */
  minConfidentFraction: 0.35,
  minMeanConfidence: 0.3,
  /** The warped A must match B at least this much better than the unaligned pair (error ratio) . */
  maxAlignedErrorRatio: 0.75,
  /** Largest tolerated displacement as a fraction of the frame diagonal. */
  maxDisplacementFraction: 0.35,
} as const;

/** Per-transition status shown on the transition (inspector, timeline) and read by the renderer. */
export type MorphCutStatus = "idle" | "analysing" | "ready" | "failed" | "cancelled";

export interface MorphCutState {
  readonly status: MorphCutStatus;
  /** 0..1 while analysing. */
  readonly progress: number;
  /** User-facing line: "Analysing in background", "Morph Cut could not align these shots", ... */
  readonly message: string;
  /** Cache key of the analysis this state belongs to. */
  readonly key?: string;
  readonly analysisMs?: number;
  readonly backend?: "gpu" | "cpu";
  /** 0..1 overall confidence of a finished analysis (also reported for a failed one). */
  readonly confidence?: number;
}

export const MORPH_CUT_CANCELLED_MESSAGE = "Morph Cut analysis was cancelled";

export const IDLE_MORPH_CUT_STATE: MorphCutState = { status: "idle", progress: 0, message: "" };

/**
 * A finished analysis: displacement fields in both directions on a grid of fw x fh cells, in units of grid
 * cells (so the field is independent of the size it is rendered at; render at W x H scales by W / fw).
 */
export interface MorphField {
  readonly width: number;
  readonly height: number;
  /** Interleaved (dx, dy) in grid pixels: A -> B and B -> A. */
  readonly ab: Float32Array;
  readonly ba: Float32Array;
  readonly confAB: Float32Array;
  readonly confBA: Float32Array;
}

export interface MorphMetrics {
  readonly confidence: number;
  readonly confidentFraction: number;
  readonly meanConfidence: number;
  readonly alignedErrorRatio: number;
  readonly inliers: number;
  readonly matches: number;
  readonly maxDisplacementFraction: number;
  readonly similarity: { readonly scale: number; readonly rotationDeg: number; readonly tx: number; readonly ty: number };
}

export interface MorphAnalysis {
  readonly key: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly field: MorphField | null;
  readonly metrics: MorphMetrics;
  readonly backend: "gpu" | "cpu";
  readonly analysisMs: number;
}
