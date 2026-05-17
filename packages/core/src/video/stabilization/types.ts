export interface MotionSample {
  time: number;
  dx: number;
  dy: number;
  rotation: number;
}

export interface CorrectionTransform {
  dx: number;
  dy: number;
  rotation: number;
  scale: number;
}

export interface StabilizationRenderContext {
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface StabilizationProfile {
  clipId: string;
  samples: MotionSample[];
  corrections: CorrectionTransform[];
  maxDisplacement: number;
  frameInterval: number;
  duration: number;
  sourceStartTime: number;
  analysisDimensions: {
    width: number;
    height: number;
  };
}

export interface StabilizationConfig {
  strength: number;
  cropMode: "auto" | "none";
  analysisInterval: number;
}

export const STABILIZATION_ANALYSIS_VERSION = 3;

export const DEFAULT_STABILIZATION_CONFIG: StabilizationConfig = {
  strength: 50,
  cropMode: "auto",
  analysisInterval: 2,
};
