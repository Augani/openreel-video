import {
  type VideoEffectsEngine,
  type ColorGradingEngine,
  type Renderer,
  type ColorWheelValues,
  type CurvesValues,
  type HSLValues,
  type LUTData,
  type ClipLutJson,
  lutToJson,
  lutFromJson,
  type ToneValues,
  type VignetteValues,
  type HueCurvesValues,
  planColorGrading,
  whiteBalanceInputGrading,
  DEFAULT_COLOR_WHEELS,
  DEFAULT_CURVES,
  DEFAULT_HSL,
  isNeutralColorGrading,
  type ProEffectType,
  type BurnInEffectType,
} from "@openreel/core";
import type { Effect } from "@openreel/core";
import { v4 as uuidv4 } from "uuid";
import { getLoadedEngineModules, loadEngineModules } from "../services/lazy-engines";

type EffectsChangeCallback = (clipId: string, effects: Effect[]) => void;

export type VideoEffectType =
  | "brightness"
  | "contrast"
  | "saturation"
  | "grayscale"
  | "sepia"
  | "invert"
  | "hue"
  | "blur"
  | "sharpen"
  | "vignette"
  | "grain"
  | "temperature"
  | "tint"
  | "tonal"
  | "chromaKey"
  | "shadow"
  | "glow"
  | "motion-blur"
  | "radial-blur"
  | "chromatic-aberration"
  | ProEffectType
  | BurnInEffectType
  | "shader"
  /** Third-party effect plugin: `plugin:<pluginId>` (see packages/core/src/plugins). */
  | `plugin:${string}`;

/**
 * Video effect with full metadata
 */
export interface VideoEffect {
  id: string;
  type: VideoEffectType;
  enabled: boolean;
  params: Record<string, unknown>;
  order: number;
  metadata?: Effect["metadata"];
}

/**
 * Color grading settings for a clip
 */
export interface ColorGradingSettings {
  colorWheels?: ColorWheelValues;
  curves?: CurvesValues;
  lut?: LUTData;
  /** Input LUT: applied before every other grading stage. */
  inputLut?: LUTData;
  hsl?: HSLValues;
  /** Temperature shift in range [-100, 100]. Negative = cool/blue, positive = warm/orange */
  temperature?: number;
  /** Tint shift in range [-100, 100]. Negative = green, positive = magenta */
  tint?: number;
  /** Basic Correction sliders, each -1..1. Absent means neutral. */
  tone?: ToneValues;
  /** Radial vignette. Absent means off. */
  vignette?: VignetteValues;
  /** Hue vs Sat / Hue vs Hue / Hue vs Luma / Luma vs Sat curves. Rendered by pipeline version 2 only. */
  hueCurves?: HueCurvesValues;
  /** Processing order: absent/1 = classic (unchanged for existing projects), 2 = Premiere order. */
  pipelineVersion?: 1 | 2;
}

/**
 * Effect application result
 */
interface EffectResult {
  success: boolean;
  effectId?: string;
  error?: string;
  processingTime?: number;
}

/**
 * Serialized effect data for persistence
 */
interface SerializedEffect {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, unknown>;
  order: number;
  metadata?: Effect["metadata"];
}

/**
 * Serialized color grading data for persistence
 */
interface SerializedColorGrading {
  colorWheels?: ColorWheelValues;
  curves?: CurvesValues;
  lut?: ClipLutJson;
  inputLut?: ClipLutJson;
  hsl?: HSLValues;
  temperature?: number;
  tint?: number;
  tone?: ToneValues;
  vignette?: VignetteValues;
  hueCurves?: HueCurvesValues;
  pipelineVersion?: 1 | 2;
}

/**
 * EffectsBridge class for connecting UI to video effects functionality
 *
 * - 1.1: Use WebGPU for video frame rendering when available
 * - 1.2: Apply video effects within 200ms
 * - 1.3: Reset effects to restore original state
 * - 1.4: Process effects in UI order
 * - 2.5: Re-render current frame when effects change within 100ms
 * - 11.1: Update effect order in clip's effect list
 * - 11.2: Process effects in new order after reordering
 */
type GpuGradeRunner = typeof import("@openreel/core/video/gpu-grade-runner");

/** localStorage "openreel-grade-renderer" = "canvas2d" pins the clip effect / grade chain to the Canvas2D / WebGL path. */
function canvas2dGradeForced(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("openreel-grade-renderer") === "canvas2d";
  } catch {
    return false;
  }
}

class EffectsBridgeDisposedError extends Error {
  constructor() {
    super("EffectsBridge was disposed during initialization");
  }
}

export class EffectsBridge {
  private videoEffectsEngine: VideoEffectsEngine | null = null;
  private colorGradingEngine: ColorGradingEngine | null = null;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationGeneration = 0;

  // Store effects per clip
  private clipEffects: Map<string, VideoEffect[]> = new Map();
  private clipColorGrading: Map<string, ColorGradingSettings> = new Map();
  /**
   * Preview-only parameter overrides by effect id (the HSL Secondary matte
   * view). Never serialized and never read by the export pipeline.
   */
  private transientEffectParams: Map<string, Record<string, unknown>> = new Map();
  private whiteBalanceInputClip: string | null = null;

  // WebGPU renderer support
  // Note: Actual rendering is delegated to VideoEffectsEngine which handles
  // WebGPU/WebGL2 fallback internally via RendererFactory
  private renderer: Renderer | null = null;

  // Effects change callbacks for real-time updates
  private effectsChangeCallbacks: EffectsChangeCallback[] = [];
  private pendingReRenders: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Initialize the effects bridge
   * Connects to VideoEffectsEngine and ColorGradingEngine
   *
   * - 1.1: Use WebGPU for video frame rendering when available
   * - 1.2: Fall back to WebGL2 when WebGPU is not available
   */
  initialize(width: number = 1920, height: number = 1080): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (this.initializationPromise) return this.initializationPromise;

    const promise = this.initializeEngines(
      width,
      height,
      this.initializationGeneration,
    );
    this.initializationPromise = promise;
    const clearPromise = () => {
      if (this.initializationPromise === promise) this.initializationPromise = null;
    };
    void promise.then(clearPromise, clearPromise);
    return promise;
  }

  private async initializeEngines(
    width: number,
    height: number,
    generation: number,
  ): Promise<void> {
    let videoEffectsEngine: VideoEffectsEngine | null = null;
    let colorGradingEngine: ColorGradingEngine | null = null;
    try {
      // Synchronous when the modules are resolved, so engine creation keeps its timing.
      const engines = getLoadedEngineModules() ?? (await loadEngineModules());
      if (generation !== this.initializationGeneration) {
        throw new EffectsBridgeDisposedError();
      }
      videoEffectsEngine = new engines.VideoEffectsEngine({
        width,
        height,
        useGPU: true,
        preferWebGPU: engines.isWebGPUSupported(),
      });
      this.videoEffectsEngine = videoEffectsEngine;
      await videoEffectsEngine.initialize();

      if (generation !== this.initializationGeneration) {
        throw new EffectsBridgeDisposedError();
      }

      colorGradingEngine = new engines.ColorGradingEngine(width, height);
      // No initialize(): the engine creates its GL context and compiles the colour wheels program
      // on the first applyColorWheels call (editor warm-up no longer pays a GPU round trip for it).
      this.colorGradingEngine = colorGradingEngine;

      this.initialized = true;
    } catch (error) {
      // GPU setup may finish after disposal. Release resources created by the
      // old operation without touching a replacement initialization's engines.
      videoEffectsEngine?.dispose();
      colorGradingEngine?.dispose();
      if (this.videoEffectsEngine === videoEffectsEngine) {
        this.videoEffectsEngine = null;
      }
      // Keep the disposal type so callers can tell a cancelled init from a failure.
      if (error instanceof EffectsBridgeDisposedError) throw error;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(`EffectsBridge initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Apply a video effect to a clip
   *
   * Apply video effect within 200ms
   *
   * @param clipId - The clip to apply the effect to
   * @param effectType - The type of effect to apply
   * @param params - Effect parameters
   * @returns Effect application result
   */
  applyVideoEffect(
    clipId: string,
    effectType: VideoEffectType,
    params: Record<string, unknown> = {},
  ): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const effects = this.clipEffects.get(clipId) || [];
    const newEffect: VideoEffect = {
      id: uuidv4(),
      type: effectType,
      enabled: true,
      params: { ...this.getDefaultParams(effectType), ...params },
      order: effects.length,
    };

    effects.push(newEffect);
    this.clipEffects.set(clipId, effects);

    return { success: true, effectId: newEffect.id };
  }

  /**
   * Remove a video effect from a clip
   *
   * Restore clip to previous state when effect removed
   *
   * @param clipId - The clip to remove the effect from
   * @param effectId - The effect to remove
   * @returns Effect removal result
   */
  removeVideoEffect(clipId: string, effectId: string): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const effects = this.clipEffects.get(clipId);
    if (!effects) {
      return { success: false, error: "No effects found for clip" };
    }

    const index = effects.findIndex((e) => e.id === effectId);
    if (index === -1) {
      return { success: false, error: "Effect not found" };
    }

    effects.splice(index, 1);

    // Reorder remaining effects
    effects.forEach((effect, i) => {
      effect.order = i;
    });

    this.clipEffects.set(clipId, effects);
    return { success: true };
  }

  /**
   * Update a video effect's parameters
   *
   * - 1.2: Apply changes within 200ms
   * - 2.5: Re-render current frame when effects change within 100ms
   *
   * @param clipId - The clip containing the effect
   * @param effectId - The effect to update
   * @param params - New parameters
   * @returns Effect update result
   */
  updateVideoEffect(
    clipId: string,
    effectId: string,
    params: Record<string, unknown>,
  ): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const effects = this.clipEffects.get(clipId);
    if (!effects) {
      return { success: false, error: "No effects found for clip" };
    }

    const effect = effects.find((e) => e.id === effectId);
    if (!effect) {
      return { success: false, error: "Effect not found" };
    }

    effect.params = { ...effect.params, ...params };

    // Trigger re-render for real-time updates
    this.notifyEffectsChanged(clipId);

    return { success: true, effectId };
  }

  /**
   * Reorder effects in the processing chain
   *
   * Update effect order and process in new order
   *
   * @param clipId - The clip to reorder effects for
   * @param effectIds - Array of effect IDs in new order
   * @returns Reorder result
   */
  reorderEffects(clipId: string, effectIds: string[]): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const effects = this.clipEffects.get(clipId);
    if (!effects) {
      return { success: false, error: "No effects found for clip" };
    }

    // Validate all effect IDs exist
    const effectMap = new Map(effects.map((e) => [e.id, e]));
    for (const id of effectIds) {
      if (!effectMap.has(id)) {
        return { success: false, error: `Effect ${id} not found` };
      }
    }

    // Reorder effects according to new order
    const reorderedEffects: VideoEffect[] = [];
    effectIds.forEach((id, index) => {
      const effect = effectMap.get(id)!;
      effect.order = index;
      reorderedEffects.push(effect);
    });

    this.clipEffects.set(clipId, reorderedEffects);
    return { success: true };
  }

  /**
   * Get all effects for a clip in order
   *
   * @param clipId - The clip to get effects for
   * @returns Array of effects sorted by order
   */
  /** Set (or clear with null) a preview-only parameter override for one effect. */
  setTransientEffectParams(
    effectId: string,
    params: Record<string, unknown> | null,
  ): void {
    if (params) this.transientEffectParams.set(effectId, params);
    else this.transientEffectParams.delete(effectId);
  }

  /** The effect as the preview should render it (stored params + overrides). */
  withTransientParams<T extends { id: string; params: Record<string, unknown> }>(
    effect: T,
  ): T {
    const override = this.transientEffectParams.get(effect.id);
    return override
      ? { ...effect, params: { ...effect.params, ...override } }
      : effect;
  }

  getEffects(clipId: string): VideoEffect[] {
    const effects = this.clipEffects.get(clipId) || [];
    return [...effects].sort((a, b) => a.order - b.order);
  }

  getNativeCssFilter(clipId: string): string | null {
    if (!this.initialized || !this.videoEffectsEngine) {
      return null;
    }

    const enabledEffects = this.getEffects(clipId).filter((e) => e.enabled);
    if (enabledEffects.length === 0) {
      return null;
    }

    const colorGrading = this.getColorGrading(clipId);
    if (
      Object.keys(colorGrading).length > 0 &&
      !isNeutralColorGrading(colorGrading)
    ) {
      return null;
    }

    const engineEffects: Effect[] = enabledEffects.map((e) => ({
      id: e.id,
      type: e.type,
      enabled: e.enabled,
      params: e.params,
    }));

    return this.videoEffectsEngine.getCssFilterString(engineEffects);
  }

  /**
   * Get a specific effect by ID
   *
   * @param clipId - The clip containing the effect
   * @param effectId - The effect ID
   * @returns The effect or undefined
   */
  getEffect(clipId: string, effectId: string): VideoEffect | undefined {
    const effects = this.clipEffects.get(clipId);
    return effects?.find((e) => e.id === effectId);
  }

  /**
   * Toggle effect enabled state
   *
   * @param clipId - The clip containing the effect
   * @param effectId - The effect to toggle
   * @param enabled - New enabled state
   * @returns Toggle result
   */
  toggleEffect(
    clipId: string,
    effectId: string,
    enabled: boolean,
  ): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const effects = this.clipEffects.get(clipId);
    if (!effects) {
      return { success: false, error: "No effects found for clip" };
    }

    const effect = effects.find((e) => e.id === effectId);
    if (!effect) {
      return { success: false, error: "Effect not found" };
    }

    effect.enabled = enabled;
    return { success: true, effectId };
  }

  /**
   * Reset an effect to default parameters
   *
   * Reset filter value to restore previous state
   *
   * @param clipId - The clip containing the effect
   * @param effectId - The effect to reset
   * @returns Reset result
   */
  resetEffect(clipId: string, effectId: string): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const effects = this.clipEffects.get(clipId);
    if (!effects) {
      return { success: false, error: "No effects found for clip" };
    }

    const effect = effects.find((e) => e.id === effectId);
    if (!effect) {
      return { success: false, error: "Effect not found" };
    }

    effect.params = this.getDefaultParams(effect.type);
    return { success: true, effectId };
  }

  /**
   * Process an image through all effects for a clip
   *
   * Process effects in order
   *
   * @param clipId - The clip to process effects for
   * @param image - The source image
   * @returns Processed image result
   */
  async processEffects(
    clipId: string,
    image: ImageBitmap,
  ): Promise<{ image: ImageBitmap; processingTime: number }> {
    if (!this.initialized || !this.videoEffectsEngine) {
      return { image, processingTime: 0 };
    }

    const effects = this.getEffects(clipId);
    if (effects.length === 0) {
      return { image, processingTime: 0 };
    }

    // Filter to only enabled effects
    const enabledEffects = effects.filter((e) => e.enabled);
    if (enabledEffects.length === 0) {
      return { image, processingTime: 0 };
    }

    try {
      // Convert VideoEffect[] to Effect[] for the engine
      const engineEffects: Effect[] = enabledEffects.map((e) => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        params: this.withTransientParams(e).params,
      }));

      const result = await this.videoEffectsEngine.applyEffects(
        image,
        engineEffects,
      );

      // Validate the result
      if (
        !result.image ||
        result.image.width === 0 ||
        result.image.height === 0
      ) {
        console.warn(
          "[EffectsBridge] Effects processing returned invalid image",
        );
        return { image, processingTime: result.processingTime };
      }

      return {
        image: result.image,
        processingTime: result.processingTime,
      };
    } catch (error) {
      console.error("[EffectsBridge] Effects processing failed:", error);
      return { image, processingTime: 0 };
    }
  }

  private gradeRunner: GpuGradeRunner | null = null;
  private gradeLoading: Promise<void> | null = null;
  private gradeChain: InstanceType<GpuGradeRunner["GpuGradeChain"]> | null = null;
  private gradeChainOff: boolean | null = null;

  /**
   * The clip's whole effect stack and colour grade on the WebGPU grade chain: one upload, every pass on the GPU, a
   * GPU-backed bitmap back. Null means "use processEffects / processColorGrading": WebGPU is missing, the chain is
   * still loading (it is a lazy chunk), a stage has no WGSL port, or the chain failed (it then stays off).
   * `animated` is the sampled effect stack of a keyframed clip; `sampled` the sampled grade values.
   */
  async processClipChainGpu(
    clipId: string,
    image: ImageBitmap,
    animated: readonly Effect[] | null,
    sampled?: Pick<ColorGradingSettings, "tone" | "vignette" | "temperature" | "tint" | "hueCurves">,
  ): Promise<ImageBitmap | null> {
    if (!this.initialized) return null;
    this.gradeChainOff ??= canvas2dGradeForced() || typeof navigator === "undefined" || !(navigator as { gpu?: unknown }).gpu;
    if (this.gradeChainOff) return null;
    if (!this.gradeRunner) {
      this.gradeLoading ??= import("@openreel/core/video/gpu-grade-runner").then(
        (module) => {
          this.gradeRunner = module;
        },
        () => {
          this.gradeChainOff = true;
        },
      );
      return null;
    }
    const runner = this.gradeRunner;
    this.gradeChain ??= new runner.GpuGradeChain();
    const stack: Effect[] = (animated ?? this.getEffects(clipId))
      .filter((effect) => effect.enabled !== false)
      .map((effect) => ({ id: effect.id, type: effect.type, enabled: true, params: this.withTransientParams(effect).params }));
    const grading: ColorGradingSettings = { ...this.getColorGrading(clipId), ...sampled };
    const result = await runner.runGpuGrade(this.gradeChain, image, stack, grading);
    if (!result && this.gradeChain.broken) this.gradeChainOff = true;
    return result;
  }

  /** Activity of the live preview's WebGPU grade chain (null until the first frame needed it). */
  getGpuGradeStats(): { frames: number; fallbacks: number; readbacks: number; meanCpuMs: number } | null {
    return this.gradeChain ? { ...this.gradeChain.stats } : null;
  }

  /** Process an explicit effect stack, used by timeline adjustment layers. */
  async processEffectList(
    image: ImageBitmap,
    effects: readonly Effect[],
  ): Promise<ImageBitmap> {
    if (!this.initialized || !this.videoEffectsEngine) return image;
    const enabled = effects
      .filter((effect) => effect.enabled !== false)
      .map((effect) => this.withTransientParams(effect));
    if (enabled.length === 0) return image;
    try {
      const result = await this.videoEffectsEngine.applyEffects(image, enabled);
      return result.image?.width > 0 && result.image.height > 0
        ? result.image
        : image;
    } catch (error) {
      console.error("[EffectsBridge] Adjustment layer processing failed:", error);
      return image;
    }
  }

  async processEffectsToCanvas(
    clipId: string,
    image: ImageBitmap,
  ): Promise<OffscreenCanvas | null> {
    if (!this.initialized || !this.videoEffectsEngine) {
      return null;
    }

    const effects = this.getEffects(clipId);
    if (effects.length === 0) {
      return null;
    }

    const enabledEffects = effects.filter((e) => e.enabled);
    if (enabledEffects.length === 0) {
      return null;
    }

    try {
      const engineEffects: Effect[] = enabledEffects.map((e) => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        params: this.withTransientParams(e).params,
      }));

      const canvas = await this.videoEffectsEngine.applyEffectsToCanvas(
        image,
        engineEffects,
      );

      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        return null;
      }

      return canvas;
    } catch (error) {
      console.error(
        "[EffectsBridge] Effects-to-canvas processing failed:",
        error,
      );
      return null;
    }
  }

  /**
   * Get default parameters for an effect type
   */
  private getDefaultParams(
    effectType: VideoEffectType,
  ): Record<string, unknown> {
    // Effects only run after the bridge initialised, which loads the engine modules.
    const engines = getLoadedEngineModules();
    const visibleDefaults = engines?.getDefaultEffectParams(effectType);
    if (visibleDefaults) return visibleDefaults;
    switch (effectType) {
      case "brightness":
        return { value: 0 };
      case "contrast":
        return { value: 1 };
      case "saturation":
        return { value: 1 };
      case "grayscale":
      case "sepia":
      case "invert":
        return { amount: 1 };
      case "hue":
        return { rotation: 0 };
      case "blur":
        return { radius: 0, type: "gaussian" };
      case "sharpen":
        return { amount: 0, radius: 1, threshold: 0 };
      case "vignette":
        return { amount: 0, midpoint: 0.5, roundness: 0.5, feather: 0.3 };
      case "grain":
        return { amount: 0, size: 1, roughness: 0.5, colored: false };
      case "temperature":
        return { value: 0 };
      case "tint":
        return { value: 0 };
      case "tonal":
        return { shadows: 0, midtones: 0, highlights: 0 };
      case "chromaKey":
        return {
          keyColor: { r: 0, g: 1, b: 0 },
          tolerance: 0.3,
          edgeSoftness: 0.1,
          spillSuppression: 0.5,
        };
      case "shadow":
        return {
          offsetX: 5,
          offsetY: 5,
          blur: 10,
          opacity: 0.8,
          color: "#000000",
        };
      case "glow":
        return {
          radius: 10,
          intensity: 1,
          color: "#ffffff",
        };
      case "motion-blur":
        return {
          angle: 0,
          distance: 20,
        };
      case "radial-blur":
        return {
          amount: 20,
          centerX: 50,
          centerY: 50,
        };
      case "chromatic-aberration":
        return {
          amount: 5,
          angle: 0,
        };
      default:
        if (engines?.isProEffectType(effectType)) {
          return { ...engines.PRO_EFFECT_DEFAULTS[effectType] };
        }
        return {};
    }
  }

  // ============================================
  // Color Grading Methods
  // ============================================

  /**
   * Apply color wheels adjustment
   *
   * Apply color shift to tonal ranges
   *
   * @param clipId - The clip to apply color wheels to
   * @param values - Color wheel values
   * @returns Application result
   */
  applyColorWheels(clipId: string, values: ColorWheelValues): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const colorGrading = this.clipColorGrading.get(clipId) || {};
    colorGrading.colorWheels = values;
    this.clipColorGrading.set(clipId, colorGrading);

    return { success: true };
  }

  /**
   * Apply curves adjustment
   *
   * Apply curve-based tonal mapping
   *
   * @param clipId - The clip to apply curves to
   * @param curves - Curves values
   * @returns Application result
   */
  applyCurves(clipId: string, curves: CurvesValues): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const colorGrading = this.clipColorGrading.get(clipId) || {};
    colorGrading.curves = curves;
    this.clipColorGrading.set(clipId, colorGrading);

    return { success: true };
  }

  /**
   * Apply LUT (Look-Up Table)
   *
   * Apply 3D LUT with intensity blending
   *
   * @param clipId - The clip to apply LUT to
   * @param lutData - LUT data
   * @returns Application result
   */
  applyLUT(clipId: string, lutData: LUTData): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const colorGrading = this.clipColorGrading.get(clipId) || {};
    colorGrading.lut = lutData;
    this.clipColorGrading.set(clipId, colorGrading);

    return { success: true };
  }

  /**
   * Apply HSL adjustments
   *
   * Apply targeted color range adjustments
   *
   * @param clipId - The clip to apply HSL to
   * @param hsl - HSL values
   * @returns Application result
   */
  applyHSL(clipId: string, hsl: HSLValues): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const colorGrading = this.clipColorGrading.get(clipId) || {};
    colorGrading.hsl = hsl;
    this.clipColorGrading.set(clipId, colorGrading);

    return { success: true };
  }

  /**
   * Apply white balance (temperature + tint) for a clip.
   *
   * @param clipId - The clip to apply white balance to
   * @param values - Temperature ([-100, 100]) and tint ([-100, 100])
   * @returns Application result
   */
  applyWhiteBalance(
    clipId: string,
    values: { temperature?: number; tint?: number },
  ): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    const colorGrading = this.clipColorGrading.get(clipId) || {};
    if (values.temperature !== undefined) {
      colorGrading.temperature = values.temperature;
    }
    if (values.tint !== undefined) {
      colorGrading.tint = values.tint;
    }
    this.clipColorGrading.set(clipId, colorGrading);

    return { success: true };
  }

  /**
   * Get color grading settings for a clip
   *
   * @param clipId - The clip to get settings for
   * @returns Color grading settings
   */
  getColorGrading(clipId: string): ColorGradingSettings {
    const stored = this.clipColorGrading.get(clipId) || {};
    // Preview-only: the white balance eyedropper renders the clip as the white balance stage sees it.
    return clipId === this.whiteBalanceInputClip ? whiteBalanceInputGrading(stored) : stored;
  }

  /** Preview-only view of `clipId` at the white balance stage input (null restores the full grade). Never stored or exported. */
  setWhiteBalanceInputView(clipId: string | null): void {
    this.whiteBalanceInputClip = clipId;
  }

  whiteBalanceInputView(): string | null {
    return this.whiteBalanceInputClip;
  }

  /**
   * Reset color grading to defaults
   *
   * @param clipId - The clip to reset
   * @returns Reset result
   */
  resetColorGrading(clipId: string): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    this.clipColorGrading.set(clipId, {
      colorWheels: { ...DEFAULT_COLOR_WHEELS },
      curves: { ...DEFAULT_CURVES },
      hsl: { ...DEFAULT_HSL },
      temperature: 0,
      tint: 0,
    });

    return { success: true };
  }

  /**
   * Process color grading for an image
   *
   * @param clipId - The clip to process
   * @param image - The source image
   * @returns Processed image
   */
  async processColorGrading(
    clipId: string,
    image: ImageBitmap,
    sampled?: Pick<ColorGradingSettings, "tone" | "vignette" | "temperature" | "tint" | "hueCurves">,
  ): Promise<{ image: ImageBitmap; processingTime: number }> {
    if (!this.initialized || !this.colorGradingEngine) {
      return { image, processingTime: 0 };
    }

    // Keyframed tone / vignette / white balance arrive as per-frame samples over the stored grade.
    const settings: ColorGradingSettings = { ...this.getColorGrading(clipId), ...sampled };
    let currentImage = image;
    let totalTime = 0;

    const plan = planColorGrading(settings);

    // Input LUT runs before every other stage.
    if (plan.inputLut) {
      const result = await this.colorGradingEngine.applyCpuGrading(
        currentImage,
        { lut: plan.inputLut },
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

    // Premiere order runs white balance before every other stage.
    if (plan.whiteBalanceFirst) {
      const wb = await this.runGradingWhiteBalance(currentImage, settings);
      currentImage = wb.image;
      totalTime += wb.processingTime;
    }

    // Classic order: 8-bit colour wheels pass
    if (plan.legacyWheels) {
      const result = await this.colorGradingEngine.applyColorWheels(
        currentImage,
        plan.legacyWheels,
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

    // Premiere order: tone -> wheels -> hue curves in one float pass
    if (plan.fused) {
      const result = await this.colorGradingEngine.applyFusedGrading(
        currentImage,
        plan.fused,
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

    // Apply fused CPU stages in a single readback
    if (plan.cpu) {
      const result = await this.colorGradingEngine.applyCpuGrading(
        currentImage,
        plan.cpu,
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

    if (!plan.whiteBalanceFirst) {
      const wb = await this.runGradingWhiteBalance(currentImage, settings);
      currentImage = wb.image;
      totalTime += wb.processingTime;
    }

    return { image: currentImage, processingTime: totalTime };
  }

  private async runGradingWhiteBalance(
    image: ImageBitmap,
    settings: ColorGradingSettings,
  ): Promise<{ image: ImageBitmap; processingTime: number }> {
    let currentImage = image;
    let totalTime = 0;
    // Apply white balance (temperature + tint) via VideoEffectsEngine
    const whiteBalanceEffects: Effect[] = [];
    if (
      this.videoEffectsEngine &&
      settings.temperature !== undefined &&
      settings.temperature !== 0
    ) {
      whiteBalanceEffects.push({
        id: "wb-temperature",
        type: "temperature",
        enabled: true,
        params: { value: settings.temperature },
      });
    }
    if (
      this.videoEffectsEngine &&
      settings.tint !== undefined &&
      settings.tint !== 0
    ) {
      whiteBalanceEffects.push({
        id: "wb-tint",
        type: "tint",
        enabled: true,
        params: { value: settings.tint },
      });
    }
    if (whiteBalanceEffects.length > 0 && this.videoEffectsEngine) {
      try {
        const result = await this.videoEffectsEngine.applyEffects(
          currentImage,
          whiteBalanceEffects,
        );
        if (
          result.image &&
          result.image.width > 0 &&
          result.image.height > 0
        ) {
          currentImage = result.image;
          totalTime += result.processingTime;
        }
      } catch (error) {
        console.warn("[EffectsBridge] White balance processing failed:", error);
      }
    }

    return { image: currentImage, processingTime: totalTime };
  }

  private isWhiteBalanceActive(settings: ColorGradingSettings): boolean {
    return (
      (settings.temperature !== undefined && settings.temperature !== 0) ||
      (settings.tint !== undefined && settings.tint !== 0)
    );
  }

  gradingYieldsCanvas(clipId: string): boolean {
    if (!this.initialized || !this.colorGradingEngine) {
      return false;
    }
    const settings = this.getColorGrading(clipId);
    return (
      planColorGrading(settings).cpu !== null &&
      planColorGrading(settings).inputLut === null &&
      !this.isWhiteBalanceActive(settings)
    );
  }

  async processColorGradingToCanvas(
    clipId: string,
    image: ImageBitmap,
  ): Promise<OffscreenCanvas | null> {
    if (!this.initialized || !this.colorGradingEngine) {
      return null;
    }

    const settings = this.getColorGrading(clipId);
    const plan = planColorGrading(settings);
    const cpuStages = plan.cpu;

    if (!cpuStages || plan.inputLut || this.isWhiteBalanceActive(settings)) {
      return null;
    }

    try {
      let currentImage = image;
      let colorWheelsBitmap: ImageBitmap | null = null;

      if (plan.legacyWheels) {
        const result = await this.colorGradingEngine.applyColorWheels(
          currentImage,
          plan.legacyWheels,
        );
        colorWheelsBitmap = result.image;
        currentImage = result.image;
      } else if (plan.fused) {
        const result = await this.colorGradingEngine.applyFusedGrading(
          currentImage,
          plan.fused,
        );
        colorWheelsBitmap = result.image;
        currentImage = result.image;
      }

      const canvas = await this.colorGradingEngine.applyCpuGradingToCanvas(
        currentImage,
        cpuStages,
      );

      colorWheelsBitmap?.close();

      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        return null;
      }

      return canvas;
    } catch (error) {
      console.error(
        "[EffectsBridge] Color-grading-to-canvas processing failed:",
        error,
      );
      return null;
    }
  }

  // ============================================
  // Serialization Methods
  // ============================================

  /**
   * Serialize all effects for a clip to JSON-compatible format
   *
   * Serialize effect parameters to JSON
   *
   * @param clipId - The clip to serialize effects for
   * @returns Serialized effects data
   */
  serializeEffects(clipId: string): {
    effects: SerializedEffect[];
    colorGrading: SerializedColorGrading;
  } {
    const effects = this.getEffects(clipId);
    const colorGrading = this.getColorGrading(clipId);

    const serializedEffects: SerializedEffect[] = effects.map((e) => ({
      id: e.id,
      type: e.type,
      enabled: e.enabled,
      params: e.params,
      order: e.order,
      ...(e.metadata ? { metadata: e.metadata } : {}),
    }));

    const serializedColorGrading: SerializedColorGrading = {};

    if (colorGrading.colorWheels) {
      serializedColorGrading.colorWheels = colorGrading.colorWheels;
    }

    if (colorGrading.curves) {
      serializedColorGrading.curves = colorGrading.curves;
    }

    if (colorGrading.lut) {
      serializedColorGrading.lut = lutToJson(colorGrading.lut);
    }

    if (colorGrading.inputLut) {
      serializedColorGrading.inputLut = lutToJson(colorGrading.inputLut);
    }

    if (colorGrading.hsl) {
      serializedColorGrading.hsl = colorGrading.hsl;
    }

    if (colorGrading.temperature !== undefined) {
      serializedColorGrading.temperature = colorGrading.temperature;
    }

    if (colorGrading.tint !== undefined) {
      serializedColorGrading.tint = colorGrading.tint;
    }

    if (colorGrading.tone) {
      serializedColorGrading.tone = colorGrading.tone;
    }

    if (colorGrading.vignette) {
      serializedColorGrading.vignette = colorGrading.vignette;
    }

    if (colorGrading.hueCurves) {
      serializedColorGrading.hueCurves = colorGrading.hueCurves;
    }

    if (colorGrading.pipelineVersion) {
      serializedColorGrading.pipelineVersion = colorGrading.pipelineVersion;
    }

    return { effects: serializedEffects, colorGrading: serializedColorGrading };
  }

  /**
   * Deserialize effects from JSON-compatible format
   *
   * Deserialize effect parameters and restore to clip
   *
   * @param clipId - The clip to restore effects to
   * @param data - Serialized effects data
   * @returns Deserialization result
   */
  deserializeEffects(
    clipId: string,
    data: {
      effects: SerializedEffect[];
      colorGrading: SerializedColorGrading;
    },
  ): EffectResult {
    if (!this.initialized) {
      return { success: false, error: "EffectsBridge not initialized" };
    }

    // Restore video effects
    const effects: VideoEffect[] = data.effects.map((e) => ({
      id: e.id,
      type: e.type as VideoEffectType,
      enabled: e.enabled,
      params: e.params,
      order: e.order,
      ...(e.metadata ? { metadata: e.metadata } : {}),
    }));
    this.clipEffects.set(clipId, effects);

    // Restore color grading
    const colorGrading: ColorGradingSettings = {};

    if (data.colorGrading.colorWheels) {
      colorGrading.colorWheels = data.colorGrading.colorWheels;
    }

    if (data.colorGrading.curves) {
      colorGrading.curves = data.colorGrading.curves;
    }

    if (data.colorGrading.lut) {
      colorGrading.lut = lutFromJson(data.colorGrading.lut);
    }

    if (data.colorGrading.inputLut) {
      colorGrading.inputLut = lutFromJson(data.colorGrading.inputLut);
    }

    if (data.colorGrading.hsl) {
      colorGrading.hsl = data.colorGrading.hsl;
    }

    if (data.colorGrading.temperature !== undefined) {
      colorGrading.temperature = data.colorGrading.temperature;
    }

    if (data.colorGrading.tint !== undefined) {
      colorGrading.tint = data.colorGrading.tint;
    }

    if (data.colorGrading.tone) {
      colorGrading.tone = data.colorGrading.tone;
    }

    if (data.colorGrading.vignette) {
      colorGrading.vignette = data.colorGrading.vignette;
    }

    if (data.colorGrading.hueCurves) {
      colorGrading.hueCurves = data.colorGrading.hueCurves;
    }

    if (data.colorGrading.pipelineVersion) {
      colorGrading.pipelineVersion = data.colorGrading.pipelineVersion;
    }

    this.clipColorGrading.set(clipId, colorGrading);

    return { success: true };
  }

  /**
   * Clear all effects for a clip
   *
   * @param clipId - The clip to clear effects for
   */
  clearEffects(clipId: string): void {
    this.clipEffects.delete(clipId);
    this.clipColorGrading.delete(clipId);
  }

  // ============================================
  // Effects Change Notification Methods
  // ============================================

  /**
   * Register a callback for effects changes
   * Used to trigger re-renders when effects are updated
   *
   * Re-render current frame when effects change
   *
   * @param callback - Callback to invoke when effects change
   */
  onEffectsChange(callback: EffectsChangeCallback): void {
    this.effectsChangeCallbacks.push(callback);
  }

  /**
   * Remove an effects change callback
   *
   * @param callback - Callback to remove
   */
  offEffectsChange(callback: EffectsChangeCallback): void {
    const index = this.effectsChangeCallbacks.indexOf(callback);
    if (index !== -1) {
      this.effectsChangeCallbacks.splice(index, 1);
    }
  }

  /**
   * Notify that effects have changed for a clip
   * Triggers re-render within 100ms (debounced)
   *
   * Re-render current frame when effects change within 100ms
   *
   * @param clipId - The clip whose effects changed
   */
  private notifyEffectsChanged(clipId: string): void {
    // Cancel any pending re-render for this clip
    const pendingTimeout = this.pendingReRenders.get(clipId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
    }

    // Schedule re-render with debouncing (target <100ms latency)
    const timeout = setTimeout(() => {
      this.pendingReRenders.delete(clipId);
      const effects = this.getEffects(clipId);

      // Convert VideoEffect[] to Effect[] for callbacks
      const coreEffects: Effect[] = effects.map((e) => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        params: e.params,
        ...(e.metadata ? { metadata: e.metadata } : {}),
      }));

      for (const callback of this.effectsChangeCallbacks) {
        callback(clipId, coreEffects);
      }
    }, 16); // ~60fps debounce, well under 100ms target

    this.pendingReRenders.set(clipId, timeout);
  }

  /**
   * Get the current renderer type being used
   *
   * @returns The renderer type ('webgpu', 'webgl2', 'canvas2d', or 'legacy-webgl2')
   */
  getRendererType(): string {
    if (
      this.videoEffectsEngine &&
      typeof this.videoEffectsEngine.getRendererType === "function"
    ) {
      return this.videoEffectsEngine.getRendererType();
    }
    return "none";
  }

  /**
   * Check if WebGPU is being used for effects processing
   */
  isUsingWebGPU(): boolean {
    if (
      this.videoEffectsEngine &&
      typeof this.videoEffectsEngine.isUsingWebGPU === "function"
    ) {
      return this.videoEffectsEngine.isUsingWebGPU();
    }
    return false;
  }

  /**
   * Dispose of the effects bridge and clean up resources
   */
  dispose(): void {
    this.initializationGeneration++;
    this.initializationPromise = null;
    // Clear pending re-renders
    for (const timeout of this.pendingReRenders.values()) {
      clearTimeout(timeout);
    }
    this.pendingReRenders.clear();

    // Clear callbacks
    this.effectsChangeCallbacks = [];

    // Clean up renderer
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    if (this.colorGradingEngine) {
      this.colorGradingEngine.dispose();
    }
    this.videoEffectsEngine?.dispose();
    this.gradeChain?.dispose();
    this.gradeChain = null;

    this.clipEffects.clear();
    this.clipColorGrading.clear();
    this.videoEffectsEngine = null;
    this.colorGradingEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let effectsBridgeInstance: EffectsBridge | null = null;

// Track initialization dimensions for auto-initialization
let lastInitWidth = 1920;
let lastInitHeight = 1080;

/**
 * Get the shared EffectsBridge instance (sync version)
 * Returns the instance but initialization may not be complete.
 * Prefer getEffectsBridgeAsync for proper initialization.
 */
export function getEffectsBridge(): EffectsBridge {
  if (!effectsBridgeInstance) {
    effectsBridgeInstance = new EffectsBridge();
  }

  if (!effectsBridgeInstance.isInitialized()) {
    const bridge = effectsBridgeInstance;
    bridge
      .initialize(lastInitWidth, lastInitHeight)
      .catch((error) => {
        // Disposal (project switch, HMR) cancels this init on purpose.
        if (error instanceof EffectsBridgeDisposedError) return;
        console.error(
          "[EffectsBridge] Background initialization failed:",
          error,
        );
      });
  }

  return effectsBridgeInstance;
}

/**
 * Get the shared EffectsBridge instance (async version - preferred)
 * Properly awaits initialization before returning.
 */
async function getEffectsBridgeAsync(
  width: number = 1920,
  height: number = 1080,
): Promise<EffectsBridge> {
  if (effectsBridgeInstance?.isInitialized()) {
    return effectsBridgeInstance;
  }

  const bridge = effectsBridgeInstance ?? (effectsBridgeInstance = new EffectsBridge());
  await bridge.initialize(width, height);
  if (effectsBridgeInstance !== bridge || !bridge.isInitialized()) {
    throw new EffectsBridgeDisposedError();
  }
  lastInitWidth = width;
  lastInitHeight = height;
  return bridge;
}

/**
 * Initialize the shared EffectsBridge (async version - preferred)
 */
export async function initializeEffectsBridge(
  width: number = 1920,
  height: number = 1080,
): Promise<EffectsBridge> {
  return getEffectsBridgeAsync(width, height);
}

/**
 * Dispose of the shared EffectsBridge
 */
export function disposeEffectsBridge(): void {
  if (effectsBridgeInstance) {
    effectsBridgeInstance.dispose();
    effectsBridgeInstance = null;
  }
}
