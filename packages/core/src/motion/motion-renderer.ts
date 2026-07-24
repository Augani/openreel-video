import type {
  MotionAsset,
  MotionComposition,
  MotionCompositionInstance,
  MotionEffect,
  MotionFontFace,
  MotionLayer,
  MotionObject3D,
  MotionShapeGroupItem,
  MotionShapeItem,
  MotionShapePathItem,
  MotionTransform,
  MotionVector2,
} from "./types";
import type {
  CornerRadii,
  FillStyle,
  GradientStyle,
  MotionShaderFill,
  ShadowStyle,
  ShapeStyle,
} from "../graphics/types";
import {
  getMotionCanvas3DProjection,
  hasMotion3DRotation,
  projectMotion3DPlanePoint,
  projectMotion3DPosition,
} from "./motion-3d-transform";
import {
  applyMotionCameraToTransform,
  buildMotionCameraDepthOfFieldCanvasFilter,
} from "./motion-camera";
import type { BlendMode } from "../video/types";
import { getMotionCanvasBlendMode } from "./motion-blend-modes";
import {
  MotionThreeRenderer,
  sampleMotionObjectMeshFrame,
  type MotionRenderQuality,
} from "./motion-three-renderer";

export {
  DEFAULT_MOTION_RENDER_QUALITY,
  type MotionRenderQuality,
} from "./motion-three-renderer";
import { getMotionBlurSamplePlanAtTime } from "./motion-blur";
import {
  applyMotionPixelEffectsToBuffer,
  buildMotionCanvasFilter,
  evaluateMotionEffectsAtTime,
  getEnabledMotionEffects,
  getMotionBackdropBlurRadius,
  getMotionEffectParameterValueAtTime,
  isMotionPixelEffect,
  layerNeedsBufferedEffects,
} from "./motion-effects";
import { MotionShaderRenderer } from "./motion-shader-renderer";
import { getMotionShaderDef } from "./shaders";
import type { MotionShaderDef } from "./shaders";
import type { MotionTextAnimator, MotionTextLayer } from "./types";
import {
  clampMotionCornerRadii,
  expandMotionShadowColor,
  getMotionConicAngleRadians,
  getMotionGradientCenter,
  resolveMotionGradientStops,
} from "./motion-paint-style";
import { wrapMotionTextLines } from "./motion-text-wrap";
import {
  evaluateMotionPropertyValueAtTime,
  type MotionExpressionContext,
} from "./motion-expressions";
import {
  getMotionLayerChildren,
  getMotionRootLayers,
} from "./motion-hierarchy";
import {
  evaluateMotionPuppetPinsAtTime,
  getMotionLayerPropertyKeyframes,
  getMotionParticleEmitterAtTime,
  parseMotionShaderFillKeyframeProperty,
  resolveShapeContentsAtTime,
} from "./motion-keyframes";
import {
  collectShapeItemRings,
  hasExplicitShapeContents,
  shapeGroupTransformToMatrix,
  shouldMergeShapeGroup,
  SHAPE_IDENTITY_MATRIX,
  type ShapeItemRingEntry,
} from "./motion-shape-contents";
import {
  mergeMotionShapeRings,
  MotionShapeBooleanError,
} from "./motion-shape-boolean";
import {
  getMotionSoloLayerIds,
  isMotionLayerContentVisible,
  isMotionLayerTreeVisible,
} from "./motion-layer-visibility";
import {
  buildMotionLightingCanvasFilter,
  getMotionLightingForLayer,
} from "./motion-lights";
import {
  applyMotionLayerMasksToCanvas,
  evaluateMotionLayerMasksAtTime,
  getMotionLayerVisualBounds,
  layerUsesAdvancedMotionMasks,
  paintMotionLayerMaskAlphaToCanvas,
} from "./motion-masks";
import {
  applyMotionInstanceOverrides,
  getMotionCompositionLayerPlaybackTime,
  getMotionCompositionLayerSource,
} from "./motion-precomps";
import { getMotionVideoLayerSourceTime } from "./motion-video-timing";
import { getMotionParticlesAtTime } from "./motion-particles";
import { orderMotionLayersForRender } from "./motion-render-order";
import {
  applyMotionShapeOperatorStack,
  buildMotionShapePolyline,
  drawMotionPath,
  evaluateMotionShapeModifiersAtTime,
  getMotionRepeaterCopies,
  getMotionRepeaterModifier,
  getMotionRoundCornersModifier,
  getMotionTrimPathsModifier,
  getMotionWigglePathsModifier,
  getTrimmedMotionPathPoints,
} from "./motion-shape-modifiers";
import {
  getMotionPathDrawCommands,
  getMotionShapePathDataAtTime,
  parseMotionPathSegments,
} from "./motion-shape-path";
import {
  evaluateMotionShapeLayerStyleAtTime,
  getMotionLinearGradientLine,
  getMotionRadialGradientSpec,
  normalizeMotionStroke,
} from "./motion-shape-style";
import {
  getMotionTextAnimatorRunProgress,
  getMotionTextAnimatorRuns,
  getMotionTextShaderAnimator,
  hasEnabledMotionTextAnimators,
  type MotionTextGlyphRun,
} from "./motion-text-animators";
import {
  getMotionTrackMatteSource,
  isInvertedMotionTrackMatte,
  isLumaMotionTrackMatte,
} from "./motion-track-mattes";
import { resolveMotionLayerVariableBindings } from "./motion-variable-bindings";

interface RenderLayerOptions {
  readonly ignoreTrackMatte?: boolean;
  readonly ignoreMotionBlur?: boolean;
  readonly forceVisibleLayerIds?: ReadonlySet<string>;
  readonly soloLayerIds?: ReadonlySet<string>;
  readonly opacityMultiplier?: number;
  readonly compositionLibrary?: readonly MotionComposition[];
  readonly compositionStack?: readonly string[];
  readonly assetResolver?: MotionRendererAssetResolver;
  readonly variableOverrides?: Record<string, string | number | boolean>;
  readonly quality?: MotionRenderQuality;
}

interface MotionTempCanvas {
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
}

/**
 * Canvas patterns are positioned in the current user space, while motion
 * layers draw around their local anchor (normally the layer center). Move the
 * shader texture to the visual bounds so the generated material covers the
 * whole glyph or shape instead of only the positive-coordinate quadrant.
 */
export function positionMotionShaderPattern(
  pattern: CanvasPattern | null,
  originX: number,
  originY: number,
): CanvasPattern | null {
  if (!pattern || typeof pattern.setTransform !== "function") return pattern;
  pattern.setTransform({
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: Number.isFinite(originX) ? originX : 0,
    f: Number.isFinite(originY) ? originY : 0,
  });
  return pattern;
}

type VisualMotionLayer = Extract<
  MotionLayer,
  {
    type:
      | "composition"
      | "image"
      | "video"
      | "particle"
      | "shape"
      | "text"
      | "scene3d";
  }
>;

export type MotionRenderableImage =
  | ImageBitmap
  | OffscreenCanvas
  | HTMLCanvasElement
  | HTMLImageElement;

export interface MotionRootLayerImage {
  readonly image: ImageBitmap;
  readonly blendMode: BlendMode;
  readonly layerId: string;
}

export interface MotionScene3DRenderInput {
  readonly composition: MotionComposition;
  readonly layer: Extract<MotionLayer, { type: "scene3d" }>;
  readonly localTime: number;
  readonly width: number;
  readonly height: number;
  readonly backgroundColor?: string;
  readonly quality?: MotionRenderQuality;
}

export interface MotionScene3DRenderResult {
  readonly image: MotionRenderableImage;
  readonly release?: () => void;
}

export interface MotionRendererAssetResolver {
  resolveImageAsset(
    asset: MotionAsset,
  ): Promise<MotionRenderableImage | null> | MotionRenderableImage | null;
  resolveVideoFrame?(
    asset: MotionAsset,
    localTime: number,
  ): Promise<MotionRenderableImage | null> | MotionRenderableImage | null;
  resolveModelUrl?(url: string): Promise<string | null> | string | null;
  renderScene3D?(
    input: MotionScene3DRenderInput,
  ):
    | Promise<MotionScene3DRenderResult | null>
    | MotionScene3DRenderResult
    | null;
}

interface MotionFontFaceLike {
  load(): Promise<unknown>;
  readonly family: string;
}

interface MotionFontFaceSet {
  load(font: string, text?: string): Promise<unknown>;
  add?(font: MotionFontFaceLike): void;
  has?(font: MotionFontFaceLike): boolean;
}

interface MotionFontFaceConstructor {
  new (
    family: string,
    source: string,
    descriptors?: { weight?: string; style?: string },
  ): MotionFontFaceLike;
}

const getAmbientFontFaceSet = (): MotionFontFaceSet | undefined => {
  const scope = globalThis as {
    document?: { fonts?: MotionFontFaceSet };
    fonts?: MotionFontFaceSet;
  };
  if (scope.document?.fonts) {
    return scope.document.fonts;
  }
  return scope.fonts;
};

const getMotionFontFaceConstructor = (): MotionFontFaceConstructor | undefined => {
  const ctor = (globalThis as { FontFace?: MotionFontFaceConstructor }).FontFace;
  return typeof ctor === "function" ? ctor : undefined;
};

const motionFontLoadPromises = new Map<string, Promise<void>>();
const motionFontFacePromises = new Map<string, Promise<void>>();

const getMotionFontFaceKey = (face: MotionFontFace): string =>
  `${face.family}|${face.weight ?? "normal"}|${face.style ?? "normal"}|${face.source}`;

const registerMotionFontFace = (face: MotionFontFace): Promise<void> => {
  const key = getMotionFontFaceKey(face);
  const cached = motionFontFacePromises.get(key);
  if (cached) {
    return cached;
  }
  const fontFaceSet = getAmbientFontFaceSet();
  const FontFaceCtor = getMotionFontFaceConstructor();
  if (!fontFaceSet || !FontFaceCtor || !fontFaceSet.add || !face.family || !face.source) {
    const resolved = Promise.resolve();
    motionFontFacePromises.set(key, resolved);
    return resolved;
  }
  const promise = (async () => {
    try {
      const descriptors: { weight?: string; style?: string } = {};
      if (face.weight !== undefined) {
        descriptors.weight = String(face.weight);
      }
      if (face.style !== undefined) {
        descriptors.style = face.style;
      }
      const source = /^url\(|^data:|,/.test(face.source)
        ? face.source
        : `url(${JSON.stringify(face.source)})`;
      const fontFace = new FontFaceCtor(face.family, source, descriptors);
      await Promise.race([
        fontFace.load(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 5000);
        }),
      ]);
      fontFaceSet.add?.(fontFace);
    } catch {
      // Embedded fonts that fail to load fall back to the family stack.
    }
  })();
  motionFontFacePromises.set(key, promise);
  return promise;
};

const registerMotionCompositionFonts = async (
  compositions: readonly MotionComposition[],
): Promise<void> => {
  const faces: MotionFontFace[] = [];
  for (const composition of compositions) {
    for (const face of composition.fonts ?? []) {
      faces.push(face);
    }
  }
  if (faces.length === 0) {
    return;
  }
  await Promise.all(faces.map((face) => registerMotionFontFace(face)));
};

const ensureMotionFontLoaded = (fontSpec: string): Promise<void> => {
  const cached = motionFontLoadPromises.get(fontSpec);
  if (cached) {
    return cached;
  }
  const fontFaceSet = getAmbientFontFaceSet();
  if (!fontFaceSet) {
    const resolved = Promise.resolve();
    motionFontLoadPromises.set(fontSpec, resolved);
    return resolved;
  }
  const loadPromise = Promise.race([
    fontFaceSet.load(fontSpec).then(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 3000);
    }),
  ]).catch(() => undefined);
  motionFontLoadPromises.set(fontSpec, loadPromise);
  return loadPromise;
};

const collectMotionFontSpecs = (
  compositions: readonly MotionComposition[],
): string[] => {
  const specs = new Set<string>();
  for (const composition of compositions) {
    for (const layer of composition.layers) {
      if (layer.type !== "text") {
        continue;
      }
      const fontWeight = layer.style.fontWeight ?? 700;
      const fontSize = Math.max(1, Math.round(layer.style.fontSize));
      specs.add(`${fontWeight} ${fontSize}px "${layer.style.fontFamily}"`);
    }
  }
  return [...specs];
};

const ensureMotionFontsReady = async (
  compositions: readonly MotionComposition[],
): Promise<void> => {
  await registerMotionCompositionFonts(compositions);
  const specs = collectMotionFontSpecs(compositions);
  if (specs.length === 0) {
    return;
  }
  await Promise.all(specs.map((spec) => ensureMotionFontLoaded(spec)));
};

const MAX_MOTION_SUPERSAMPLE = 4;
const MAX_MOTION_SUPERSAMPLE_DIMENSION = 8192;
const MAX_SHADER_GLYPHS = 120;
const SHADER_GLYPH_PADDING = 8;
const SHADER_GLYPH_HEIGHT_MULTIPLIER = 1.4;

interface GlyphVerticalMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly contentHeight: number;
}

function measureGlyphVerticalMetrics(
  ctx: OffscreenCanvasRenderingContext2D,
  character: string,
  fontSize: number,
): GlyphVerticalMetrics {
  const fallbackHeight = fontSize * SHADER_GLYPH_HEIGHT_MULTIPLIER;
  const fallback: GlyphVerticalMetrics = {
    ascent: fallbackHeight / 2,
    descent: fallbackHeight / 2,
    contentHeight: fallbackHeight,
  };

  const metrics = ctx.measureText(character);
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  if (
    !Number.isFinite(ascent) ||
    !Number.isFinite(descent) ||
    ascent <= 0 ||
    descent < 0
  ) {
    return fallback;
  }

  const contentHeight = ascent + descent;
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) {
    return fallback;
  }

  return { ascent, descent, contentHeight };
}

export interface MotionTextShaderPass {
  readonly def: MotionShaderDef;
  readonly animator: MotionTextAnimator;
}

export function resolveTextShaderPass(
  layer: MotionTextLayer,
  _localTime: number,
): MotionTextShaderPass | null {
  const animator = getMotionTextShaderAnimator(layer);
  const shaderId = animator?.shader?.shaderId;
  if (!animator || shaderId === undefined) {
    return null;
  }
  const def = getMotionShaderDef(shaderId);
  if (!def || def.category !== "text") {
    return null;
  }
  return { def, animator };
}

export function resolveMotionSupersample(
  requested: number | undefined,
  width: number,
  height: number,
): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return 1;
  }
  const clamped = Math.min(MAX_MOTION_SUPERSAMPLE, Math.max(1, requested));
  const longestEdge = Math.max(1, width, height);
  const dimensionCap = MAX_MOTION_SUPERSAMPLE_DIMENSION / longestEdge;
  return Math.max(1, Math.min(clamped, dimensionCap));
}

export class MotionRenderer {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private deviceScale = 1;
  private threeRenderer: MotionThreeRenderer | null = null;
  private shaderRenderer: MotionShaderRenderer | null = null;
  private shaderFillFrameCache: Map<string, OffscreenCanvas> | null = null;
  private warnedShaderGlyphCaps = new Set<string>();
  private renderDepth = 0;

  async renderComposition(
    composition: MotionComposition,
    localTime: number,
    options: {
      readonly compositionLibrary?: readonly MotionComposition[];
      readonly compositionStack?: readonly string[];
      readonly assetResolver?: MotionRendererAssetResolver;
      readonly variableOverrides?: Record<string, string | number | boolean>;
      readonly supersample?: number;
      readonly quality?: MotionRenderQuality;
    } = {},
  ): Promise<ImageBitmap> {
    if (this.renderDepth === 0) {
      this.shaderFillFrameCache = new Map();
    }
    this.renderDepth += 1;
    try {
      this.deviceScale = resolveMotionSupersample(
        options.supersample,
        composition.width,
        composition.height,
      );
      this.ensureCanvas(composition.width, composition.height);
      const canvas = this.canvas!;
      const ctx = this.ctx!;
      ctx.setTransform(this.deviceScale, 0, 0, this.deviceScale, 0, 0);

      await ensureMotionFontsReady(options.compositionLibrary ?? [composition]);

      await this.renderCompositionToContext(ctx, composition, localTime, {
        compositionLibrary: options.compositionLibrary ?? [composition],
        compositionStack: options.compositionStack ?? [],
        assetResolver: options.assetResolver,
        variableOverrides: options.variableOverrides,
        quality: options.quality,
      });

      if (this.deviceScale === 1) {
        return await createImageBitmap(canvas);
      }
      return await createImageBitmap(canvas, {
        resizeWidth: composition.width,
        resizeHeight: composition.height,
        resizeQuality: "high",
      });
    } finally {
      this.renderDepth -= 1;
      if (this.renderDepth === 0) {
        this.shaderFillFrameCache = null;
      }
    }
  }

  async renderInstance(
    composition: MotionComposition,
    instance: MotionCompositionInstance,
    timelineTime: number,
    compositionLibrary: readonly MotionComposition[] = [composition],
    assetResolver?: MotionRendererAssetResolver,
    supersample?: number,
  ): Promise<ImageBitmap> {
    const localTime = Math.max(0, timelineTime - instance.startTime);
    return this.renderComposition(composition, localTime, {
      compositionLibrary,
      assetResolver,
      variableOverrides: instance.variableOverrides,
      supersample,
    });
  }

  async renderRootLayerImages(
    composition: MotionComposition,
    localTime: number,
    options: {
      readonly compositionLibrary?: readonly MotionComposition[];
      readonly assetResolver?: MotionRendererAssetResolver;
      readonly variableOverrides?: Record<string, string | number | boolean>;
      readonly supersample?: number;
    } = {},
  ): Promise<MotionRootLayerImage[]> {
    this.deviceScale = resolveMotionSupersample(
      options.supersample,
      composition.width,
      composition.height,
    );
    const library = options.compositionLibrary ?? [composition];
    await ensureMotionFontsReady(library);

    const baseOptions: RenderLayerOptions = {
      compositionLibrary: library,
      compositionStack: [composition.id],
      soloLayerIds: getMotionSoloLayerIds(composition),
      assetResolver: options.assetResolver,
      variableOverrides: options.variableOverrides,
    };

    const ordered = orderMotionLayersForRender(
      composition,
      getMotionRootLayers(composition),
      localTime,
      { variableOverrides: options.variableOverrides },
    );

    const results: MotionRootLayerImage[] = [];
    for (const layer of ordered) {
      const buffer = this.createTempCanvas(composition);
      buffer.ctx.setTransform(
        this.deviceScale,
        0,
        0,
        this.deviceScale,
        0,
        0,
      );
      const normalized =
        layer.blendMode && layer.blendMode !== "normal"
          ? ({ ...layer, blendMode: "normal" } as MotionLayer)
          : layer;
      await this.renderLayerTree(
        buffer.ctx,
        composition,
        normalized,
        localTime,
        baseOptions,
      );
      results.push({
        image: await createImageBitmap(buffer.canvas),
        blendMode: layer.blendMode ?? "normal",
        layerId: layer.id,
      });
    }
    return results;
  }

  private ensureCanvas(width: number, height: number): void {
    const physicalWidth = Math.max(1, Math.round(width * this.deviceScale));
    const physicalHeight = Math.max(1, Math.round(height * this.deviceScale));
    if (
      this.canvas?.width === physicalWidth &&
      this.canvas.height === physicalHeight
    ) {
      return;
    }
    this.canvas = new OffscreenCanvas(physicalWidth, physicalHeight);
    this.ctx = this.canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false,
    });
    if (!this.ctx) {
      throw new Error("MotionRenderer could not create a 2D context");
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
  }

  private async renderLayerTree(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    sourceLayer: MotionLayer,
    compositionTime: number,
    options: RenderLayerOptions = {},
  ): Promise<void> {
    const layer = resolveMotionLayerVariableBindings(
      composition,
      sourceLayer,
      options.variableOverrides,
    );
    const forceVisible = options.forceVisibleLayerIds?.has(layer.id) ?? false;
    if (!isMotionLayerActive(layer, compositionTime, forceVisible)) {
      return;
    }
    const soloLayerIds = options.soloLayerIds ?? getMotionSoloLayerIds(composition);
    if (!forceVisible && !isMotionLayerTreeVisible(composition, layer, soloLayerIds)) {
      return;
    }

    if (!options.ignoreMotionBlur) {
      const plan = getMotionBlurSamplePlanAtTime(
        composition,
        layer,
        compositionTime,
      );
      if (plan.enabled) {
        const opacityMultiplier = options.opacityMultiplier ?? 1;
        for (const sampleTime of plan.sampleTimes) {
          await this.renderLayerTree(ctx, composition, layer, sampleTime, {
            ...options,
            ignoreMotionBlur: true,
            opacityMultiplier: opacityMultiplier * plan.weight,
          });
        }
        return;
      }
    }

    const matteSource = options.ignoreTrackMatte
      ? undefined
      : getMotionTrackMatteSource(composition, layer);
    if (matteSource) {
      await this.renderLayerTreeWithTrackMatte(
        ctx,
        composition,
        layer,
        matteSource,
        compositionTime,
        options,
      );
      return;
    }

    const localTime = compositionTime - layer.startTime;
    const layerTransform = getMotionTransformAtTime(
      layer.transform,
      layer.keyframes,
      localTime,
      layer.expressions,
      layer.duration,
      layer.autoOrient,
      { composition, layer },
    );
    const transform = applyMotionCameraToTransform(
      composition,
      layerTransform,
      compositionTime,
    );
    const lighting = getMotionLightingForLayer(
      composition,
      layerTransform,
      compositionTime,
    );
    const enabledEffects = evaluateMotionEffectsAtTime(
      layer.effects,
      layer.keyframes,
      localTime,
      layer.expressions,
      layer.duration,
      composition,
      layer,
    ).filter((effect) => effect.enabled);
    const shouldRenderContent = isMotionLayerContentVisible(
      composition,
      layer,
      soloLayerIds,
    );
    const renderLayer = evaluateMotionLayerMasksAtTime(
      layer,
      localTime,
      composition,
    );

    ctx.save();
    const projection = getMotionCanvas3DProjection(transform);
    const projectionPosition =
      renderLayer.type === "scene3d"
        ? { x: transform.position.x, y: transform.position.y }
        : transform.position;
    const projected = projectMotion3DPosition(projectionPosition, transform.perspective, {
      x: composition.width / 2,
      y: composition.height / 2,
    });
    const usesPerspectiveWarp =
      (renderLayer.type === "image" || renderLayer.type === "video") &&
      hasMotion3DRotation(transform);
    ctx.translate(projected.x, projected.y);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    if (renderLayer.type === "scene3d") {
      // True 3D rotation is handled by the WebGL engine inside the layer, so the
      // 2D transform must NOT apply the 2.5D cos-scale (that would double up).
      ctx.scale(transform.scale.x, transform.scale.y);
    } else if (usesPerspectiveWarp) {
      ctx.scale(
        transform.scale.x * projection.depthScale,
        transform.scale.y * projection.depthScale,
      );
    } else {
      ctx.scale(projection.scaleX, projection.scaleY);
    }
    ctx.translate(-transform.anchor.x, -transform.anchor.y);

    if (renderLayer.type === "adjustment" && shouldRenderContent) {
      this.applyAdjustmentLayer(
        ctx,
        composition,
        renderLayer,
        transform,
        enabledEffects,
        localTime,
        options.opacityMultiplier ?? 1,
      );
    } else if (shouldRenderContent && isVisualMotionLayer(renderLayer)) {
      ctx.save();
      const backdropBlurRadius = getMotionBackdropBlurRadius(enabledEffects);
      if (backdropBlurRadius > 0) {
        this.applyBackdropBlur(
          ctx,
          composition,
          renderLayer,
          backdropBlurRadius,
          localTime,
        );
      }
      if (
        layerUsesAdvancedMotionMasks(renderLayer) ||
        layerNeedsBufferedEffects(renderLayer)
      ) {
        await this.renderVisualLayerWithAdvancedMasks(
          ctx,
          composition,
          renderLayer,
          localTime,
          transform,
          enabledEffects,
          lighting,
          layerTransform,
          compositionTime,
          options,
        );
      } else {
        applyMotionLayerMasksToCanvas(ctx, renderLayer);
        this.configureVisualLayerContext(
          ctx,
          renderLayer,
          transform,
          enabledEffects,
          lighting,
          buildMotionCameraDepthOfFieldCanvasFilter(
            composition,
            layerTransform,
            compositionTime,
          ),
          options.opacityMultiplier ?? 1,
          true,
        );
        await this.renderVisualLayerContent(
          ctx,
          composition,
          renderLayer,
          localTime,
          options,
          transform,
        );
      }
      ctx.restore();
    } else if (renderLayer.type === "group" && shouldRenderContent) {
      if (
        layerUsesAdvancedMotionMasks(renderLayer) ||
        enabledEffects.length > 0 ||
        (renderLayer.blendMode ?? "normal") !== "normal"
      ) {
        await this.renderGroupLayerWithAdvancedMasks(
          ctx,
          composition,
          renderLayer,
          compositionTime,
          localTime,
          transform,
          enabledEffects,
          options,
        );
        ctx.restore();
        return;
      }
      applyMotionLayerMasksToCanvas(ctx, renderLayer);
    }

    const childOptions =
      renderLayer.type === "group"
        ? {
            ...options,
            opacityMultiplier:
              (options.opacityMultiplier ?? 1) * transform.opacity,
          }
        : options;

    for (const child of orderMotionLayersForRender(
      composition,
      getMotionLayerChildren(composition, renderLayer.id),
      compositionTime,
      { variableOverrides: options.variableOverrides },
    )) {
      await this.renderLayerTree(ctx, composition, child, compositionTime, childOptions);
    }

    ctx.restore();
  }

  private async renderVisualLayerWithAdvancedMasks(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: VisualMotionLayer,
    localTime: number,
    transform: MotionTransform,
    enabledEffects: readonly MotionEffect[],
    lighting: ReturnType<typeof getMotionLightingForLayer>,
    layerTransform: MotionTransform,
    compositionTime: number,
    options: RenderLayerOptions,
  ): Promise<void> {
    const contentBuffer = this.createTempCanvas(composition);
    const currentTransform = ctx.getTransform();

    contentBuffer.ctx.setTransform(currentTransform);
    this.configureVisualLayerContext(
      contentBuffer.ctx,
      layer,
      transform,
      [],
      lighting,
      buildMotionCameraDepthOfFieldCanvasFilter(
        composition,
        layerTransform,
        compositionTime,
      ),
      options.opacityMultiplier ?? 1,
      false,
    );
    await this.renderVisualLayerContent(
      contentBuffer.ctx,
      composition,
      layer,
      localTime,
      options,
      transform,
    );

    this.applyOrderedMotionEffectsToBuffer(
      contentBuffer,
      layer,
      enabledEffects,
      localTime,
      composition,
      false,
    );

    if ((layer.masks ?? []).some((mask) => mask.enabled)) {
      const maskBuffer = this.createTempCanvas(composition);
      maskBuffer.ctx.setTransform(currentTransform);
      paintMotionLayerMaskAlphaToCanvas(maskBuffer.ctx, layer);

      contentBuffer.ctx.save();
      contentBuffer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      contentBuffer.ctx.globalCompositeOperation = "destination-in";
      contentBuffer.ctx.drawImage(maskBuffer.canvas, 0, 0);
      contentBuffer.ctx.restore();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = getMotionCanvasBlendMode(layer.blendMode);
    ctx.drawImage(contentBuffer.canvas, 0, 0);
    ctx.restore();
  }

  private applyMotionShaderEffectsToBuffer(
    contentBuffer: MotionTempCanvas,
    layer: MotionLayer,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    const width = contentBuffer.canvas.width;
    const height = contentBuffer.canvas.height;
    if (width <= 0 || height <= 0) return;

    if (!this.shaderRenderer) {
      this.shaderRenderer = new MotionShaderRenderer();
    }
    const shaderRenderer = this.shaderRenderer;

    for (const effect of getEnabledMotionEffects(layer)) {
      if (effect.type !== "shader") continue;
      const def = getMotionShaderDef(effect.shaderId);
      if (!def) continue;

      const params: Record<string, number | string> = {};
      for (const paramDef of def.params) {
        if (paramDef.type === "color") {
          params[paramDef.name] = resolveShaderColorParamValue(
            effect.params[paramDef.name],
            paramDef.default,
          );
          continue;
        }
        params[paramDef.name] = getMotionEffectParameterValueAtTime(
          effect,
          layer.keyframes,
          paramDef.name,
          localTime,
          layer.expressions,
          layer.duration,
          composition,
          layer,
        );
      }

      const result = shaderRenderer.render(def, {
        width,
        height,
        time: localTime,
        params,
        inputCanvas: contentBuffer.canvas,
      });
      if (!result) continue;

      contentBuffer.ctx.save();
      contentBuffer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      contentBuffer.ctx.clearRect(0, 0, width, height);
      contentBuffer.ctx.drawImage(result, 0, 0, width, height);
      contentBuffer.ctx.restore();
    }
  }

  private applyOrderedMotionEffectsToBuffer(
    buffer: MotionTempCanvas,
    layer: MotionLayer,
    enabledEffects: readonly MotionEffect[],
    localTime: number,
    composition: MotionComposition,
    backdropAsBlur: boolean,
  ): boolean {
    let appliedEffect = false;
    for (const effect of enabledEffects) {
      const singleEffectLayer = {
        ...layer,
        effects: [effect],
      } as MotionLayer;

      if (isMotionPixelEffect(effect.type)) {
        const imageData = buffer.ctx.getImageData(
          0,
          0,
          buffer.canvas.width,
          buffer.canvas.height,
        );
        applyMotionPixelEffectsToBuffer(
          imageData,
          singleEffectLayer,
          localTime,
          composition,
        );
        buffer.ctx.putImageData(imageData, 0, 0);
        appliedEffect = true;
        continue;
      }

      if (effect.type === "shader") {
        this.applyMotionShaderEffectsToBuffer(
          buffer,
          singleEffectLayer,
          localTime,
          composition,
        );
        appliedEffect = true;
        continue;
      }

      const filter =
        backdropAsBlur &&
        effect.type === "backdrop-blur" &&
        effect.radius > 0
          ? `blur(${effect.radius}px)`
          : buildMotionCanvasFilter([effect]);
      if (filter === "none") continue;

      const filtered = this.createTempCanvas(composition);
      filtered.ctx.filter = filter;
      filtered.ctx.drawImage(buffer.canvas, 0, 0);
      buffer.ctx.clearRect(0, 0, buffer.canvas.width, buffer.canvas.height);
      buffer.ctx.drawImage(filtered.canvas, 0, 0);
      appliedEffect = true;
    }
    return appliedEffect;
  }

  private async renderGroupLayerWithAdvancedMasks(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: Extract<MotionLayer, { type: "group" }>,
    compositionTime: number,
    localTime: number,
    transform: MotionTransform,
    enabledEffects: readonly MotionEffect[],
    options: RenderLayerOptions,
  ): Promise<void> {
    const contentBuffer = this.createTempCanvas(composition);
    const currentTransform = ctx.getTransform();
    const childOptions = {
      ...options,
      opacityMultiplier: (options.opacityMultiplier ?? 1) * transform.opacity,
    };

    contentBuffer.ctx.setTransform(currentTransform);
    for (const child of orderMotionLayersForRender(
      composition,
      getMotionLayerChildren(composition, layer.id),
      compositionTime,
      { variableOverrides: options.variableOverrides },
    )) {
      await this.renderLayerTree(
        contentBuffer.ctx,
        composition,
        child,
        compositionTime,
        childOptions,
      );
    }

    this.applyOrderedMotionEffectsToBuffer(
      contentBuffer,
      layer,
      enabledEffects,
      localTime,
      composition,
      false,
    );

    if ((layer.masks ?? []).some((mask) => mask.enabled)) {
      const maskBuffer = this.createTempCanvas(composition);
      maskBuffer.ctx.setTransform(currentTransform);
      paintMotionLayerMaskAlphaToCanvas(maskBuffer.ctx, layer);

      contentBuffer.ctx.save();
      contentBuffer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      contentBuffer.ctx.globalCompositeOperation = "destination-in";
      contentBuffer.ctx.drawImage(maskBuffer.canvas, 0, 0);
      contentBuffer.ctx.restore();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = getMotionCanvasBlendMode(layer.blendMode);
    ctx.drawImage(contentBuffer.canvas, 0, 0);
    ctx.restore();
  }

  private configureVisualLayerContext(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: VisualMotionLayer,
    transform: MotionTransform,
    enabledEffects: readonly MotionEffect[],
    lighting: ReturnType<typeof getMotionLightingForLayer>,
    depthOfFieldFilter: string,
    opacityMultiplier: number,
    includeBlendMode: boolean,
  ): void {
    if (includeBlendMode) {
      ctx.globalCompositeOperation = getMotionCanvasBlendMode(layer.blendMode);
    }
    ctx.filter = combineCanvasFilters(
      buildMotionCanvasFilter(enabledEffects),
      buildMotionLightingCanvasFilter(lighting),
      depthOfFieldFilter,
    );
    const shadow = lighting.shadow;
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
    }
    ctx.globalAlpha = transform.opacity * opacityMultiplier;
  }

  private async renderVisualLayerContent(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: VisualMotionLayer,
    localTime: number,
    options: RenderLayerOptions,
    transform?: MotionTransform,
  ): Promise<void> {
    switch (layer.type) {
      case "shape":
        this.renderShape(ctx, layer, localTime, composition);
        break;
      case "text":
        this.renderText(ctx, layer, localTime, composition);
        break;
      case "composition":
        await this.renderNestedComposition(ctx, layer, localTime, options);
        break;
      case "image":
        await this.renderImage(ctx, composition, layer, options, transform);
        break;
      case "video":
        await this.renderVideo(ctx, composition, layer, localTime, options, transform);
        break;
      case "particle":
        this.renderParticles(ctx, layer, localTime);
        break;
      case "scene3d":
        await this.renderScene3D(ctx, composition, layer, options, localTime, transform);
        break;
    }
  }

  private async renderScene3D(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: Extract<MotionLayer, { type: "scene3d" }>,
    options: RenderLayerOptions,
    localTime: number,
    transform?: MotionTransform,
  ): Promise<void> {
    const boundsW = layer.width ?? composition.width;
    const boundsH = layer.height ?? composition.height;
    const pixelW = Math.max(1, Math.round(boundsW * this.deviceScale));
    const pixelH = Math.max(1, Math.round(boundsH * this.deviceScale));

    if (options.assetResolver?.renderScene3D) {
      try {
        const rendered = await options.assetResolver.renderScene3D({
          composition,
          layer,
          localTime,
          width: pixelW,
          height: pixelH,
          backgroundColor: composition.backgroundColor,
          quality: options.quality,
        });
        if (rendered) {
          try {
            ctx.drawImage(rendered.image, -boundsW / 2, -boundsH / 2, boundsW, boundsH);
          } finally {
            rendered.release?.();
          }
          return;
        }
      } catch (error) {
        console.warn("[MotionRenderer] native scene3d render failed, falling back to Three.js", error);
      }
    }

    if (!this.threeRenderer) {
      this.threeRenderer = new MotionThreeRenderer();
    }
    if (!this.threeRenderer.isAvailable()) return;

    if (layer.objects && layer.objects.length > 0) {
      await this.renderScene3DMultiObject(
        ctx,
        composition,
        layer,
        options,
        localTime,
        boundsW,
        boundsH,
        pixelW,
        pixelH,
      );
      return;
    }

    const activeTransform = transform ?? layer.transform;
    const rot = activeTransform.rotation3d ?? { x: 0, y: 0, z: 0 };
    const cameraZoom = activeTransform.position.z ?? 0;

    let screenTexture: TexImageSource | null = null;
    if (layer.material?.mapAssetId && options.assetResolver) {
      const asset = composition.assets.find(
        (candidate) => candidate.id === layer.material?.mapAssetId,
      );
      if (asset) {
        const resolved = await options.assetResolver.resolveImageAsset(asset);
        if (resolved && typeof (resolved as HTMLImageElement).width === "number") {
          screenTexture = resolved as unknown as TexImageSource;
        }
      }
    }

    const renderLayer = await this.resolveScene3DLayerModels(layer, options);
    const rendered = await this.threeRenderer.render({
      layer: renderLayer,
      rotation: { x: rot.x, y: rot.y, z: rot.z ?? 0 },
      cameraZoom,
      width: pixelW,
      height: pixelH,
      screenTexture,
      timeSeconds: localTime,
      quality: options.quality,
    });
    if (!rendered) return;
    ctx.drawImage(rendered, -boundsW / 2, -boundsH / 2, boundsW, boundsH);
  }

  private async renderScene3DMultiObject(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: Extract<MotionLayer, { type: "scene3d" }>,
    options: RenderLayerOptions,
    localTime: number,
    boundsW: number,
    boundsH: number,
    pixelW: number,
    pixelH: number,
  ): Promise<void> {
    const sample = (property: string, fallback: number): number =>
      evaluateMotionPropertyValueAtTime({
        keyframes: layer.keyframes,
        expressions: layer.expressions,
        property,
        localTime,
        fallback,
        duration: layer.duration,
        context: { composition, layer },
      });

    const resolveObjectTexture = async (
      mapAssetId: string | undefined,
    ): Promise<TexImageSource | null> => {
      if (!mapAssetId || !options.assetResolver) return null;
      const asset = composition.assets.find(
        (candidate) => candidate.id === mapAssetId,
      );
      if (!asset) return null;
      const resolved = await options.assetResolver.resolveImageAsset(asset);
      if (resolved && typeof (resolved as HTMLImageElement).width === "number") {
        return resolved as unknown as TexImageSource;
      }
      return null;
    };

    const objects = await Promise.all(
      (layer.objects ?? []).map(async (obj) => {
        const id = obj.id;
        const pos = obj.transform3d?.position;
        const rot = obj.transform3d?.rotation;
        const scl = obj.transform3d?.scale;
        const [texture, normalTexture, roughnessTexture, metalnessTexture] =
          await Promise.all([
            resolveObjectTexture(obj.material?.mapAssetId),
            resolveObjectTexture(obj.material?.normalMapAssetId),
            resolveObjectTexture(obj.material?.roughnessMapAssetId),
            resolveObjectTexture(obj.material?.metalnessMapAssetId),
          ]);
        return {
          id,
          object: await this.resolveMotionObjectModelUrl(
            sampleMotionObjectMeshFrame(obj.object, localTime),
            options,
          ),
          material: obj.material,
          texture,
          normalTexture,
          roughnessTexture,
          metalnessTexture,
          position: {
            x: sample(`scene.object.${id}.position.x`, pos?.x ?? 0),
            y: sample(`scene.object.${id}.position.y`, pos?.y ?? 0),
            z: sample(`scene.object.${id}.position.z`, pos?.z ?? 0),
          },
          rotation: {
            x: sample(`scene.object.${id}.rotation.x`, rot?.x ?? 0),
            y: sample(`scene.object.${id}.rotation.y`, rot?.y ?? 0),
            z: sample(`scene.object.${id}.rotation.z`, rot?.z ?? 0),
          },
          scale: {
            x: sample(`scene.object.${id}.scale.x`, scl?.x ?? 1),
            y: sample(`scene.object.${id}.scale.y`, scl?.y ?? 1),
            z: sample(`scene.object.${id}.scale.z`, scl?.z ?? 1),
          },
          opacity: sample(`scene.object.${id}.opacity`, obj.opacity ?? 1),
          lidAngle: sample(`scene.object.${id}.lid.angle`, obj.lidAngle ?? 0),
        };
      }),
    );

    const cam = layer.camera;
    const camera = {
      position: {
        x: sample("scene.camera.position.x", cam?.position?.x ?? 0),
        y: sample("scene.camera.position.y", cam?.position?.y ?? 3),
        z: sample("scene.camera.position.z", cam?.position?.z ?? 14),
      },
      target: {
        x: sample("scene.camera.target.x", cam?.target?.x ?? 0),
        y: sample("scene.camera.target.y", cam?.target?.y ?? 0),
        z: sample("scene.camera.target.z", cam?.target?.z ?? 0),
      },
      fov: sample("scene.camera.fov", cam?.fov ?? layer.fov ?? 38),
      near: cam?.near,
      far: cam?.far,
    };

    const rendered = await this.threeRenderer!.render({
      layer,
      rotation: { x: 0, y: 0, z: 0 },
      width: pixelW,
      height: pixelH,
      timeSeconds: localTime,
      scene: { objects, camera, room: layer.room },
      quality: options.quality,
    });
    if (!rendered) return;
    ctx.drawImage(rendered, -boundsW / 2, -boundsH / 2, boundsW, boundsH);
  }

  private async resolveScene3DLayerModels(
    layer: Extract<MotionLayer, { type: "scene3d" }>,
    options: RenderLayerOptions,
  ): Promise<Extract<MotionLayer, { type: "scene3d" }>> {
    if (!options.assetResolver?.resolveModelUrl) return layer;
    const object = await this.resolveMotionObjectModelUrl(layer.object, options);
    return object === layer.object ? layer : { ...layer, object };
  }

  private async resolveMotionObjectModelUrl(
    object: MotionObject3D,
    options: RenderLayerOptions,
  ): Promise<MotionObject3D> {
    const modelUrl = object.kind === "model" ? object.modelUrl : undefined;
    if (!modelUrl || !options.assetResolver?.resolveModelUrl) return object;
    const resolved = await options.assetResolver.resolveModelUrl(modelUrl);
    if (!resolved || resolved === modelUrl) return object;
    return { ...object, modelUrl: resolved };
  }

  private renderParticles(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "particle" }>,
    localTime: number,
  ): void {
    const emitter = getMotionParticleEmitterAtTime(layer, localTime);
    for (const particle of getMotionParticlesAtTime(
      { ...layer, emitter },
      localTime,
      (time) => getMotionParticleEmitterAtTime(layer, time),
    )) {
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate((particle.rotation * Math.PI) / 180);
      ctx.globalAlpha *= particle.opacity;
      ctx.fillStyle = particle.color;
      const size = particle.size;
      if (emitter.shape === "square") {
        ctx.fillRect(-size / 2, -size / 2, size, size);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private applyBackdropBlur(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: VisualMotionLayer,
    radius: number,
    localTime: number,
  ): void {
    if (radius <= 0) {
      return;
    }
    const backdrop = this.createTempCanvas(composition);
    backdrop.ctx.save();
    backdrop.ctx.setTransform(1, 0, 0, 1, 0, 0);
    backdrop.ctx.filter = `blur(${Math.max(0, radius)}px)`;
    backdrop.ctx.drawImage(ctx.canvas, 0, 0);
    backdrop.ctx.restore();

    ctx.save();
    this.clipToLayerBounds(ctx, layer, localTime);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.drawImage(backdrop.canvas, 0, 0);
    ctx.restore();
  }

  private clipToLayerBounds(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: VisualMotionLayer,
    localTime: number,
  ): void {
    if (layer.type === "shape") {
      this.buildShapePath(ctx, layer, localTime, 0);
      ctx.clip();
      return;
    }
    const bounds = getMotionLayerVisualBounds(layer);
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
  }

  private applyAdjustmentLayer(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: Extract<MotionLayer, { type: "adjustment" }>,
    transform: MotionTransform,
    enabledEffects: readonly MotionEffect[],
    localTime: number,
    opacityMultiplier: number,
  ): void {
    const opacity = clampAlpha(transform.opacity * opacityMultiplier);
    if (enabledEffects.length === 0 || opacity <= 0) {
      return;
    }

    const buffer = this.createTempCanvas(composition);
    buffer.ctx.drawImage(ctx.canvas, 0, 0);
    const appliedEffect = this.applyOrderedMotionEffectsToBuffer(
      buffer,
      layer,
      enabledEffects,
      localTime,
      composition,
      true,
    );

    if (!appliedEffect) return;

    ctx.save();
    const projection = getMotionCanvas3DProjection(transform);
    const projected = projectMotion3DPosition(transform.position, transform.perspective, {
      x: composition.width / 2,
      y: composition.height / 2,
    });
    ctx.translate(projected.x, projected.y);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(projection.scaleX, projection.scaleY);
    ctx.translate(-transform.anchor.x, -transform.anchor.y);
    ctx.beginPath();
    ctx.rect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
    ctx.clip();
    applyMotionLayerMasksToCanvas(ctx, layer);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if ((layer.blendMode ?? "normal") === "normal" && opacity >= 0.999) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = getMotionCanvasBlendMode(layer.blendMode);
    ctx.drawImage(buffer.canvas, 0, 0);
    ctx.restore();
  }

  private async renderLayerTreeWithTrackMatte(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: MotionLayer,
    matteSource: MotionLayer,
    compositionTime: number,
    options: RenderLayerOptions,
  ): Promise<void> {
    const layerBuffer = this.createTempCanvas(composition);
    const matteBuffer = this.createTempCanvas(composition);
    const currentTransform = ctx.getTransform();

    layerBuffer.ctx.setTransform(currentTransform);
    await this.renderLayerTree(
      layerBuffer.ctx,
      composition,
      layer,
      compositionTime,
      { ...options, ignoreTrackMatte: true },
    );

    matteBuffer.ctx.setTransform(currentTransform);
    await this.renderLayerTree(
      matteBuffer.ctx,
      composition,
      matteSource,
      compositionTime,
      {
        ...options,
        ignoreTrackMatte: true,
        forceVisibleLayerIds: new Set([
          ...(options.forceVisibleLayerIds ?? []),
          matteSource.id,
        ]),
      },
    );

    const matte = layer.trackMatte;
    if (!matte) {
      return;
    }

    if (isLumaMotionTrackMatte(matte.type)) {
      applyLumaToAlpha(
        matteBuffer.ctx,
        matteBuffer.canvas.width,
        matteBuffer.canvas.height,
        matte.type === "luma-inverted",
      );
    }

    layerBuffer.ctx.save();
    layerBuffer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    layerBuffer.ctx.globalCompositeOperation =
      isInvertedMotionTrackMatte(matte.type) && !isLumaMotionTrackMatte(matte.type)
        ? "destination-out"
        : "destination-in";
    layerBuffer.ctx.drawImage(matteBuffer.canvas, 0, 0);
    layerBuffer.ctx.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = getMotionCanvasBlendMode(layer.blendMode);
    ctx.drawImage(layerBuffer.canvas, 0, 0);
    ctx.restore();
  }

  private createTempCanvas(composition: MotionComposition): MotionTempCanvas {
    return this.createSizedTempCanvas(
      Math.max(1, Math.round(composition.width * this.deviceScale)),
      Math.max(1, Math.round(composition.height * this.deviceScale)),
    );
  }

  private createSizedTempCanvas(width: number, height: number): MotionTempCanvas {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false,
    });
    if (!ctx) {
      throw new Error("MotionRenderer could not create a temporary 2D context");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    return { canvas, ctx };
  }

  private async renderCompositionToContext(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    localTime: number,
    options: Required<
      Pick<RenderLayerOptions, "compositionLibrary" | "compositionStack">
    > &
      Pick<RenderLayerOptions, "assetResolver" | "variableOverrides" | "quality">,
  ): Promise<void> {
    if (options.compositionStack.includes(composition.id)) {
      return;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (
      composition.backgroundColor &&
      composition.backgroundColor !== "transparent"
    ) {
      ctx.fillStyle = composition.backgroundColor;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.restore();

    const nextOptions: RenderLayerOptions = {
      ...options,
      compositionStack: [...options.compositionStack, composition.id],
      soloLayerIds: getMotionSoloLayerIds(composition),
    };

    for (const layer of orderMotionLayersForRender(
      composition,
      getMotionRootLayers(composition),
      localTime,
      { variableOverrides: options.variableOverrides },
    )) {
      await this.renderLayerTree(ctx, composition, layer, localTime, nextOptions);
    }
  }

  private renderShape(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    if (hasExplicitShapeContents(layer)) {
      this.renderShapeContents(ctx, layer, localTime, composition);
      return;
    }
    const evaluatedLayer = evaluateMotionPuppetPinsAtTime(
      evaluateMotionShapeModifiersAtTime(
        evaluateMotionShapeLayerStyleAtTime(layer, localTime, composition),
        localTime,
        composition,
      ),
      localTime,
    );
    const trimPaths = getMotionTrimPathsModifier(evaluatedLayer);
    const repeater = getMotionRepeaterModifier(evaluatedLayer);
    for (const copy of getMotionRepeaterCopies(repeater)) {
      ctx.save();
      ctx.translate(copy.position.x, copy.position.y);
      ctx.rotate((copy.rotation * Math.PI) / 180);
      ctx.scale(copy.scale.x, copy.scale.y);
      ctx.globalAlpha *= copy.opacity;
      this.renderSingleShape(ctx, evaluatedLayer, trimPaths, localTime, composition);
      ctx.restore();
    }
  }

  private renderShapeContents(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    const styledLayer = evaluateMotionShapeLayerStyleAtTime(
      layer,
      localTime,
      composition,
    );
    const contents = resolveShapeContentsAtTime(
      styledLayer,
      localTime,
      composition,
    );
    for (const item of contents) {
      this.renderShapeItem(
        ctx,
        item,
        styledLayer,
        localTime,
        composition,
        styledLayer.style,
      );
    }
  }

  private renderShapeItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: MotionShapeItem,
    baseLayer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition: MotionComposition | undefined,
    inheritedStyle: ShapeStyle,
  ): void {
    if (item.visible === false) {
      return;
    }

    if (item.kind === "path") {
      this.renderShapePathItem(
        ctx,
        item,
        baseLayer,
        localTime,
        composition,
        inheritedStyle,
      );
      return;
    }

    if (shouldMergeShapeGroup(item)) {
      this.renderMergedShapeGroup(
        ctx,
        item,
        baseLayer,
        localTime,
        composition,
        inheritedStyle,
      );
      return;
    }

    this.renderPlainShapeGroup(
      ctx,
      item,
      baseLayer,
      localTime,
      composition,
      inheritedStyle,
    );
  }

  private renderPlainShapeGroup(
    ctx: OffscreenCanvasRenderingContext2D,
    group: MotionShapeGroupItem,
    baseLayer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition: MotionComposition | undefined,
    inheritedStyle: ShapeStyle,
  ): void {
    const [a, b, c, d, e, f] = shapeGroupTransformToMatrix(group.transform);
    ctx.save();
    ctx.transform(a, b, c, d, e, f);
    ctx.globalAlpha *= group.transform.opacity;
    const childStyle = group.style ?? inheritedStyle;
    for (const child of group.items) {
      this.renderShapeItem(
        ctx,
        child,
        baseLayer,
        localTime,
        composition,
        childStyle,
      );
    }
    ctx.restore();
  }

  private renderShapePathItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: MotionShapePathItem,
    baseLayer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition: MotionComposition | undefined,
    inheritedStyle: ShapeStyle,
  ): void {
    const style = item.style ?? inheritedStyle;
    const effectiveLayer = this.synthesizeShapeItemLayer(
      baseLayer,
      item,
      style,
    );
    ctx.save();
    ctx.translate(item.position.x, item.position.y);
    this.renderSingleShape(ctx, effectiveLayer, undefined, localTime, composition);
    ctx.restore();
  }

  private synthesizeShapeItemLayer(
    baseLayer: Extract<MotionLayer, { type: "shape" }>,
    item: MotionShapePathItem,
    style: ShapeStyle,
  ): Extract<MotionLayer, { type: "shape" }> {
    return {
      ...baseLayer,
      shapeType: item.shapeType,
      width: item.width,
      height: item.height,
      pathData: item.pathData,
      pathClosed: item.pathClosed,
      style,
      modifiers: [],
      puppetPins: [],
      contents: undefined,
    };
  }

  private renderMergedShapeGroup(
    ctx: OffscreenCanvasRenderingContext2D,
    group: MotionShapeGroupItem,
    baseLayer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition: MotionComposition | undefined,
    inheritedStyle: ShapeStyle,
  ): void {
    const groupStyle = group.style ?? inheritedStyle;
    const groupMatrix = shapeGroupTransformToMatrix(group.transform);
    const groupOpacity = group.transform.opacity;
    const entries: ShapeItemRingEntry[] = [];
    for (const child of group.items) {
      entries.push(
        ...collectShapeItemRings(
          child,
          baseLayer,
          SHAPE_IDENTITY_MATRIX,
          1,
          groupStyle,
        ),
      );
    }

    const closedEntries = entries.filter((entry) => entry.closed);
    const openEntries = entries.filter((entry) => !entry.closed);

    let mergedRings: MotionVector2[][][];
    try {
      const ringSets = closedEntries.map((entry) => entry.rings);
      const merged = mergeMotionShapeRings(
        ringSets,
        group.mergeMode ?? "none",
      );
      mergedRings = applyMotionShapeOperatorStack(
        merged,
        group.operators ?? [],
        { localTime },
      );
    } catch (error) {
      if (error instanceof MotionShapeBooleanError) {
        this.renderPlainShapeGroup(
          ctx,
          group,
          baseLayer,
          localTime,
          composition,
          inheritedStyle,
        );
        return;
      }
      throw error;
    }

    const [ga, gb, gc, gd, ge, gf] = groupMatrix;
    ctx.save();
    ctx.transform(ga, gb, gc, gd, ge, gf);
    ctx.globalAlpha *= groupOpacity;
    this.fillMergedShapeRings(ctx, mergedRings, groupStyle, localTime);
    for (const entry of openEntries) {
      this.strokeOpenShapeEntry(ctx, entry, groupStyle);
    }
    ctx.restore();
  }

  private computeMergedRingBounds(
    ringSets: MotionVector2[][][],
  ): { minX: number; minY: number; width: number; height: number } | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const polygon of ringSets) {
      for (const ring of polygon) {
        for (const point of ring) {
          if (point === undefined) continue;
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
          if (point.x < minX) minX = point.x;
          if (point.y < minY) minY = point.y;
          if (point.x > maxX) maxX = point.x;
          if (point.y > maxY) maxY = point.y;
        }
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return {
      minX,
      minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  private firstGradientStopColor(fill: FillStyle): string | null {
    const stop = fill.gradient?.stops?.[0];
    return stop ? stop.color : null;
  }

  private createMergedShapeFillStyle(
    ctx: OffscreenCanvasRenderingContext2D,
    fill: FillStyle,
    bounds: { minX: number; minY: number; width: number; height: number },
    localTime: number,
  ): string | CanvasGradient | CanvasPattern {
    if (fill.type === "solid") return fill.color ?? "#ffffff";
    if (fill.type === "gradient") {
      if (!fill.gradient) return fill.color ?? "#ffffff";
      return this.buildMotionGradient(
        ctx,
        fill.gradient,
        bounds.width,
        bounds.height,
      );
    }
    if (fill.type === "shader") {
      if (fill.shader) {
        const pattern = this.createMotionShaderFillPattern(
          ctx,
          fill.shader,
          bounds.width,
          bounds.height,
          localTime,
          bounds.minX,
          bounds.minY,
        );
        if (pattern) return pattern;
      }
      return fill.color ?? this.firstGradientStopColor(fill) ?? "#888888";
    }
    return fill.color ?? this.firstGradientStopColor(fill) ?? "#ffffff";
  }

  private fillMergedShapeRings(
    ctx: OffscreenCanvasRenderingContext2D,
    ringSets: MotionVector2[][][],
    style: ShapeStyle,
    localTime: number,
  ): void {
    if (ringSets.length === 0) {
      return;
    }
    const bounds = this.computeMergedRingBounds(ringSets);
    const traceAt = (originX: number, originY: number): void => {
      ctx.beginPath();
      for (const polygon of ringSets) {
        for (const ring of polygon) {
          if (ring.length === 0) {
            continue;
          }
          const first = ring[0];
          if (first === undefined) {
            continue;
          }
          ctx.moveTo(first.x - originX, first.y - originY);
          for (let index = 1; index < ring.length; index += 1) {
            const point = ring[index];
            if (point === undefined) {
              continue;
            }
            ctx.lineTo(point.x - originX, point.y - originY);
          }
          ctx.closePath();
        }
      }
    };
    const trace = (): void => traceAt(0, 0);

    if (style.fill.type !== "none") {
      ctx.save();
      ctx.globalAlpha *= style.fill.opacity;
      if (bounds) {
        ctx.translate(bounds.minX, bounds.minY);
        ctx.fillStyle = this.createMergedShapeFillStyle(
          ctx,
          style.fill,
          bounds,
          localTime,
        );
        traceAt(bounds.minX, bounds.minY);
      } else {
        ctx.fillStyle = style.fill.color ?? "#ffffff";
        trace();
      }
      ctx.fill("evenodd");
      ctx.restore();
    }

    const stroke = normalizeMotionStroke(style.stroke);
    if (stroke.width > 0 && stroke.opacity > 0) {
      trace();
      ctx.save();
      ctx.globalAlpha *= stroke.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = stroke.lineCap;
      ctx.lineJoin = stroke.lineJoin;
      ctx.setLineDash([...stroke.dashArray]);
      ctx.lineDashOffset = stroke.dashOffset;
      ctx.stroke();
      ctx.restore();
    }
  }

  private strokeOpenShapeEntry(
    ctx: OffscreenCanvasRenderingContext2D,
    entry: ShapeItemRingEntry,
    fallbackStyle: ShapeStyle,
  ): void {
    const style = entry.style ?? fallbackStyle;
    const stroke = normalizeMotionStroke(style.stroke);
    if (stroke.width <= 0 || stroke.opacity <= 0) {
      return;
    }
    for (const ring of entry.rings) {
      if (ring.length < 2) {
        continue;
      }
      const first = ring[0];
      if (first === undefined) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < ring.length; index += 1) {
        const point = ring[index];
        if (point === undefined) {
          continue;
        }
        ctx.lineTo(point.x, point.y);
      }
      ctx.save();
      ctx.globalAlpha *= entry.opacity * stroke.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = stroke.lineCap;
      ctx.lineJoin = stroke.lineJoin;
      ctx.setLineDash([...stroke.dashArray]);
      ctx.lineDashOffset = stroke.dashOffset;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBezierShapePath(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
  ): boolean {
    const pathData = getMotionShapePathDataAtTime(layer, localTime);
    const segments = parseMotionPathSegments(pathData);
    if (segments.length < 2) return false;
    const commands = getMotionPathDrawCommands(segments);
    if (!commands.some((command) => command.type === "cubic")) {
      return false;
    }
    for (const command of commands) {
      if (command.type === "move") {
        ctx.moveTo(command.x, command.y);
      } else if (command.type === "line") {
        ctx.lineTo(command.x, command.y);
      } else {
        ctx.bezierCurveTo(
          command.c1x,
          command.c1y,
          command.c2x,
          command.c2y,
          command.x,
          command.y,
        );
      }
    }
    return true;
  }

  private renderSingleShape(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    trimPaths: ReturnType<typeof getMotionTrimPathsModifier>,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    if (trimPaths?.enabled) {
      this.renderTrimmedShape(ctx, layer, trimPaths, localTime);
      return;
    }

    this.renderShapeShadows(ctx, layer, localTime, composition);

    this.buildShapePath(ctx, layer, localTime, 0);

    const fillStyle = this.createShapeFillStyle(ctx, layer, localTime, composition);
    if (fillStyle) {
      ctx.save();
      ctx.globalAlpha *= layer.style.fill.opacity;
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.restore();
    }

    this.renderInsetShapeShadows(ctx, layer, localTime);

    const stroke = normalizeMotionStroke(layer.style.stroke);
    if (stroke.width > 0 && stroke.opacity > 0) {
      this.buildShapePath(ctx, layer, localTime, 0);
      ctx.save();
      ctx.globalAlpha *= stroke.opacity;
      ctx.strokeStyle = this.createShapeStrokeStyle(ctx, layer) ?? stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = stroke.lineCap;
      ctx.lineJoin = stroke.lineJoin;
      ctx.setLineDash([...stroke.dashArray]);
      ctx.lineDashOffset = stroke.dashOffset;
      ctx.stroke();
      ctx.restore();
    }
  }

  private buildShapePath(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    spread: number,
  ): void {
    const width = Math.max(0, layer.width + spread * 2);
    const height = Math.max(0, layer.height + spread * 2);
    const x = -width / 2;
    const y = -height / 2;

    const usesZigZagPath =
      layer.modifiers?.some(
        (modifier) => modifier.type === "zig-zag" && modifier.enabled,
      ) ?? false;
    const roundCorners = getMotionRoundCornersModifier(layer);
    const usesRoundCornersPath = roundCorners
      ? roundCorners.enabled && roundCorners.radius > 0
      : false;
    const wigglePaths = getMotionWigglePathsModifier(layer);
    const usesWigglePaths =
      wigglePaths ? wigglePaths.enabled && wigglePaths.size > 0 : false;
    const usesDeformedPath =
      layer.puppetPins?.some(
        (pin) => pin.enabled && pin.radius > 0 && pin.strength > 0,
      ) ?? false;
    const usesProceduralPath =
      usesDeformedPath ||
      usesZigZagPath ||
      usesRoundCornersPath ||
      usesWigglePaths;
    const cornerRadii = layer.style.cornerRadii;

    ctx.beginPath();
    if (usesProceduralPath) {
      drawMotionPath(ctx, buildMotionShapePolyline(layer, 96, localTime));
      if (layer.pathClosed ?? true) {
        ctx.closePath();
      }
    } else if (layer.shapeType === "circle" || layer.shapeType === "ellipse") {
      ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else if (layer.shapeType === "rectangle" && cornerRadii) {
      drawMotionPerCornerRect(ctx, x, y, width, height, cornerRadii);
    } else if (layer.shapeType === "rectangle" && (layer.style.cornerRadius ?? 0) > 0) {
      ctx.roundRect(x, y, width, height, layer.style.cornerRadius ?? 0);
    } else if (layer.shapeType === "rectangle") {
      ctx.rect(x, y, width, height);
    } else if (
      layer.shapeType === "path" &&
      this.drawBezierShapePath(ctx, layer, localTime)
    ) {
      if (layer.pathClosed ?? true) {
        ctx.closePath();
      }
    } else {
      drawMotionPath(ctx, buildMotionShapePolyline(layer, 96, localTime));
      if (layer.pathClosed ?? true) {
        ctx.closePath();
      }
    }
  }

  private getShapeDropShadows(
    layer: Extract<MotionLayer, { type: "shape" }>,
  ): ShadowStyle[] {
    const shadows: ShadowStyle[] = [];
    for (const shadow of layer.style.shadows ?? []) {
      if (!shadow.inset) shadows.push(shadow);
    }
    if (layer.style.shadow && !layer.style.shadow.inset) {
      shadows.push(layer.style.shadow);
    }
    return shadows;
  }

  private renderShapeShadows(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    const shadows = this.getShapeDropShadows(layer);
    if (shadows.length === 0 || layer.style.fill.type === "none") {
      return;
    }
    const fillType = layer.style.fill.type;
    const fillStyle =
      fillType === "shader" || fillType === "gradient"
        ? layer.style.fill.color ?? "#000000"
        : this.createShapeFillStyle(ctx, layer, localTime, composition) ?? "#000000";
    for (const shadow of shadows) {
      ctx.save();
      ctx.shadowColor = expandMotionShadowColor(shadow);
      ctx.shadowBlur = Math.max(0, shadow.blur);
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
      ctx.fillStyle = fillStyle;
      this.buildShapePath(ctx, layer, localTime, shadow.spread ?? 0);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderInsetShapeShadows(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
  ): void {
    const insets = [
      ...(layer.style.shadows ?? []).filter((shadow) => shadow.inset),
      ...(layer.style.shadow?.inset ? [layer.style.shadow] : []),
    ];
    if (insets.length === 0) {
      return;
    }
    for (const shadow of insets) {
      ctx.save();
      this.buildShapePath(ctx, layer, localTime, 0);
      ctx.clip();
      ctx.shadowColor = expandMotionShadowColor(shadow);
      ctx.shadowBlur = Math.max(0, shadow.blur);
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0, 0, 0, 0)";
      ctx.strokeStyle = expandMotionShadowColor(shadow);
      const spread = Math.max(0, shadow.spread ?? 0);
      this.buildShapePath(ctx, layer, localTime, Math.max(2, shadow.blur) + spread);
      ctx.lineWidth = Math.max(2, shadow.blur) * 2 + spread * 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderTrimmedShape(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    trimPaths: NonNullable<ReturnType<typeof getMotionTrimPathsModifier>>,
    localTime: number,
  ): void {
    if (layer.style.stroke.width <= 0 || layer.style.stroke.opacity <= 0) {
      return;
    }

    const points = getTrimmedMotionPathPoints(
      buildMotionShapePolyline(layer, 96, localTime),
      trimPaths,
    );
    if (points.length < 2) return;

    const stroke = normalizeMotionStroke(layer.style.stroke);
    drawMotionPath(ctx, points);
    ctx.globalAlpha *= stroke.opacity;
    ctx.strokeStyle = this.createShapeStrokeStyle(ctx, layer) ?? stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = stroke.lineCap;
    ctx.lineJoin = stroke.lineJoin;
    ctx.setLineDash([...stroke.dashArray]);
    ctx.lineDashOffset = stroke.dashOffset;
    ctx.stroke();
  }

  private createShapeFillStyle(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
    composition?: MotionComposition,
  ): string | CanvasGradient | CanvasPattern | null {
    const fill = layer.style.fill;
    if (fill.type === "none") return null;
    if (fill.type === "solid") return fill.color ?? "#ffffff";
    if (fill.type === "shader") {
      if (!fill.shader) return fill.color ?? "#888888";
      const def = getMotionShaderDef(fill.shader.shaderId);
      const params = def
        ? resolveMotionShaderFillParams(
            layer,
            fill.shader.params,
            "shape.fill.shader",
            def,
            localTime,
            composition,
          )
        : fill.shader.params;
      const pattern = this.createMotionShaderFillPattern(
        ctx,
        { ...fill.shader, params },
        layer.width,
        layer.height,
        localTime,
        -layer.width / 2,
        -layer.height / 2,
      );
      return pattern ?? fill.color ?? "#888888";
    }
    if (!fill.gradient) return null;
    return this.buildMotionGradient(
      ctx,
      fill.gradient,
      layer.width,
      layer.height,
    );
  }

  private createMotionShaderFillPattern(
    ctx: OffscreenCanvasRenderingContext2D,
    shader: MotionShaderFill,
    width: number,
    height: number,
    localTime: number,
    originX = 0,
    originY = 0,
  ): CanvasPattern | null {
    const def = getMotionShaderDef(shader.shaderId);
    if (!def) return null;

    const renderWidth = Math.max(1, Math.floor(width));
    const renderHeight = Math.max(1, Math.floor(height));
    const cache = this.shaderFillFrameCache;
    const key =
      cache !== null
        ? `${shader.shaderId}|${renderWidth}x${renderHeight}|${localTime}|${serializeMotionShaderParams(shader.params)}`
        : null;

    if (cache !== null && key !== null) {
      const cached = cache.get(key);
      if (cached) {
        return positionMotionShaderPattern(
          ctx.createPattern(cached, "no-repeat"),
          originX,
          originY,
        );
      }
    }

    if (!this.shaderRenderer) {
      this.shaderRenderer = new MotionShaderRenderer();
    }
    const result = this.shaderRenderer.render(def, {
      width,
      height,
      time: localTime,
      params: shader.params,
    });
    if (!result) return null;

    if (cache !== null && key !== null) {
      const copy = new OffscreenCanvas(result.width, result.height);
      const copyCtx = copy.getContext("2d");
      if (copyCtx) {
        copyCtx.drawImage(result, 0, 0);
        cache.set(key, copy);
        return positionMotionShaderPattern(
          ctx.createPattern(copy, "no-repeat"),
          originX,
          originY,
        );
      }
    }

    return positionMotionShaderPattern(
      ctx.createPattern(result, "no-repeat"),
      originX,
      originY,
    );
  }

  private createShapeStrokeStyle(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "shape" }>,
  ): string | CanvasGradient | null {
    const gradient = layer.style.stroke.gradient;
    if (!gradient) return null;
    return this.buildMotionGradient(ctx, gradient, layer.width, layer.height);
  }

  private buildMotionGradient(
    ctx: OffscreenCanvasRenderingContext2D,
    style: GradientStyle,
    width: number,
    height: number,
  ): CanvasGradient {
    const gradient = this.createGradientCanvasObject(ctx, style, width, height);
    for (const stop of resolveMotionGradientStops(style.stops)) {
      gradient.addColorStop(stop.offset, stop.color);
    }
    return gradient;
  }

  private createGradientCanvasObject(
    ctx: OffscreenCanvasRenderingContext2D,
    style: GradientStyle,
    width: number,
    height: number,
  ): CanvasGradient {
    if (style.type === "conic" && typeof ctx.createConicGradient === "function") {
      const center = getMotionGradientCenter(width, height, style.center);
      return ctx.createConicGradient(
        getMotionConicAngleRadians(style.angle),
        center.x,
        center.y,
      );
    }
    if (style.type === "radial") {
      const spec = getMotionRadialGradientSpec(width, height);
      const center = getMotionGradientCenter(width, height, style.center);
      return ctx.createRadialGradient(
        center.x,
        center.y,
        spec.r0,
        center.x,
        center.y,
        spec.r1,
      );
    }
    const line = getMotionLinearGradientLine(width, height, style.angle ?? 0);
    return ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
  }

  private async renderNestedComposition(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "composition" }>,
    localTime: number,
    options: RenderLayerOptions,
  ): Promise<void> {
    const compositionLibrary = options.compositionLibrary ?? [];
    const masterSource = getMotionCompositionLayerSource(compositionLibrary, layer);
    if (!masterSource || options.compositionStack?.includes(masterSource.id)) {
      return;
    }
    const source = applyMotionInstanceOverrides(masterSource, layer.overrides);

    const buffer = this.createSizedTempCanvas(
      Math.max(1, Math.round(source.width * this.deviceScale)),
      Math.max(1, Math.round(source.height * this.deviceScale)),
    );
    buffer.ctx.setTransform(
      this.deviceScale,
      0,
      0,
      this.deviceScale,
      0,
      0,
    );
    await this.renderCompositionToContext(
      buffer.ctx,
      source,
      getMotionCompositionLayerPlaybackTime(layer, localTime, source.duration),
      {
        compositionLibrary,
        compositionStack: options.compositionStack ?? [],
        assetResolver: options.assetResolver,
        variableOverrides: options.variableOverrides,
      },
    );

    const { width, height, x, y } = fitNestedComposition(
      source.width,
      source.height,
      layer.width,
      layer.height,
      layer.fit ?? "contain",
    );
    ctx.drawImage(buffer.canvas, x, y, width, height);
  }

  private async renderImage(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: Extract<MotionLayer, { type: "image" }>,
    options: RenderLayerOptions,
    transform?: MotionTransform,
  ): Promise<void> {
    const asset = composition.assets.find(
      (candidate) => candidate.id === layer.assetId,
    );
    if (!asset || asset.type !== "image" || !options.assetResolver) return;

    const image = await options.assetResolver.resolveImageAsset(asset);
    if (!image) return;

    const sourceWidth = getRenderableImageWidth(image);
    const sourceHeight = getRenderableImageHeight(image);
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const boundsWidth = layer.width ?? asset.width ?? sourceWidth;
    const boundsHeight = layer.height ?? asset.height ?? sourceHeight;
    const { width, height, x, y } = fitNestedComposition(
      sourceWidth,
      sourceHeight,
      boundsWidth,
      boundsHeight,
      layer.fit ?? "contain",
    );
    if (transform && hasMotion3DRotation(transform)) {
      this.drawPerspectiveImage(
        ctx,
        image,
        sourceWidth,
        sourceHeight,
        x,
        y,
        width,
        height,
        transform,
      );
      return;
    }
    const radii = layer.cornerRadii;
    const radius = layer.cornerRadius ?? 0;
    if (radii || radius > 0) {
      ctx.save();
      ctx.beginPath();
      if (radii) {
        drawMotionPerCornerRect(
          ctx,
          -boundsWidth / 2,
          -boundsHeight / 2,
          boundsWidth,
          boundsHeight,
          radii,
        );
      } else {
        ctx.roundRect(
          -boundsWidth / 2,
          -boundsHeight / 2,
          boundsWidth,
          boundsHeight,
          radius,
        );
      }
      ctx.clip();
      ctx.drawImage(image, x, y, width, height);
      ctx.restore();
      return;
    }
    ctx.drawImage(image, x, y, width, height);
  }

  private drawPerspectiveImage(
    ctx: OffscreenCanvasRenderingContext2D,
    image: MotionRenderableImage,
    sourceWidth: number,
    sourceHeight: number,
    destX: number,
    destY: number,
    destWidth: number,
    destHeight: number,
    transform: MotionTransform,
    subdivisions = 10,
  ): void {
    const steps = Math.max(2, subdivisions);
    for (let row = 0; row < steps; row += 1) {
      for (let column = 0; column < steps; column += 1) {
        const localX0 = destX + (column / steps) * destWidth;
        const localX1 = destX + ((column + 1) / steps) * destWidth;
        const localY0 = destY + (row / steps) * destHeight;
        const localY1 = destY + ((row + 1) / steps) * destHeight;
        const p00 = projectMotion3DPlanePoint(localX0, localY0, transform);
        const p10 = projectMotion3DPlanePoint(localX1, localY0, transform);
        const p11 = projectMotion3DPlanePoint(localX1, localY1, transform);
        const p01 = projectMotion3DPlanePoint(localX0, localY1, transform);
        const sourceX0 = (column / steps) * sourceWidth;
        const sourceX1 = ((column + 1) / steps) * sourceWidth;
        const sourceY0 = (row / steps) * sourceHeight;
        const sourceY1 = ((row + 1) / steps) * sourceHeight;
        this.drawTexturedTriangle(
          ctx,
          image,
          { x: sourceX0, y: sourceY0 },
          { x: sourceX1, y: sourceY0 },
          { x: sourceX1, y: sourceY1 },
          p00,
          p10,
          p11,
        );
        this.drawTexturedTriangle(
          ctx,
          image,
          { x: sourceX0, y: sourceY0 },
          { x: sourceX1, y: sourceY1 },
          { x: sourceX0, y: sourceY1 },
          p00,
          p11,
          p01,
        );
      }
    }
  }

  private drawTexturedTriangle(
    ctx: OffscreenCanvasRenderingContext2D,
    image: MotionRenderableImage,
    s0: { x: number; y: number },
    s1: { x: number; y: number },
    s2: { x: number; y: number },
    d0: { x: number; y: number },
    d1: { x: number; y: number },
    d2: { x: number; y: number },
  ): void {
    const delta =
      (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(delta) < 1e-6) return;
    const a =
      ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / delta;
    const c =
      ((s1.x - s0.x) * (d2.x - d0.x) - (s2.x - s0.x) * (d1.x - d0.x)) / delta;
    const e = d0.x - a * s0.x - c * s0.y;
    const b =
      ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / delta;
    const d =
      ((s1.x - s0.x) * (d2.y - d0.y) - (s2.x - s0.x) * (d1.y - d0.y)) / delta;
    const f = d0.y - b * s0.x - d * s0.y;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }

  private async renderVideo(
    ctx: OffscreenCanvasRenderingContext2D,
    composition: MotionComposition,
    layer: Extract<MotionLayer, { type: "video" }>,
    localTime: number,
    options: RenderLayerOptions,
    transform?: MotionTransform,
  ): Promise<void> {
    const asset = composition.assets.find(
      (candidate) => candidate.id === layer.assetId,
    );
    if (!asset || asset.type !== "video" || !options.assetResolver?.resolveVideoFrame) {
      return;
    }

    const clampedSourceTime = getMotionVideoLayerSourceTime(
      layer,
      localTime,
      asset.duration,
    );

    const frame = await options.assetResolver.resolveVideoFrame(
      asset,
      clampedSourceTime,
    );
    if (!frame) return;

    const sourceWidth = getRenderableImageWidth(frame);
    const sourceHeight = getRenderableImageHeight(frame);
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const boundsWidth = layer.width ?? asset.width ?? sourceWidth;
    const boundsHeight = layer.height ?? asset.height ?? sourceHeight;
    const { width, height, x, y } = fitNestedComposition(
      sourceWidth,
      sourceHeight,
      boundsWidth,
      boundsHeight,
      layer.fit ?? "contain",
    );
    if (transform && hasMotion3DRotation(transform)) {
      this.drawPerspectiveImage(
        ctx,
        frame,
        sourceWidth,
        sourceHeight,
        x,
        y,
        width,
        height,
        transform,
      );
      return;
    }
    ctx.drawImage(frame, x, y, width, height);
  }

  private renderText(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    this.configureTextContext(ctx, layer);
    if (hasEnabledMotionTextAnimators(layer)) {
      this.renderAnimatedText(ctx, layer, localTime, composition);
      return;
    }
    this.renderPlainText(ctx, layer, localTime, composition);
  }

  private configureTextContext(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
  ): void {
    const fontWeight = layer.style.fontWeight ?? 700;
    ctx.fillStyle = layer.style.color;
    ctx.textBaseline = "middle";
    ctx.font = `${fontWeight} ${layer.style.fontSize}px ${layer.style.fontFamily}, Inter, sans-serif`;
  }

  private renderPlainText(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    const maxWidth = layer.style.maxWidth ?? 0;
    const lines = wrapMotionTextLines(layer.text, maxWidth, (text) =>
      ctx.measureText(text).width,
    );
    const lineHeight = getMotionTextLineHeight(layer);
    const align = layer.style.align ?? "center";
    ctx.textAlign = align;

    const blockHeight = lines.length * lineHeight;
    const blockTop = getMotionTextBlockTop(
      blockHeight,
      layer.style.verticalAlign ?? "middle",
    );
    const firstLineCenter = blockTop + lineHeight / 2;
    const blockWidth = lines.reduce(
      (widest, line) => Math.max(widest, ctx.measureText(line).width),
      0,
    );

    this.renderTextBackground(ctx, layer, blockWidth, blockHeight, blockTop, align);

    const blockCenterY = blockTop + blockHeight / 2;
    const fillStyle = this.resolveTextFillStyle(
      ctx,
      layer,
      blockWidth,
      blockHeight,
      blockCenterY,
      localTime,
      composition,
    );

    lines.forEach((line, index) => {
      const y = firstLineCenter + index * lineHeight;
      this.drawTextLine(ctx, layer, line, y, fillStyle);
    });
  }

  private resolveTextFillStyle(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    blockWidth: number,
    blockHeight: number,
    blockCenterY: number,
    localTime: number,
    composition?: MotionComposition,
  ): string | CanvasGradient | CanvasPattern {
    const fillShader = layer.style.fillShader;
    if (fillShader && blockWidth > 0) {
      const def = getMotionShaderDef(fillShader.shaderId);
      const params = def
        ? resolveMotionShaderFillParams(
            layer,
            fillShader.params,
            "text.fillShader",
            def,
            localTime,
            composition,
          )
        : fillShader.params;
      const pattern = this.createMotionShaderFillPattern(
        ctx,
        { ...fillShader, params },
        Math.max(1, blockWidth),
        Math.max(1, blockHeight),
        localTime,
        getMotionTextBlockLeft(blockWidth, layer.style.align ?? "center"),
        blockCenterY - blockHeight / 2,
      );
      if (pattern) return pattern;
    }
    const style = layer.style.fillGradient;
    if (!style || blockWidth <= 0) {
      return layer.style.color;
    }
    const width = Math.max(1, blockWidth);
    const height = Math.max(1, blockHeight);
    let gradient: CanvasGradient;
    if (style.type === "conic" && typeof ctx.createConicGradient === "function") {
      const center = getMotionGradientCenter(width, height, style.center);
      gradient = ctx.createConicGradient(
        getMotionConicAngleRadians(style.angle),
        center.x,
        center.y + blockCenterY,
      );
    } else if (style.type === "radial") {
      const spec = getMotionRadialGradientSpec(width, height);
      const center = getMotionGradientCenter(width, height, style.center);
      gradient = ctx.createRadialGradient(
        center.x,
        center.y + blockCenterY,
        spec.r0,
        center.x,
        center.y + blockCenterY,
        spec.r1,
      );
    } else {
      const line = getMotionLinearGradientLine(width, height, style.angle ?? 0);
      gradient = ctx.createLinearGradient(
        line.x0,
        line.y0 + blockCenterY,
        line.x1,
        line.y1 + blockCenterY,
      );
    }
    for (const stop of resolveMotionGradientStops(style.stops)) {
      gradient.addColorStop(stop.offset, stop.color);
    }
    return gradient;
  }

  private drawTextLine(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    line: string,
    y: number,
    fillStyle: string | CanvasGradient | CanvasPattern,
  ): void {
    const shadow = layer.style.shadow;
    ctx.save();
    if (shadow) {
      ctx.shadowColor = expandMotionShadowColor(shadow);
      ctx.shadowBlur = Math.max(0, shadow.blur);
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
    }
    ctx.fillStyle = fillStyle;
    this.paintTextGlyph(ctx, layer, line, 0, y, fillStyle);
    ctx.restore();
  }

  private paintTextGlyph(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    text: string,
    x: number,
    y: number,
    fillStyle: string | CanvasGradient | CanvasPattern,
  ): void {
    const stroke = this.resolveTextStroke(layer);
    if (stroke && stroke.over === true) {
      ctx.fillStyle = fillStyle;
      ctx.fillText(text, x, y);
      this.strokeTextGlyph(ctx, stroke, text, x, y);
      return;
    }
    if (stroke) {
      this.strokeTextGlyph(ctx, stroke, text, x, y);
    }
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);
  }

  private resolveTextStroke(
    layer: Extract<MotionLayer, { type: "text" }>,
  ): { color: string; width: number; over?: boolean } | null {
    const stroke = layer.style.stroke;
    if (!stroke) return null;
    if (typeof stroke.color !== "string" || stroke.color.length === 0) return null;
    if (!Number.isFinite(stroke.width) || stroke.width <= 0) return null;
    return stroke;
  }

  private strokeTextGlyph(
    ctx: OffscreenCanvasRenderingContext2D,
    stroke: { color: string; width: number; over?: boolean },
    text: string,
    x: number,
    y: number,
  ): void {
    ctx.lineWidth = stroke.width * 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color;
    ctx.strokeText(text, x, y);
  }

  private renderTextBackground(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    blockWidth: number,
    blockHeight: number,
    blockTop: number,
    align: CanvasTextAlign,
  ): void {
    const backgroundColor = layer.style.backgroundColor;
    if (!backgroundColor || blockWidth <= 0) {
      return;
    }
    const padding = Math.max(0, layer.style.backgroundPadding ?? 0);
    const radius = Math.max(0, layer.style.backgroundRadius ?? 0);
    const rectWidth = blockWidth + padding * 2;
    const rectHeight = blockHeight + padding * 2;
    const rectLeft = getMotionTextBlockLeft(blockWidth, align) - padding;
    const rectTop = blockTop - padding;

    ctx.save();
    ctx.fillStyle = backgroundColor;
    ctx.beginPath();
    if (radius > 0) {
      ctx.roundRect(rectLeft, rectTop, rectWidth, rectHeight, radius);
    } else {
      ctx.rect(rectLeft, rectTop, rectWidth, rectHeight);
    }
    ctx.fill();
    ctx.restore();
  }

  private renderAnimatedText(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    localTime: number,
    composition?: MotionComposition,
  ): void {
    const runs = getMotionTextAnimatorRuns(layer, localTime);
    const lines = splitTextRunsIntoLines(runs);
    const lineHeight = getMotionTextLineHeight(layer);
    const blockHeight = lines.length * lineHeight;
    const blockTop = getMotionTextBlockTop(
      blockHeight,
      layer.style.verticalAlign ?? "middle",
    );
    const startY = blockTop + lineHeight / 2;
    const letterSpacing = layer.style.letterSpacing ?? 0;
    ctx.textAlign = "center";

    const lineWidths = lines.map((line) =>
      measureTextRunLine(ctx, line, letterSpacing),
    );
    const blockWidth = lineWidths.reduce(
      (widest, width) => Math.max(widest, width),
      0,
    );
    this.renderTextBackground(
      ctx,
      layer,
      blockWidth,
      blockHeight,
      blockTop,
      layer.style.align ?? "center",
    );
    const fillStyle = this.resolveTextFillStyle(
      ctx,
      layer,
      blockWidth,
      blockHeight,
      blockTop + blockHeight / 2,
      localTime,
      composition,
    );

    const shaderPass = resolveTextShaderPass(layer, localTime);
    const shaderProgressByRun = shaderPass
      ? this.buildShaderProgressByRun(shaderPass, runs, localTime)
      : null;
    let shaderGlyphIndex = 0;

    lines.forEach((line, lineIndex) => {
      const width = lineWidths[lineIndex] ?? 0;
      let cursorX = getTextLineStartX(width, layer.style.align ?? "center");
      const y = startY + lineIndex * lineHeight;

      for (const run of line) {
        const characterWidth = ctx.measureText(run.character).width;
        const characterCenterX = cursorX + characterWidth / 2;
        cursorX += characterWidth + letterSpacing;

        if (run.character === " ") {
          continue;
        }

        const glyphIndex = shaderGlyphIndex;
        shaderGlyphIndex += 1;

        ctx.save();
        ctx.translate(
          characterCenterX + run.position.x,
          y + run.position.y,
        );
        ctx.rotate((run.rotation * Math.PI) / 180);
        ctx.scale(run.scale.x, run.scale.y);
        ctx.globalAlpha *= run.opacity;

        const useShader = shaderPass !== null && glyphIndex < MAX_SHADER_GLYPHS;
        if (
          shaderPass !== null &&
          glyphIndex >= MAX_SHADER_GLYPHS &&
          !this.warnedShaderGlyphCaps.has(layer.id)
        ) {
          this.warnedShaderGlyphCaps.add(layer.id);
          console.warn(
            `[motion-renderer] shader text animator capped at ${MAX_SHADER_GLYPHS} glyphs; remaining glyphs render plain`,
          );
        }

        const drew =
          useShader && shaderPass !== null
            ? this.drawShaderGlyph(
                ctx,
                layer,
                shaderPass,
                run,
                characterWidth,
                shaderProgressByRun?.get(run) ?? 0,
                localTime,
              )
            : false;

        if (!drew) {
          this.paintTextGlyph(ctx, layer, run.character, 0, 0, fillStyle);
        }
        ctx.restore();
      }
    });
  }

  private buildShaderProgressByRun(
    pass: MotionTextShaderPass,
    runs: readonly MotionTextGlyphRun[],
    localTime: number,
  ): Map<MotionTextGlyphRun, number> {
    const progress = getMotionTextAnimatorRunProgress(
      pass.animator,
      runs,
      localTime,
    );
    const byRun = new Map<MotionTextGlyphRun, number>();
    runs.forEach((run, index) => {
      byRun.set(run, progress[index] ?? 0);
    });
    return byRun;
  }

  private drawShaderGlyph(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    pass: MotionTextShaderPass,
    run: MotionTextGlyphRun,
    characterWidth: number,
    progress: number,
    localTime: number,
  ): boolean {
    const shader = pass.animator.shader;
    if (!shader) return false;

    const fontSize = layer.style.fontSize;
    if (!Number.isFinite(characterWidth) || characterWidth <= 0) return false;
    if (!Number.isFinite(fontSize) || fontSize <= 0) return false;

    const metrics = measureGlyphVerticalMetrics(ctx, run.character, fontSize);
    const glyphWidth = Math.ceil(characterWidth) + SHADER_GLYPH_PADDING * 2;
    const glyphHeight = Math.ceil(metrics.contentHeight) + SHADER_GLYPH_PADDING * 2;
    if (glyphWidth <= 0 || glyphHeight <= 0) return false;

    const glyphCanvas = this.renderGlyphToOffscreen(
      ctx,
      layer,
      run.character,
      glyphWidth,
      glyphHeight,
      SHADER_GLYPH_PADDING + metrics.ascent,
    );
    if (!glyphCanvas) return false;

    if (!this.shaderRenderer) {
      this.shaderRenderer = new MotionShaderRenderer();
    }
    const result = this.shaderRenderer.render(pass.def, {
      width: glyphWidth,
      height: glyphHeight,
      time: localTime,
      progress,
      params: shader.params,
      inputCanvas: glyphCanvas,
    });
    if (!result) return false;

    ctx.drawImage(result, -glyphWidth / 2, -glyphHeight / 2, glyphWidth, glyphHeight);
    return true;
  }

  private renderGlyphToOffscreen(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: Extract<MotionLayer, { type: "text" }>,
    character: string,
    width: number,
    height: number,
    baselineY: number,
  ): OffscreenCanvas | null {
    const glyphCanvas = new OffscreenCanvas(width, height);
    const glyphCtx = glyphCanvas.getContext("2d");
    if (!glyphCtx) return null;
    glyphCtx.textAlign = "center";
    glyphCtx.textBaseline = "alphabetic";
    glyphCtx.font = ctx.font;
    glyphCtx.fillStyle = layer.style.color;
    const safeBaseline = Number.isFinite(baselineY) ? baselineY : height / 2;
    this.paintTextGlyph(glyphCtx, layer, character, width / 2, safeBaseline, layer.style.color);
    return glyphCanvas;
  }

  dispose(): void {
    if (this.shaderRenderer) {
      this.shaderRenderer.dispose();
      this.shaderRenderer = null;
    }
    this.shaderFillFrameCache = null;
    this.warnedShaderGlyphCaps.clear();
  }
}

export function resolveMotionShaderFillParams(
  layer: MotionLayer,
  base: Record<string, number | string>,
  prefix: "shape.fill.shader" | "text.fillShader",
  def: MotionShaderDef,
  localTime: number,
  composition?: MotionComposition,
): Record<string, number | string> {
  const hasFillShaderKeyframes = layer.keyframes.some((keyframe) => {
    const parsed = parseMotionShaderFillKeyframeProperty(keyframe.property);
    if (!parsed) return false;
    const keyframePrefix =
      parsed.surface === "shape" ? "shape.fill.shader" : "text.fillShader";
    return keyframePrefix === prefix;
  });
  if (!hasFillShaderKeyframes) return base;

  const context = composition ? { composition, layer } : undefined;
  const resolved: Record<string, number | string> = {};
  for (const param of def.params) {
    const property = `${prefix}.${param.name}`;
    if (param.type === "color") {
      resolved[param.name] = resolveShaderColorParamValue(base[param.name], param.default);
      continue;
    }
    const fallback = resolveNumericParamFallback(base[param.name], param.default);
    resolved[param.name] =
      getMotionLayerPropertyKeyframes(layer, property).length > 0
        ? evaluateMotionPropertyValueAtTime({
            keyframes: layer.keyframes,
            expressions: layer.expressions,
            property,
            localTime,
            fallback,
            duration: layer.duration,
            context,
          })
        : fallback;
  }
  return resolved;
}

function resolveShaderColorParamValue(
  base: number | string | undefined,
  fallback: number | string,
): number | string {
  if (base !== undefined) return base;
  return fallback;
}

function resolveNumericParamFallback(
  base: number | string | undefined,
  fallback: number | string,
): number {
  if (typeof base === "number" && Number.isFinite(base)) return base;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return 0;
}

function serializeMotionShaderParams(
  params: Record<string, number | string>,
): string {
  const keys = Object.keys(params).sort();
  let serialized = "";
  for (const key of keys) {
    serialized += `${key}=${params[key]};`;
  }
  return serialized;
}

function splitTextRunsIntoLines(
  runs: readonly MotionTextGlyphRun[],
): MotionTextGlyphRun[][] {
  const lines: MotionTextGlyphRun[][] = [[]];
  for (const run of runs) {
    if (run.character === "\n") {
      lines.push([]);
    } else {
      lines[lines.length - 1].push(run);
    }
  }
  return lines;
}

function measureTextRunLine(
  ctx: OffscreenCanvasRenderingContext2D,
  runs: readonly MotionTextGlyphRun[],
  letterSpacing: number,
): number {
  if (runs.length === 0) return 0;
  return runs.reduce(
    (width, run, index) =>
      width +
      ctx.measureText(run.character).width +
      (index < runs.length - 1 ? letterSpacing : 0),
    0,
  );
}

function getTextLineStartX(width: number, align: CanvasTextAlign): number {
  if (align === "left" || align === "start") return 0;
  if (align === "right" || align === "end") return -width;
  return -width / 2;
}

function getMotionTextBlockTop(
  blockHeight: number,
  verticalAlign: "top" | "middle" | "bottom",
): number {
  if (verticalAlign === "top") return 0;
  if (verticalAlign === "bottom") return -blockHeight;
  return -blockHeight / 2;
}

function getMotionTextBlockLeft(width: number, align: CanvasTextAlign): number {
  if (align === "left" || align === "start") return 0;
  if (align === "right" || align === "end") return -width;
  return -width / 2;
}

function drawMotionPerCornerRect(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radii: CornerRadii,
): void {
  const { topLeft, topRight, bottomRight, bottomLeft } = clampMotionCornerRadii(
    radii,
    width,
    height,
  );
  const right = x + width;
  const bottom = y + height;
  ctx.moveTo(x + topLeft, y);
  ctx.lineTo(right - topRight, y);
  if (topRight > 0) {
    ctx.arcTo(right, y, right, y + topRight, topRight);
  }
  ctx.lineTo(right, bottom - bottomRight);
  if (bottomRight > 0) {
    ctx.arcTo(right, bottom, right - bottomRight, bottom, bottomRight);
  }
  ctx.lineTo(x + bottomLeft, bottom);
  if (bottomLeft > 0) {
    ctx.arcTo(x, bottom, x, bottom - bottomLeft, bottomLeft);
  }
  ctx.lineTo(x, y + topLeft);
  if (topLeft > 0) {
    ctx.arcTo(x, y, x + topLeft, y, topLeft);
  }
  ctx.closePath();
}

function getRenderableImageWidth(image: MotionRenderableImage): number {
  if ("naturalWidth" in image) return image.naturalWidth;
  return image.width;
}

function getRenderableImageHeight(image: MotionRenderableImage): number {
  if ("naturalHeight" in image) return image.naturalHeight;
  return image.height;
}

function isVisualMotionLayer(layer: MotionLayer): layer is VisualMotionLayer {
  return (
    layer.type === "composition" ||
    layer.type === "image" ||
    layer.type === "video" ||
    layer.type === "particle" ||
    layer.type === "shape" ||
    layer.type === "text" ||
    layer.type === "scene3d"
  );
}

function fitNestedComposition(
  sourceWidth: number,
  sourceHeight: number,
  layerWidth: number,
  layerHeight: number,
  fit: "contain" | "cover" | "fill",
): { width: number; height: number; x: number; y: number } {
  if (fit === "fill") {
    return {
      width: layerWidth,
      height: layerHeight,
      x: -layerWidth / 2,
      y: -layerHeight / 2,
    };
  }

  const scale =
    fit === "cover"
      ? Math.max(layerWidth / sourceWidth, layerHeight / sourceHeight)
      : Math.min(layerWidth / sourceWidth, layerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    width,
    height,
    x: -width / 2,
    y: -height / 2,
  };
}

function getMotionTextLineHeight(
  layer: Extract<MotionLayer, { type: "text" }>,
): number {
  return layer.style.fontSize * (layer.style.lineHeight ?? 1.1);
}

function combineCanvasFilters(...filters: readonly string[]): string {
  const parts = filters.filter((filter) => filter && filter !== "none");
  return parts.length > 0 ? parts.join(" ") : "none";
}

export function getMotionTransformAtTime(
  base: MotionTransform,
  keyframes: MotionLayer["keyframes"],
  localTime: number,
  expressions: MotionLayer["expressions"] = [],
  duration = Number.POSITIVE_INFINITY,
  autoOrient = false,
  context?: MotionExpressionContext,
): MotionTransform {
  const valueAt = (property: string, fallback: number, atTime: number): number =>
    evaluateMotionPropertyValueAtTime({
      keyframes,
      expressions,
      property,
      localTime: atTime,
      fallback,
      duration,
      context,
    });
  const value = (property: string, fallback: number): number =>
    valueAt(property, fallback, localTime);

  let rotation = value("transform.rotation", base.rotation);
  if (autoOrient) {
    const step = 1 / 60;
    const aheadX = valueAt("transform.position.x", base.position.x, localTime + step);
    const aheadY = valueAt("transform.position.y", base.position.y, localTime + step);
    const behindX = valueAt(
      "transform.position.x",
      base.position.x,
      Math.max(0, localTime - step),
    );
    const behindY = valueAt(
      "transform.position.y",
      base.position.y,
      Math.max(0, localTime - step),
    );
    const dx = aheadX - behindX;
    const dy = aheadY - behindY;
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
      rotation += (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }

  return {
    position: {
      x: value("transform.position.x", base.position.x),
      y: value("transform.position.y", base.position.y),
      z: value("transform.position.z", base.position.z ?? 0),
    },
    scale: {
      x: value("transform.scale.x", base.scale.x),
      y: value("transform.scale.y", base.scale.y),
    },
    rotation,
    rotation3d: {
      x: value("transform.rotation.x", base.rotation3d?.x ?? 0),
      y: value("transform.rotation.y", base.rotation3d?.y ?? 0),
    },
    anchor: {
      x: value("transform.anchor.x", base.anchor.x),
      y: value("transform.anchor.y", base.anchor.y),
    },
    opacity: value("transform.opacity", base.opacity),
    perspective: value("transform.perspective", base.perspective ?? 1000),
    transformStyle: base.transformStyle,
  };
}

function isMotionLayerActive(
  layer: MotionLayer,
  compositionTime: number,
  forceVisible = false,
): boolean {
  return (
    (forceVisible || layer.visible) &&
    compositionTime >= layer.startTime &&
    compositionTime < layer.startTime + layer.duration
  );
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function applyLumaToAlpha(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  inverted: boolean,
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const luma =
      (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) *
      alpha;
    const matteAlpha = inverted ? 255 - luma : luma;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = Math.max(0, Math.min(255, Math.round(matteAlpha)));
  }
  ctx.putImageData(imageData, 0, 0);
}

export const motionRenderer = new MotionRenderer();
