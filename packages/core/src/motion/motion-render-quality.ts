/** View transform applied at present time. */
export type MotionToneMapping =
  | "agx"
  | "aces"
  | "filmic"
  | "neutral"
  | "linear"
  | "none";

export interface MotionRenderQuality {
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly environment: boolean;
  /** Cinematic post-processing (bloom + optional AO/DOF). Off for fast preview. */
  readonly postProcessing?: boolean;
  /** UnrealBloom strength when postProcessing is on. */
  readonly bloomStrength?: number;
  /** Screen-space ambient occlusion (GTAO). */
  readonly ambientOcclusion?: boolean;
  /** Cinematic depth-of-field (Bokeh), focused on the camera target. */
  readonly depthOfField?: boolean;
  /** DOF aperture when depthOfField is on. */
  readonly dofAperture?: number;
  /** MSAA samples for the post-processing pipeline (0 disables). */
  readonly antialiasSamples?: number;
  /** Defaults to AgX. */
  readonly toneMapping?: MotionToneMapping;
  /** Tonemap exposure multiplier. */
  readonly exposure?: number;
  /** Soft area key light. */
  readonly softLighting?: boolean;
  /** Image-based-lighting intensity. */
  readonly environmentIntensity?: number;
}

export const DEFAULT_ENVIRONMENT_INTENSITY = 0.85;

export const DEFAULT_MOTION_RENDER_QUALITY: MotionRenderQuality = {
  shadows: true,
  shadowMapSize: 2048,
  environment: true,
  postProcessing: true,
  bloomStrength: 0.34,
  ambientOcclusion: true,
  depthOfField: true,
  dofAperture: 0.0016,
  antialiasSamples: 4,
  toneMapping: "agx",
  exposure: 1,
  softLighting: true,
  environmentIntensity: DEFAULT_ENVIRONMENT_INTENSITY,
};

export function mergeMotionRenderQuality(
  partial?: Partial<MotionRenderQuality>,
): MotionRenderQuality {
  return { ...DEFAULT_MOTION_RENDER_QUALITY, ...(partial ?? {}) };
}
