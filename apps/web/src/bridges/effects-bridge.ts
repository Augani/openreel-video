import {
  VideoEffectsEngine,
  ColorGradingEngine,
  type Renderer,
  isWebGPUSupported,
  type ColorWheelValues,
  type CurvesValues,
  type HSLValues,
  type LUTData,
  type WaveformScopeData,
  type VectorscopeData,
  type HistogramData,
  DEFAULT_COLOR_WHEELS,
  DEFAULT_CURVES,
  DEFAULT_HSL,
} from "@openreel/core";
import type { Effect } from "@openreel/core";
import { v4 as uuidv4 } from "uuid";

export type EffectsChangeCallback = (clipId: string, effects: Effect[]) => void;

export type VideoEffectType =
  | "brightness"
  | "contrast"
  | "saturation"
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
  | "chromatic-aberration";

/**
 * Video effect with full metadata
 */
export interface VideoEffect {
  id: string;
  type: VideoEffectType;
  enabled: boolean;
  params: Record<string, unknown>;
  order: number;
}

/**
 * Color grading settings for a clip
 */
export interface ColorGradingSettings {
  colorWheels?: ColorWheelValues;
  curves?: CurvesValues;
  lut?: LUTData;
  hsl?: HSLValues;
  /** Temperature shift in range [-100, 100]. Negative = cool/blue, positive = warm/orange */
  temperature?: number;
  /** Tint shift in range [-100, 100]. Negative = green, positive = magenta */
  tint?: number;
}

/**
 * Effect application result
 */
export interface EffectResult {
  success: boolean;
  effectId?: string;
  error?: string;
  processingTime?: number;
}

/**
 * Serialized effect data for persistence
 */
export interface SerializedEffect {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, unknown>;
  order: number;
}

/**
 * Serialized color grading data for persistence
 */
export interface SerializedColorGrading {
  colorWheels?: ColorWheelValues;
  curves?: CurvesValues;
  lut?: {
    data: number[];
    size: number;
    intensity: number;
  };
  hsl?: HSLValues;
  temperature?: number;
  tint?: number;
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
export class EffectsBridge {
  private videoEffectsEngine: VideoEffectsEngine | null = null;
  private colorGradingEngine: ColorGradingEngine | null = null;
  private initialized = false;

  // Store effects per clip
  private clipEffects: Map<string, VideoEffect[]> = new Map();
  private clipColorGrading: Map<string, ColorGradingSettings> = new Map();

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
  async initialize(width: number = 1920, height: number = 1080): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.videoEffectsEngine = new VideoEffectsEngine({
        width,
        height,
        useGPU: true,
        preferWebGPU: isWebGPUSupported(),
      });
      await this.videoEffectsEngine.initialize();

      this.colorGradingEngine = new ColorGradingEngine(width, height);
      this.colorGradingEngine.initialize();

      this.initialized = true;
    } catch (error) {
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
  getEffects(clipId: string): VideoEffect[] {
    const effects = this.clipEffects.get(clipId) || [];
    return [...effects].sort((a, b) => a.order - b.order);
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
        params: e.params,
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

  /**
   * Get default parameters for an effect type
   */
  private getDefaultParams(
    effectType: VideoEffectType,
  ): Record<string, unknown> {
    switch (effectType) {
      case "brightness":
        return { value: 0 };
      case "contrast":
        return { value: 1 };
      case "saturation":
        return { value: 1 };
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
    return this.clipColorGrading.get(clipId) || {};
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
  ): Promise<{ image: ImageBitmap; processingTime: number }> {
    if (!this.initialized || !this.colorGradingEngine) {
      return { image, processingTime: 0 };
    }

    const settings = this.getColorGrading(clipId);
    let currentImage = image;
    let totalTime = 0;

    // Apply color wheels
    if (settings.colorWheels) {
      const result = await this.colorGradingEngine.applyColorWheels(
        currentImage,
        settings.colorWheels,
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

    // Apply curves
    if (settings.curves) {
      const result = await this.colorGradingEngine.applyCurves(
        currentImage,
        settings.curves,
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

    // Apply LUT
    if (settings.lut) {
      const result = await this.colorGradingEngine.applyLUT(
        currentImage,
        settings.lut,
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

    // Apply HSL
    if (settings.hsl) {
      const result = await this.colorGradingEngine.applyHSL(
        currentImage,
        settings.hsl,
      );
      currentImage = result.image;
      totalTime += result.processingTime;
    }

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

  // ============================================
  // Scope Generation Methods
  // ============================================

  /**
   * Generate waveform scope data
   *
   * Generate waveform showing luminance distribution
   *
   * @param image - The image to analyze
   * @returns Waveform scope data
   */
  async generateWaveform(
    image: ImageBitmap,
  ): Promise<WaveformScopeData | null> {
    if (!this.initialized || !this.colorGradingEngine) {
      return null;
    }

    return this.colorGradingEngine.generateWaveform(image);
  }

  /**
   * Generate vectorscope data
   *
   * Generate vectorscope showing color distribution
   *
   * @param image - The image to analyze
   * @param size - Size of the vectorscope (default 256)
   * @returns Vectorscope data
   */
  async generateVectorscope(
    image: ImageBitmap,
    size: number = 256,
  ): Promise<VectorscopeData | null> {
    if (!this.initialized || !this.colorGradingEngine) {
      return null;
    }

    return this.colorGradingEngine.generateVectorscope(image, size);
  }

  /**
   * Generate histogram data
   *
   * Generate RGB and luminance histograms
   *
   * @param image - The image to analyze
   * @returns Histogram data
   */
  async generateHistogram(image: ImageBitmap): Promise<HistogramData | null> {
    if (!this.initialized || !this.colorGradingEngine) {
      return null;
    }

    return this.colorGradingEngine.generateHistogram(image);
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
    }));

    const serializedColorGrading: SerializedColorGrading = {};

    if (colorGrading.colorWheels) {
      serializedColorGrading.colorWheels = colorGrading.colorWheels;
    }

    if (colorGrading.curves) {
      serializedColorGrading.curves = colorGrading.curves;
    }

    if (colorGrading.lut) {
      serializedColorGrading.lut = {
        data: Array.from(colorGrading.lut.data),
        size: colorGrading.lut.size,
        intensity: colorGrading.lut.intensity,
      };
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
      colorGrading.lut = {
        data: new Uint8Array(data.colorGrading.lut.data),
        size: data.colorGrading.lut.size,
        intensity: data.colorGrading.lut.intensity,
      };
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

    this.clipEffects.clear();
    this.clipColorGrading.clear();
    this.videoEffectsEngine = null;
    this.colorGradingEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let effectsBridgeInstance: EffectsBridge | null = null;
let bridgeInitPromise: Promise<EffectsBridge> | null = null;

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
    effectsBridgeInstance
      .initialize(lastInitWidth, lastInitHeight)
      .catch((error) => {
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
export async function getEffectsBridgeAsync(
  width: number = 1920,
  height: number = 1080,
): Promise<EffectsBridge> {
  if (effectsBridgeInstance?.isInitialized()) {
    return effectsBridgeInstance;
  }

  if (bridgeInitPromise) {
    return bridgeInitPromise;
  }

  bridgeInitPromise = (async () => {
    if (!effectsBridgeInstance) {
      effectsBridgeInstance = new EffectsBridge();
    }
    await effectsBridgeInstance.initialize(width, height);
    lastInitWidth = width;
    lastInitHeight = height;
    return effectsBridgeInstance;
  })();

  return bridgeInitPromise;
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
