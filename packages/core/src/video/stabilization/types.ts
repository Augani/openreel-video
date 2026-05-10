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

export interface StabilizationProfile {
  clipId: string;
  samples: MotionSample[];
  corrections: CorrectionTransform[];
  maxDisplacement: number;
  frameInterval: number;
  duration: number;
}

export interface StabilizationConfig {
  strength: number;
  cropMode: "auto" | "none";
  analysisInterval: number;
}

export const DEFAULT_STABILIZATION_CONFIG: StabilizationConfig = {
  strength: 50,
  cropMode: "auto",
  analysisInterval: 2,
};
