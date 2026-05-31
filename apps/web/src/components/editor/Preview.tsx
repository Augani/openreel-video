import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Monitor,
  Maximize2,
  Minimize2,
  Move,
  Loader2,
  ZoomIn,
  Proportions,
  Magnet,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { getRenderBridge } from "../../bridges/render-bridge";
import { getEffectsBridge } from "../../bridges/effects-bridge";
import {
  RendererFactory,
  type Renderer,
  isWebGPUSupported,
  getSpeedEngine,
  getMasterClock,
  getRealtimeAudioGraph,
  initializeAudioEffectsEngine,
  getPreviewAudioEffects,
  splitProfileAwareNoiseReductionEffects,
  resolveClipAudioEffects as resolveTimelineClipAudioEffects,
  resolveClipVolumeAutomation,
  getParticleEngine,
  MotionRenderer,
  evaluateKeyframesAt,
  type Effect,
  type AudioEffectParams,
  type AudioClipSchedule,
  type TextClip,
  type ShapeClip,
  type SVGClip,
  type StickerClip,
  type Subtitle,
  type Track,
  type MotionAsset,
  type Mask,
  type AdjustmentLayer,
  type BlendMode,
  getTrackTransitionAudioFades,
} from "@openreel/core";
import { useEngineStore } from "../../stores/engine-store";
import {
  type HandlePosition,
  type InteractionMode,
  type ClipTransform,
  DEFAULT_TRANSFORM,
  formatTime,
  renderTextClipToCanvas,
  getActiveTextClips,
  getActiveShapeClips,
  renderShapeClipToCanvas,
  getActiveSubtitles,
  renderSubtitleToCanvas,
  drawFrameWithTransform,
  drawFrameWithMasks,
  applyEffectsToFrame,
  applyEffectsToFrameCanvas,
  getTransitionAtTime,
  setImageLoadCallback,
  renderTransitionFrame,
  renderTransitionCanvas,
  getAnimatedTransform,
  applyEmphasisAnimation,
  CropModeView,
  MotionPathOverlay,
  ParticleRenderer,
  computePreviewResolution,
  PREVIEW_MAX_DIMENSION,
  previewQualityScale,
  PREVIEW_QUALITY_OPTIONS,
} from "./preview/index";
import { snapCanvasPosition } from "./preview/canvas-snapping";
import { ProcessingOverlay } from "./ProcessingOverlay";
import {
  getPersonSegmentationEngine,
  getBackgroundRemovalEngine,
  createMotionAwareOcclusionMask,
  getStabilizedTransform,
  getVidstabEngine,
} from "@openreel/core";
import type {
  GSAPMotionPathPoint,
  MotionPathConfig,
  SegmentationResult,
} from "@openreel/core";

interface GPULayer {
  bitmap: ImageBitmap;
  transform: ClipTransform;
}

interface PreparedPreviewFrame {
  frame: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  cleanup: () => void;
}

type PreviewClip = Track["clips"][number];
type PreviewFrameSource = Parameters<typeof drawFrameWithTransform>[1];
type PreviewCompositeOperation =
  CanvasRenderingContext2D["globalCompositeOperation"];

const adjustmentBlendOperation = (mode: BlendMode): PreviewCompositeOperation =>
  mode === "add" || mode === "linear-dodge"
    ? "lighter"
    : (mode as PreviewCompositeOperation);

const applyPreviewAdjustmentLayers = async (
  canvas: OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layers: readonly AdjustmentLayer[],
  time: number,
): Promise<boolean> => {
  let applied = false;
  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) return false;
  for (const layer of layers) {
    if (
      !layer.enabled ||
      layer.opacity <= 0 ||
      time < layer.startTime ||
      time >= layer.startTime + layer.duration
    ) continue;
    const effects = layer.effects.filter((effect) => effect.enabled !== false);
    if (effects.length === 0) continue;
    let source: ImageBitmap | null = null;
    let processed: ImageBitmap | null = null;
    try {
      source = await createImageBitmap(canvas);
      processed = await effectsBridge.processEffectList(source, effects);
      if (processed.width <= 0 || processed.height <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      ctx.globalCompositeOperation = adjustmentBlendOperation(layer.blendMode);
      ctx.drawImage(processed, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      applied = true;
    } catch (error) {
      console.warn(`[Preview] Adjustment layer ${layer.id} failed:`, error);
    } finally {
      if (processed && processed !== source) processed.close();
      source?.close();
    }
  }
  return applied;
};

const clipNeedsFrameProcessing = (
  clipId: string,
  keyframes: PreviewClip["keyframes"] = [],
): boolean => {
  const bgEngine = getBackgroundRemovalEngine();
  if (bgEngine?.isInitialized() && bgEngine.getSettings(clipId).enabled) {
    return true;
  }

  if (keyframes.some((kf) => kf.property.startsWith("colorGrade."))) {
    return true;
  }

  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) {
    return false;
  }

  if (effectsBridge.getEffects(clipId).some((effect) => effect.enabled)) {
    return true;
  }

  return Object.keys(effectsBridge.getColorGrading(clipId)).length > 0;
};

const clipCssFilterOnly = (clipId: string): string | null => {
  const bgEngine = getBackgroundRemovalEngine();
  if (bgEngine?.isInitialized() && bgEngine.getSettings(clipId).enabled) {
    return null;
  }
  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) {
    return null;
  }
  return effectsBridge.getNativeCssFilter(clipId);
};

const preparePreviewFrame = async (
  clipId: string,
  frameCanvas: HTMLCanvasElement | OffscreenCanvas,
  preferBitmap: boolean,
  allowCanvasByRef = false,
  keyframes: PreviewClip["keyframes"] = [],
): Promise<PreparedPreviewFrame> => {
  const needsProcessing = clipNeedsFrameProcessing(clipId, keyframes);
  if (!preferBitmap && !needsProcessing) {
    return {
      frame: frameCanvas,
      cleanup: () => {},
    };
  }

  let frameBitmap: ImageBitmap | null = null;
  let processedFrame: ImageBitmap | null = null;

  try {
    frameBitmap = await createImageBitmap(frameCanvas);

    if (!needsProcessing) {
      return {
        frame: frameBitmap,
        cleanup: () => {
          frameBitmap?.close();
        },
      };
    }

    if (allowCanvasByRef) {
      const effectsCanvas = await applyEffectsToFrameCanvas(
        clipId,
        frameBitmap,
      );
      if (effectsCanvas) {
        const sourceBitmap = frameBitmap;
        return {
          frame: effectsCanvas,
          cleanup: () => {
            sourceBitmap.close();
          },
        };
      }
    }

    processedFrame = await applyEffectsToFrame(clipId, frameBitmap);
    if (processedFrame === frameBitmap) {
      return {
        frame: frameBitmap,
        cleanup: () => {
          frameBitmap?.close();
        },
      };
    }

    return {
      frame: processedFrame,
      cleanup: () => {
        processedFrame?.close();
        frameBitmap?.close();
      },
    };
  } catch {
    processedFrame?.close();
    frameBitmap?.close();

    return {
      frame: frameCanvas,
      cleanup: () => {},
    };
  }
};

const scaleTransformPositionForPreview = (
  transform: ClipTransform,
  scale: number,
): ClipTransform => {
  if (scale === 1) {
    return transform;
  }
  return {
    ...transform,
    position: {
      x: transform.position.x * scale,
      y: transform.position.y * scale,
    },
  };
};

const applyStabilizationTransform = (
  clip: Track["clips"][number],
  transform: ClipTransform,
  sourceTime: number,
  canvasWidth: number,
  canvasHeight: number,
  frameWidth: number,
  frameHeight: number,
): ClipTransform => {
  return getStabilizedTransform(
    clip,
    transform,
    sourceTime,
    {
      canvasWidth,
      canvasHeight,
      sourceWidth: frameWidth,
      sourceHeight: frameHeight,
    },
  ) as ClipTransform;
};

// The WebGPU renderer maps a layer's texture onto a full-canvas quad, so a
// scale of {1,1} stretches the source to the canvas. Bake the aspect-fit
// ratio into the layer scale so GPU compositing letterboxes ("contain") like
// the Canvas2D path instead of distorting mismatched-aspect clips.
const computeFitScale = (
  fitMode: ClipTransform["fitMode"],
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } => {
  const mode = !fitMode || fitMode === "none" ? "contain" : fitMode;
  if (
    mode === "stretch" ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return { x: 1, y: 1 };
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  let drawWidth: number;
  let drawHeight: number;
  if (mode === "cover") {
    if (sourceAspect > canvasAspect) {
      drawHeight = canvasHeight;
      drawWidth = canvasHeight * sourceAspect;
    } else {
      drawWidth = canvasWidth;
      drawHeight = canvasWidth / sourceAspect;
    }
  } else {
    if (sourceAspect > canvasAspect) {
      drawWidth = canvasWidth;
      drawHeight = canvasWidth / sourceAspect;
    } else {
      drawHeight = canvasHeight;
      drawWidth = canvasHeight * sourceAspect;
    }
  }
  return { x: drawWidth / canvasWidth, y: drawHeight / canvasHeight };
};

const ASPECT_PRESETS: Array<{
  label: string;
  width: number;
  height: number;
}> = [
  { label: "16:9", width: 1920, height: 1080 },
  { label: "9:16", width: 1080, height: 1920 },
  { label: "1:1", width: 1080, height: 1080 },
  { label: "4:5", width: 1080, height: 1350 },
  { label: "4:3", width: 1440, height: 1080 },
  { label: "21:9", width: 2560, height: 1080 },
];

const aspectLabelFor = (width: number, height: number): string => {
  const ratio = width / height;
  let closest = ASPECT_PRESETS[0];
  let smallestDelta = Infinity;
  for (const preset of ASPECT_PRESETS) {
    const delta = Math.abs(preset.width / preset.height - ratio);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closest = preset;
    }
  }
  return smallestDelta < 0.01 ? closest.label : "Custom";
};

// Draws `source` cover-fit and Gaussian-blurred across the whole canvas — the
// blurred letterbox backdrop. Called inline with the live decoded base frame
// (ImageBitmap or video element) so it always has real pixels, then the
// contained clip is drawn on top.
const drawBlurredBackdrop = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): void => {
  if (sourceWidth <= 0 || sourceHeight <= 0) return;
  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = width / height;
  let drawWidth = width;
  let drawHeight = height;
  if (sourceAspect > canvasAspect) {
    drawHeight = height;
    drawWidth = height * sourceAspect;
  } else {
    drawWidth = width;
    drawHeight = width / sourceAspect;
  }
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;
  const blurPx = Math.max(Math.min(width, height) / 32, 8);
  ctx.save();
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
};

const renderFrameWithGPU = async (
  renderer: Renderer,
  frame: ImageBitmap,
  transform: ClipTransform,
  canvasWidth: number,
  canvasHeight: number,
): Promise<ImageBitmap | null> => {
  try {
    const device = renderer.getDevice();
    if (!device) {
      return null;
    }

    renderer.beginFrame();

    const texture = renderer.createTextureFromImage(frame);

    const fitScale = computeFitScale(
      transform.fitMode,
      frame.width,
      frame.height,
      canvasWidth,
      canvasHeight,
    );
    const gpuTransform = {
      position: transform.position,
      scale: {
        x: transform.scale.x * fitScale.x,
        y: transform.scale.y * fitScale.y,
      },
      rotation: transform.rotation,
      anchor: transform.anchor,
      opacity: transform.opacity,
      borderRadius: transform.borderRadius,
    };

    renderer.renderLayer({
      texture,
      transform: gpuTransform,
      effects: [],
      opacity: transform.opacity,
      borderRadius: transform.borderRadius || 0,
    });

    const result = await renderer.endFrame();
    renderer.releaseTexture(texture);

    return result;
  } catch {
    return null;
  }
};

const renderAllLayersWithGPU = async (
  renderer: Renderer,
  layers: GPULayer[],
  canvasWidth: number,
  canvasHeight: number,
): Promise<ImageBitmap | null> => {
  try {
    const device = renderer.getDevice();

    if (!device || layers.length === 0) {
      return null;
    }

    renderer.beginFrame();

    const textures: ReturnType<typeof renderer.createTextureFromImage>[] = [];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];

      const texture = renderer.createTextureFromImage(layer.bitmap);
      textures.push(texture);

      const fitScale = computeFitScale(
        layer.transform.fitMode,
        layer.bitmap.width,
        layer.bitmap.height,
        canvasWidth,
        canvasHeight,
      );
      const gpuTransform = {
        position: layer.transform.position,
        scale: {
          x: layer.transform.scale.x * fitScale.x,
          y: layer.transform.scale.y * fitScale.y,
        },
        rotation: layer.transform.rotation,
        anchor: layer.transform.anchor,
        opacity: layer.transform.opacity,
        borderRadius: layer.transform.borderRadius,
      };

      renderer.renderLayer({
        texture,
        transform: gpuTransform,
        effects: [],
        opacity: layer.transform.opacity,
        borderRadius: layer.transform.borderRadius || 0,
      });
    }

    const result = await renderer.endFrame();

    for (const texture of textures) {
      renderer.releaseTexture(texture);
    }

    return result;
  } catch (e) {
    console.error("[renderAllLayersWithGPU] Error:", e);
    return null;
  }
};

const hasBehindSubjectText = (textClips: TextClip[]): boolean =>
  textClips.some((textClip) => textClip.behindSubject);

const getBehindSubjectStreamId = (
  tracks: readonly Track[],
  time: number,
): string => {
  const activeSourceIds = tracks
    .filter(
      (track) =>
        (track.type === "video" || track.type === "image") && !track.hidden,
    )
    .flatMap((track) =>
      track.clips
        .filter(
          (clip) =>
            time >= clip.startTime && time < clip.startTime + clip.duration,
        )
        .map((clip) => clip.id),
    )
    .sort();
  return `editor:text-behind-subject:${activeSourceIds.join("|") || "canvas"}`;
};

const subjectMaskRequestCache = new WeakMap<
  ImageBitmap,
  Map<string, Promise<SegmentationResult | null>>
>();
const subjectOcclusionMaskCache = new WeakMap<
  ImageBitmap,
  WeakMap<SegmentationResult, ImageData>
>();

const getSubjectMaskForFrame = (
  subjectFrame: ImageBitmap,
  time: number,
  realtime: boolean,
  streamId: string,
): Promise<SegmentationResult | null> => {
  let requests = subjectMaskRequestCache.get(subjectFrame);
  if (!requests) {
    requests = new Map();
    subjectMaskRequestCache.set(subjectFrame, requests);
  }
  const key = `${streamId}:${time}:${Number(realtime)}`;
  const cached = requests.get(key);
  if (cached) return cached;
  const request = getPersonSegmentationEngine().getPersonMask(subjectFrame, {
    timestampMs: time * 1000,
    streamId,
    realtime,
  });
  requests.set(key, request);
  return request;
};

const createTransparentCanvasSource = (
  width: number,
  height: number,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.clearRect(0, 0, width, height);
  return canvas;
};

const createTransparentImageBitmap = async (
  width: number,
  height: number,
): Promise<ImageBitmap | null> => {
  try {
    return await createImageBitmap(createTransparentCanvasSource(width, height));
  } catch {
    return null;
  }
};

const captureSubjectFrame = async (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): Promise<ImageBitmap | null> => {
  try {
    return await createImageBitmap(
      ctx.canvas as HTMLCanvasElement | OffscreenCanvas,
      0,
      0,
      width,
      height,
    );
  } catch {
    return null;
  }
};

const applySubjectOcclusionMask = (
  textCtx: CanvasRenderingContext2D,
  subjectFrame: ImageBitmap | null,
  canvasWidth: number,
  canvasHeight: number,
  maskResult: SegmentationResult | null,
): boolean => {
  if (!subjectFrame || !maskResult) return false;

  try {
    const maskCanvas = new OffscreenCanvas(maskResult.width, maskResult.height);
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return false;

    let occlusionMask = subjectOcclusionMaskCache
      .get(subjectFrame)
      ?.get(maskResult);
    if (!occlusionMask) {
      occlusionMask = maskResult.mask;
    }
    if (
      !subjectOcclusionMaskCache.get(subjectFrame)?.has(maskResult) &&
      maskResult.referenceWidth > 0 &&
      maskResult.referenceHeight > 0 &&
      maskResult.referenceRgba.length ===
        maskResult.referenceWidth * maskResult.referenceHeight * 4
    ) {
      try {
        const currentReferenceCanvas = new OffscreenCanvas(
          maskResult.referenceWidth,
          maskResult.referenceHeight,
        );
        const currentReferenceCtx = currentReferenceCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (currentReferenceCtx) {
          currentReferenceCtx.drawImage(
            subjectFrame,
            0,
            0,
            maskResult.referenceWidth,
            maskResult.referenceHeight,
          );
          const currentRgba = currentReferenceCtx.getImageData(
            0,
            0,
            maskResult.referenceWidth,
            maskResult.referenceHeight,
          ).data;
          const motionAwareMaskRgba = createMotionAwareOcclusionMask(
            maskResult.mask.data,
            maskResult.width,
            maskResult.height,
            maskResult.referenceRgba,
            currentRgba,
            maskResult.referenceWidth,
            maskResult.referenceHeight,
          );
          occlusionMask = new ImageData(maskResult.width, maskResult.height);
          occlusionMask.data.set(motionAwareMaskRgba);
        }
      } catch {
        // Keep using the exact matte if frame readback or motion estimation
        // fails. Dropping the whole text layer here creates a visible blink.
        occlusionMask = maskResult.mask;
      }
    }

    let frameMasks = subjectOcclusionMaskCache.get(subjectFrame);
    if (!frameMasks) {
      frameMasks = new WeakMap();
      subjectOcclusionMaskCache.set(subjectFrame, frameMasks);
    }
    frameMasks.set(maskResult, occlusionMask);

    maskCtx.putImageData(occlusionMask, 0, 0);
    textCtx.save();
    textCtx.globalCompositeOperation = "destination-out";
    textCtx.imageSmoothingEnabled = true;
    textCtx.imageSmoothingQuality = "high";
    textCtx.drawImage(maskCanvas, 0, 0, canvasWidth, canvasHeight);
    textCtx.restore();
    return true;
  } catch {
    return false;
  }
};

const renderOverlayLayerWithEffects = async (
  ctx: CanvasRenderingContext2D,
  clipId: string,
  canvasWidth: number,
  canvasHeight: number,
  render: (layerCtx: CanvasRenderingContext2D) => void | Promise<void>,
): Promise<void> => {
  if (!clipNeedsFrameProcessing(clipId)) {
    await render(ctx);
    return;
  }
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = canvasWidth;
  layerCanvas.height = canvasHeight;
  const layerCtx = layerCanvas.getContext("2d");
  if (!layerCtx) return;
  await render(layerCtx);
  const prepared = await preparePreviewFrame(
    clipId,
    layerCanvas,
    false,
    true,
  );
  try {
    ctx.drawImage(prepared.frame, 0, 0, canvasWidth, canvasHeight);
  } finally {
    prepared.cleanup();
  }
};

const renderShapeClipWithEffects = async (
  ctx: CanvasRenderingContext2D,
  shapeClip: ShapeClip | SVGClip | StickerClip,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
): Promise<void> => {
  await renderOverlayLayerWithEffects(
    ctx,
    shapeClip.id,
    canvasWidth,
    canvasHeight,
    (layerCtx) =>
      renderShapeClipToCanvas(
        layerCtx,
        shapeClip,
        canvasWidth,
        canvasHeight,
        time,
      ),
  );
};

const renderTextClipWithSubjectMask = async (
  ctx: CanvasRenderingContext2D,
  textClip: TextClip,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
  subjectFrame: ImageBitmap | null,
  realtime = true,
  streamId = "editor:text-behind-subject:canvas",
): Promise<void> => {
  let subjectMask: SegmentationResult | null = null;
  if (textClip.behindSubject && subjectFrame) {
    const segEngine = getPersonSegmentationEngine();
    if (segEngine.isInitialized()) {
      subjectMask = await getSubjectMaskForFrame(
        subjectFrame,
        time,
        realtime,
        streamId,
      );
    }
    // During the worker's first realtime inference, keep the text hidden
    // instead of flashing it in front of the subject for one or two frames.
    if (!subjectMask && realtime) return;
  }

  const renderTextLayer = (targetCtx: CanvasRenderingContext2D) =>
    renderOverlayLayerWithEffects(
      targetCtx,
      textClip.id,
      canvasWidth,
      canvasHeight,
      (layerCtx) =>
        renderTextClipToCanvas(
          layerCtx,
          textClip,
          canvasWidth,
          canvasHeight,
          time,
        ),
    );

  if (!textClip.behindSubject || !subjectFrame || !subjectMask) {
    await renderTextLayer(ctx);
    return;
  }

  const textLayerCanvas = document.createElement("canvas");
  textLayerCanvas.width = canvasWidth;
  textLayerCanvas.height = canvasHeight;
  const textLayerCtx = textLayerCanvas.getContext("2d");
  if (!textLayerCtx) return;
  await renderTextLayer(textLayerCtx);
  if (
    !applySubjectOcclusionMask(
      textLayerCtx,
      subjectFrame,
      canvasWidth,
      canvasHeight,
      subjectMask,
    )
  ) {
    return;
  }
  ctx.drawImage(textLayerCanvas, 0, 0, canvasWidth, canvasHeight);
};

interface ClipWithPlaceholder {
  isPlaceholder?: boolean;
}

export const Preview: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const renderBridgeInitialized = useRef<boolean>(false);
  const lastGoodFrameRef = useRef<ImageBitmap | null>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const decodeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decodeDebounceResolveRef = useRef<((value: ImageBitmap | null) => void) | null>(
    null,
  );
  const decodeRequestSeqRef = useRef(0);
  const scrubVideoReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastPreviewRenderTimeRef = useRef(0);
  const offscreenCtxRef = useRef<OffscreenCanvasRenderingContext2D | null>(
    null,
  );

  // Native video element for hardware-accelerated playback (much faster for 4K)
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const currentVideoMediaIdRef = useRef<string | null>(null);
  const nativePlaybackActiveRef = useRef<boolean>(false);
  const nativeVideoCacheRef = useRef<
    Map<string, { video: HTMLVideoElement; url: string }>
  >(new Map());
  const nativeImageBitmapCacheRef = useRef<Map<string, ImageBitmap>>(new Map());

  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioGraphRef = useRef<ReturnType<typeof getRealtimeAudioGraph> | null>(
    null,
  );
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const processedAudioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const noAudioBufferRef = useRef<Set<string>>(new Set());

  const getAudioBufferCacheKey = (mediaId: string, audioTrackIndex?: number): string =>
    `${mediaId}:${audioTrackIndex ?? 0}`;

  const loadAudioBuffer = async (
    audioContext: AudioContext | BaseAudioContext,
    blob: Blob,
    audioTrackIndex: number = 0,
  ): Promise<AudioBuffer | null> => {
    try {
      const { extractAudioWav } = await import("@openreel/core/media");
      const wavBlob = await extractAudioWav(blob, audioTrackIndex);
      const arrayBuffer = await wavBlob.arrayBuffer();
      return await audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      if (error instanceof Error && error.name === "NoAudioStreamError") {
        return null;
      }
    }

    if (audioTrackIndex === 0) {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        return await audioContext.decodeAudioData(arrayBuffer);
      } catch {
        return null;
      }
    }
    return null;
  };

  const getAudioEffectSignature = useCallback((effects: Effect[]): string =>
    JSON.stringify(
      effects.map((effect) => ({
        id: effect.id,
        type: effect.type,
        enabled: effect.enabled,
        params: effect.params,
        metadata: effect.metadata,
      })),
    ), []);

  const getPreviewAudioBufferForEffects = useCallback(
    async (
      audioBuffer: AudioBuffer,
      baseCacheKey: string,
      effects: Effect[],
    ): Promise<{ audioBuffer: AudioBuffer; effects: Effect[] }> => {
      const previewEffects = getPreviewAudioEffects(
        effects.filter((effect) => effect.enabled),
      );
      const { profileAwareNoiseEffects, realtimeEffects } =
        splitProfileAwareNoiseReductionEffects(previewEffects);

      if (profileAwareNoiseEffects.length === 0) {
        return { audioBuffer, effects: realtimeEffects };
      }

      const processedCacheKey = `${baseCacheKey}:profile-denoise:${getAudioEffectSignature(profileAwareNoiseEffects)}`;
      const cached = processedAudioBufferCacheRef.current.get(processedCacheKey);
      if (cached) {
        return { audioBuffer: cached, effects: realtimeEffects };
      }

      const effectsEngine = await initializeAudioEffectsEngine();
      let processedBuffer = audioBuffer;

      for (const effect of profileAwareNoiseEffects) {
        const params = effect.params as AudioEffectParams["noiseReduction"];
        if (!params.profile) {
          continue;
        }

        processedBuffer = await effectsEngine.applyNoiseReductionWithProfileData(
          processedBuffer,
          params.profile,
          params.reduction ?? 0.5,
          params.focus ?? "balanced",
          params.threshold ?? -40,
        );
      }

      processedAudioBufferCacheRef.current.set(processedCacheKey, processedBuffer);
      return { audioBuffer: processedBuffer, effects: realtimeEffects };
    },
    [getAudioEffectSignature],
  );

  const getResolvedClipAudioEffects = useCallback((clip: PreviewClip): Effect[] => {
    return resolveTimelineClipAudioEffects(clip, {
      tracks: timelineTracksRef.current,
    });
  }, []);

  const getResolvedClipVolumeAutomation = useCallback((clip: PreviewClip) =>
    resolveClipVolumeAutomation(clip, {
      tracks: timelineTracksRef.current,
    }), []);

  const rendererRef = useRef<Renderer | null>(null);
  const rendererInitializedRef = useRef<boolean>(false);
  const motionRendererRef = useRef<MotionRenderer | null>(null);
  const motionAssetBitmapCacheRef = useRef<Map<string, ImageBitmap>>(new Map());

  useEffect(() => () => {
    motionRendererRef.current?.dispose();
    motionRendererRef.current = null;
  }, []);

  const [isMuted, setIsMuted] = useState(false);
  const [isRenderBridgeReady, setIsRenderBridgeReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [videoAreaSize, setVideoAreaSize] = useState({ width: 0, height: 0 });
  const [, setRendererType] = useState<string>("none");
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [showCompositionGrid, setShowCompositionGrid] = useState(false);
  const [showSafeMargins, setShowSafeMargins] = useState(false);
  const [canvasSnappingEnabled, setCanvasSnappingEnabled] = useState(true);

  const ZOOM_OPTIONS = [
    { label: "50%", value: 0.5 },
    { label: "75%", value: 0.75 },
    { label: "100%", value: 1 },
    { label: "125%", value: 1.25 },
    { label: "150%", value: 1.5 },
    { label: "200%", value: 2 },
  ];

  const isDark = useThemeStore((state) => state.isDark);

  // The preview canvas background / letterbox bars. A project "color" canvas
  // fill overrides the theme stage so the preview matches the exported video;
  // otherwise the bars follow the theme (--screen-bg token). Kept in a ref so
  // every render path (scrub, playback, transitions) picks up the current
  // value without re-creating callbacks. (Blur fill draws a cover-fit blurred
  // backdrop of the base clip in both preview and export.)
  const previewBgRef = useRef<string>(isDark ? "#000000" : "#ffffff");

  // Canvas interaction state for resize/move
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("none");
  const [activeHandle, setActiveHandle] = useState<HandlePosition | null>(null);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const interactionStartRef = useRef<{
    x: number;
    y: number;
    transform: { x: number; y: number; scaleX: number; scaleY: number };
  } | null>(null);
  const pendingTransformRef = useRef<{
    clipId: string;
    transform: {
      position?: { x: number; y: number };
      scale?: { x: number; y: number };
    };
  } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Track if we're currently interacting to prevent re-renders during resize/move
  const isInteractingRef = useRef<boolean>(false);
  // Throttle store updates during interaction (update at most every 32ms ~30fps)
  const lastStoreUpdateRef = useRef<number>(0);
  const STORE_UPDATE_THROTTLE_MS = 32;
  // Throttle playhead updates during playback to reduce React re-renders
  const lastPlayheadUpdateRef = useRef<number>(0);
  // Keep React/timeline updates from competing with continuous media playback.
  // The video canvas still renders on every animation frame; only the heavier
  // editor-wide playhead state update is capped to roughly 30fps.
  const PLAYHEAD_UPDATE_THROTTLE_MS = 33;
  // Live transform state for immediate visual feedback during interaction
  const [liveTransform, setLiveTransform] = useState<{
    position: { x: number; y: number };
    scale: { x: number; y: number };
  } | null>(null);
  const [canvasSnapGuides, setCanvasSnapGuides] = useState<{
    x: number | null;
    y: number | null;
  }>({ x: null, y: null });

  // Track interaction target type (video clip or text clip)
  const [interactionTargetType, setInteractionTargetType] = useState<
    "clip" | "text-clip" | "shape-clip" | null
  >(null);
  const interactionTargetIdRef = useRef<string | null>(null);

  // Video element cache for native hardware-accelerated frame decoding (thumbnails/scrubbing)
  // Much more reliable than MediaBunny's CanvasSink for random-access seeking
  const videoElementCacheRef = useRef<
    Map<string, { video: HTMLVideoElement; url: string; lastUsed: number }>
  >(new Map());

  const releaseVideoElement = useCallback(
    (entry: { video: HTMLVideoElement; url: string }): void => {
      const { video, url } = entry;
      video.pause();
      video.removeAttribute("src");
      video.onloadedmetadata = null;
      video.onerror = null;
      video.load();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const evictOldestVideoElement = useCallback((): void => {
    let oldestKey = "";
    let oldestTime = Infinity;
    for (const [key, entry] of videoElementCacheRef.current.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (!oldestKey) return;

    const oldEntry = videoElementCacheRef.current.get(oldestKey);
    if (!oldEntry) return;

    releaseVideoElement(oldEntry);
    videoElementCacheRef.current.delete(oldestKey);
  }, [releaseVideoElement]);

  const cancelPendingScrubDecode = useCallback((): void => {
    if (decodeDebounceRef.current) {
      clearTimeout(decodeDebounceRef.current);
      decodeDebounceRef.current = null;
    }
    decodeDebounceResolveRef.current?.(null);
    decodeDebounceResolveRef.current = null;
    decodeRequestSeqRef.current += 1;
  }, []);

  const releaseScrubVideoElements = useCallback((): void => {
    if (scrubVideoReleaseTimerRef.current) {
      clearTimeout(scrubVideoReleaseTimerRef.current);
      scrubVideoReleaseTimerRef.current = null;
    }
    cancelPendingScrubDecode();
    for (const entry of videoElementCacheRef.current.values()) {
      releaseVideoElement(entry);
    }
    videoElementCacheRef.current.clear();
  }, [cancelPendingScrubDecode, releaseVideoElement]);

  const scheduleScrubVideoRelease = useCallback((): void => {
    if (scrubVideoReleaseTimerRef.current) {
      clearTimeout(scrubVideoReleaseTimerRef.current);
    }
    scrubVideoReleaseTimerRef.current = setTimeout(() => {
      releaseScrubVideoElements();
    }, 350);
  }, [releaseScrubVideoElements]);

  // Persistent decoder cache for efficient playback (legacy - kept for fallback)
  const decoderCacheRef = useRef<
    Map<
      string,
      {
        input: { [Symbol.dispose]?: () => void };
        sink: unknown;
        mediaId: string;
        lastUsed: number;
      }
    >
  >(new Map());

  // Track canvas size changes for resize handles positioning
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width, height });
        if (width > 0 && height > 0) {
          offscreenCanvasRef.current = new OffscreenCanvas(width, height);
          offscreenCtxRef.current = offscreenCanvasRef.current.getContext("2d");
        }
      }
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const videoArea = videoAreaRef.current;
    if (!videoArea) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setVideoAreaSize({ width, height });
      }
    });

    resizeObserver.observe(videoArea);
    return () => resizeObserver.disconnect();
  }, []);

  // Project store - subscribe to the entire project to ensure re-renders
  // when any part of the project changes (including clips)
  const project = useProjectStore((state) => state.project);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);

  // Get text clips from TitleEngine
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const allTextClips = useMemo(() => {
    const titleEngine = getTitleEngine();
    return titleEngine?.getAllTextClips() || [];
  }, [getTitleEngine, project.modifiedAt]);

  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const allShapeClips = useMemo(() => {
    const graphicsEngine = getGraphicsEngine();
    const shapes = graphicsEngine?.getAllShapeClips() || [];
    const svgs = graphicsEngine?.getAllSVGClips() || [];
    const stickers = graphicsEngine?.getAllStickerClips() || [];
    return [...shapes, ...svgs, ...stickers];
  }, [getGraphicsEngine, project.modifiedAt]);

  const getMaskEngine = useEngineStore((state) => state.getMaskEngine);
  const clipMasksById = useMemo(() => {
    const byClip = new Map<string, Mask[]>();
    for (const mask of project.masks ?? []) {
      const existing = byClip.get(mask.clipId) ?? [];
      byClip.set(mask.clipId, [...existing, mask]);
    }
    return byClip;
  }, [project.masks]);

  const drawClipFrame = useCallback(
    async (
      ctx: CanvasRenderingContext2D,
      clipId: string,
      frame: PreviewFrameSource,
      transform: ClipTransform,
      canvasWidth: number,
      canvasHeight: number,
      time: number,
      filter?: string,
    ) => {
      const masks = clipMasksById.get(clipId) ?? [];
      if (masks.length === 0) {
        drawFrameWithTransform(
          ctx,
          frame,
          transform,
          canvasWidth,
          canvasHeight,
          filter,
        );
        return;
      }

      try {
        const maskEngine = await getMaskEngine();
        await drawFrameWithMasks({
          ctx,
          frame,
          transform,
          canvasWidth,
          canvasHeight,
          masks,
          maskEngine,
          time,
          filter,
        });
      } catch (error) {
        console.warn(`[Preview] Failed to apply masks to ${clipId}:`, error);
        drawFrameWithTransform(
          ctx,
          frame,
          transform,
          canvasWidth,
          canvasHeight,
          filter,
        );
      }
    },
    [clipMasksById, getMaskEngine],
  );

  // Get subtitles from project timeline
  const allSubtitles = useMemo(() => {
    return project.timeline.subtitles || [];
  }, [project.timeline.subtitles]);

  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );
  const updateTextTransform = useProjectStore(
    (state) => state.updateTextTransform,
  );
  const updateShapeTransform = useProjectStore(
    (state) => state.updateShapeTransform,
  );
  const beginHistoryGroup = useProjectStore((state) => state.beginHistoryGroup);
  const endHistoryGroup = useProjectStore((state) => state.endHistoryGroup);
  const updateSettings = useProjectStore((state) => state.updateSettings);
  const timelineTracks = project.timeline.tracks;
  const settings = project.settings;

  const canvasFillMode = project.timeline.backgroundFillMode;
  const canvasFillColor = project.timeline.layoutBackgroundColor;
  useEffect(() => {
    if (canvasFillMode === "color" && canvasFillColor) {
      previewBgRef.current = canvasFillColor;
      return;
    }
    const screenBg =
      typeof window !== "undefined"
        ? getComputedStyle(document.documentElement)
            .getPropertyValue("--screen-bg")
            .trim()
        : "";
    previewBgRef.current = screenBg || (isDark ? "#000000" : "#ffffff");
  }, [canvasFillMode, canvasFillColor, isDark]);

  const playbackQuality = useUIStore((state) => state.playbackQuality);
  const setPlaybackQuality = useUIStore((state) => state.setPlaybackQuality);
  const previewRes = useMemo(
    () =>
      computePreviewResolution(
        settings.width,
        settings.height,
        PREVIEW_MAX_DIMENSION *
          previewQualityScale(playbackQuality, settings.width, settings.height),
      ),
    [settings.width, settings.height, playbackQuality],
  );

  const previewFrameSize = useMemo(() => {
    if (videoAreaSize.width <= 0 || videoAreaSize.height <= 0) {
      return { width: 0, height: 0 };
    }

    const aspectRatio = settings.width / settings.height;
    // Fill the available preview area (minus a small margin) while preserving
    // the project aspect ratio, instead of capping at a fixed small size which
    // left the monitor floating in unused space on larger screens.
    const PREVIEW_PADDING = 24;
    const availableWidth = Math.max(1, videoAreaSize.width - PREVIEW_PADDING * 2);
    const availableHeight = Math.max(
      1,
      videoAreaSize.height - PREVIEW_PADDING * 2,
    );

    let width = availableWidth;
    let height = width / aspectRatio;

    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspectRatio;
    }

    return {
      width: width * zoomLevel,
      height: height * zoomLevel,
    };
  }, [settings.height, settings.width, videoAreaSize, zoomLevel]);

  // Keep a ref to timelineTracks for use in playback effect without causing re-runs
  const timelineTracksRef = useRef(timelineTracks);
  useEffect(() => {
    timelineTracksRef.current = timelineTracks;
  }, [timelineTracks]);

  // Current canvas fill mode in a ref so the (stable) preview-background
  // helper always reads the latest value even when the big render callbacks
  // captured it before the mode changed.
  const canvasFillModeRef = useRef(canvasFillMode);
  useEffect(() => {
    canvasFillModeRef.current = canvasFillMode;
  }, [canvasFillMode]);
  const canvasFillColorRef = useRef(canvasFillColor);
  useEffect(() => {
    canvasFillColorRef.current = canvasFillColor;
  }, [canvasFillColor]);

  // Keep a ref to allTextClips for use in playback effect
  const allTextClipsRef = useRef(allTextClips);
  useEffect(() => {
    allTextClipsRef.current = allTextClips;
  }, [allTextClips]);

  const allShapeClipsRef = useRef(allShapeClips);
  useEffect(() => {
    allShapeClipsRef.current = allShapeClips;
  }, [allShapeClips]);

  // Keep a ref to allSubtitles for use in playback effect
  const allSubtitlesRef = useRef(allSubtitles);
  useEffect(() => {
    allSubtitlesRef.current = allSubtitles;
  }, [allSubtitles]);

  // Keep a ref to isScrubbing for use in playback loop
  const isScrubbingRef = useRef(false);

  const selectedItems = useUIStore((state) => state.selectedItems);
  const cropMode = useUIStore((state) => state.cropMode);
  const cropClipId = useUIStore((state) => state.cropClipId);
  const setCropMode = useUIStore((state) => state.setCropMode);
  const exportState = useUIStore((state) => state.exportState);
  const motionPathMode = useUIStore((state) => state.motionPathMode);
  const motionPathClipId = useUIStore((state) => state.motionPathClipId);
  const select = useUIStore((state) => state.select);

  const {
    playheadPosition,
    playbackState,
    playbackLockedReason,
    playbackRate,
    isScrubbing,
    pause,
    togglePlayback,
    seekTo,
    seekRelative,
    setPlayheadPosition,
  } = useTimelineStore();

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  const isPlaying = playbackState === "playing";

  const motionPathClip = React.useMemo(() => {
    if (!motionPathMode || !motionPathClipId) return null;
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === motionPathClipId);
      if (clip) return clip;
    }
    return null;
  }, [motionPathMode, motionPathClipId, project.timeline.tracks]);

  const [motionPathConfig, setMotionPathConfig] = React.useState<MotionPathConfig | null>(null);

  React.useEffect(() => {
    if (motionPathClip) {
      setMotionPathConfig({
        clipId: motionPathClip.id,
        enabled: true,
        pathType: "bezier",
        points: [],
        showPath: true,
        autoOrient: false,
        alignOrigin: [0.5, 0.5],
      });
    } else {
      setMotionPathConfig(null);
    }
  }, [motionPathClip]);

  const handleMotionPathPointMove = React.useCallback(
    (index: number, x: number, y: number) => {
      setMotionPathConfig((prev) => {
        if (!prev) return prev;
        const newPoints = [...prev.points];
        newPoints[index] = { ...newPoints[index], x, y };
        return { ...prev, points: newPoints };
      });
    },
    []
  );

  const handleMotionPathPointAdd = React.useCallback(
    (point: GSAPMotionPathPoint) => {
      setMotionPathConfig((prev) => {
        if (!prev) return prev;
        const newPoints = [...prev.points, point].sort((a, b) => a.time - b.time);
        return { ...prev, points: newPoints };
      });
    },
    []
  );

  const handleMotionPathPointRemove = React.useCallback((index: number) => {
    setMotionPathConfig((prev) => {
      if (!prev) return prev;
      const newPoints = prev.points.filter((_, i) => i !== index);
      return { ...prev, points: newPoints };
    });
  }, []);

  const handleMotionPathControlPointMove = React.useCallback(
    (pointIndex: number, handleType: "cp1" | "cp2", x: number, y: number) => {
      setMotionPathConfig((prev) => {
        if (!prev) return prev;
        const newPoints = [...prev.points];
        const point = newPoints[pointIndex];
        if (!point.controlPoints) {
          point.controlPoints = { cp1: { x: 0, y: 0 }, cp2: { x: 0, y: 0 } };
        }
        point.controlPoints[handleType] = { x, y };
        return { ...prev, points: newPoints };
      });
    },
    []
  );

  const particleEngine = React.useMemo(() => getParticleEngine(), []);
  const [particleUpdateTrigger, setParticleUpdateTrigger] = React.useState(
    () => particleEngine.getChangeVersion()
  );

  React.useEffect(() => {
    const unsubscribe = particleEngine.onEffectsChange(() => {
      setParticleUpdateTrigger(particleEngine.getChangeVersion());
    });
    return unsubscribe;
  }, [particleEngine]);

  const particleEffects = React.useMemo(() => {
    return particleEngine.getAllEffects();
  }, [particleEngine, particleUpdateTrigger]);

  // Calculate the actual end time for playback (where clips actually end)
  // This needs to recalculate whenever the timeline changes
  // Includes video/audio/image clips, text clips, and shape clips
  const actualEndTime = React.useMemo(() => {
    const tracks = project.timeline.tracks;
    let maxEnd = 0;

    for (const track of tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }

    for (const textClip of allTextClips) {
      const end = textClip.startTime + textClip.duration;
      if (end > maxEnd) maxEnd = end;
    }

    for (const shapeClip of allShapeClips) {
      const end = shapeClip.startTime + shapeClip.duration;
      if (end > maxEnd) maxEnd = end;
    }

    return maxEnd;
  }, [project.timeline.tracks, allTextClips, allShapeClips]);

  // RenderBridge is guaranteed to be initialized before Preview renders (see EditorInterface)
  useEffect(() => {
    if (renderBridgeInitialized.current) return;

    const bridge = getRenderBridge();
    if (canvasRef.current) {
      bridge.setCanvas(canvasRef.current);
    }
    renderBridgeInitialized.current = true;
    setIsRenderBridgeReady(true);
  }, []);

  useEffect(() => {
    return () => {
      for (const entry of decoderCacheRef.current.values()) {
        entry.input[Symbol.dispose]?.();
      }
      decoderCacheRef.current.clear();

      releaseScrubVideoElements();

      if (videoElementRef.current) {
        videoElementRef.current.pause();
        videoElementRef.current.removeAttribute("src");
        videoElementRef.current.load();
        videoElementRef.current = null;
      }
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
      currentVideoMediaIdRef.current = null;

      for (const [, entry] of nativeVideoCacheRef.current) {
        releaseVideoElement(entry);
      }
      nativeVideoCacheRef.current.clear();

      for (const [, bitmap] of nativeImageBitmapCacheRef.current) {
        bitmap.close();
      }
      nativeImageBitmapCacheRef.current.clear();
    };
  }, [releaseScrubVideoElements]);

  // Set canvas internal resolution ONLY when project settings change
  // This follows the WebGPU best practice of keeping internal resolution fixed
  // and using CSS/transforms for display scaling (prevents flickering during resize)
  // Using useLayoutEffect to ensure canvas size is set before first paint
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Always ensure canvas has correct size
    if (
      canvas.width !== previewRes.width ||
      canvas.height !== previewRes.height
    ) {
      canvas.width = previewRes.width;
      canvas.height = previewRes.height;
    }
  }, [previewRes.width, previewRes.height]);

  useEffect(() => {
    if (isRenderBridgeReady && canvasRef.current) {
      const bridge = getRenderBridge();
      bridge.setCanvas(canvasRef.current);
    }
  }, [isRenderBridgeReady]);

  /**
   * Initialize WebGPU renderer for GPU-accelerated rendering (once on mount)
   */
  useEffect(() => {
    if (rendererInitializedRef.current || !canvasRef.current) return;

    const initializeRenderer = async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const factory = RendererFactory.getInstance();
        const renderer = await factory.createRenderer({
          canvas,
          width: previewRes.width,
          height: previewRes.height,
          preferredRenderer: isWebGPUSupported() ? "webgpu" : "canvas2d",
        });

        rendererRef.current = renderer;
        rendererInitializedRef.current = true;
        setRendererType(renderer.type);

        renderer.onDeviceLost(() => {
          console.warn("[Preview] GPU device lost, attempting recovery...");
          renderer.recreateDevice().then((success) => {
            if (!success) {
              console.error("[Preview] Failed to recover GPU device");
              setRendererType("canvas2d");
            }
          });
        });
      } catch (error) {
        console.warn("[Preview] Failed to initialize GPU renderer:", error);
        setRendererType("canvas2d");
      }
    };

    initializeRenderer();

    return () => {
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
        rendererInitializedRef.current = false;
      }
    };
  }, []);

  /**
   * Handle canvas resize events
   *
   * Update preview at 60fps when dragging to resize
   */
  useEffect(() => {
    if (rendererRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      if (
        canvas.width !== previewRes.width ||
        canvas.height !== previewRes.height
      ) {
        rendererRef.current.resize(previewRes.width, previewRes.height);
      }
    }
  }, [previewRes.width, previewRes.height]);

  const rateRef = useRef(playbackRate);
  const startPositionRef = useRef(playheadPosition);

  // MediaBunny playback resources - map of clipId to resources for multi-track playback
  const playbackResourcesRef = useRef<
    Map<
      string,
      {
        input: { [Symbol.dispose]?: () => void };
        sink: unknown;
        mediaId: string;
        clipId: string;
        trackIndex: number;
      }
    >
  >(new Map());

  const imageBitmapCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const failedImageDecodesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    rateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!isPlaying) {
      startPositionRef.current = playheadPosition;
    }
  }, [isPlaying, playheadPosition]);

  const cleanupPlaybackResources = useCallback(() => {
    const resources = playbackResourcesRef.current;
    for (const [, resource] of resources) {
      resource.input[Symbol.dispose]?.();
    }
    playbackResourcesRef.current = new Map();

    for (const [, bitmap] of imageBitmapCacheRef.current) {
      bitmap.close();
    }
    imageBitmapCacheRef.current = new Map();

    for (const [, bitmap] of motionAssetBitmapCacheRef.current) {
      bitmap.close();
    }
    motionAssetBitmapCacheRef.current = new Map();
  }, []);

  const cleanupAudioResources = useCallback(() => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch {
        // Ignore errors if already stopped
      }
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioGraphRef.current) {
      audioGraphRef.current.stopScheduler();
      audioGraphRef.current.stopAllClips();
    }
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : 1;
    }
    if (audioGraphRef.current) {
      audioGraphRef.current.setPreviewMuted(isMuted);
    }
  }, [isMuted]);

  const resolveMotionImageAsset = useCallback(
    async (asset: MotionAsset): Promise<ImageBitmap | null> => {
      const cacheKey = asset.mediaId
        ? `media:${asset.mediaId}`
        : asset.url
          ? `url:${asset.url}`
          : `asset:${asset.id}`;
      const cached = motionAssetBitmapCacheRef.current.get(cacheKey);
      if (cached) return cached;

      let blob: Blob | null = null;
      if (asset.mediaId) {
        const mediaItem = getMediaItem(asset.mediaId);
        if (mediaItem?.type === "image" && mediaItem.blob) {
          blob = mediaItem.blob;
        }
      } else if (asset.url) {
        try {
          const response = await fetch(asset.url);
          if (response.ok) {
            blob = await response.blob();
          }
        } catch {
          return null;
        }
      }

      if (!blob) return null;
      try {
        const bitmap = await createImageBitmap(blob);
        motionAssetBitmapCacheRef.current.set(cacheKey, bitmap);
        return bitmap;
      } catch {
        return null;
      }
    },
    [getMediaItem],
  );

  const hasActiveMotionInstances = useCallback(
    (time: number, trackId?: string): boolean =>
      (project.motionInstances ?? []).some((instance) => {
        if (trackId && instance.trackId !== trackId) return false;
        return time >= instance.startTime && time < instance.startTime + instance.duration;
      }),
    [project.motionInstances],
  );

  const renderMotionInstancesForTrack = useCallback(
    async (
      ctx: CanvasRenderingContext2D,
      track: Track,
      time: number,
      canvasWidth: number,
      canvasHeight: number,
    ): Promise<boolean> => {
      const instances = (project.motionInstances ?? []).filter(
        (instance) =>
          instance.trackId === track.id &&
          time >= instance.startTime &&
          time < instance.startTime + instance.duration,
      );
      if (instances.length === 0) return false;

      const compositions = project.motionCompositions ?? [];
      const assetResolver = { resolveImageAsset: resolveMotionImageAsset };
      const renderer =
        motionRendererRef.current ?? (motionRendererRef.current = new MotionRenderer());
      let rendered = false;

      for (const instance of instances) {
        const composition = compositions.find(
          (candidate) => candidate.id === instance.compositionId,
        );
        if (!composition) continue;

        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await renderer.renderInstance(
            composition,
            instance,
            time,
            compositions,
            assetResolver,
            1,
          );
          const baseTransform = scaleTransformPositionForPreview(
            instance.transform as ClipTransform,
            previewRes.scale,
          );
          drawFrameWithTransform(
            ctx,
            bitmap,
            {
              ...baseTransform,
              opacity: instance.opacity * (baseTransform.opacity ?? 1),
            },
            canvasWidth,
            canvasHeight,
          );
          rendered = true;
        } catch (error) {
          console.warn(
            `[Preview] Motion render failed for instance ${instance.id}:`,
            error,
          );
        } finally {
          bitmap?.close();
        }
      }

      return rendered;
    },
    [
      project.motionCompositions,
      project.motionInstances,
      previewRes.scale,
      resolveMotionImageAsset,
    ],
  );

  /**
   * Render overlay clips (text and shapes) respecting proper z-ordering with video/image tracks.
   * Track order determines layering: lower track index = rendered on top.
   *
   * @param mode - "below-video" renders only overlays that should appear below video tracks
   * "above-video" renders only overlays that should appear above video tracks
   * "all" renders all overlays (legacy behavior for when no video is present)
   */
  const renderOverlayClipsInTrackOrder = useCallback(
    async (
      ctx: CanvasRenderingContext2D,
      tracks: Track[],
      shapeClips: (ShapeClip | SVGClip | StickerClip)[],
      textClips: TextClip[],
      time: number,
      canvasWidth: number,
      canvasHeight: number,
      mode: "below-video" | "above-video" | "all" = "all",
      subjectFrame: ImageBitmap | null = null,
    ) => {
      const subjectStreamId = getBehindSubjectStreamId(tracks, time);
      const videoImageTrackIndices = tracks
        .map((t, idx) => ({ track: t, originalIndex: idx }))
        .filter(
          ({ track }) =>
            (track.type === "video" || track.type === "image") && !track.hidden,
        )
        .map(({ originalIndex }) => originalIndex);

      const lowestVideoIndex =
        videoImageTrackIndices.length > 0
          ? Math.min(...videoImageTrackIndices)
          : Infinity;
      const highestVideoIndex =
        videoImageTrackIndices.length > 0
          ? Math.max(...videoImageTrackIndices)
          : -1;

      const overlayTracksWithIndex = tracks
        .map((t, idx) => ({ track: t, originalIndex: idx }))
        .filter(
          ({ track }) =>
            (track.type === "text" || track.type === "graphics") &&
            !track.hidden,
        );

      const tracksToRender = overlayTracksWithIndex.filter(
        ({ originalIndex }) => {
          if (mode === "below-video") {
            return originalIndex > highestVideoIndex;
          } else if (mode === "above-video") {
            return originalIndex < lowestVideoIndex;
          }
          return true;
        },
      );

      tracksToRender.sort((a, b) => b.originalIndex - a.originalIndex);

      for (const { track } of tracksToRender) {
        if (track.type === "graphics") {
          const trackShapeClips = shapeClips.filter(
            (sc) => sc.trackId === track.id,
          );
          for (const shapeClip of trackShapeClips) {
            await renderShapeClipWithEffects(
              ctx,
              shapeClip,
              canvasWidth,
              canvasHeight,
              time,
            );
          }
          await renderMotionInstancesForTrack(
            ctx,
            track,
            time,
            canvasWidth,
            canvasHeight,
          );
        } else if (track.type === "text") {
          const trackTextClips = textClips.filter(
            (tc) => tc.trackId === track.id,
          );
          for (const textClip of trackTextClips) {
            await renderTextClipWithSubjectMask(
              ctx,
              textClip,
              canvasWidth,
              canvasHeight,
              time,
              subjectFrame,
              isPlaying,
              subjectStreamId,
            );
          }
        }
      }
    },
    [isPlaying, renderMotionInstancesForTrack],
  );

  /**
   * Set up audio playback from the AUDIO TRACK at a given timeline position
   * Uses RealtimeAudioGraph for real-time audio effects (reverb, delay, EQ, compressor)
   *
   * Audio effects can be on either:
   * 1. The audio clip on the audio track (preferred)
   * 2. A linked video clip on the video track (same mediaId, same startTime)
   *
   * @param timelinePosition - The current position in the timeline
   */
  const setupAudioFromAudioTrack = useCallback(
    async (timelinePosition: number): Promise<void> => {
      const tracks = timelineTracksRef.current;
      const audioTracks = tracks.filter((t) => t.type === "audio" && !t.hidden);

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setPreviewMuted(isMuted);

      const speedEngine = getSpeedEngine();
      const scheduledClips: AudioClipSchedule[] = [];

      for (const audioTrack of audioTracks) {
        audioGraph.createTrack({
          trackId: audioTrack.id,
          volume: 1,
          pan: 0,
          muted: audioTrack.muted || false,
          solo: audioTrack.solo || false,
          effects: [],
        });

        if (audioTrack.muted) {
          continue;
        }

        for (const audioClip of audioTrack.clips) {
          const clipEnd = audioClip.startTime + audioClip.duration;

          if (
            timelinePosition >= audioClip.startTime &&
            timelinePosition < clipEnd
          ) {
            const mediaItem = getMediaItem(audioClip.mediaId);
            if (!mediaItem?.blob) {
              continue;
            }

            const audioCacheKey = getAudioBufferCacheKey(
              audioClip.mediaId,
              audioClip.audioTrackIndex,
            );
            let audioBuffer = audioBufferCacheRef.current.get(audioCacheKey);
            if (!audioBuffer) {
              if (noAudioBufferRef.current.has(audioCacheKey)) {
                continue;
              }
              try {
                const audioContext = audioGraph.getAudioContext();
                const loaded = await loadAudioBuffer(
                  audioContext,
                  mediaItem.blob,
                  audioClip.audioTrackIndex ?? 0,
                );
                if (!loaded) {
                  noAudioBufferRef.current.add(audioCacheKey);
                  continue;
                }
                audioBuffer = loaded;
                audioBufferCacheRef.current.set(audioCacheKey, audioBuffer);
              } catch (error) {
                console.warn(
                  `[Preview] Failed to decode audio for clip ${audioClip.id}:`,
                  error,
                );
                continue;
              }
            }

            const audioEffects = getResolvedClipAudioEffects(audioClip);

            const enabledEffects = audioEffects.filter(
              (e: Effect) => e.enabled,
            );
            const previewAudio = await getPreviewAudioBufferForEffects(
              audioBuffer,
              audioCacheKey,
              enabledEffects,
            );

            audioGraph.updateTrackEffects(audioTrack.id, previewAudio.effects);

            const clipLocalTime = timelinePosition - audioClip.startTime;
            const isReverse = speedEngine.isReverse(audioClip.id);
            const transitionFades = getTrackTransitionAudioFades(
              audioTrack,
              audioClip.id,
            );

            let mediaOffset = (audioClip.inPoint || 0) + clipLocalTime;
            if (isReverse) {
              mediaOffset = audioBuffer.duration - mediaOffset;
              mediaOffset = Math.max(0, mediaOffset);
            }

            scheduledClips.push({
              clipId: audioClip.id,
              trackId: audioTrack.id,
              audioBuffer: previewAudio.audioBuffer,
              startTime: audioClip.startTime,
              endTime: clipEnd,
              mediaOffset,
              volume: audioClip.volume ?? 1,
              volumeAutomation: getResolvedClipVolumeAutomation(audioClip),
              keyframes: audioClip.keyframes,
              pan: 0,
              effects: previewAudio.effects,
              speed: audioClip.speed ?? 1,
              fadeIn: Math.max(
                audioClip.fade?.fadeIn ?? 0,
                transitionFades.fadeIn,
              ),
              fadeOut: Math.max(
                audioClip.fade?.fadeOut ?? 0,
                transitionFades.fadeOut,
              ),
            });
          }
        }
      }

      if (scheduledClips.length > 0) {
        await audioGraph.resume();
        audioGraph.scheduleClips(scheduledClips);
      }
    },
    [
      getMediaItem,
      getPreviewAudioBufferForEffects,
      getResolvedClipAudioEffects,
      getResolvedClipVolumeAutomation,
      isMuted,
    ],
  );

  const preDecodeAllAudioBuffers = useCallback(async (): Promise<void> => {
    const tracks = timelineTracksRef.current;
    const audioTracks = tracks.filter((t) => t.type === "audio" && !t.hidden);
    const videoTracks = tracks.filter(
      (t) => (t.type === "video" || t.type === "image") && !t.hidden,
    );

    if (!audioGraphRef.current) {
      audioGraphRef.current = getRealtimeAudioGraph();
    }
    const audioGraph = audioGraphRef.current;
    const audioContext = audioGraph.getAudioContext();

    const allTracks = [...audioTracks, ...videoTracks];

    for (const track of allTracks) {
      for (const clip of track.clips) {
        const cacheKey = getAudioBufferCacheKey(clip.mediaId, clip.audioTrackIndex);
        let audioBuffer: AudioBuffer | null | undefined =
          audioBufferCacheRef.current.get(cacheKey);

        if (!audioBuffer) {
          if (noAudioBufferRef.current.has(cacheKey)) {
            continue;
          }
          const mediaItem = getMediaItem(clip.mediaId);
          if (!mediaItem?.blob) {
            continue;
          }

          try {
            audioBuffer = await loadAudioBuffer(
              audioContext,
              mediaItem.blob,
              clip.audioTrackIndex ?? 0,
            );
            if (audioBuffer) {
              audioBufferCacheRef.current.set(cacheKey, audioBuffer);
            } else {
              noAudioBufferRef.current.add(cacheKey);
            }
          } catch {
            audioBuffer = null;
            noAudioBufferRef.current.add(cacheKey);
          }
        }

        if (audioBuffer) {
          const audioEffects = getResolvedClipAudioEffects(clip).filter(
            (effect: Effect) => effect.enabled,
          );
          if (audioEffects.length > 0) {
            try {
              await getPreviewAudioBufferForEffects(audioBuffer, cacheKey, audioEffects);
            } catch (error) {
              console.warn(
                `[Preview] Failed to pre-process audio effects for clip ${clip.id}:`,
                error,
              );
            }
          }
        }
      }
    }
  }, [getMediaItem, getPreviewAudioBufferForEffects, getResolvedClipAudioEffects]);

  // Pre-warm audio decode caches when the timeline settles after an edit (e.g.
  // moving/adding a clip), so the realtime scheduler finds decoded buffers ready
  // on the first play tick instead of silently dropping clips until a lazy decode
  // lands (~0.5-1s "lag then smooth"). Debounced so it never runs mid-drag, and
  // skipped during playback. preDecodeAllAudioBuffers is idempotent (cached and
  // negatively-cached buffers are no-ops), so re-warming after each edit is cheap.
  const audioWarmupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioWarmupIdleRef = useRef<number | null>(null);
  useEffect(() => {
    if (isPlaying) {
      return;
    }

    if (audioWarmupTimerRef.current) {
      clearTimeout(audioWarmupTimerRef.current);
    }

    audioWarmupTimerRef.current = setTimeout(() => {
      audioWarmupTimerRef.current = null;
      if (isInteractingRef.current) {
        return;
      }

      const warm = () => {
        void preDecodeAllAudioBuffers().catch(() => {});
      };

      const idle = (
        window as Window & {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number;
        }
      ).requestIdleCallback;

      if (typeof idle === "function") {
        audioWarmupIdleRef.current = idle(warm, { timeout: 1000 });
      } else {
        warm();
      }
    }, 250);

    return () => {
      if (audioWarmupTimerRef.current) {
        clearTimeout(audioWarmupTimerRef.current);
        audioWarmupTimerRef.current = null;
      }
    };
  }, [timelineTracks, isPlaying, preDecodeAllAudioBuffers]);

  const getAudioClipsForScheduler = useCallback(
    (time: number): AudioClipSchedule[] => {
      const tracks = timelineTracksRef.current;
      const tracksWithAudio = tracks.filter(
        (t) => (t.type === "audio" || t.type === "video") && !t.hidden && !t.muted,
      );
      const schedules: AudioClipSchedule[] = [];

      for (const track of tracksWithAudio) {
        for (const clip of track.clips) {
          const clipEnd = clip.startTime + clip.duration;
          if (clipEnd <= time || clip.startTime > time + 1) {
            continue;
          }

          const audioBuffer = audioBufferCacheRef.current.get(
            getAudioBufferCacheKey(clip.mediaId, clip.audioTrackIndex),
          );
          if (!audioBuffer) {
            continue;
          }

          const audioEffects = getResolvedClipAudioEffects(clip).filter(
            (e: Effect) => e.enabled,
          );
          const previewEffects = getPreviewAudioEffects(audioEffects);
          const { profileAwareNoiseEffects, realtimeEffects } =
            splitProfileAwareNoiseReductionEffects(previewEffects);
          let scheduleAudioBuffer = audioBuffer;
          let scheduleEffects = previewEffects;

          if (profileAwareNoiseEffects.length > 0) {
            const processedCacheKey = `${getAudioBufferCacheKey(
              clip.mediaId,
              clip.audioTrackIndex,
            )}:profile-denoise:${getAudioEffectSignature(profileAwareNoiseEffects)}`;
            const processedAudioBuffer =
              processedAudioBufferCacheRef.current.get(processedCacheKey);

            if (processedAudioBuffer) {
              scheduleAudioBuffer = processedAudioBuffer;
              scheduleEffects = realtimeEffects;
            }
          }
          const transitionFades = getTrackTransitionAudioFades(track, clip.id);

          schedules.push({
            clipId: clip.id,
            trackId: track.id,
            audioBuffer: scheduleAudioBuffer,
            startTime: clip.startTime,
            endTime: clipEnd,
            mediaOffset: clip.inPoint || 0,
            volume: clip.volume ?? 1,
            volumeAutomation: getResolvedClipVolumeAutomation(clip),
            keyframes: clip.keyframes,
            pan: 0,
            effects: scheduleEffects,
            speed: clip.speed ?? 1,
            fadeIn: Math.max(
              clip.fade?.fadeIn ?? 0,
              transitionFades.fadeIn,
            ),
            fadeOut: Math.max(
              clip.fade?.fadeOut ?? 0,
              transitionFades.fadeOut,
            ),
          });
        }
      }

      return schedules;
    },
    [
      getAudioEffectSignature,
      getResolvedClipAudioEffects,
      getResolvedClipVolumeAutomation,
    ],
  );

  /**
   * Decode a single frame from a clip at a specific time using native video element
   * Native video elements provide reliable hardware-accelerated random-access seeking
   */
  const decodeClipFrame = useCallback(
    async (
      clip: {
        id: string;
        mediaId: string;
        startTime: number;
        inPoint?: number;
      },
      time: number,
      canvasWidth: number,
      canvasHeight: number,
    ): Promise<ImageBitmap | null> => {
      const mediaItem = getMediaItem(clip.mediaId);
      if (!mediaItem?.blob) return null;
      const vidstab = getVidstabEngine();
      const mediaBlob = (vidstab.hasStabilized(clip.id)
        ? vidstab.getStabilizedBlob(clip.id)
        : mediaItem.blob)!;

      if (mediaItem.type === "image") {
        try {
          return await createImageBitmap(mediaItem.blob);
        } catch {
          return null;
        }
      }

      const requestSeq = ++decodeRequestSeqRef.current;
      const isStaleRequest = () => requestSeq !== decodeRequestSeqRef.current;

      if (scrubVideoReleaseTimerRef.current) {
        clearTimeout(scrubVideoReleaseTimerRef.current);
        scrubVideoReleaseTimerRef.current = null;
      }

      if (decodeDebounceRef.current) {
        clearTimeout(decodeDebounceRef.current);
        decodeDebounceRef.current = null;
      }
      decodeDebounceResolveRef.current?.(null);
      decodeDebounceResolveRef.current = null;

      return new Promise<ImageBitmap | null>((resolve) => {
        decodeDebounceResolveRef.current = resolve;
        decodeDebounceRef.current = setTimeout(async () => {
          decodeDebounceRef.current = null;
          decodeDebounceResolveRef.current = null;

          if (isStaleRequest()) {
            resolve(null);
            return;
          }

          try {
            const clipLocalTime = time - clip.startTime;
            const speedEngine = getSpeedEngine();
            const adjustedLocalTime = speedEngine.getSourceTimeAtPlaybackTime(
              clip.id,
              clipLocalTime,
            );
            const isStabilized = vidstab.hasStabilized(clip.id);
            const mediaTime = isStabilized ? adjustedLocalTime : (clip.inPoint || 0) + adjustedLocalTime;
            const cacheKey = isStabilized ? `${clip.mediaId}:stabilized` : clip.mediaId;
            let cached = videoElementCacheRef.current.get(cacheKey);

            if (!cached) {
              const url = URL.createObjectURL(mediaBlob);
              const video = document.createElement("video");
              video.src = url;
              video.muted = true;
              video.playsInline = true;
              video.preload = "metadata";
              video.crossOrigin = "anonymous";

              await new Promise<void>((res, rej) => {
                const timeoutId = setTimeout(
                  () => rej(new Error("Video load timeout")),
                  10000,
                );
                video.onloadedmetadata = () => {
                  clearTimeout(timeoutId);
                  res();
                };
                video.onerror = () => {
                  clearTimeout(timeoutId);
                  rej(new Error("Video load failed"));
                };
              });

              if (isStaleRequest()) {
                releaseVideoElement({ video, url });
                resolve(null);
                return;
              }

              cached = { video, url, lastUsed: Date.now() };
              videoElementCacheRef.current.set(cacheKey, cached);

              while (videoElementCacheRef.current.size > 2) {
                evictOldestVideoElement();
              }
            }

            cached.lastUsed = Date.now();
            const { video } = cached;

            const clampedTime = Math.max(
              0,
              Math.min(mediaTime, video.duration - 0.001),
            );
            const seekTime =
              clampedTime <= 0 && video.duration > 0.002 ? 0.001 : clampedTime;
            if (
              Math.abs(video.currentTime - seekTime) > 0.01 ||
              video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            ) {
              video.currentTime = seekTime;
              await new Promise<void>((res) => {
                let settled = false;
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const onSeeked = () => {
                  if (settled) return;
                  settled = true;
                  if (timeoutId) clearTimeout(timeoutId);
                  video.removeEventListener("seeked", onSeeked);
                  res();
                };
                video.addEventListener("seeked", onSeeked);
                timeoutId = setTimeout(() => {
                  if (settled) return;
                  settled = true;
                  video.removeEventListener("seeked", onSeeked);
                  res();
                }, 250);
              });
            }

            if (isStaleRequest()) {
              resolve(null);
              return;
            }

            await new Promise<void>((res) => {
              if (!("requestVideoFrameCallback" in video)) {
                res();
                return;
              }

              let settled = false;
              let timeoutId: ReturnType<typeof setTimeout> | null = null;
              const finish = () => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                res();
              };

              video.requestVideoFrameCallback(finish);
              timeoutId = setTimeout(finish, 300);
            });

            if (isStaleRequest()) {
              resolve(null);
              return;
            }

            await new Promise<void>((res) => {
              if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                res();
                return;
              }

              let settled = false;
              let timeoutId: ReturnType<typeof setTimeout> | null = null;
              const finish = () => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                video.removeEventListener("loadeddata", finish);
                video.removeEventListener("canplay", finish);
                res();
              };

              video.addEventListener("loadeddata", finish);
              video.addEventListener("canplay", finish);
              timeoutId = setTimeout(finish, 250);
            });

            if (isStaleRequest()) {
              resolve(null);
              return;
            }

            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = canvasWidth;
            tempCanvas.height = canvasHeight;
            const tempCtx = tempCanvas.getContext("2d");
            if (!tempCtx) {
              resolve(null);
              return;
            }

            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = canvasWidth / canvasHeight;
            let drawWidth = canvasWidth;
            let drawHeight = canvasHeight;
            let offsetX = 0;
            let offsetY = 0;

            if (videoAspect > canvasAspect) {
              drawHeight = canvasWidth / videoAspect;
              offsetY = (canvasHeight - drawHeight) / 2;
            } else {
              drawWidth = canvasHeight * videoAspect;
              offsetX = (canvasWidth - drawWidth) / 2;
            }

            if (
              canvasFillModeRef.current === "blur" &&
              video.videoWidth > 0 &&
              video.videoHeight > 0
            ) {
              drawBlurredBackdrop(
                tempCtx,
                video,
                video.videoWidth,
                video.videoHeight,
                canvasWidth,
                canvasHeight,
              );
            } else {
              tempCtx.fillStyle = previewBgRef.current;
              tempCtx.fillRect(0, 0, canvasWidth, canvasHeight);
            }
            tempCtx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

            const frame = await createImageBitmap(tempCanvas);
            if (isStaleRequest()) {
              frame.close();
              resolve(null);
              return;
            }
            scheduleScrubVideoRelease();
            resolve(frame);
          } catch {
            const cached = videoElementCacheRef.current.get(clip.mediaId);
            if (cached) {
              releaseVideoElement(cached);
              videoElementCacheRef.current.delete(clip.mediaId);
            }
            scheduleScrubVideoRelease();
            resolve(null);
          }
        }, 50);
      });
    },
    [
      evictOldestVideoElement,
      getMediaItem,
      releaseVideoElement,
      scheduleScrubVideoRelease,
    ],
  );

  // Fills the preview canvas behind the clip. A project "color" canvas fill
  // paints the chosen color; otherwise the theme bar color (black/white). The
  // "blur" backdrop is NOT painted here — it needs the actual decoded base
  // frame, which is only available mid-render, so each render path draws it
  // inline via drawBlurredBackdrop right after decoding the base clip.
  const fillPreviewBackground = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      _time: number,
      width: number,
      height: number,
    ): void => {
      if (canvasFillModeRef.current === "color" && canvasFillColorRef.current) {
        ctx.fillStyle = canvasFillColorRef.current;
      } else {
        ctx.fillStyle = previewBgRef.current;
      }
      ctx.fillRect(0, 0, width, height);
    },
    [],
  );

  // Render a single frame using MediaBunny (for scrubbing/seeking)
  const renderFrameDirectly = useCallback(
    async (time: number): Promise<boolean> => {
      const canvas = canvasRef.current;
      if (!canvas) return false;

      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = previewRes.width;
        canvas.height = previewRes.height;
      }

      const mainCtx = canvas.getContext("2d");
      if (!mainCtx) return false;

      // Compound clips are full nested timelines rather than media blobs.
      // Route those frames through the canonical compositor so preview and
      // export share identical nesting, timing, effects and transforms.
      const hasActiveCompound = timelineTracks.some((track) =>
        !track.hidden &&
        track.clips.some(
          (clip) =>
            typeof clip.metadata?.compoundClipId === "string" &&
            time >= clip.startTime &&
            time < clip.startTime + clip.duration,
        ),
      );
      if (hasActiveCompound) {
        const frame = await getRenderBridge().renderFrame(time);
        if (frame) {
          mainCtx.clearRect(0, 0, canvas.width, canvas.height);
          mainCtx.drawImage(frame.image, 0, 0, canvas.width, canvas.height);
          return true;
        }
      }

      if (
        !offscreenCanvasRef.current ||
        offscreenCanvasRef.current.width !== canvas.width ||
        offscreenCanvasRef.current.height !== canvas.height
      ) {
        offscreenCanvasRef.current = new OffscreenCanvas(
          canvas.width,
          canvas.height,
        );
        offscreenCtxRef.current = offscreenCanvasRef.current.getContext(
          "2d",
        ) as OffscreenCanvasRenderingContext2D;
      }

      const ctx =
        offscreenCtxRef.current as unknown as CanvasRenderingContext2D;
      if (!ctx) return false;

      const videoTracks = timelineTracks.filter(
        (t) => (t.type === "video" || t.type === "image") && !t.hidden,
      );

      let hasRenderedFrame = false;
      let shouldClearCanvas = true;
      const hadBackground = Boolean(lastGoodFrameRef.current);
      if (lastGoodFrameRef.current) {
        ctx.drawImage(
          lastGoodFrameRef.current,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        shouldClearCanvas = false;
      }

      const activeShapeClips = getActiveShapeClips(allShapeClips, time);
      const activeTextClips = getActiveTextClips(allTextClips, time);
      const hasActiveClipMasks = videoTracks.some((track) =>
        track.clips.some(
          (clip) =>
            clipMasksById.has(clip.id) &&
            time >= clip.startTime &&
            time < clip.startTime + clip.duration,
        ),
      );
      if (hasActiveClipMasks) {
        // A masked layer contains transparent pixels. Reusing the previous full
        // frame underneath would make those pixels appear unmasked, so start
        // from the actual composition background before drawing the layer.
        fillPreviewBackground(ctx, time, canvas.width, canvas.height);
        shouldClearCanvas = false;
      }

      const transitionInfo = getTransitionAtTime(time, timelineTracks);

      if (transitionInfo) {
        try {
          const clipAFrame = await decodeClipFrame(
            transitionInfo.clipA,
            time,
            canvas.width,
            canvas.height,
          );
          const clipBFrame = transitionInfo.clipB
            ? await decodeClipFrame(
                transitionInfo.clipB,
                time,
                canvas.width,
                canvas.height,
              )
            : null;
          const blankFrame = transitionInfo.clipB
            ? null
            : await createTransparentImageBitmap(canvas.width, canvas.height);
          const closeOnce = (() => {
            const closed = new Set<ImageBitmap>();
            return (bitmap: ImageBitmap | null | undefined) => {
              if (!bitmap || closed.has(bitmap)) return;
              closed.add(bitmap);
              bitmap.close();
            };
          })();

          if (clipAFrame && (clipBFrame || blankFrame)) {
            const processedA = await applyEffectsToFrame(
              transitionInfo.clipA.id,
              clipAFrame,
            );
            const processedB =
              transitionInfo.clipB && clipBFrame
                ? await applyEffectsToFrame(transitionInfo.clipB.id, clipBFrame)
                : null;

            const validA =
              processedA.width > 0 && processedA.height > 0
                ? processedA
                : clipAFrame;
            const validB =
              processedB && processedB.width > 0 && processedB.height > 0
                ? processedB
                : clipBFrame;
            const outgoingTransitionFrame =
              transitionInfo.clipB || transitionInfo.edge !== "in"
                ? validA
                : blankFrame;
            const incomingTransitionFrame = transitionInfo.clipB
              ? validB
              : transitionInfo.edge === "in"
                ? validA
                : blankFrame;

            const blendedFrame =
              outgoingTransitionFrame && incomingTransitionFrame
                ? await renderTransitionFrame(
                    transitionInfo,
                    outgoingTransitionFrame,
                    incomingTransitionFrame,
                  )
                : null;

            if (
              blendedFrame &&
              blendedFrame.width > 0 &&
              blendedFrame.height > 0
            ) {
              if (shouldClearCanvas) {
                fillPreviewBackground(ctx, time, canvas.width, canvas.height);
                shouldClearCanvas = false;
              }
              await renderOverlayClipsInTrackOrder(
                ctx,
                timelineTracks,
                activeShapeClips,
                activeTextClips,
                time,
                canvas.width,
                canvas.height,
                "below-video",
              );
              ctx.drawImage(blendedFrame, 0, 0);
              await renderOverlayClipsInTrackOrder(
                ctx,
                timelineTracks,
                activeShapeClips,
                activeTextClips,
                time,
                canvas.width,
                canvas.height,
                "above-video",
                hasBehindSubjectText(activeTextClips) ? blendedFrame : null,
              );
              if (processedA !== clipAFrame) closeOnce(processedA);
              if (processedB && processedB !== clipBFrame) closeOnce(processedB);
              closeOnce(clipAFrame);
              closeOnce(clipBFrame);
              closeOnce(blankFrame);
              if (
                blendedFrame !== validA &&
                blendedFrame !== validB &&
                blendedFrame !== blankFrame
              ) {
                closeOnce(blendedFrame);
              }
              hasRenderedFrame = true;
            }
            if (processedA !== clipAFrame) closeOnce(processedA);
            if (processedB && processedB !== clipBFrame) closeOnce(processedB);
            closeOnce(clipAFrame);
            closeOnce(clipBFrame);
            closeOnce(blankFrame);
            if (
              blendedFrame &&
              blendedFrame !== validA &&
              blendedFrame !== validB &&
              blendedFrame !== blankFrame
            ) {
              closeOnce(blendedFrame);
            }
          } else if (clipAFrame) {
            const processed = await applyEffectsToFrame(
              transitionInfo.clipA.id,
              clipAFrame,
            );
            const validFrame =
              processed.width > 0 && processed.height > 0
                ? processed
                : clipAFrame;
            if (shouldClearCanvas) {
              fillPreviewBackground(ctx, time, canvas.width, canvas.height);
              shouldClearCanvas = false;
            }
            await renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "below-video",
            );
            ctx.drawImage(validFrame, 0, 0);
            await renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "above-video",
              hasBehindSubjectText(activeTextClips) ? validFrame : null,
            );
            if (processed !== clipAFrame) {
              closeOnce(processed);
            }
            closeOnce(clipAFrame);
            hasRenderedFrame = true;
          } else if (clipBFrame && transitionInfo.clipB) {
            const processed = await applyEffectsToFrame(
              transitionInfo.clipB.id,
              clipBFrame,
            );
            const validFrame =
              processed.width > 0 && processed.height > 0
                ? processed
                : clipBFrame;
            if (shouldClearCanvas) {
              fillPreviewBackground(ctx, time, canvas.width, canvas.height);
              shouldClearCanvas = false;
            }
            await renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "below-video",
            );
            ctx.drawImage(validFrame, 0, 0);
            await renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "above-video",
              hasBehindSubjectText(activeTextClips) ? validFrame : null,
            );
            if (processed !== clipBFrame) {
              closeOnce(processed);
            }
            closeOnce(clipBFrame);
            hasRenderedFrame = true;
          }
          closeOnce(blankFrame);
        } catch (error) {
          console.warn("[Preview] Transition render failed:", error);
        }
      }

      if (!hasRenderedFrame) {
        const hasVideoContent = videoTracks.some((track) =>
          track.clips.some(
            (clip) =>
              time >= clip.startTime && time < clip.startTime + clip.duration,
          ),
        );
        const hasMotionContent = hasActiveMotionInstances(time);

        if (
          shouldClearCanvas &&
          (hasVideoContent ||
            hasMotionContent ||
            activeShapeClips.length > 0 ||
            activeTextClips.length > 0)
        ) {
          if (hasVideoContent) {
            fillPreviewBackground(ctx, time, canvas.width, canvas.height);
          } else {
            ctx.fillStyle = isDark ? "#0f0f11" : "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          shouldClearCanvas = false;
        }

        // Render ALL tracks in layer order using painter's algorithm
        // Higher index = rendered first (appears behind), Lower index = rendered last (appears on top)
        const allRenderableTracks = timelineTracks
          .map((track, idx) => ({ track, originalIndex: idx }))
          .filter(
            ({ track }) =>
              (track.type === "video" ||
                track.type === "image" ||
                track.type === "text" ||
                track.type === "graphics") &&
              !track.hidden,
          )
          .sort((a, b) => b.originalIndex - a.originalIndex);

        let subjectFrame: ImageBitmap | null = null;
        const shouldCompositeSubject = hasBehindSubjectText(activeTextClips);
        let blurBackdropDrawn = false;

        for (const { track } of allRenderableTracks) {
          if (track.type === "video" || track.type === "image") {
            for (const clip of track.clips) {
              const clipStart = clip.startTime;
              const clipEnd = clip.startTime + clip.duration;

              if (time >= clipStart && time < clipEnd) {
                const frame = await decodeClipFrame(
                  clip,
                  time,
                  canvas.width,
                  canvas.height,
                );

                if (frame) {
                  // Blur canvas fill for images: decodeClipFrame returns a raw
                  // (un-letterboxed) bitmap for images, so paint it cover-fit +
                  // blurred behind everything before the contained clip is drawn
                  // on top. Video frames are canvas-sized and already carry the
                  // blurred backdrop baked in by decodeClipFrame.
                  if (
                    canvasFillModeRef.current === "blur" &&
                    !blurBackdropDrawn &&
                    getMediaItem(clip.mediaId)?.type === "image"
                  ) {
                    drawBlurredBackdrop(
                      ctx,
                      frame,
                      frame.width,
                      frame.height,
                      canvas.width,
                      canvas.height,
                    );
                    blurBackdropDrawn = true;
                  }
                  const clipLocalTime = time - clip.startTime;
                  const speedEngine = getSpeedEngine();
                  const adjustedLocalTime = speedEngine.getSourceTimeAtPlaybackTime(
                    clip.id,
                    clipLocalTime,
                  );
                  const sourceTime = Math.max(
                    clip.inPoint,
                    Math.min(clip.outPoint, clip.inPoint + adjustedLocalTime),
                  );
                  let animatedTransform = scaleTransformPositionForPreview(
                    getAnimatedTransform(
                      clip.transform as ClipTransform,
                      clip.keyframes,
                      clipLocalTime,
                    ),
                    previewRes.scale,
                  );

                  if (
                    clip.emphasisAnimation &&
                    clip.emphasisAnimation.type !== "none"
                  ) {
                    const emphasisState = applyEmphasisAnimation(
                      clip.emphasisAnimation,
                      clipLocalTime,
                    );
                    animatedTransform = {
                      ...animatedTransform,
                      opacity:
                        animatedTransform.opacity * emphasisState.opacity,
                      scale: {
                        x:
                          animatedTransform.scale.x *
                          emphasisState.scale *
                          emphasisState.scaleX,
                        y:
                          animatedTransform.scale.y *
                          emphasisState.scale *
                          emphasisState.scaleY,
                      },
                      position: {
                        x:
                          animatedTransform.position.x +
                          emphasisState.offsetX * canvas.width,
                        y:
                          animatedTransform.position.y +
                          emphasisState.offsetY * canvas.height,
                      },
                      rotation:
                        animatedTransform.rotation + emphasisState.rotation,
                    };
                  }

                  const stabilizedTransform = applyStabilizationTransform(
                    clip,
                    animatedTransform,
                    sourceTime,
                    canvas.width,
                    canvas.height,
                    frame.width,
                    frame.height,
                  );

                  const nativeCssFilter = clipCssFilterOnly(clip.id);
                  const gradeKeyframes = evaluateKeyframesAt(
                    clip.keyframes,
                    clipLocalTime,
                  );
                  const hasGradeOverride =
                    gradeKeyframes.has("colorGrade.temperature") ||
                    gradeKeyframes.has("colorGrade.tint");
                  if (hasGradeOverride) {
                    const override: Partial<{
                      temperature: number;
                      tint: number;
                    }> = {};
                    const temperature = gradeKeyframes.get(
                      "colorGrade.temperature",
                    );
                    const tint = gradeKeyframes.get("colorGrade.tint");
                    if (temperature !== undefined) {
                      override.temperature = temperature;
                    }
                    if (tint !== undefined) {
                      override.tint = tint;
                    }
                    getEffectsBridge().setColorGradingOverride(
                      clip.id,
                      override,
                    );
                  }

                  let processedFrame: ImageBitmap | null = null;
                  try {
                    if (nativeCssFilter) {
                      await drawClipFrame(
                        ctx,
                        clip.id,
                        frame,
                        stabilizedTransform,
                        canvas.width,
                        canvas.height,
                        time,
                        nativeCssFilter,
                      );
                      hasRenderedFrame = true;
                    } else {
                      processedFrame = await applyEffectsToFrame(clip.id, frame);
                      if (processedFrame.width > 0 && processedFrame.height > 0) {
                        await drawClipFrame(
                          ctx,
                          clip.id,
                          processedFrame,
                          stabilizedTransform,
                          canvas.width,
                          canvas.height,
                          time,
                        );
                        hasRenderedFrame = true;
                      } else {
                        await drawClipFrame(
                          ctx,
                          clip.id,
                          frame,
                          stabilizedTransform,
                          canvas.width,
                          canvas.height,
                          time,
                        );
                        hasRenderedFrame = true;
                      }
                    }
                  } catch {
                    await drawClipFrame(
                      ctx,
                      clip.id,
                      frame,
                      stabilizedTransform,
                      canvas.width,
                      canvas.height,
                      time,
                    );
                    hasRenderedFrame = true;
                  } finally {
                    if (hasGradeOverride) {
                      getEffectsBridge().clearColorGradingOverride(clip.id);
                    }
                    if (processedFrame && processedFrame !== frame) {
                      processedFrame.close();
                    }
                  }

                  if (shouldCompositeSubject) {
                    subjectFrame?.close();
                    subjectFrame = await captureSubjectFrame(
                      ctx,
                      canvas.width,
                      canvas.height,
                    );
                  }
                  frame.close();
                }
              }
            }
          } else if (track.type === "graphics") {
            const trackShapeClips = activeShapeClips.filter(
              (sc) => sc.trackId === track.id,
            );
            for (const shapeClip of trackShapeClips) {
              await renderShapeClipWithEffects(
                ctx,
                shapeClip,
                canvas.width,
                canvas.height,
                time,
              );
              hasRenderedFrame = true;
            }
            if (
              await renderMotionInstancesForTrack(
                ctx,
                track,
                time,
                canvas.width,
                canvas.height,
              )
            ) {
              hasRenderedFrame = true;
            }
          } else if (track.type === "text") {
            const trackTextClips = activeTextClips.filter(
              (tc) => tc.trackId === track.id,
            );
            for (const textClip of trackTextClips) {
              await renderTextClipWithSubjectMask(
                ctx,
                textClip,
                canvas.width,
                canvas.height,
                time,
                subjectFrame,
                isPlaying,
                getBehindSubjectStreamId(timelineTracks, time),
              );

              hasRenderedFrame = true;
            }
          }
        }
        subjectFrame?.close();
      }

      const activeSubtitles = getActiveSubtitles(allSubtitles, time);
      if (activeSubtitles.length > 0 && ctx) {
        for (const subtitle of activeSubtitles) {
          renderSubtitleToCanvas(
            ctx,
            subtitle,
            canvas.width,
            canvas.height,
            time,
          );
        }
      }

      if (ctx && offscreenCanvasRef.current) {
        const adjusted = await applyPreviewAdjustmentLayers(
          offscreenCanvasRef.current,
          ctx,
          project.adjustmentLayers ?? [],
          time,
        );
        hasRenderedFrame = hasRenderedFrame || adjusted;
      }

      if (hasRenderedFrame && offscreenCanvasRef.current) {
        mainCtx.clearRect(0, 0, canvas.width, canvas.height);
        mainCtx.drawImage(offscreenCanvasRef.current, 0, 0);
        try {
          lastGoodFrameRef.current?.close();
          lastGoodFrameRef.current = await createImageBitmap(
            offscreenCanvasRef.current,
          );
        } catch {}
        return true;
      }

      const hasActiveContent =
        videoTracks.some((track) =>
          track.clips.some(
            (clip) =>
              time >= clip.startTime && time < clip.startTime + clip.duration,
          ),
        ) ||
        hasActiveMotionInstances(time) ||
        activeShapeClips.length > 0 ||
        activeTextClips.length > 0;

      if (hadBackground && hasActiveContent && offscreenCanvasRef.current) {
        mainCtx.clearRect(0, 0, canvas.width, canvas.height);
        mainCtx.drawImage(offscreenCanvasRef.current, 0, 0);
        return true;
      }

      return hasRenderedFrame;
    },
    [
      timelineTracks,
      getMediaItem,
      decodeClipFrame,
      previewRes.width,
      previewRes.height,
      previewRes.scale,
      allTextClips,
      allShapeClips,
      allSubtitles,
      renderOverlayClipsInTrackOrder,
      renderMotionInstancesForTrack,
      hasActiveMotionInstances,
      clipMasksById,
      drawClipFrame,
      fillPreviewBackground,
      isDark,
      isPlaying,
      project.adjustmentLayers,
    ],
  );

  const renderFrameDirectlyRef = useRef(renderFrameDirectly);
  useEffect(() => {
    renderFrameDirectlyRef.current = renderFrameDirectly;
  }, [renderFrameDirectly]);

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const playheadPositionRef = useRef(playheadPosition);
  useEffect(() => {
    playheadPositionRef.current = playheadPosition;
  }, [playheadPosition]);

  useEffect(() => {
    setImageLoadCallback(() => {
      if (!isPlayingRef.current) {
        renderFrameDirectlyRef.current(playheadPositionRef.current);
      }
    });
    return () => setImageLoadCallback(null);
  }, []);

  const renderFallbackFrame = useCallback(
    async (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = previewRes.width;
        canvas.height = previewRes.height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const emptyBg = isDark ? "#0f0f11" : "#ffffff";
      const emptyText = isDark ? "#52525b" : "#a1a1aa";
      const textPrimary = isDark ? "#ffffff" : "#18181b";
      const textSecondary = isDark ? "#a1a1aa" : "#71717a";

      const activeShapeClips = getActiveShapeClips(allShapeClips, time);
      const activeTextClips = getActiveTextClips(allTextClips, time);

      const videoTracks = timelineTracks.filter(
        (t) => (t.type === "video" || t.type === "image") && !t.hidden,
      );

      const hasVideoContent = videoTracks.some((track) =>
        track.clips.some(
          (clip) =>
            time >= clip.startTime && time < clip.startTime + clip.duration,
        ),
      );

      ctx.fillStyle = hasVideoContent
        ? isDark
          ? "#18181b"
          : "#f4f4f5"
        : emptyBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let hasRenderedContent = false;

      const allRenderableTracks = timelineTracks
        .map((track, idx) => ({ track, originalIndex: idx }))
        .filter(
          ({ track }) =>
            (track.type === "video" ||
              track.type === "image" ||
              track.type === "text" ||
              track.type === "graphics") &&
            !track.hidden,
        )
        .sort((a, b) => b.originalIndex - a.originalIndex);

      for (const { track } of allRenderableTracks) {
        if (track.type === "video" || track.type === "image") {
          for (const clip of track.clips) {
            const clipStart = clip.startTime;
            const clipEnd = clip.startTime + clip.duration;

            if (time >= clipStart && time < clipEnd) {
              const mediaItem = getMediaItem(clip.mediaId);
              if (mediaItem) {
                hasRenderedContent = true;
                ctx.fillStyle = textPrimary;
                ctx.font = "bold 24px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(
                  mediaItem.name,
                  canvas.width / 2,
                  canvas.height / 2,
                );
                ctx.font = "16px Inter, sans-serif";
                ctx.fillStyle = textSecondary;
                ctx.fillText(
                  `${formatTime(time)} / ${formatTime(clip.duration)}`,
                  canvas.width / 2,
                  canvas.height / 2 + 30,
                );
              } else if ((clip as ClipWithPlaceholder).isPlaceholder) {
                hasRenderedContent = true;
                ctx.fillStyle = textSecondary;
                ctx.font = "bold 20px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(
                  "Drop media here",
                  canvas.width / 2,
                  canvas.height / 2,
                );
                ctx.font = "14px Inter, sans-serif";
                ctx.fillStyle = emptyText;
                ctx.fillText(
                  "Replace this placeholder with your content",
                  canvas.width / 2,
                  canvas.height / 2 + 28,
                );
              }
            }
          }
        } else if (track.type === "graphics") {
          const trackShapeClips = activeShapeClips.filter(
            (sc) => sc.trackId === track.id,
          );
          for (const shapeClip of trackShapeClips) {
            await renderShapeClipWithEffects(
              ctx,
              shapeClip,
              canvas.width,
              canvas.height,
              time,
            );
            hasRenderedContent = true;
          }
        } else if (track.type === "text") {
          const trackTextClips = activeTextClips.filter(
            (tc) => tc.trackId === track.id,
          );
          for (const textClip of trackTextClips) {
            await renderTextClipWithSubjectMask(
              ctx,
              textClip,
              canvas.width,
              canvas.height,
              time,
              null,
              isPlaying,
              getBehindSubjectStreamId(timelineTracks, time),
            );
            hasRenderedContent = true;
          }
        }
      }

      const activeSubtitles = getActiveSubtitles(allSubtitles, time);
      for (const subtitle of activeSubtitles) {
        renderSubtitleToCanvas(
          ctx,
          subtitle,
          canvas.width,
          canvas.height,
          time,
        );
      }

      const audioTracks = timelineTracks.filter(
        (t) => t.type === "audio" && !t.hidden,
      );
      const hasActiveAudioClip = audioTracks.some((track) =>
        track.clips.some(
          (clip) =>
            time >= clip.startTime && time < clip.startTime + clip.duration,
        ),
      );

      if (
        !hasRenderedContent &&
        activeTextClips.length === 0 &&
        activeShapeClips.length === 0 &&
        !hasActiveMotionInstances(time) &&
        !hasActiveAudioClip
      ) {
        ctx.fillStyle = emptyText;
        ctx.font = "24px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          "Import media to get started",
          canvas.width / 2,
          canvas.height / 2,
        );
      }
    },
    [
      timelineTracks,
      getMediaItem,
      previewRes.width,
      previewRes.height,
      allTextClips,
      allShapeClips,
      allSubtitles,
      hasActiveMotionInstances,
      isDark,
      isPlaying,
    ],
  );

  // Check if we can use native video element playback (much faster, hardware-accelerated)
  const canUseNativeVideoPlayback = useCallback(
    (
      startPosition: number,
    ): {
      canUse: boolean;
      clips: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>;
      }>;
      imageClips?: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        trackIndex: number;
      }>;
    } => {
      const tracks = timelineTracks;
      if (
        tracks.some(
          (track) =>
            !track.hidden &&
            track.clips.some(
              (clip) =>
                clip.startTime + clip.duration > startPosition &&
                typeof clip.metadata?.compoundClipId === "string",
            ),
        )
      ) {
        return { canUse: false, clips: [] };
      }
      const videoTracks = tracks.filter((t) => t.type === "video" && !t.hidden);

      const allVideoClips: Array<{
        clip: (typeof tracks)[0]["clips"][0];
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>;
      }> = [];
      const speedEngine = getSpeedEngine();

      for (const track of videoTracks) {
        for (const clip of track.clips) {
          if (clip.startTime + clip.duration > startPosition) {
            if (clipMasksById.has(clip.id)) {
              return { canUse: false, clips: [] };
            }
            const mediaItem = getMediaItem(clip.mediaId);
            if (mediaItem?.blob && mediaItem.type === "video") {
              const clipSpeed = speedEngine.getClipSpeed(clip.id);
              const isReverse = speedEngine.isReverse(clip.id);
              if (
                clipSpeed !== 1 ||
                isReverse ||
                (clipNeedsFrameProcessing(clip.id, clip.keyframes) &&
                  clipCssFilterOnly(clip.id) === null)
              ) {
                return { canUse: false, clips: [] };
              }
              allVideoClips.push({ clip, mediaItem });
            }
          }
        }
      }

      const hasActiveAudioEffects = tracks.some(
        (track) =>
          (track.type === "audio" || track.type === "video") &&
          !track.hidden &&
          track.clips.some((clip) => {
            if (clip.startTime + clip.duration <= startPosition) {
              return false;
            }

            return getPreviewAudioEffects(
              getResolvedClipAudioEffects(clip),
            ).some(
              (effect) => effect.enabled,
            );
          }),
      );

      if (hasActiveAudioEffects) {
        return { canUse: false, clips: [] };
      }

      if (allVideoClips.length === 0) return { canUse: false, clips: [] };

      allVideoClips.sort((a, b) => a.clip.startTime - b.clip.startTime);

      // Check for overlapping clips (multi-layer) - can't use native playback for compositing
      for (let i = 0; i < allVideoClips.length - 1; i++) {
        const current = allVideoClips[i];
        const next = allVideoClips[i + 1];
        const currentEnd = current.clip.startTime + current.clip.duration;
        if (next.clip.startTime < currentEnd) {
          return { canUse: false, clips: [] };
        }
      }

      // Note: Text/graphics overlays are now supported in native video playback
      // They are rendered using CPU canvas2D after the video frame

      // Collect image clips for background compositing (don't disable native playback)
      const imageTracks = tracks.filter((t) => t.type === "image" && !t.hidden);
      const imageClips: Array<{
        clip: (typeof tracks)[0]["clips"][0];
        trackIndex: number;
      }> = [];
      imageTracks.forEach((track) => {
        const trackIndex = tracks.indexOf(track);
        for (const clip of track.clips) {
          imageClips.push({ clip, trackIndex });
        }
      });

      if (imageClips.some(({ clip }) => clipMasksById.has(clip.id))) {
        return { canUse: false, clips: [] };
      }

      return { canUse: true, clips: allVideoClips, imageClips };
    },
    [
      timelineTracks,
      getMediaItem,
      allTextClips,
      allShapeClips,
      getResolvedClipAudioEffects,
      clipMasksById,
    ],
  );

  // Start native video playback using hardware-accelerated video elements (handles multiple clips)
  const startNativeVideoPlayback = useCallback(
    async (
      clips: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>;
      }>,
      imageClips: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        trackIndex: number;
      }>,
      startPosition: number,
      onEnd: () => void,
    ): Promise<() => void> => {
      const canvas = canvasRef.current;
      if (!canvas || clips.length === 0) {
        onEnd();
        return () => {};
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onEnd();
        return () => {};
      }

      nativePlaybackActiveRef.current = true;

      const imageBitmapCache = nativeImageBitmapCacheRef.current;
      for (const { clip } of imageClips) {
        if (imageBitmapCache.has(clip.id)) {
          continue;
        }
        const mediaItem = getMediaItem(clip.mediaId);
        if (mediaItem?.type === "image" && mediaItem.blob) {
          try {
            const bitmap = await createImageBitmap(mediaItem.blob);
            imageBitmapCache.set(clip.id, bitmap);
          } catch (error) {
            console.warn(`Failed to cache image bitmap for ${clip.id}:`, error);
          }
        }
      }

      preDecodeAllAudioBuffers().catch((error) => {
        console.warn("[Preview] Audio warmup failed:", error);
      });

      const videoCache = nativeVideoCacheRef.current;
      const loadingVideos = new Map<string, Promise<void>>();

      const loadVideoForClip = (
        clip: (typeof timelineTracks)[0]["clips"][0],
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>,
      ): Promise<void> => {
        const vidstabCheck = getVidstabEngine();
        const clipStabilized = vidstabCheck.hasStabilized(clip.id);
        const videoCacheId = clipStabilized ? `stabilized:${clip.id}` : clip.mediaId;

        const existingLoad = loadingVideos.get(videoCacheId);
        if (existingLoad) {
          return existingLoad;
        }

        const cachedVideo = videoCache.get(videoCacheId)?.video;
        if (cachedVideo) {
          if (cachedVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            return Promise.resolve();
          }
        }

        if (!mediaItem.blob) {
          return Promise.resolve();
        }

        const vidstabEng = getVidstabEngine();
        const isStabilized = vidstabEng.hasStabilized(clip.id);
        const playBlob = (isStabilized
          ? vidstabEng.getStabilizedBlob(clip.id)
          : mediaItem.blob)!;
        const cacheId = isStabilized ? `stabilized:${clip.id}` : clip.mediaId;
        const url = URL.createObjectURL(playBlob);
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";

        videoCache.set(cacheId, { video, url });

        const loadPromise = new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            video.onloadedmetadata = null;
            video.onloadeddata = null;
            video.oncanplay = null;
            video.onerror = null;
            loadingVideos.delete(cacheId);
            resolve();
          };
          video.onloadeddata = finish;
          video.oncanplay = finish;
          video.onloadedmetadata = () => {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              finish();
            }
          };
          video.onerror = finish;
          video.load();
          setTimeout(finish, 1200);
        });

        loadingVideos.set(cacheId, loadPromise);
        return loadPromise;
      };

      const activeStartClip = clips.find(
        ({ clip }) =>
          startPosition >= clip.startTime &&
          startPosition < clip.startTime + clip.duration,
      );
      if (activeStartClip) {
        await loadVideoForClip(activeStartClip.clip, activeStartClip.mediaItem);
      }

      for (const entry of clips) {
        if (entry !== activeStartClip) {
          loadVideoForClip(entry.clip, entry.mediaItem).catch(() => {});
        }
      }

      const masterClock = getMasterClock();
      masterClock.setDuration(actualEndTime);
      masterClock.seek(startPosition);

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setPreviewMuted(isMuted);

      const tracksWithAudio = timelineTracks.filter(
        (t) => (t.type === "audio" || t.type === "video") && !t.hidden,
      );
      for (const audioTrack of tracksWithAudio) {
        audioGraph.createTrack({
          trackId: audioTrack.id,
          volume: 1,
          pan: 0,
          muted: audioTrack.muted || false,
          solo: audioTrack.solo || false,
          effects: [],
        });
      }

      await audioGraph.resume();
      audioGraph.seekTo(startPosition);

      let isActive = true;
      let rafId: number | null = null;
      let currentClipId: string | null = null;

      const findClipAtTime = (time: number) => {
        for (const { clip, mediaItem } of clips) {
          if (time >= clip.startTime && time < clip.startTime + clip.duration) {
            return { clip, mediaItem };
          }
        }
        return null;
      };

      const findNextNativeClip = (clipId: string) => {
        const sorted = [...clips].sort((a, b) => a.clip.startTime - b.clip.startTime);
        const index = sorted.findIndex(({ clip }) => clip.id === clipId);
        return index >= 0 ? sorted[index + 1] ?? null : null;
      };

      const findNativeClipById = (clipId: string) =>
        clips.find(({ clip }) => clip.id === clipId) ?? null;

      const waitForDrawableVideoFrame = async (
        video: HTMLVideoElement,
        timeoutMs = 300,
      ): Promise<void> => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          return;
        }

        await new Promise<void>((resolve) => {
          let settled = false;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (timeoutId) clearTimeout(timeoutId);
            video.removeEventListener("loadeddata", finish);
            video.removeEventListener("canplay", finish);
            resolve();
          };
          video.addEventListener("loadeddata", finish);
          video.addEventListener("canplay", finish);
          timeoutId = setTimeout(finish, timeoutMs);
        });
      };

      const syncVideoToClipTime = async (
        video: HTMLVideoElement,
        clip: (typeof clips)[0]["clip"],
        time: number,
      ): Promise<void> => {
        const speedEngine = getSpeedEngine();
        const localTime = Math.max(
          0,
          Math.min(clip.duration, time - clip.startTime),
        );
        const adjustedLocalTime = speedEngine.getSourceTimeAtPlaybackTime(
          clip.id,
          localTime,
        );
        const sourceTime = Math.max(
          clip.inPoint,
          Math.min(clip.outPoint, clip.inPoint + adjustedLocalTime),
        );
        const vidstabPlay = getVidstabEngine();
        const videoTime = vidstabPlay.hasStabilized(clip.id)
          ? sourceTime - clip.inPoint
          : sourceTime;

        let needsDrawableWait = video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA;
        if (Math.abs(video.currentTime - videoTime) > 0.1) {
          needsDrawableWait = true;
          await new Promise<void>((resolve) => {
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const finish = () => {
              if (settled) return;
              settled = true;
              if (timeoutId) clearTimeout(timeoutId);
              video.removeEventListener("seeked", finish);
              resolve();
            };
            video.addEventListener("seeked", finish);
            timeoutId = setTimeout(finish, 250);
            video.currentTime = videoTime;
          });
        } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          needsDrawableWait = true;
          video.currentTime = videoTime;
        }

        if (needsDrawableWait) {
          await waitForDrawableVideoFrame(video);
        }
      };

      const playVideoElement = async (video: HTMLVideoElement): Promise<void> => {
        video.playbackRate = rateRef.current;
        if (!video.paused) {
          return;
        }
        try {
          await video.play();
        } catch {
          // The canvas renderer can still draw the current frame if autoplay is blocked.
        }
      };

      const drawFrame = async () => {
        if (!isActive || !nativePlaybackActiveRef.current) return;

        const currentPlayhead = masterClock.currentTime;

        if (currentPlayhead >= actualEndTime) {
          cleanup();
          setPlayheadPosition(0);
          startPositionRef.current = 0;
          onEnd();
          return;
        }

        if (!masterClock.isPlaying) {
          cleanup();
          if (!isScrubbingRef.current) {
            onEnd();
          }
          return;
        }

        // Publish the clock before any frame decoding/compositing awaits. Audio
        // is scheduled from this same clock, so delaying this update until the
        // end of a heavy render makes sound appear to start ahead of the playhead.
        const nowPlayhead = performance.now();
        if (nowPlayhead - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
          lastPlayheadUpdateRef.current = nowPlayhead;
          setPlayheadPosition(currentPlayhead);
        }

        const transitionInfo = getTransitionAtTime(
          currentPlayhead,
          timelineTracksRef.current,
        );
        if (transitionInfo) {
          const clipARecord = findNativeClipById(transitionInfo.clipA.id);
          const clipBRecord = transitionInfo.clipB
            ? findNativeClipById(transitionInfo.clipB.id)
            : null;

          if (clipARecord && (!transitionInfo.clipB || clipBRecord)) {
            const records = clipBRecord
              ? [clipARecord, clipBRecord]
              : [clipARecord];
            await Promise.all(
              records.map((record) =>
                loadVideoForClip(record.clip, record.mediaItem),
              ),
            );
            if (!isActive || !nativePlaybackActiveRef.current) return;

            const clipACacheId = getVidstabEngine().hasStabilized(
              clipARecord.clip.id,
            )
              ? `stabilized:${clipARecord.clip.id}`
              : clipARecord.clip.mediaId;
            const clipBCacheId = clipBRecord && getVidstabEngine().hasStabilized(
              clipBRecord.clip.id,
            )
              ? `stabilized:${clipBRecord.clip.id}`
              : clipBRecord?.clip.mediaId;
            const clipAVideo = videoCache.get(clipACacheId)?.video;
            const clipBVideo = clipBCacheId
              ? videoCache.get(clipBCacheId)?.video
              : null;

            if (clipAVideo && (!transitionInfo.clipB || clipBVideo)) {
              const sameElement =
                Boolean(clipBVideo) && clipAVideo === clipBVideo;
              const cutTime = clipBRecord?.clip.startTime ?? clipARecord.clip.startTime;
              const outgoingHeld =
                Boolean(clipBVideo) && !sameElement && currentPlayhead >= cutTime;
              const incomingHeld =
                Boolean(clipBVideo) && !sameElement && currentPlayhead < cutTime;

              if (outgoingHeld) clipAVideo.pause();
              if (incomingHeld && clipBVideo) clipBVideo.pause();

              await Promise.all([
                syncVideoToClipTime(
                  clipAVideo,
                  clipARecord.clip,
                  currentPlayhead,
                ),
                clipBVideo && clipBRecord
                  ? syncVideoToClipTime(
                      clipBVideo,
                      clipBRecord.clip,
                      currentPlayhead,
                    )
                  : Promise.resolve(),
              ]);
              if (!isActive || !nativePlaybackActiveRef.current) return;
              if (!outgoingHeld) await playVideoElement(clipAVideo);
              if (!incomingHeld && clipBVideo) {
                await playVideoElement(clipBVideo);
              }

              const blank = transitionInfo.clipB
                ? null
                : createTransparentCanvasSource(canvas.width, canvas.height);
              const outgoingSource =
                transitionInfo.clipB || transitionInfo.edge !== "in"
                  ? clipAVideo
                  : blank;
              const incomingSource = transitionInfo.clipB
                ? clipBVideo
                : transitionInfo.edge === "in"
                  ? clipAVideo
                  : blank;

              const blended =
                outgoingSource && incomingSource
                  ? await renderTransitionCanvas(
                      transitionInfo,
                      outgoingSource,
                      incomingSource,
                    )
                  : null;
              if (!isActive || !nativePlaybackActiveRef.current) return;
              if (blended) {
                fillPreviewBackground(
                  ctx,
                  playheadPositionRef.current,
                  canvas.width,
                  canvas.height,
                );
                ctx.drawImage(blended, 0, 0, canvas.width, canvas.height);
              }

              const activeShapeClipsTr = getActiveShapeClips(
                allShapeClipsRef.current,
                currentPlayhead,
              );
              const activeTextClipsTr = getActiveTextClips(
                allTextClipsRef.current,
                currentPlayhead,
              );
              if (
                activeShapeClipsTr.length > 0 ||
                activeTextClipsTr.length > 0
              ) {
                const transitionSubjectFrame = hasBehindSubjectText(
                  activeTextClipsTr,
                )
                  ? await captureSubjectFrame(ctx, canvas.width, canvas.height)
                  : null;
                try {
                  await renderOverlayClipsInTrackOrder(
                    ctx,
                    timelineTracksRef.current,
                    activeShapeClipsTr,
                    activeTextClipsTr,
                    currentPlayhead,
                    canvas.width,
                    canvas.height,
                    "all",
                    transitionSubjectFrame,
                  );
                } finally {
                  transitionSubjectFrame?.close();
                }
              }

              const activeSubtitlesTr = getActiveSubtitles(
                allSubtitles,
                currentPlayhead,
              );
              for (const subtitle of activeSubtitlesTr) {
                renderSubtitleToCanvas(
                  ctx,
                  subtitle,
                  canvas.width,
                  canvas.height,
                  currentPlayhead,
                );
              }

              const nowTransition = performance.now();
              if (
                nowTransition - lastPlayheadUpdateRef.current >=
                PLAYHEAD_UPDATE_THROTTLE_MS
              ) {
                lastPlayheadUpdateRef.current = nowTransition;
                setPlayheadPosition(currentPlayhead);
              }
              rafId = requestAnimationFrame(() => {
                drawFrame();
              });
              return;
            }
          }
        }

        const activeClip = findClipAtTime(currentPlayhead);

        if (!activeClip) {
          fillPreviewBackground(
            ctx,
            playheadPositionRef.current,
            canvas.width,
            canvas.height,
          );

          const sortedImageClipsNoVideo = [...imageClips].sort(
            (a, b) => b.trackIndex - a.trackIndex,
          );
          for (const { clip: imgClip } of sortedImageClipsNoVideo) {
            if (
              currentPlayhead >= imgClip.startTime &&
              currentPlayhead < imgClip.startTime + imgClip.duration
            ) {
              const bitmap = imageBitmapCache.get(imgClip.id);
              if (bitmap) {
                const latestImgClip = (() => {
                  for (const track of timelineTracksRef.current) {
                    const found = track.clips.find((c) => c.id === imgClip.id);
                    if (found) return found;
                  }
                  return imgClip;
                })();
                const imgClipLocalTime = currentPlayhead - imgClip.startTime;
                const imgTransform = scaleTransformPositionForPreview(
                  getAnimatedTransform(
                    (latestImgClip.transform as ClipTransform) ||
                      DEFAULT_TRANSFORM,
                    latestImgClip.keyframes,
                    imgClipLocalTime,
                  ),
                  previewRes.scale,
                );
                drawFrameWithTransform(
                  ctx,
                  bitmap,
                  imgTransform,
                  canvas.width,
                  canvas.height,
                );
              }
            }
          }

          const activeShapeClipsNoVideo = getActiveShapeClips(
            allShapeClipsRef.current,
            currentPlayhead,
          );
          const activeTextClipsNoVideo = getActiveTextClips(
            allTextClipsRef.current,
            currentPlayhead,
          );

          if (
            activeShapeClipsNoVideo.length > 0 ||
            activeTextClipsNoVideo.length > 0 ||
            hasActiveMotionInstances(currentPlayhead)
          ) {
            await renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracksRef.current,
              activeShapeClipsNoVideo,
              activeTextClipsNoVideo,
              currentPlayhead,
              canvas.width,
              canvas.height,
              "all",
            );
          }

          const activeSubtitlesNoVideo = getActiveSubtitles(
            allSubtitles,
            currentPlayhead,
          );
          for (const subtitle of activeSubtitlesNoVideo) {
            renderSubtitleToCanvas(
              ctx,
              subtitle,
              canvas.width,
              canvas.height,
              currentPlayhead,
            );
          }

          const nowNoClip = performance.now();
          if (nowNoClip - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
            lastPlayheadUpdateRef.current = nowNoClip;
            setPlayheadPosition(currentPlayhead);
          }
          rafId = requestAnimationFrame(() => { drawFrame(); });
          return;
        }

        const { clip, mediaItem } = activeClip;
        const vidstabPlay = getVidstabEngine();
        const clipIsStabilized = vidstabPlay.hasStabilized(clip.id);
        const playbackCacheId = clipIsStabilized ? `stabilized:${clip.id}` : clip.mediaId;
        const cached = videoCache.get(playbackCacheId);

        if (!cached) {
          await loadVideoForClip(clip, mediaItem);
          if (!isActive || !nativePlaybackActiveRef.current) return;
          const nowNoCached = performance.now();
          if (nowNoCached - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
            lastPlayheadUpdateRef.current = nowNoCached;
            setPlayheadPosition(currentPlayhead);
          }
          rafId = requestAnimationFrame(() => { drawFrame(); });
          return;
        }

        const { video } = cached;

        if (currentClipId !== clip.id) {
          currentClipId = clip.id;
        }

        const latestClip = (() => {
          for (const track of timelineTracksRef.current) {
            const found = track.clips.find((c) => c.id === clip.id);
            if (found) return found;
          }
          return clip;
        })();

        const clipLocalTime = currentPlayhead - latestClip.startTime;
        const speedEngine = getSpeedEngine();
        const adjustedLocalTime = speedEngine.getSourceTimeAtPlaybackTime(
          latestClip.id,
          clipLocalTime,
        );
        const sourceTime = Math.max(
          latestClip.inPoint,
          Math.min(latestClip.outPoint, latestClip.inPoint + adjustedLocalTime),
        );
        await syncVideoToClipTime(video, latestClip, currentPlayhead);
        if (!isActive || !nativePlaybackActiveRef.current) return;
        await playVideoElement(video);

        const timeUntilClipEnd =
          latestClip.startTime + latestClip.duration - currentPlayhead;
        if (timeUntilClipEnd <= 1.0) {
          const nextClip = findNextNativeClip(latestClip.id);
          if (nextClip) {
            loadVideoForClip(nextClip.clip, nextClip.mediaItem).catch(() => {});
          }
        }

        let transform = scaleTransformPositionForPreview(
          getAnimatedTransform(
            (latestClip.transform as ClipTransform) || DEFAULT_TRANSFORM,
            latestClip.keyframes,
            clipLocalTime,
          ),
          previewRes.scale,
        );

        if (latestClip.emphasisAnimation && latestClip.emphasisAnimation.type !== "none") {
          const emphasisState = applyEmphasisAnimation(
            latestClip.emphasisAnimation,
            clipLocalTime,
          );
          transform = {
            ...transform,
            opacity: transform.opacity * emphasisState.opacity,
            scale: {
              x: transform.scale.x * emphasisState.scale * emphasisState.scaleX,
              y: transform.scale.y * emphasisState.scale * emphasisState.scaleY,
            },
            position: {
              x: transform.position.x + emphasisState.offsetX * canvas.width,
              y: transform.position.y + emphasisState.offsetY * canvas.height,
            },
            rotation: transform.rotation + emphasisState.rotation,
          };
        }

        fillPreviewBackground(
          ctx,
          playheadPositionRef.current,
          canvas.width,
          canvas.height,
        );

        if (
          canvasFillModeRef.current === "blur" &&
          video.videoWidth > 0 &&
          video.videoHeight > 0
        ) {
          drawBlurredBackdrop(
            ctx,
            video,
            video.videoWidth,
            video.videoHeight,
            canvas.width,
            canvas.height,
          );
        }

        // Sort by track index descending (higher index = background = render first)
        const sortedImageClips = [...imageClips].sort(
          (a, b) => b.trackIndex - a.trackIndex,
        );
        for (const { clip: imgClip } of sortedImageClips) {
          if (
            currentPlayhead >= imgClip.startTime &&
            currentPlayhead < imgClip.startTime + imgClip.duration
          ) {
            const bitmap = imageBitmapCache.get(imgClip.id);
            if (bitmap) {
              const latestImgClip = (() => {
                for (const track of timelineTracksRef.current) {
                  const found = track.clips.find((c) => c.id === imgClip.id);
                  if (found) return found;
                }
                return imgClip;
              })();
              const imgClipLocalTime = currentPlayhead - imgClip.startTime;
              const imgTransform = scaleTransformPositionForPreview(
                getAnimatedTransform(
                  (latestImgClip.transform as ClipTransform) ||
                    DEFAULT_TRANSFORM,
                  latestImgClip.keyframes,
                  imgClipLocalTime,
                ),
                previewRes.scale,
              );
              drawFrameWithTransform(
                ctx,
                bitmap,
                imgTransform,
                canvas.width,
                canvas.height,
              );
            }
          }
        }

        const allShapeClipsData = allShapeClipsRef.current;
        const activeShapeClips = getActiveShapeClips(
          allShapeClipsData,
          currentPlayhead,
        );
        const activeTextClips = getActiveTextClips(
          allTextClipsRef.current,
          currentPlayhead,
        );

        const bgEngine = getBackgroundRemovalEngine();
        const hasBgRemoval = bgEngine?.isInitialized() && bgEngine.getSettings(clip.id).enabled;

        let videoFrame: HTMLVideoElement | ImageBitmap = video;
        if (hasBgRemoval) {
          try {
            const rawBitmap = await createImageBitmap(video);
            const processed = await applyEffectsToFrame(clip.id, rawBitmap);
            if (!isActive || !nativePlaybackActiveRef.current) {
              if (processed !== rawBitmap) {
                processed.close();
              }
              rawBitmap.close();
              return;
            }
            if (processed !== rawBitmap) {
              rawBitmap.close();
            }
            videoFrame = processed;
          } catch {
            videoFrame = video;
          }
        }

        let finalTransform = transform;
        const vidstabEng = getVidstabEngine();
        if (
          latestClip.stabilization?.enabled &&
          latestClip.stabilization.analyzed &&
          !vidstabEng.hasStabilized(latestClip.id)
        ) {
          finalTransform = applyStabilizationTransform(
            latestClip,
            transform,
            sourceTime,
            canvas.width,
            canvas.height,
            video.videoWidth,
            video.videoHeight,
          );
        }

        const nativeCssFilter =
          videoFrame === video ? clipCssFilterOnly(clip.id) : null;
        drawFrameWithTransform(
          ctx,
          videoFrame,
          finalTransform,
          canvas.width,
          canvas.height,
          nativeCssFilter ?? undefined,
        );
        if (videoFrame !== video && videoFrame instanceof ImageBitmap) {
          videoFrame.close();
        }
        const subjectFrame = hasBehindSubjectText(activeTextClips)
          ? await captureSubjectFrame(ctx, canvas.width, canvas.height)
          : null;

        // Use CPU canvas2D for all overlays - more reliable than GPU compositing
        // Render all text/graphics overlays (they're above the video since backgrounds are separate)
        if (
          activeShapeClips.length > 0 ||
          activeTextClips.length > 0 ||
          hasActiveMotionInstances(currentPlayhead)
        ) {
          await renderOverlayClipsInTrackOrder(
            ctx,
            timelineTracksRef.current,
            activeShapeClips,
            activeTextClips,
            currentPlayhead,
            canvas.width,
            canvas.height,
            "all",
            subjectFrame,
          );
        }
        subjectFrame?.close();

        const activeSubtitles = getActiveSubtitles(
          allSubtitles,
          currentPlayhead,
        );
        for (const subtitle of activeSubtitles) {
          renderSubtitleToCanvas(
            ctx,
            subtitle,
            canvas.width,
            canvas.height,
            currentPlayhead,
          );
        }

        try {
          lastGoodFrameRef.current?.close();
          lastGoodFrameRef.current = await createImageBitmap(canvas);
        } catch {}

        rafId = requestAnimationFrame(() => {
          drawFrame();
        });
      };

      const cleanup = (preserveCaches = false) => {
        isActive = false;
        nativePlaybackActiveRef.current = false;
        if (rafId) cancelAnimationFrame(rafId);

        if (preserveCaches) {
          for (const [, entry] of videoCache) {
            entry.video.pause();
          }
        } else {
          for (const [, entry] of videoCache) {
            releaseVideoElement(entry);
          }
          videoCache.clear();
        }

        if (!preserveCaches) {
          for (const [, bitmap] of imageBitmapCache) {
            bitmap.close();
          }
          imageBitmapCache.clear();
        }

        videoElementRef.current = null;
        currentVideoMediaIdRef.current = null;
        if (preserveCaches) {
          masterClock.pause();
        } else {
          masterClock.stop();
        }
        audioGraph.stopScheduler();
      };

      if (activeStartClip) {
        const startupCacheId = getVidstabEngine().hasStabilized(
          activeStartClip.clip.id,
        )
          ? `stabilized:${activeStartClip.clip.id}`
          : activeStartClip.clip.mediaId;
        const startupVideo = videoCache.get(startupCacheId)?.video;
        if (startupVideo) {
          await syncVideoToClipTime(startupVideo, activeStartClip.clip, startPosition);
          if (!isActive || !nativePlaybackActiveRef.current) {
            cleanup(true);
            return () => {};
          }
          await playVideoElement(startupVideo);
        }
      }

      await masterClock.play();
      audioGraph.startScheduler(getAudioClipsForScheduler);
      rafId = requestAnimationFrame(() => { drawFrame(); });

      return cleanup;
    },
    [
      actualEndTime,
      allSubtitles,
      getMediaItem,
      getAudioClipsForScheduler,
      isMuted,
      preDecodeAllAudioBuffers,
      releaseVideoElement,
      hasActiveMotionInstances,
      renderOverlayClipsInTrackOrder,
      fillPreviewBackground,
      setPlayheadPosition,
      timelineTracks,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = previewRes.width;
      canvas.height = previewRes.height;
    }

    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      cleanupAudioResources();
      return;
    }

    if (actualEndTime <= 0) {
      pause();
      return;
    }

    let isActive = true;
    let nativeCleanup: ((preserveCaches?: boolean) => void) | null = null;

    if (startPositionRef.current >= actualEndTime - 0.001) {
      startPositionRef.current = 0;
      setPlayheadPosition(0);
    }
    const playbackStartPosition = startPositionRef.current;

    const findAllClipsAtTime = (time: number) => {
      const tracks = timelineTracksRef.current;
      const results: Array<{
        clip: (typeof tracks)[0]["clips"][0];
        track: (typeof tracks)[0];
        trackIndex: number;
      }> = [];

      tracks.forEach((track, originalIndex) => {
        if (
          (track.type === "video" || track.type === "image") &&
          !track.hidden
        ) {
          for (const clip of track.clips) {
            if (
              time >= clip.startTime &&
              time < clip.startTime + clip.duration
            ) {
              results.push({ clip, track, trackIndex: originalIndex });
            }
          }
        }
      });

      return results.sort((a, b) => a.trackIndex - b.trackIndex);
    };

    const findClipAtTime = (time: number) => {
      const results = findAllClipsAtTime(time);
      return results.length > 0 ? results[0] : null;
    };

    const startPlaybackForClip = async (
      clip: (typeof timelineTracksRef.current)[0]["clips"][0],
      _track: (typeof timelineTracksRef.current)[0],
      timelinePosition: number,
    ) => {
      try {
        const mediaItem = getMediaItem(clip.mediaId);
        if (!mediaItem?.blob) {
          const clipEndTime = clip.startTime + clip.duration;
          const nextResult = findClipAtTime(clipEndTime);
          if (nextResult && clipEndTime < actualEndTime && isActive) {
            startPlaybackForClip(
              nextResult.clip,
              nextResult.track,
              clipEndTime,
            );
          } else {
            pause();
          }
          return;
        }

        try {
          const mediabunny = await import("mediabunny");
          const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunny;

          const input = new Input({
            source: new BlobSource(mediaItem.blob),
            formats: ALL_FORMATS,
          });

          const videoTrack = await input.getPrimaryVideoTrack();
          if (!videoTrack || !isActive) {
            input[Symbol.dispose]?.();
            return;
          }

          const canDecode = await videoTrack.canDecode();
          if (!canDecode || !isActive) {
            input[Symbol.dispose]?.();
            return;
          }

          // Ensure canvas has valid dimensions BEFORE creating CanvasSink
          if (canvas.width === 0 || canvas.height === 0) {
            console.warn(
              "[Preview] Canvas has zero dimensions, setting from project settings",
            );
            canvas.width = previewRes.width;
            canvas.height = previewRes.height;
          }

          const sink = new CanvasSink(videoTrack, {
            poolSize: 3,
          });

          const speedEngine = getSpeedEngine();
          const clipLocalTime = Math.max(0, timelinePosition - clip.startTime);

          let currentSpeed = speedEngine.getClipSpeed(clip.id);
          let isReverse = speedEngine.isReverse(clip.id);
          let speedSourceClip = clip.id;

          // If video clip has default speed, check for linked audio clip's speed
          if (currentSpeed === 1 && !isReverse) {
            const tracks = timelineTracksRef.current;
            const audioTracks = tracks.filter((t) => t.type === "audio");

            for (const audioTrack of audioTracks) {
              for (const audioClip of audioTrack.clips) {
                if (
                  audioClip.mediaId === clip.mediaId &&
                  Math.abs(audioClip.startTime - clip.startTime) < 0.01
                ) {
                  const linkedSpeed = speedEngine.getClipSpeed(audioClip.id);
                  const linkedReverse = speedEngine.isReverse(audioClip.id);

                  if (linkedSpeed !== 1 || linkedReverse) {
                    currentSpeed = linkedSpeed;
                    isReverse = linkedReverse;
                    speedSourceClip = audioClip.id;
                    break;
                  }
                }
              }
              if (currentSpeed !== 1 || isReverse) break;
            }
          }

          const adjustedLocalTime = speedEngine.getSourceTimeAtPlaybackTime(
            speedSourceClip,
            clipLocalTime,
          );
          const mediaStartTime = (clip.inPoint || 0) + adjustedLocalTime;

          const mediaEndTime = Math.min(
            clip.outPoint || (clip.inPoint || 0) + clip.duration,
            (await videoTrack.computeDuration()) || Infinity,
          );

          await setupAudioFromAudioTrack(timelinePosition);

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            console.error("[Preview] Failed to get 2D context from canvas");
            input[Symbol.dispose]?.();
            return;
          }

          const frameDuration = 1000 / 30;

          let currentMediaTime = mediaStartTime;
          let currentPlayheadTime = timelinePosition;
          let lastFrameTimestamp = performance.now();
          let frameCount = 0;

          const processNextFrame = async () => {
            if (!isActive) {
              input[Symbol.dispose]?.();
              return;
            }

            try {
              if (currentMediaTime >= mediaEndTime) {
                input[Symbol.dispose]?.();
                cleanupAudioResources();

                const clipEndTime = clip.startTime + clip.duration;
                const nextResult = findClipAtTime(clipEndTime);

                if (nextResult && clipEndTime < actualEndTime && isActive) {
                  setPlayheadPosition(clipEndTime);
                  startPlaybackForClip(
                    nextResult.clip,
                    nextResult.track,
                    clipEndTime,
                  );
                } else if (!isScrubbingRef.current) {
                  setPlayheadPosition(0);
                  startPositionRef.current = 0;
                  pause();
                }
                return;
              }

              const frameResult = await (
                sink as {
                  getCanvas: (time: number) => Promise<{
                    canvas: HTMLCanvasElement | OffscreenCanvas;
                    timestamp: number;
                    duration: number;
                  } | null>;
                }
              ).getCanvas(currentMediaTime);

              frameCount++;

              if (!frameResult || !frameResult.canvas) {
                console.warn("[Preview] No frame at time", currentMediaTime);
                const skipTime = frameDuration / 1000;
                currentPlayheadTime += skipTime;
                currentMediaTime += skipTime * currentSpeed;
                if (isActive) {
                  animationRef.current =
                    requestAnimationFrame(processNextFrame);
                }
                return;
              }

              const { canvas: frameCanvas, duration } = frameResult;

              const frameWidth = "width" in frameCanvas ? frameCanvas.width : 0;
              const frameHeight =
                "height" in frameCanvas ? frameCanvas.height : 0;
              if (frameWidth === 0 || frameHeight === 0) {
                console.warn("[Preview] Frame has zero dimensions, skipping");
                const skipTime = frameDuration / 1000;
                currentPlayheadTime += skipTime;
                currentMediaTime += skipTime * currentSpeed;
                if (isActive) {
                  animationRef.current =
                    requestAnimationFrame(processNextFrame);
                }
                return;
              }

              const currentPlayhead = currentPlayheadTime;

              if (currentPlayhead >= actualEndTime) {
                if (!isScrubbingRef.current) {
                  setPlayheadPosition(0);
                  startPositionRef.current = 0;
                  pause();
                }
                input[Symbol.dispose]?.();
                return;
              }

              const clipLocalTime = currentPlayhead - clip.startTime;
              let transform = scaleTransformPositionForPreview(
                getAnimatedTransform(
                  (clip.transform as ClipTransform) || DEFAULT_TRANSFORM,
                  clip.keyframes,
                  clipLocalTime,
                ),
                previewRes.scale,
              );

              if (
                clip.emphasisAnimation &&
                clip.emphasisAnimation.type !== "none"
              ) {
                const emphasisState = applyEmphasisAnimation(
                  clip.emphasisAnimation,
                  clipLocalTime,
                );
                transform = {
                  ...transform,
                  opacity: transform.opacity * emphasisState.opacity,
                  scale: {
                    x:
                      transform.scale.x *
                      emphasisState.scale *
                      emphasisState.scaleX,
                    y:
                      transform.scale.y *
                      emphasisState.scale *
                      emphasisState.scaleY,
                  },
                  position: {
                    x:
                      transform.position.x +
                      emphasisState.offsetX * canvas.width,
                    y:
                      transform.position.y +
                      emphasisState.offsetY * canvas.height,
                  },
                  rotation: transform.rotation + emphasisState.rotation,
                };
              }

              const useGPU =
                rendererRef.current &&
                rendererRef.current.type === "webgpu" &&
                !clipMasksById.has(clip.id);
              const preparedFrame = await preparePreviewFrame(
                clip.id,
                frameCanvas,
                Boolean(useGPU),
                true,
                clip.keyframes,
              );
              const stabilizedTransform = applyStabilizationTransform(
                clip,
                transform,
                currentMediaTime,
                canvas.width,
                canvas.height,
                preparedFrame.frame.width,
                preparedFrame.frame.height,
              );

              fillPreviewBackground(
                ctx,
                playheadPositionRef.current,
                canvas.width,
                canvas.height,
              );
              if (
                canvasFillModeRef.current === "blur" &&
                frameWidth > 0 &&
                frameHeight > 0
              ) {
                drawBlurredBackdrop(
                  ctx,
                  frameCanvas,
                  frameWidth,
                  frameHeight,
                  canvas.width,
                  canvas.height,
                );
              }
              if (useGPU && preparedFrame.frame instanceof ImageBitmap) {
                const gpuResult = await renderFrameWithGPU(
                  rendererRef.current!,
                  preparedFrame.frame,
                  stabilizedTransform,
                  canvas.width,
                  canvas.height,
                );
                if (gpuResult) {
                  ctx.drawImage(gpuResult, 0, 0, canvas.width, canvas.height);
                  gpuResult.close();
                } else {
                  await drawClipFrame(
                    ctx,
                    clip.id,
                    preparedFrame.frame,
                    stabilizedTransform,
                    canvas.width,
                    canvas.height,
                    currentPlayhead,
                  );
                }
              } else {
                await drawClipFrame(
                  ctx,
                  clip.id,
                  preparedFrame.frame,
                  stabilizedTransform,
                  canvas.width,
                  canvas.height,
                  currentPlayhead,
                );
              }
              preparedFrame.cleanup();

              const nowPh = performance.now();
              if (nowPh - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
                lastPlayheadUpdateRef.current = nowPh;
                setPlayheadPosition(currentPlayhead);
              }

              const now = performance.now();
              const elapsed = now - lastFrameTimestamp;
              const actualFrameDuration =
                duration > 0 ? duration * 1000 : frameDuration;
              const targetTime = actualFrameDuration / rateRef.current;

              const normalTimeAdvance = actualFrameDuration / 1000;
              const mediaTimeAdvance = normalTimeAdvance * currentSpeed;
              currentPlayheadTime += normalTimeAdvance;
              currentMediaTime += mediaTimeAdvance;

              const delay = Math.max(0, targetTime - elapsed);
              lastFrameTimestamp = now;

              if (isActive) {
                if (delay > 0) {
                  setTimeout(() => {
                    if (isActive) {
                      animationRef.current =
                        requestAnimationFrame(processNextFrame);
                    }
                  }, delay);
                } else {
                  animationRef.current =
                    requestAnimationFrame(processNextFrame);
                }
              }
            } catch (error) {
              console.error("[Preview] Frame error:", error);
              input[Symbol.dispose]?.();
              pause();
            }
          };

          animationRef.current = requestAnimationFrame(processNextFrame);
        } catch (error) {
          console.error("[Preview] MediaBunny setup error:", error);
          pause();
        }
      } catch (outerError) {
        console.error(
          "[Preview] startPlaybackForClip outer error:",
          outerError,
        );
        pause();
      }
    };

    const initClipResources = async (
      clip: (typeof timelineTracksRef.current)[0]["clips"][0],
      trackIndex: number,
    ) => {
      const mediaItem = getMediaItem(clip.mediaId);
      if (!mediaItem?.blob) {
        return null;
      }

      // Images don't need MediaBunny resources - they're rendered directly via createImageBitmap
      if (mediaItem.type === "image") {
        return null;
      }

      try {
        const mediabunny = await import("mediabunny");
        const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunny;

        const input = new Input({
          source: new BlobSource(mediaItem.blob),
          formats: ALL_FORMATS,
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) {
          input[Symbol.dispose]?.();
          return null;
        }

        const canDecode = await videoTrack.canDecode();
        if (!canDecode) {
          input[Symbol.dispose]?.();
          return null;
        }

        const sink = new CanvasSink(videoTrack, {
          poolSize: 3,
        });

        return {
          input,
          sink,
          mediaId: clip.mediaId,
          clipId: clip.id,
          trackIndex,
        };
      } catch (error) {
        console.error(
          `[Preview] Failed to init resources for clip ${clip.id}:`,
          error,
        );
        return null;
      }
    };

    const preCacheAllImageBitmaps = async () => {
      const tracks = timelineTracksRef.current;
      const visualTracks = tracks.filter(
        (t) => (t.type === "image" || t.type === "video") && !t.hidden,
      );

      for (const track of visualTracks) {
        for (const clip of track.clips) {
          if (imageBitmapCacheRef.current.has(clip.id)) continue;

          const mediaItem = getMediaItem(clip.mediaId);
          if (mediaItem?.type === "image" && mediaItem.blob) {
            try {
              const bitmap = await createImageBitmap(mediaItem.blob);
              imageBitmapCacheRef.current.set(clip.id, bitmap);
            } catch (error) {
              console.warn(
                `[Preview] Failed to pre-cache image clip ${clip.id}:`,
                error,
              );
            }
          }
        }
      }
    };

    const startMultiTrackPlayback = async () => {
      const initialClips = findAllClipsAtTime(playbackStartPosition);
      const activeTextClips = getActiveTextClips(
        allTextClipsRef.current,
        playbackStartPosition,
      );
      const activeShapeClips = getActiveShapeClips(
        allShapeClipsRef.current,
        playbackStartPosition,
      );

      const audioTracks = timelineTracksRef.current.filter(
        (t) => t.type === "audio" && !t.hidden,
      );
      const hasActiveAudioClip = audioTracks.some((track) =>
        track.clips.some(
          (clip) =>
            playbackStartPosition >= clip.startTime &&
            playbackStartPosition < clip.startTime + clip.duration,
        ),
      );

      const hasAnyVisualContent =
        initialClips.length > 0 ||
        activeTextClips.length > 0 ||
        activeShapeClips.length > 0 ||
        hasActiveMotionInstances(playbackStartPosition);
      const hasAnyContent = hasAnyVisualContent || hasActiveAudioClip;

      if (!hasAnyContent && actualEndTime <= 0) {
        pause();
        return;
      }

      preCacheAllImageBitmaps().catch((error) => {
        console.warn("[Preview] Image warmup failed:", error);
      });

      for (const { clip, trackIndex } of initialClips) {
        if (!playbackResourcesRef.current.has(clip.id)) {
          const resources = await initClipResources(clip, trackIndex);
          if (resources) {
            playbackResourcesRef.current.set(clip.id, resources);
          }
        }
      }

      const hasTextOrShapeContent =
        activeTextClips.length > 0 ||
        activeShapeClips.length > 0 ||
        hasActiveMotionInstances(playbackStartPosition);
      if (
        playbackResourcesRef.current.size === 0 &&
        !hasTextOrShapeContent &&
        !hasActiveAudioClip &&
        actualEndTime <= 0
      ) {
        pause();
        return;
      }

      preDecodeAllAudioBuffers().catch((error) => {
        console.warn("[Preview] Audio warmup failed:", error);
      });

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setPreviewMuted(isMuted);

      const tracksWithAudio = timelineTracksRef.current.filter(
        (t) => (t.type === "audio" || t.type === "video") && !t.hidden,
      );
      for (const track of tracksWithAudio) {
        audioGraph.createTrack({
          trackId: track.id,
          volume: 1,
          pan: 0,
          muted: track.muted || false,
          solo: track.solo || false,
          effects: [],
        });
      }

      await audioGraph.resume();

      const mainCtx = canvas.getContext("2d");
      if (!mainCtx) {
        console.error("[Preview] Failed to get 2D context");
        pause();
        return;
      }

      if (
        !offscreenCanvasRef.current ||
        offscreenCanvasRef.current.width !== canvas.width ||
        offscreenCanvasRef.current.height !== canvas.height
      ) {
        offscreenCanvasRef.current = new OffscreenCanvas(
          canvas.width,
          canvas.height,
        );
        offscreenCtxRef.current = offscreenCanvasRef.current.getContext(
          "2d",
        ) as OffscreenCanvasRenderingContext2D;
      }

      const ctx = offscreenCtxRef.current as unknown as CanvasRenderingContext2D;
      if (!ctx) {
        console.error("[Preview] Failed to get offscreen 2D context");
        pause();
        return;
      }

      const masterClock = getMasterClock();
      masterClock.setDuration(actualEndTime);
      masterClock.seek(playbackStartPosition);

      audioGraph.seekTo(playbackStartPosition);
      await masterClock.play();
      audioGraph.startScheduler(getAudioClipsForScheduler);

      const frameDuration = 1000 / 30;
      let lastFrameTimestamp = performance.now();
      let frameCount = 0;
      let isProcessingFrame = false;

      const processMultiTrackFrame = async () => {
        if (!isActive) {
          cleanupPlaybackResources();
          masterClock.pause();
          return;
        }

        if (isProcessingFrame) {
          return;
        }
        isProcessingFrame = true;

        const currentPlayhead = masterClock.currentTime;

        try {
          if (currentPlayhead >= actualEndTime) {
            isProcessingFrame = false;
            cleanupPlaybackResources();
            cleanupAudioResources();
            masterClock.stop();
            setPlayheadPosition(0);
            startPositionRef.current = 0;
            pause();
            return;
          }

          if (!masterClock.isPlaying) {
            isProcessingFrame = false;
            cleanupPlaybackResources();
            cleanupAudioResources();
            if (!isScrubbingRef.current) {
              pause();
            }
            return;
          }

          // Keep the timeline UI clock-aligned with audio even when decoding or
          // effects make the current visual frame expensive to produce.
          const nowPlayhead = performance.now();
          if (nowPlayhead - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
            lastPlayheadUpdateRef.current = nowPlayhead;
            setPlayheadPosition(currentPlayhead);
          }

          const activeClips = findAllClipsAtTime(currentPlayhead);
          const currentTextClips = getActiveTextClips(
            allTextClipsRef.current,
            currentPlayhead,
          );
          const currentShapeClips = getActiveShapeClips(
            allShapeClipsRef.current,
            currentPlayhead,
          );

          const audioTracksForFrame = timelineTracksRef.current.filter(
            (t) => t.type === "audio" && !t.hidden,
          );
          const hasCurrentAudioClip = audioTracksForFrame.some((track) =>
            track.clips.some(
              (clip) =>
                currentPlayhead >= clip.startTime &&
                currentPlayhead < clip.startTime + clip.duration,
            ),
          );

          const hasVisualContent =
            activeClips.length > 0 ||
            currentTextClips.length > 0 ||
            currentShapeClips.length > 0 ||
            hasActiveMotionInstances(currentPlayhead);
          const hasAnyContentAtPlayhead =
            hasVisualContent || hasCurrentAudioClip;

          if (!hasAnyContentAtPlayhead) {
            const nextClipTime = findNextClipStartTime(currentPlayhead);
            const nextTextTime = findNextTextClipStartTime(currentPlayhead);
            const nextShapeTime = findNextShapeClipStartTime(currentPlayhead);
            const nextMotionTime = findNextMotionInstanceStartTime(currentPlayhead);
            const nextAudioTime = findNextAudioClipStartTime(currentPlayhead);

            const nextTimes = [
              nextClipTime,
              nextTextTime,
              nextShapeTime,
              nextMotionTime,
              nextAudioTime,
            ].filter((t): t is number => t !== null && t < actualEndTime);
            const nextTime =
              nextTimes.length > 0 ? Math.min(...nextTimes) : null;

            if (nextTime !== null) {
              masterClock.seek(nextTime);
              audioGraph.seekTo(nextTime);
              isProcessingFrame = false;
              animationRef.current = requestAnimationFrame(
                processMultiTrackFrame,
              );
              return;
            } else {
              isProcessingFrame = false;
              cleanupPlaybackResources();
              cleanupAudioResources();
              if (!isScrubbingRef.current) {
                masterClock.stop();
                setPlayheadPosition(0);
                startPositionRef.current = 0;
                pause();
              }
              return;
            }
          }

          const hasActiveCompound = activeClips.some(
            ({ clip }) => typeof clip.metadata?.compoundClipId === "string",
          );
          if (hasActiveCompound) {
            await renderFrameDirectlyRef.current(currentPlayhead);
            frameCount++;
            masterClock.reportVideoTime(currentPlayhead);
            const now = performance.now();
            const elapsed = now - lastFrameTimestamp;
            const delay = Math.max(0, frameDuration / rateRef.current - elapsed);
            lastFrameTimestamp = now;
            isProcessingFrame = false;
            if (isActive) {
              if (delay > 0) {
                setTimeout(() => {
                  if (isActive) animationRef.current = requestAnimationFrame(processMultiTrackFrame);
                }, delay);
              } else {
                animationRef.current = requestAnimationFrame(processMultiTrackFrame);
              }
            }
            return;
          }

          for (const { clip, trackIndex } of activeClips) {
            if (!playbackResourcesRef.current.has(clip.id)) {
              const resources = await initClipResources(clip, trackIndex);
              if (resources) {
                playbackResourcesRef.current.set(clip.id, resources);
              }
            }
          }

          // Active transition takes over the whole frame: decode both clips
          // (one will be outside its visible window — its sink will clamp to
          // the nearest edge frame) and blend them. Overlays still render on
          // top below.
          const transitionInfoMulti = getTransitionAtTime(
            currentPlayhead,
            timelineTracksRef.current,
          );

          // Compute these here so they're visible in both the transition path
          // and the normal compositing path below.
          const activeShapeClips = getActiveShapeClips(
            allShapeClipsRef.current,
            currentPlayhead,
          );
          const activeTextClips = getActiveTextClips(
            allTextClipsRef.current,
            currentPlayhead,
          );

          if (transitionInfoMulti) {
            const tracks = timelineTracksRef.current;
            const findClipById = (id: string) => {
              for (let idx = 0; idx < tracks.length; idx++) {
                const found = tracks[idx].clips.find((c) => c.id === id);
                if (found) return { clip: found, trackIndex: idx };
              }
              return null;
            };

            const aLookup = findClipById(transitionInfoMulti.clipA.id);
            const bLookup = transitionInfoMulti.clipB
              ? findClipById(transitionInfoMulti.clipB.id)
              : null;

            if (aLookup && (!transitionInfoMulti.clipB || bLookup)) {
              const lookups = bLookup ? [aLookup, bLookup] : [aLookup];
              for (const lookup of lookups) {
                if (!playbackResourcesRef.current.has(lookup.clip.id)) {
                  const resources = await initClipResources(
                    lookup.clip,
                    lookup.trackIndex,
                  );
                  if (resources) {
                    playbackResourcesRef.current.set(
                      lookup.clip.id,
                      resources,
                    );
                  }
                }
              }

              const decodeClipFrameForTransition = async (
                clip: (typeof tracks)[0]["clips"][0],
              ): Promise<HTMLCanvasElement | OffscreenCanvas | null> => {
                const resources = playbackResourcesRef.current.get(clip.id);
                if (!resources) return null;
                const speedEngine = getSpeedEngine();
                const localTime = currentPlayhead - clip.startTime;
                const adjustedLocalTime =
                  speedEngine.getSourceTimeAtPlaybackTime(clip.id, localTime);
                const sourceTime = Math.max(
                  clip.inPoint,
                  Math.min(
                    clip.outPoint,
                    (clip.inPoint || 0) + adjustedLocalTime,
                  ),
                );
                try {
                  const result = await (
                    resources.sink as {
                      getCanvas: (time: number) => Promise<{
                        canvas: HTMLCanvasElement | OffscreenCanvas;
                      } | null>;
                    }
                  ).getCanvas(sourceTime);
                  if (!result?.canvas) return null;
                  return result.canvas;
                } catch (error) {
                  console.warn(
                    `[Preview] Transition decode failed for clip ${clip.id}:`,
                    error,
                  );
                  return null;
                }
              };

              const [clipAFrame, clipBFrame] = await Promise.all([
                decodeClipFrameForTransition(aLookup.clip),
                bLookup
                  ? decodeClipFrameForTransition(bLookup.clip)
                  : Promise.resolve(null),
              ]);

              const blank = transitionInfoMulti.clipB
                ? null
                : createTransparentCanvasSource(canvas.width, canvas.height);
              const outgoing =
                transitionInfoMulti.clipB || transitionInfoMulti.edge !== "in"
                  ? clipAFrame
                  : blank;
              const incoming = transitionInfoMulti.clipB
                ? clipBFrame
                : transitionInfoMulti.edge === "in"
                  ? clipAFrame
                  : blank;

              if (outgoing && incoming) {
                try {
                  const blended = await renderTransitionCanvas(
                    transitionInfoMulti,
                    outgoing,
                    incoming,
                  );

                  fillPreviewBackground(
                    ctx,
                    playheadPositionRef.current,
                    canvas.width,
                    canvas.height,
                  );
                  ctx.drawImage(blended, 0, 0, canvas.width, canvas.height);

                  const transitionSubjectFrame = hasBehindSubjectText(
                    activeTextClips,
                  )
                    ? await captureSubjectFrame(
                        ctx,
                        canvas.width,
                        canvas.height,
                      )
                    : null;
                  try {
                    for (const shapeClip of activeShapeClips) {
                      await renderShapeClipWithEffects(
                        ctx,
                        shapeClip,
                        canvas.width,
                        canvas.height,
                        currentPlayhead,
                      );
                    }
                    for (const textClip of activeTextClips) {
                      await renderTextClipWithSubjectMask(
                        ctx,
                        textClip,
                        canvas.width,
                        canvas.height,
                        currentPlayhead,
                        transitionSubjectFrame,
                        true,
                        getBehindSubjectStreamId(
                          timelineTracksRef.current,
                          currentPlayhead,
                        ),
                      );
                    }
                  } finally {
                    transitionSubjectFrame?.close();
                  }
                  const activeSubtitlesTr = getActiveSubtitles(
                    allSubtitlesRef.current,
                    currentPlayhead,
                  );
                  for (const subtitle of activeSubtitlesTr) {
                    renderSubtitleToCanvas(
                      ctx,
                      subtitle,
                      canvas.width,
                      canvas.height,
                      currentPlayhead,
                    );
                  }

                  mainCtx.drawImage(offscreenCanvasRef.current!, 0, 0);

                  frameCount++;
                  masterClock.reportVideoTime(currentPlayhead);
                  const nowTr = performance.now();
                  if (
                    nowTr - lastPlayheadUpdateRef.current >=
                    PLAYHEAD_UPDATE_THROTTLE_MS
                  ) {
                    lastPlayheadUpdateRef.current = nowTr;
                    setPlayheadPosition(currentPlayhead);
                  }
                  const elapsedTr = nowTr - lastFrameTimestamp;
                  const targetTimeTr = frameDuration / rateRef.current;
                  const delayTr = Math.max(0, targetTimeTr - elapsedTr);
                  lastFrameTimestamp = nowTr;
                  isProcessingFrame = false;
                  if (isActive) {
                    if (delayTr > 0) {
                      setTimeout(() => {
                        if (isActive) {
                          animationRef.current = requestAnimationFrame(
                            processMultiTrackFrame,
                          );
                        }
                      }, delayTr);
                    } else {
                      animationRef.current = requestAnimationFrame(
                        processMultiTrackFrame,
                      );
                    }
                  }
                  return;
                } catch (error) {
                  console.warn(
                    "[Preview] Transition render failed, falling back to normal compositing:",
                    error,
                  );
                }
              }
            }
          }

          const activeClipIds = new Set(activeClips.map((c) => c.clip.id));
          for (const [clipId, resources] of playbackResourcesRef.current) {
            if (!activeClipIds.has(clipId)) {
              resources.input[Symbol.dispose]?.();
              playbackResourcesRef.current.delete(clipId);
            }
          }

          const sortedClips = [...activeClips].sort(
            (a, b) => b.trackIndex - a.trackIndex,
          );
          const activeTextNeedsSubject = hasBehindSubjectText(activeTextClips);
          const useGPUFrames =
            rendererRef.current?.type === "webgpu" && !activeTextNeedsSubject;

          const imageClipFrames: Array<{
            clip: (typeof sortedClips)[0]["clip"];
            transform: ClipTransform;
            frame: ImageBitmap;
          }> = [];

          const videoClipPromises: Array<
            Promise<{
              clip: (typeof sortedClips)[0]["clip"];
              transform: ClipTransform;
              frame: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
              cleanup: () => void;
            } | null>
          > = [];

          for (const { clip, track } of sortedClips) {
            if (!isActive) continue;

            const clipLocalTime = currentPlayhead - clip.startTime;

            let transform = scaleTransformPositionForPreview(
              getAnimatedTransform(
                (clip.transform as ClipTransform) || DEFAULT_TRANSFORM,
                clip.keyframes,
                clipLocalTime,
              ),
              previewRes.scale,
            );

            if (
              clip.emphasisAnimation &&
              clip.emphasisAnimation.type !== "none"
            ) {
              const emphasisState = applyEmphasisAnimation(
                clip.emphasisAnimation,
                clipLocalTime,
              );
              transform = {
                ...transform,
                opacity: transform.opacity * emphasisState.opacity,
                scale: {
                  x:
                    transform.scale.x *
                    emphasisState.scale *
                    emphasisState.scaleX,
                  y:
                    transform.scale.y *
                    emphasisState.scale *
                    emphasisState.scaleY,
                },
                position: {
                  x:
                    transform.position.x + emphasisState.offsetX * canvas.width,
                  y:
                    transform.position.y +
                    emphasisState.offsetY * canvas.height,
                },
                rotation: transform.rotation + emphasisState.rotation,
              };
            }

            const clipMedia = getMediaItem(clip.mediaId);
            if (track.type === "image" || clipMedia?.type === "image") {
              let cachedBitmap = imageBitmapCacheRef.current.get(clip.id);
              if (
                !cachedBitmap &&
                clipMedia?.type === "image" &&
                clipMedia.blob instanceof Blob &&
                !failedImageDecodesRef.current.has(clip.id)
              ) {
                try {
                  cachedBitmap = await createImageBitmap(clipMedia.blob);
                  imageBitmapCacheRef.current.set(clip.id, cachedBitmap);
                } catch (error) {
                  failedImageDecodesRef.current.add(clip.id);
                  console.warn(
                    `[Preview] On-demand image decode failed for clip ${clip.id}:`,
                    error,
                  );
                }
              }
              if (cachedBitmap) {
                imageClipFrames.push({ clip, transform, frame: cachedBitmap });
              }
              continue;
            }

            videoClipPromises.push(
              (async () => {
                const resources = playbackResourcesRef.current.get(clip.id);
                if (!resources) return null;

                const speedEngine = getSpeedEngine();
                const adjustedLocalTime =
                  speedEngine.getSourceTimeAtPlaybackTime(
                    clip.id,
                    clipLocalTime,
                  );
                const sourceTime = Math.max(
                  clip.inPoint,
                  Math.min(clip.outPoint, (clip.inPoint || 0) + adjustedLocalTime),
                );

                try {
                  const frameResult = await (
                    resources.sink as {
                      getCanvas: (time: number) => Promise<{
                        canvas: HTMLCanvasElement | OffscreenCanvas;
                        timestamp: number;
                        duration: number;
                      } | null>;
                    }
                  ).getCanvas(sourceTime);

                  if (!isActive) return null;

                  if (frameResult?.canvas) {
                    const preparedFrame = await preparePreviewFrame(
                      clip.id,
                      frameResult.canvas,
                      useGPUFrames,
                      clip.keyframes,
                    );

                    const stabilizedTransform = applyStabilizationTransform(
                      clip,
                      transform,
                      sourceTime,
                      canvas.width,
                      canvas.height,
                      preparedFrame.frame.width,
                      preparedFrame.frame.height,
                    );

                    return {
                      clip,
                      transform: stabilizedTransform,
                      frame: preparedFrame.frame,
                      cleanup: preparedFrame.cleanup,
                    };
                  }
                } catch (error) {
                  const errorMessage =
                    error instanceof Error ? error.message : String(error);
                  if (errorMessage.includes("disposed") || !isActive) {
                    return null;
                  }
                  console.warn(
                    `[Preview] Failed to get frame for clip ${clip.id}:`,
                    error,
                  );
                }
                return null;
              })(),
            );
          }

          const videoFrameResults = await Promise.all(videoClipPromises);
          const validVideoFrames = videoFrameResults.filter(
            (f): f is NonNullable<typeof f> => f !== null,
          );

          const validFrames = [...imageClipFrames, ...validVideoFrames];

          if (
            validFrames.length > 0 ||
            currentTextClips.length > 0 ||
            currentShapeClips.length > 0 ||
            hasActiveMotionInstances(currentPlayhead)
          ) {
            fillPreviewBackground(
              ctx,
              playheadPositionRef.current,
              canvas.width,
              canvas.height,
            );

            const tracks = timelineTracksRef.current;

            const clipToTrackIndex = new Map<string, number>();
            tracks.forEach((track, idx) => {
              if (
                (track.type === "video" || track.type === "image") &&
                !track.hidden
              ) {
                for (const clip of track.clips) {
                  clipToTrackIndex.set(clip.id, idx);
                }
              }
            });

            const allRenderableTracks = tracks
              .map((track, idx) => ({ track, originalIndex: idx }))
              .filter(
                ({ track }) =>
                  (track.type === "video" ||
                    track.type === "image" ||
                    track.type === "text" ||
                    track.type === "graphics") &&
                  !track.hidden,
              )
              .sort((a, b) => b.originalIndex - a.originalIndex);

            if (canvasFillModeRef.current === "blur") {
              for (const { track, originalIndex } of allRenderableTracks) {
                if (track.type !== "video") continue;
                const baseFrame = validFrames.find(
                  (f) => clipToTrackIndex.get(f.clip.id) === originalIndex,
                );
                if (
                  baseFrame &&
                  baseFrame.frame.width > 0 &&
                  baseFrame.frame.height > 0
                ) {
                  drawBlurredBackdrop(
                    ctx,
                    baseFrame.frame,
                    baseFrame.frame.width,
                    baseFrame.frame.height,
                    canvas.width,
                    canvas.height,
                  );
                  break;
                }
              }
            }

            const useGPU =
              rendererRef.current &&
              rendererRef.current.type === "webgpu" &&
              !activeTextNeedsSubject &&
              !validFrames.some(({ clip }) => clipMasksById.has(clip.id));

            if (useGPU) {
              const gpuLayers: GPULayer[] = [];
              const tempBitmaps: ImageBitmap[] = [];

              for (const { track, originalIndex } of allRenderableTracks) {
                if (track.type === "video") {
                  const trackFrames = validFrames.filter(
                    (f) => clipToTrackIndex.get(f.clip.id) === originalIndex,
                  );
                  for (const { transform, frame } of trackFrames) {
                    if (frame instanceof ImageBitmap) {
                      gpuLayers.push({
                        bitmap: frame,
                        transform,
                      });
                    }
                  }
                } else if (track.type === "image") {
                  const trackFrames = validFrames.filter(
                    (f) => clipToTrackIndex.get(f.clip.id) === originalIndex,
                  );
                  for (const { transform, frame } of trackFrames) {
                    drawFrameWithTransform(
                      ctx,
                      frame,
                      transform,
                      canvas.width,
                      canvas.height,
                    );
                  }
                } else if (track.type === "graphics") {
                  const trackShapeClips = activeShapeClips.filter(
                    (sc) => sc.trackId === track.id,
                  );
                  for (const shapeClip of trackShapeClips) {
                    await renderShapeClipWithEffects(
                      ctx,
                      shapeClip,
                      canvas.width,
                      canvas.height,
                      currentPlayhead,
                    );
                  }
                  await renderMotionInstancesForTrack(
                    ctx,
                    track,
                    currentPlayhead,
                    canvas.width,
                    canvas.height,
                  );
                } else if (track.type === "text") {
                  const trackTextClips = activeTextClips.filter(
                    (tc) => tc.trackId === track.id,
                  );
                  for (const textClip of trackTextClips) {
                    const offscreen = new OffscreenCanvas(
                      canvas.width,
                      canvas.height,
                    );
                    const offCtx = offscreen.getContext("2d");
                    if (offCtx) {
                      renderTextClipToCanvas(
                        offCtx as unknown as CanvasRenderingContext2D,
                        textClip,
                        canvas.width,
                        canvas.height,
                        currentPlayhead,
                      );
                      const prepared = await preparePreviewFrame(
                        textClip.id,
                        offscreen,
                        true,
                        true,
                      );
                      const bitmap = await createImageBitmap(prepared.frame);
                      prepared.cleanup();
                      tempBitmaps.push(bitmap);
                      gpuLayers.push({
                        bitmap,
                        transform: {
                          ...DEFAULT_TRANSFORM,
                          opacity: 1,
                          scale: { x: 1, y: 1 },
                          position: { x: 0, y: 0 },
                          anchor: { x: 0, y: 0 },
                        },
                      });
                    }
                  }
                }
              }

              if (gpuLayers.length > 0) {
                const gpuResult = await renderAllLayersWithGPU(
                  rendererRef.current!,
                  gpuLayers,
                  canvas.width,
                  canvas.height,
                );
                if (gpuResult) {
                  ctx.drawImage(gpuResult, 0, 0, canvas.width, canvas.height);
                  gpuResult.close();
                } else {
                  for (const layer of gpuLayers) {
                    drawFrameWithTransform(
                      ctx,
                      layer.bitmap,
                      layer.transform,
                      canvas.width,
                      canvas.height,
                    );
                  }
                }
              }

              for (const bitmap of tempBitmaps) {
                bitmap.close();
              }
            } else {
              let subjectFrame: ImageBitmap | null = null;
              for (const { track, originalIndex } of allRenderableTracks) {
                if (track.type === "video" || track.type === "image") {
                  const trackFrames = validFrames.filter(
                    (f) => clipToTrackIndex.get(f.clip.id) === originalIndex,
                  );
                  for (const { clip, transform, frame } of trackFrames) {
                    await drawClipFrame(
                      ctx,
                      clip.id,
                      frame,
                      transform,
                      canvas.width,
                      canvas.height,
                      currentPlayhead,
                    );
                    if (activeTextNeedsSubject) {
                      subjectFrame?.close();
                      subjectFrame = await captureSubjectFrame(
                        ctx,
                        canvas.width,
                        canvas.height,
                      );
                    }
                  }
                } else if (track.type === "graphics") {
                  const trackShapeClips = activeShapeClips.filter(
                    (sc) => sc.trackId === track.id,
                  );
                  for (const shapeClip of trackShapeClips) {
                    await renderShapeClipWithEffects(
                      ctx,
                      shapeClip,
                      canvas.width,
                      canvas.height,
                      currentPlayhead,
                    );
                  }
                  await renderMotionInstancesForTrack(
                    ctx,
                    track,
                    currentPlayhead,
                    canvas.width,
                    canvas.height,
                  );
                } else if (track.type === "text") {
                  const trackTextClips = activeTextClips.filter(
                    (tc) => tc.trackId === track.id,
                  );
                  for (const textClip of trackTextClips) {
                    await renderTextClipWithSubjectMask(
                      ctx,
                      textClip,
                      canvas.width,
                      canvas.height,
                      currentPlayhead,
                      subjectFrame,
                      true,
                      getBehindSubjectStreamId(
                        timelineTracksRef.current,
                        currentPlayhead,
                      ),
                    );
                  }
                }
              }
              subjectFrame?.close();
            }

            for (const frame of validVideoFrames) {
              frame.cleanup();
            }

            const activeSubtitles = getActiveSubtitles(
              allSubtitlesRef.current,
              currentPlayhead,
            );
            for (const subtitle of activeSubtitles) {
              renderSubtitleToCanvas(
                ctx,
                subtitle,
                canvas.width,
                canvas.height,
                currentPlayhead,
              );
            }

            mainCtx.drawImage(offscreenCanvasRef.current!, 0, 0);

            try {
              lastGoodFrameRef.current?.close();
              lastGoodFrameRef.current = await createImageBitmap(offscreenCanvasRef.current!);
            } catch {}
          } else if (lastGoodFrameRef.current) {
            ctx.drawImage(
              lastGoodFrameRef.current,
              0,
              0,
              canvas.width,
              canvas.height,
            );

            const activeSubtitles = getActiveSubtitles(
              allSubtitlesRef.current,
              currentPlayhead,
            );
            for (const subtitle of activeSubtitles) {
              renderSubtitleToCanvas(
                ctx,
                subtitle,
                canvas.width,
                canvas.height,
                currentPlayhead,
              );
            }

            mainCtx.drawImage(offscreenCanvasRef.current!, 0, 0);
          }

          frameCount++;
          masterClock.reportVideoTime(currentPlayhead);
          const now = performance.now();
          const elapsed = now - lastFrameTimestamp;
          const targetTime = frameDuration / rateRef.current;

          const delay = Math.max(0, targetTime - elapsed);
          lastFrameTimestamp = now;

          isProcessingFrame = false;

          if (isActive) {
            if (delay > 0) {
              setTimeout(() => {
                if (isActive) {
                  animationRef.current = requestAnimationFrame(
                    processMultiTrackFrame,
                  );
                }
              }, delay);
            } else {
              animationRef.current = requestAnimationFrame(
                processMultiTrackFrame,
              );
            }
          }
        } catch (error) {
          isProcessingFrame = false;
          console.error("[Preview] Multi-track frame error:", error);
          cleanupPlaybackResources();
          pause();
        }
      };

      animationRef.current = requestAnimationFrame(processMultiTrackFrame);
    };

    const findNextClipStartTime = (afterTime: number): number | null => {
      const tracks = timelineTracksRef.current;
      const videoTracks = tracks.filter(
        (t) => (t.type === "video" || t.type === "image") && !t.hidden,
      );
      let nextStart: number | null = null;

      for (const track of videoTracks) {
        for (const clip of track.clips) {
          if (clip.startTime > afterTime) {
            if (nextStart === null || clip.startTime < nextStart) {
              nextStart = clip.startTime;
            }
          }
        }
      }

      return nextStart;
    };

    const findNextTextClipStartTime = (afterTime: number): number | null => {
      const textClips = allTextClipsRef.current;
      let nextStart: number | null = null;

      for (const clip of textClips) {
        if (clip.startTime > afterTime) {
          if (nextStart === null || clip.startTime < nextStart) {
            nextStart = clip.startTime;
          }
        }
      }

      return nextStart;
    };

    const findNextShapeClipStartTime = (afterTime: number): number | null => {
      const shapeClips = allShapeClipsRef.current;
      let nextStart: number | null = null;

      for (const clip of shapeClips) {
        if (clip.startTime > afterTime) {
          if (nextStart === null || clip.startTime < nextStart) {
            nextStart = clip.startTime;
          }
        }
      }

      return nextStart;
    };

    const findNextMotionInstanceStartTime = (afterTime: number): number | null => {
      let nextStart: number | null = null;
      for (const instance of project.motionInstances ?? []) {
        if (instance.startTime > afterTime) {
          if (nextStart === null || instance.startTime < nextStart) {
            nextStart = instance.startTime;
          }
        }
      }
      return nextStart;
    };

    const findNextAudioClipStartTime = (afterTime: number): number | null => {
      const tracks = timelineTracksRef.current;
      const audioTracks = tracks.filter((t) => t.type === "audio" && !t.hidden);
      let nextStart: number | null = null;

      for (const track of audioTracks) {
        for (const clip of track.clips) {
          if (clip.startTime > afterTime) {
            if (nextStart === null || clip.startTime < nextStart) {
              nextStart = clip.startTime;
            }
          }
        }
      }

      return nextStart;
    };

    const startPlayback = async () => {
      const nativeCheck = canUseNativeVideoPlayback(playbackStartPosition);

      if (nativeCheck.canUse && nativeCheck.clips.length > 0) {
        try {
          nativeCleanup = await startNativeVideoPlayback(
            nativeCheck.clips,
            nativeCheck.imageClips || [],
            playbackStartPosition,
            () => pause(),
          );
          return nativeCleanup;
        } catch (error) {
          console.warn(
            "[Preview] Native video playback failed, falling back to MediaBunny:",
            error,
          );
        }
      }
      await startMultiTrackPlayback();
    };

    startPlayback().catch((error) => {
      console.error("[Preview] startPlayback error:", error);
    });

    return () => {
      isActive = false;
      nativePlaybackActiveRef.current = false;
      const masterClock = getMasterClock();
      if (masterClock.isPlaying || masterClock.isPaused) {
        startPositionRef.current = masterClock.currentTime;
      }
      if (nativeCleanup) {
        const pausedForResume =
          useTimelineStore.getState().playbackState === "paused";
        nativeCleanup(pausedForResume);
        nativeCleanup = null;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (videoElementRef.current) {
        videoElementRef.current.pause();
        videoElementRef.current.removeAttribute("src");
        videoElementRef.current.load();
        videoElementRef.current = null;
      }
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
      masterClock.pause();
      cleanupAudioResources();
    };
  }, [
    isPlaying,
    canUseNativeVideoPlayback,
    startNativeVideoPlayback,
    actualEndTime,
    setPlayheadPosition,
    pause,
    getMediaItem,
    cleanupPlaybackResources,
    cleanupAudioResources,
    setupAudioFromAudioTrack,
    preDecodeAllAudioBuffers,
    getAudioClipsForScheduler,
    isMuted,
    previewRes.width,
    previewRes.height,
    previewRes.scale,
    hasActiveMotionInstances,
    renderMotionInstancesForTrack,
    project.motionInstances,
    clipMasksById,
    drawClipFrame,
    fillPreviewBackground,
  ]);

  const lastModifiedAtRef = useRef<number>(project.modifiedAt);
  const lastPlayheadForRenderRef = useRef<number>(playheadPosition);
  const modifiedRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderInFlightRef = useRef<boolean>(false);
  const pendingRenderTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPlaying) return;

    if (isInteractingRef.current) {
      lastModifiedAtRef.current = project.modifiedAt;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const playheadChanged = playheadPosition !== lastPlayheadForRenderRef.current;
    const modifiedChanged = project.modifiedAt !== lastModifiedAtRef.current;

    lastModifiedAtRef.current = project.modifiedAt;
    lastPlayheadForRenderRef.current = playheadPosition;

    const previousRenderTime = lastPreviewRenderTimeRef.current;
    const isLargeJump =
      Math.abs(playheadPosition - previousRenderTime) > 1 ||
      playheadPosition < previousRenderTime - 0.25;
    if (isLargeJump) {
      releaseScrubVideoElements();
    }
    lastPreviewRenderTimeRef.current = playheadPosition;

    const doRender = async (time: number) => {
      if (renderInFlightRef.current) {
        // Coalesce: remember the latest requested position and render it
        // once the current render completes. This is what makes scrubbing
        // feel responsive even when each render is slower than mouse moves.
        pendingRenderTimeRef.current = time;
        return;
      }
      renderInFlightRef.current = true;
      try {
        const rendered = await renderFrameDirectly(time);
        if (!rendered) {
          await renderFallbackFrame(time);
        }
      } finally {
        renderInFlightRef.current = false;
        const next = pendingRenderTimeRef.current;
        if (next !== null && next !== time) {
          pendingRenderTimeRef.current = null;
          doRender(next);
        } else {
          pendingRenderTimeRef.current = null;
        }
      }
    };

    if (playheadChanged) {
      doRender(playheadPosition);
    } else if (modifiedChanged) {
      if (modifiedRenderTimerRef.current) {
        clearTimeout(modifiedRenderTimerRef.current);
      }
      modifiedRenderTimerRef.current = setTimeout(() => {
        modifiedRenderTimerRef.current = null;
        doRender(playheadPosition);
      }, 150);
    }

    return () => {
      if (modifiedRenderTimerRef.current) {
        clearTimeout(modifiedRenderTimerRef.current);
        modifiedRenderTimerRef.current = null;
      }
    };
  }, [
    playheadPosition,
    isPlaying,
    isScrubbing,
    renderFrameDirectly,
    renderFallbackFrame,
    releaseScrubVideoElements,
    project.modifiedAt,
    isDark,
  ]);

  const [previewInvalidateCounter, setPreviewInvalidateCounter] = useState(0);
  useEffect(() => {
    const handler = () => {
      processedAudioBufferCacheRef.current.clear();
      if (audioGraphRef.current) {
        audioGraphRef.current.seekTo(getMasterClock().currentTime);
      }
      setPreviewInvalidateCounter((c) => c + 1);
    };
    window.addEventListener("openreel:preview-invalidate", handler);
    return () => window.removeEventListener("openreel:preview-invalidate", handler);
  }, []);

  useEffect(() => {
    if (isPlaying || previewInvalidateCounter === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderFrameDirectly(playheadPosition);
  }, [previewInvalidateCounter, isPlaying, renderFrameDirectly, playheadPosition]);

  const selectedClipId = useMemo(() => {
    const clipSelection = selectedItems.find((item) => item.type === "clip");
    return clipSelection?.id || null;
  }, [selectedItems]);

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const track of timelineTracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId);
      if (clip) return clip;
    }
    return null;
  }, [selectedClipId, timelineTracks]);

  const clipAtPlayhead = useMemo(() => {
    const videoTracks = timelineTracks.filter(
      (t) => (t.type === "video" || t.type === "image") && !t.hidden,
    );
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;
        if (playheadPosition >= clipStart && playheadPosition < clipEnd) {
          return clip;
        }
      }
    }
    return null;
  }, [timelineTracks, playheadPosition]);

  const selectedTextClipId = useMemo(() => {
    const textClipSelection = selectedItems.find(
      (item) => item.type === "text-clip",
    );
    return textClipSelection?.id || null;
  }, [selectedItems]);

  const selectedTextClip = useMemo<TextClip | null>(() => {
    if (!selectedTextClipId) return null;
    return allTextClips.find((clip) => clip.id === selectedTextClipId) || null;
  }, [selectedTextClipId, allTextClips]);

  const activeTextClip = selectedTextClip;

  const clipBounds = useMemo(() => {
    const clip = selectedClip || clipAtPlayhead;
    if (!clip || !canvasRef.current || !overlayRef.current) return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const clipTransform = clip.transform || {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchor: { x: 0.5, y: 0.5 },
    };

    const transform = liveTransform
      ? {
          ...clipTransform,
          position: liveTransform.position,
          scale: liveTransform.scale,
        }
      : clipTransform;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    const fitMode =
      !clipTransform.fitMode || clipTransform.fitMode === "none"
        ? "contain"
        : clipTransform.fitMode;
    const mediaItem = getMediaItem(clip.mediaId);
    const mediaWidth = mediaItem?.metadata?.width ?? canvasWidth;
    const mediaHeight = mediaItem?.metadata?.height ?? canvasHeight;

    let baseWidth: number;
    let baseHeight: number;

    if (fitMode === "stretch") {
      baseWidth = canvasWidth;
      baseHeight = canvasHeight;
    } else if (fitMode === "cover") {
      const mediaAspect = mediaWidth / mediaHeight;
      if (mediaAspect > canvasAspect) {
        baseHeight = canvasHeight;
        baseWidth = canvasHeight * mediaAspect;
      } else {
        baseWidth = canvasWidth;
        baseHeight = canvasWidth / mediaAspect;
      }
    } else {
      const mediaAspect = mediaWidth / mediaHeight;
      if (mediaAspect > canvasAspect) {
        baseWidth = canvasWidth;
        baseHeight = canvasWidth / mediaAspect;
      } else {
        baseHeight = canvasHeight;
        baseWidth = canvasHeight * mediaAspect;
      }
    }

    const clipWidth = baseWidth * transform.scale.x * displayScale;
    const clipHeight = baseHeight * transform.scale.y * displayScale;

    const offsetX = transform.position.x * displayScale;
    const offsetY = transform.position.y * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + actualWidth / 2 + offsetX;
    const centerY = canvasOffsetY + actualHeight / 2 + offsetY;

    return {
      x: centerX - clipWidth / 2,
      y: centerY - clipHeight / 2,
      width: clipWidth,
      height: clipHeight,
      centerX,
      centerY,
      displayScale,
    };
  }, [
    selectedClip,
    clipAtPlayhead,
    settings.width,
    settings.height,
    canvasSize,
    liveTransform,
    getMediaItem,
  ]);

  const textClipBounds = useMemo(() => {
    if (!selectedTextClip || !canvasRef.current || !overlayRef.current)
      return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const { transform, style, text } = selectedTextClip;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    const lines = text.split("\n");
    const lineHeight = style.fontSize * style.lineHeight;
    const estimatedHeight = lines.length * lineHeight;
    const estimatedWidth =
      style.fontSize * Math.max(...lines.map((l) => l.length)) * 0.6;

    const textWidth = estimatedWidth * transform.scale.x * displayScale;
    const textHeight = estimatedHeight * transform.scale.y * displayScale;

    const posX = transform.position.x * canvasWidth * displayScale;
    const posY = transform.position.y * canvasHeight * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + posX;
    const centerY = canvasOffsetY + posY;

    return {
      x: centerX - textWidth / 2,
      y: centerY - textHeight / 2,
      width: textWidth,
      height: textHeight,
      centerX,
      centerY,
      displayScale,
      isTextClip: true,
    };
  }, [selectedTextClip, settings.width, settings.height, canvasSize]);

  const selectedShapeClipId = useMemo(() => {
    const shapeClipSelection = selectedItems.find(
      (item) => item.type === "shape-clip",
    );
    return shapeClipSelection?.id || null;
  }, [selectedItems]);

  const selectedShapeClip = useMemo<
    ShapeClip | SVGClip | StickerClip | null
  >(() => {
    if (!selectedShapeClipId) return null;
    return (
      allShapeClips.find((clip) => clip.id === selectedShapeClipId) || null
    );
  }, [selectedShapeClipId, allShapeClips]);

  const activeShapeClip = selectedShapeClip;

  const handlePreviewKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, select, button, [contenteditable='true']",
        )
      ) {
        return;
      }
      const direction =
        event.key === "ArrowLeft"
          ? { x: -1, y: 0 }
          : event.key === "ArrowRight"
            ? { x: 1, y: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: -1 }
              : event.key === "ArrowDown"
                ? { x: 0, y: 1 }
                : null;
      if (!direction || selectedItems.length === 0) return;

      const amount = event.shiftKey ? 10 : 1;
      const pixelX = direction.x * amount;
      const pixelY = direction.y * amount;
      const normalizedX = pixelX / Math.max(1, settings.width);
      const normalizedY = pixelY / Math.max(1, settings.height);
      const pending: Promise<unknown>[] = [];
      let changed = false;

      beginHistoryGroup("Nudge canvas selection");
      for (const item of selectedItems) {
        if (item.type === "clip") {
          const clip = timelineTracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === item.id);
          if (!clip) continue;
          changed = true;
          pending.push(
            updateClipTransform(item.id, {
              position: {
                x: clip.transform.position.x + pixelX,
                y: clip.transform.position.y + pixelY,
              },
            }),
          );
          continue;
        }

        if (item.type === "text-clip") {
          const clip = allTextClips.find((candidate) => candidate.id === item.id);
          if (!clip) continue;
          changed = true;
          updateTextTransform(item.id, {
            position: {
              x: clip.transform.position.x + normalizedX,
              y: clip.transform.position.y + normalizedY,
            },
          });
          continue;
        }

        if (item.type === "shape-clip") {
          const clip = allShapeClips.find((candidate) => candidate.id === item.id);
          if (!clip) continue;
          changed = true;
          updateShapeTransform(item.id, {
            position: {
              x: clip.transform.position.x + normalizedX,
              y: clip.transform.position.y + normalizedY,
            },
          });
        }
      }

      if (!changed) {
        endHistoryGroup();
        return;
      }
      event.preventDefault();
      void Promise.all(pending).finally(endHistoryGroup);
    },
    [
      allShapeClips,
      allTextClips,
      beginHistoryGroup,
      endHistoryGroup,
      selectedItems,
      settings.height,
      settings.width,
      timelineTracks,
      updateClipTransform,
      updateShapeTransform,
      updateTextTransform,
    ],
  );

  const [hoveredGraphicClipId, setHoveredGraphicClipId] = useState<string | null>(null);

  const activeGraphicClips = useMemo(() => {
    // getActiveShapeClips returns all graphic clip types (shapes, SVGs, and stickers)
    return getActiveShapeClips(allShapeClips, playheadPosition);
  }, [allShapeClips, playheadPosition]);

  const shapeClipBounds = useMemo(() => {
    if (!selectedShapeClip || !canvasRef.current || !overlayRef.current)
      return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const { transform } = selectedShapeClip;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    let baseWidth: number;
    let baseHeight: number;

    if (selectedShapeClip.type === "svg") {
      const svgClip = selectedShapeClip as SVGClip;
      const svgWidth = svgClip.viewBox?.width || 200;
      const svgHeight = svgClip.viewBox?.height || 200;
      const svgAspect = svgWidth / svgHeight;
      if (svgAspect > 1) {
        baseWidth = canvasWidth;
        baseHeight = canvasWidth / svgAspect;
      } else {
        baseHeight = canvasHeight;
        baseWidth = canvasHeight * svgAspect;
      }
    } else {
      baseWidth = 200;
      baseHeight = 200;
    }

    const shapeWidth = baseWidth * transform.scale.x * displayScale;
    const shapeHeight = baseHeight * transform.scale.y * displayScale;

    const posX = transform.position.x * canvasWidth * displayScale;
    const posY = transform.position.y * canvasHeight * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + posX;
    const centerY = canvasOffsetY + posY;

    return {
      x: centerX - shapeWidth / 2,
      y: centerY - shapeHeight / 2,
      width: shapeWidth,
      height: shapeHeight,
      centerX,
      centerY,
      displayScale,
      isShapeClip: true,
    };
  }, [selectedShapeClip, settings.width, settings.height, canvasSize]);

  const getGraphicClipDisplayBounds = useCallback(
    (clip: ShapeClip | SVGClip | StickerClip) => {
      if (!canvasRef.current || !overlayRef.current) return null;

      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      const overlayRect = overlay.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      const { transform } = clip;

      const canvasWidth = settings.width;
      const canvasHeight = settings.height;

      const canvasAspect = canvasWidth / canvasHeight;
      const elementAspect = canvasRect.width / canvasRect.height;

      let actualWidth: number;
      let actualHeight: number;
      let letterboxOffsetX = 0;
      let letterboxOffsetY = 0;

      if (elementAspect > canvasAspect) {
        actualHeight = canvasRect.height;
        actualWidth = actualHeight * canvasAspect;
        letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
      } else {
        actualWidth = canvasRect.width;
        actualHeight = actualWidth / canvasAspect;
        letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
      }

      const displayScale = actualWidth / canvasWidth;

      let baseWidth: number;
      let baseHeight: number;

      if (clip.type === "svg") {
        const svgClip = clip as SVGClip;
        const svgW = svgClip.viewBox?.width || 200;
        const svgH = svgClip.viewBox?.height || 200;
        const svgAspect = svgW / svgH;
        if (svgAspect > 1) {
          baseWidth = canvasWidth;
          baseHeight = canvasWidth / svgAspect;
        } else {
          baseHeight = canvasHeight;
          baseWidth = canvasHeight * svgAspect;
        }
      } else {
        baseWidth = 200;
        baseHeight = 200;
      }

      const shapeWidth = baseWidth * transform.scale.x * displayScale;
      const shapeHeight = baseHeight * transform.scale.y * displayScale;

      const posX = transform.position.x * canvasWidth * displayScale;
      const posY = transform.position.y * canvasHeight * displayScale;

      const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
      const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

      const centerX = canvasOffsetX + posX;
      const centerY = canvasOffsetY + posY;

      return {
        x: centerX - shapeWidth / 2,
        y: centerY - shapeHeight / 2,
        width: shapeWidth,
        height: shapeHeight,
        centerX,
        centerY,
      };
    },
    [settings.width, settings.height],
  );

  const findGraphicClipAtPoint = useCallback(
    (clientX: number, clientY: number): ShapeClip | SVGClip | StickerClip | null => {
      if (!overlayRef.current) return null;
      const overlayRect = overlayRef.current.getBoundingClientRect();
      const pointX = clientX - overlayRect.left;
      const pointY = clientY - overlayRect.top;

      for (let i = activeGraphicClips.length - 1; i >= 0; i--) {
        const clip = activeGraphicClips[i];
        const bounds = getGraphicClipDisplayBounds(clip);
        if (!bounds) continue;

        if (
          pointX >= bounds.x &&
          pointX <= bounds.x + bounds.width &&
          pointY >= bounds.y &&
          pointY <= bounds.y + bounds.height
        ) {
          return clip;
        }
      }
      return null;
    },
    [activeGraphicClips, getGraphicClipDisplayBounds],
  );

  const selectedSubtitleId = useMemo(() => {
    const subtitleSelection = selectedItems.find(
      (item) => item.type === "subtitle",
    );
    return subtitleSelection?.id || null;
  }, [selectedItems]);

  const selectedSubtitleObj = useMemo<Subtitle | null>(() => {
    if (!selectedSubtitleId) return null;
    return allSubtitles.find((sub) => sub.id === selectedSubtitleId) || null;
  }, [selectedSubtitleId, allSubtitles]);

  const subtitleBounds = useMemo(() => {
    if (!selectedSubtitleObj || !canvasRef.current || !overlayRef.current)
      return null;
    if (
      playheadPosition < selectedSubtitleObj.startTime ||
      playheadPosition >= selectedSubtitleObj.endTime
    )
      return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const fontSize = selectedSubtitleObj.style?.fontSize || 24;
    const position = selectedSubtitleObj.style?.position || "bottom";
    const lines = selectedSubtitleObj.text.split("\n");
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    let baseY: number;
    if (position === "top") {
      baseY = fontSize * 2;
    } else if (position === "center") {
      baseY = canvasHeight / 2 - totalHeight / 2;
    } else {
      baseY = canvasHeight - fontSize * 2 - totalHeight;
    }

    const subtitleWidth = canvasWidth * 0.8 * displayScale;
    const subtitleHeight = totalHeight * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + actualWidth / 2;
    const topY = canvasOffsetY + baseY * displayScale;

    return {
      x: centerX - subtitleWidth / 2,
      y: topY,
      width: subtitleWidth,
      height: subtitleHeight,
      centerX,
      centerY: topY + subtitleHeight / 2,
      displayScale,
    };
  }, [
    selectedSubtitleObj,
    settings.width,
    settings.height,
    canvasSize,
    playheadPosition,
  ]);

  const handleHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      const clip = selectedClip || clipAtPlayhead;
      if (!clip) return;

      const transform = clip.transform || {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
        anchor: { x: 0.5, y: 0.5 },
      };

      isInteractingRef.current = true;
      setInteractionMode("resize");
      setActiveHandle(handle);
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [selectedClip, clipAtPlayhead],
  );

  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const clip = selectedClip || clipAtPlayhead;
      if (!clip) return;

      const transform = clip.transform || {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
        anchor: { x: 0.5, y: 0.5 },
      };

      isInteractingRef.current = true;
      setInteractionMode("move");
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [selectedClip, clipAtPlayhead],
  );

  const handleTextClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeTextClip) return;

      const { transform } = activeTextClip;

      isInteractingRef.current = true;
      setInteractionMode("move");
      setInteractionTargetType("text-clip");
      interactionTargetIdRef.current = activeTextClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeTextClip],
  );

  const handleTextHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeTextClip) return;

      const { transform } = activeTextClip;

      isInteractingRef.current = true;
      setInteractionMode("resize");
      setActiveHandle(handle);
      setInteractionTargetType("text-clip");
      interactionTargetIdRef.current = activeTextClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeTextClip],
  );

  const handleShapeClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeShapeClip) return;

      const { transform } = activeShapeClip;

      isInteractingRef.current = true;
      setInteractionMode("move");
      setInteractionTargetType("shape-clip");
      interactionTargetIdRef.current = activeShapeClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeShapeClip],
  );

  const handleShapeHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeShapeClip) return;

      const { transform } = activeShapeClip;

      isInteractingRef.current = true;
      setInteractionMode("resize");
      setActiveHandle(handle);
      setInteractionTargetType("shape-clip");
      interactionTargetIdRef.current = activeShapeClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeShapeClip],
  );

  const handleGraphicsMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (interactionMode !== "none") {
        setHoveredGraphicClipId(null);
        return;
      }

      const clip = findGraphicClipAtPoint(e.clientX, e.clientY);
      setHoveredGraphicClipId(clip ? clip.id : null);
    },
    [interactionMode, findGraphicClipAtPoint],
  );

  const handleGraphicsClick = useCallback(
    (e: React.MouseEvent) => {
      if (interactionMode !== "none") return;

      const clip = findGraphicClipAtPoint(e.clientX, e.clientY);
      if (clip) {
        select({ type: "shape-clip", id: clip.id });
        e.stopPropagation();
      }
    },
    [interactionMode, findGraphicClipAtPoint, select],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (interactionMode === "none" || !interactionStartRef.current) return;

      if (
        interactionTargetType === "text-clip" &&
        textClipBounds &&
        activeTextClip
      ) {
        const deltaX = e.clientX - interactionStartRef.current.x;
        const deltaY = e.clientY - interactionStartRef.current.y;
        const { displayScale } = textClipBounds;

        let newTransform: {
          position?: { x: number; y: number };
          scale?: { x: number; y: number };
        } = {};

        if (interactionMode === "move") {
          const rawX =
            interactionStartRef.current.transform.x +
            deltaX / displayScale / settings.width;
          const rawY =
            interactionStartRef.current.transform.y +
            deltaY / displayScale / settings.height;
          const halfWidth =
            textClipBounds.width / displayScale / settings.width / 2;
          const halfHeight =
            textClipBounds.height / displayScale / settings.height / 2;
          const snapped = snapCanvasPosition({
            x: rawX,
            y: rawY,
            xCandidates: [
              { value: halfWidth, guide: 0 },
              { value: 0.5, guide: 0.5 },
              { value: 1 - halfWidth, guide: 1 },
            ],
            yCandidates: [
              { value: halfHeight, guide: 0 },
              { value: 0.5, guide: 0.5 },
              { value: 1 - halfHeight, guide: 1 },
            ],
            thresholdX: 8 / displayScale / settings.width,
            thresholdY: 8 / displayScale / settings.height,
            enabled: canvasSnappingEnabled && !e.altKey,
          });
          setCanvasSnapGuides({ x: snapped.guideX, y: snapped.guideY });
          newTransform = { position: { x: snapped.x, y: snapped.y } };
        } else if (interactionMode === "resize" && activeHandle) {
          setCanvasSnapGuides({ x: null, y: null });
          const startTransform = interactionStartRef.current.transform;
          let newScaleX = startTransform.scaleX;
          let newScaleY = startTransform.scaleY;

          const scaleDeltaX = deltaX / displayScale / 100;
          const scaleDeltaY = deltaY / displayScale / 100;

          switch (activeHandle) {
            case "e":
            case "se":
            case "ne":
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "w":
            case "sw":
            case "nw":
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "s":
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
            case "n":
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
          }

          newTransform = {
            position: { x: startTransform.x, y: startTransform.y },
            scale: { x: newScaleX, y: newScaleY },
          };
        }

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            const now = performance.now();
            if (
              now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS &&
              interactionTargetIdRef.current
            ) {
              lastStoreUpdateRef.current = now;
              updateTextTransform(interactionTargetIdRef.current, newTransform);
            }
            rafIdRef.current = null;
          });
        }
        return;
      }

      if (
        interactionTargetType === "shape-clip" &&
        shapeClipBounds &&
        activeShapeClip
      ) {
        const deltaX = e.clientX - interactionStartRef.current.x;
        const deltaY = e.clientY - interactionStartRef.current.y;
        const { displayScale } = shapeClipBounds;

        let newTransform: {
          position?: { x: number; y: number };
          scale?: { x: number; y: number };
        } = {};

        if (interactionMode === "move") {
          const rawX =
            interactionStartRef.current.transform.x +
            deltaX / displayScale / settings.width;
          const rawY =
            interactionStartRef.current.transform.y +
            deltaY / displayScale / settings.height;
          const halfWidth =
            shapeClipBounds.width / displayScale / settings.width / 2;
          const halfHeight =
            shapeClipBounds.height / displayScale / settings.height / 2;
          const snapped = snapCanvasPosition({
            x: rawX,
            y: rawY,
            xCandidates: [
              { value: halfWidth, guide: 0 },
              { value: 0.5, guide: 0.5 },
              { value: 1 - halfWidth, guide: 1 },
            ],
            yCandidates: [
              { value: halfHeight, guide: 0 },
              { value: 0.5, guide: 0.5 },
              { value: 1 - halfHeight, guide: 1 },
            ],
            thresholdX: 8 / displayScale / settings.width,
            thresholdY: 8 / displayScale / settings.height,
            enabled: canvasSnappingEnabled && !e.altKey,
          });
          setCanvasSnapGuides({ x: snapped.guideX, y: snapped.guideY });
          newTransform = { position: { x: snapped.x, y: snapped.y } };
        } else if (interactionMode === "resize" && activeHandle) {
          setCanvasSnapGuides({ x: null, y: null });
          const startTransform = interactionStartRef.current.transform;
          let newScaleX = startTransform.scaleX;
          let newScaleY = startTransform.scaleY;

          const scaleDeltaX = deltaX / displayScale / 100;
          const scaleDeltaY = deltaY / displayScale / 100;

          switch (activeHandle) {
            case "e":
            case "se":
            case "ne":
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "w":
            case "sw":
            case "nw":
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "s":
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
            case "n":
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
          }

          newTransform = {
            position: { x: startTransform.x, y: startTransform.y },
            scale: { x: newScaleX, y: newScaleY },
          };
        }

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            const now = performance.now();
            if (
              now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS &&
              interactionTargetIdRef.current
            ) {
              lastStoreUpdateRef.current = now;
              updateShapeTransform(
                interactionTargetIdRef.current,
                newTransform,
              );
            }
            rafIdRef.current = null;
          });
        }
        return;
      }

      if (!clipBounds) return;
      const clip = selectedClip || clipAtPlayhead;
      if (!clip) return;

      const deltaX = e.clientX - interactionStartRef.current.x;
      const deltaY = e.clientY - interactionStartRef.current.y;
      const { displayScale } = clipBounds;

      let newTransform: {
        position?: { x: number; y: number };
        scale?: { x: number; y: number };
      } = {};

      if (interactionMode === "move") {
        const rawX =
          interactionStartRef.current.transform.x + deltaX / displayScale;
        const rawY =
          interactionStartRef.current.transform.y + deltaY / displayScale;
        const halfWidth = clipBounds.width / displayScale / 2;
        const halfHeight = clipBounds.height / displayScale / 2;
        const snapped = snapCanvasPosition({
          x: rawX,
          y: rawY,
          xCandidates: [
            { value: -settings.width / 2 + halfWidth, guide: 0 },
            { value: 0, guide: 0.5 },
            { value: settings.width / 2 - halfWidth, guide: 1 },
          ],
          yCandidates: [
            { value: -settings.height / 2 + halfHeight, guide: 0 },
            { value: 0, guide: 0.5 },
            { value: settings.height / 2 - halfHeight, guide: 1 },
          ],
          thresholdX: 8 / displayScale,
          thresholdY: 8 / displayScale,
          enabled: canvasSnappingEnabled && !e.altKey,
        });
        setCanvasSnapGuides({ x: snapped.guideX, y: snapped.guideY });
        newTransform = { position: { x: snapped.x, y: snapped.y } };
      } else if (interactionMode === "resize" && activeHandle) {
        setCanvasSnapGuides({ x: null, y: null });
        const startTransform = interactionStartRef.current.transform;
        let newScaleX = startTransform.scaleX;
        let newScaleY = startTransform.scaleY;
        let newX = startTransform.x;
        let newY = startTransform.y;

        // Base dimensions match how the clip is actually rendered so resize
        // handles track the cursor regardless of fit mode.
        const baseScaleW =
          (clipBounds.width / displayScale) /
          Math.max(0.001, startTransform.scaleX);
        const baseScaleH =
          (clipBounds.height / displayScale) /
          Math.max(0.001, startTransform.scaleY);

        const scaleDeltaX = deltaX / displayScale / (baseScaleW / 2);
        const scaleDeltaY = deltaY / displayScale / (baseScaleH / 2);

        switch (activeHandle) {
          case "e":
            newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
            if (lockAspectRatio) newScaleY = newScaleX;
            break;
          case "w":
            newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
            if (lockAspectRatio) newScaleY = newScaleX;
            newX = startTransform.x + deltaX / displayScale / 2;
            break;
          case "s":
            newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
            if (lockAspectRatio) newScaleX = newScaleY;
            break;
          case "n":
            newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
            if (lockAspectRatio) newScaleX = newScaleY;
            newY = startTransform.y + deltaY / displayScale / 2;
            break;
          case "se":
            if (lockAspectRatio) {
              const avgDelta = (scaleDeltaX + scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
            }
            break;
          case "sw":
            if (lockAspectRatio) {
              const avgDelta = (-scaleDeltaX + scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
            }
            newX = startTransform.x + deltaX / displayScale / 2;
            break;
          case "ne":
            if (lockAspectRatio) {
              const avgDelta = (scaleDeltaX - scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
            }
            newY = startTransform.y + deltaY / displayScale / 2;
            break;
          case "nw":
            if (lockAspectRatio) {
              const avgDelta = (-scaleDeltaX - scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
            }
            newX = startTransform.x + deltaX / displayScale / 2;
            newY = startTransform.y + deltaY / displayScale / 2;
            break;
        }

        newTransform = {
          position: { x: newX, y: newY },
          scale: { x: newScaleX, y: newScaleY },
        };
      }

      pendingTransformRef.current = {
        clipId: clip.id,
        transform: newTransform,
      };

      const currentTransform = clip.transform || {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
      };
      setLiveTransform({
        position: newTransform.position || currentTransform.position,
        scale: newTransform.scale || currentTransform.scale,
      });

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          const now = performance.now();
          if (
            pendingTransformRef.current &&
            now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS
          ) {
            lastStoreUpdateRef.current = now;
            updateClipTransform(
              pendingTransformRef.current.clipId,
              pendingTransformRef.current.transform,
            );
          }
          rafIdRef.current = null;
        });
      }
    },
    [
      interactionMode,
      activeHandle,
      clipBounds,
      selectedClip,
      clipAtPlayhead,
      updateClipTransform,
      settings.width,
      settings.height,
      canvasSnappingEnabled,
      lockAspectRatio,
      interactionTargetType,
      textClipBounds,
      activeTextClip,
      updateTextTransform,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (pendingTransformRef.current) {
      updateClipTransform(
        pendingTransformRef.current.clipId,
        pendingTransformRef.current.transform,
      );
      pendingTransformRef.current = null;
    }
    setInteractionTargetType(null);
    interactionTargetIdRef.current = null;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const wasInteracting = isInteractingRef.current;
    isInteractingRef.current = false;
    setInteractionMode("none");
    setActiveHandle(null);
    interactionStartRef.current = null;
    setLiveTransform(null);
    setCanvasSnapGuides({ x: null, y: null });

    if (wasInteracting) {
      renderFrameDirectly(playheadPosition);
    }
  }, [updateClipTransform, renderFrameDirectly, playheadPosition]);

  const handleCropChange = useCallback(
    (crop: { x: number; y: number; width: number; height: number }) => {
      if (cropClipId) {
        updateClipTransform(cropClipId, { crop });
      }
    },
    [cropClipId, updateClipTransform],
  );

  const handleCropComplete = useCallback(() => {
    setCropMode(false);
  }, [setCropMode]);

  const handleCropCancel = useCallback(() => {
    setCropMode(false);
  }, [setCropMode]);

  useEffect(() => {
    if (interactionMode !== "none") {
      const handleGlobalMouseUp = () => {
        if (pendingTransformRef.current) {
          updateClipTransform(
            pendingTransformRef.current.clipId,
            pendingTransformRef.current.transform,
          );
          pendingTransformRef.current = null;
        }
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const wasInteracting = isInteractingRef.current;
        isInteractingRef.current = false;
        setInteractionMode("none");
        setActiveHandle(null);
        interactionStartRef.current = null;
        setLiveTransform(null);

        if (wasInteracting) {
          renderFrameDirectly(playheadPosition);
        }
      };

      window.addEventListener("mouseup", handleGlobalMouseUp);
      return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
    }
  }, [
    interactionMode,
    renderFrameDirectly,
    playheadPosition,
    updateClipTransform,
  ]);

  const handleScrubClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const newTime = percentage * (actualEndTime || 10);
      seekTo(newTime);
    },
    [actualEndTime, seekTo],
  );

  const handleSkipBack = useCallback(() => {
    seekRelative(-5);
  }, [seekRelative]);

  const handleSkipForward = useCallback(() => {
    const current = useTimelineStore.getState().playheadPosition;
    const end = actualEndTime > 0 ? actualEndTime : project.timeline.duration || 0;
    seekTo(end > 0 ? Math.min(current + 5, end) : current + 5);
  }, [seekTo, actualEndTime, project.timeline.duration]);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      setZoomLevel(1);
      container
        .requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
        })
        .catch((err) => {
          console.error("Error entering fullscreen:", err);
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          setIsFullscreen(false);
        })
        .catch((err) => {
          console.error("Error exiting fullscreen:", err);
        });
    }
  }, []);

  const handleMaximize = useCallback(() => {
    setZoomLevel(1);
    setIsMaximized((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const progressPercentage =
    actualEndTime > 0 ? (playheadPosition / actualEndTime) * 100 : 0;

  const showResizeHandles = !isPlaying && selectedClip && clipBounds;

  const showTextClipHandles = !isPlaying && selectedTextClip && textClipBounds;


  const showShapeClipHandles =
    !isPlaying &&
    selectedShapeClip &&
    shapeClipBounds;

  const showSubtitleOverlay =
    !isPlaying && selectedSubtitleObj && subtitleBounds;

  const cropClip = useMemo(() => {
    if (!cropMode || !cropClipId) return null;

    for (const track of timelineTracks) {
      const clip = track.clips.find((c) => c.id === cropClipId);
      if (clip) return clip;
    }
    return null;
  }, [cropMode, cropClipId, timelineTracks]);

  const cropMediaData = useMemo(() => {
    if (!cropMode || !cropClipId || !cropClip) return null;

    const mediaItem = getMediaItem(cropClip.mediaId);
    if (!mediaItem) return null;

    let src: string | null = null;
    if (mediaItem.blob) {
      src = URL.createObjectURL(mediaItem.blob);
    } else if (mediaItem.originalUrl) {
      src = mediaItem.originalUrl;
    }

    if (!src) return null;

    return {
      src,
      type: mediaItem.type as "video" | "image",
    };
  }, [cropMode, cropClipId, cropClip, getMediaItem]);

  const cropVideoSrc = cropMediaData?.src ?? null;
  const cropMediaType = cropMediaData?.type ?? "video";

  const shouldShowCropMode = cropMode && cropClipId && cropClip && cropVideoSrc;

  return (
    <div
      ref={containerRef}
      data-tour="preview"
      tabIndex={0}
      aria-label="Preview canvas"
      onKeyDown={handlePreviewKeyDown}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("input, textarea, select, button")) {
          containerRef.current?.focus({ preventScroll: true });
        }
      }}
      className="w-full h-full min-h-0 min-w-0 bg-stage-bg flex flex-col relative group overflow-hidden outline-none"
    >
      {/* ── Panel bar header (mockup: 'Player') ───────────────── */}
      {!isMaximized && !isFullscreen && (
        <div className="flex items-center px-3.5 py-2 border-b border-border bg-bg-1 gap-2.5 min-h-[38px] shrink-0">
          <Text type="label" color="primary" weight="semibold" className="text-[13px] tracking-tight text-fg m-0">Player</Text>
          <div className="ml-auto flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" title="Live preview" />
          </div>
        </div>
      )}

      {/* Crop Mode View - Full Screen Overlay */}
      {shouldShowCropMode && (
        <CropModeView
          clip={cropClip!}
          videoSrc={cropVideoSrc}
          mediaType={cropMediaType}
          currentTime={playheadPosition}
          canvasWidth={canvasSize.width}
          canvasHeight={canvasSize.height}
          onCropChange={handleCropChange}
          onComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}

      {/* Video Area */}
      <div
        ref={videoAreaRef}
        className={`flex-1 min-h-0 min-w-0 relative flex items-center justify-center bg-bg-1 transition-all duration-300 ${
          isMaximized || isFullscreen ? "p-0" : "p-[18px]"
        } ${zoomLevel > 1 ? "overflow-auto" : ""}`}
        onMouseMove={interactionMode !== "none" ? handleMouseMove : undefined}
        onMouseUp={handleMouseUp}
      >
        <div
          ref={overlayRef}
          className={`relative bg-[var(--screen-bg)] overflow-visible transition-all duration-300 ${
            isMaximized || isFullscreen
              ? "rounded-none ring-0 shadow-none"
              : isDark
                ? "shadow-2xl rounded-[10px] ring-1 ring-border shadow-[0_0_50px_rgba(0,0,0,0.5)]"
                : "rounded-[10px] ring-1 ring-border shadow-sm"
          }`}
          style={
            isMaximized || isFullscreen
              ? {
                  width: "100%",
                  height: "100%",
                  maxWidth: "none",
                }
              : {
                  width: `${previewFrameSize.width}px`,
                  height: `${previewFrameSize.height}px`,
                  maxWidth: "100%",
                  maxHeight: "100%",
                }
          }
          onMouseMove={!isPlaying ? handleGraphicsMouseMove : undefined}
          onClick={!isPlaying ? handleGraphicsClick : undefined}
          onMouseLeave={() => setHoveredGraphicClipId(null)}
        >
          <canvas
            ref={canvasRef}
            width={previewRes.width}
            height={previewRes.height}
            className="w-full h-full object-contain bg-[var(--screen-bg)] rounded-[10px]"
            style={{
              cursor: hoveredGraphicClipId && !isPlaying ? "pointer" : "default",
            }}
          />

          {showCompositionGrid && !cropMode ? (
            <div
              aria-label="Composition grid"
              className="pointer-events-none absolute inset-0 z-20"
            >
              {[1, 2].map((line) => (
                <React.Fragment key={line}>
                  <span
                    className="absolute inset-y-0 w-px bg-white/45 shadow-[0_0_1px_rgba(0,0,0,0.9)]"
                    style={{ left: `${(line / 3) * 100}%` }}
                  />
                  <span
                    className="absolute inset-x-0 h-px bg-white/45 shadow-[0_0_1px_rgba(0,0,0,0.9)]"
                    style={{ top: `${(line / 3) * 100}%` }}
                  />
                </React.Fragment>
              ))}
            </div>
          ) : null}

          {showSafeMargins && !cropMode ? (
            <div
              aria-label="Title and action safe margins"
              className="pointer-events-none absolute inset-0 z-20"
            >
              <span className="absolute inset-[5%] border border-dashed border-white/60 shadow-[0_0_1px_rgba(0,0,0,0.9)]" />
              <span className="absolute inset-[10%] border border-white/75 shadow-[0_0_1px_rgba(0,0,0,0.9)]" />
              <span className="absolute left-[10%] top-[10%] rounded-br bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/80">
                Title safe
              </span>
            </div>
          ) : null}

          {canvasSnapGuides.x !== null && !cropMode ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent shadow-[0_0_3px_var(--accent)]"
              style={{ left: `${canvasSnapGuides.x * 100}%` }}
            />
          ) : null}
          {canvasSnapGuides.y !== null && !cropMode ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 z-30 h-px bg-accent shadow-[0_0_3px_var(--accent)]"
              style={{ top: `${canvasSnapGuides.y * 100}%` }}
            />
          ) : null}

          {/* Processing Overlay */}
          <ProcessingOverlay />

          {/* Motion Path Overlay */}
          {motionPathMode && motionPathConfig && motionPathClip && (
            <div className="absolute inset-0 pointer-events-auto z-30">
              <MotionPathOverlay
                config={motionPathConfig}
                canvasWidth={settings.width}
                canvasHeight={settings.height}
                currentTime={playheadPosition - motionPathClip.startTime}
                clipDuration={motionPathClip.duration}
                onPointMove={handleMotionPathPointMove}
                onPointAdd={handleMotionPathPointAdd}
                onPointRemove={handleMotionPathPointRemove}
                onControlPointMove={handleMotionPathControlPointMove}
                disabled={isPlaying}
              />
            </div>
          )}

          {/* Particle Effects Renderer */}
          {particleEffects.length > 0 && (
            <div className="absolute inset-0 pointer-events-none z-20">
              <ParticleRenderer
                effects={particleEffects}
                width={settings.width}
                height={settings.height}
                currentTime={playheadPosition}
                isPlaying={isPlaying}
              />
            </div>
          )}

          {/* Export Overlay */}
          {exportState.isExporting && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
              <div
                role="status"
                aria-live="polite"
                className="w-full max-w-[360px] rounded-xl border border-white/15 bg-neutral-950/95 p-5 text-white shadow-2xl"
              >
                <div className="mb-5 flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/20 ring-1 ring-primary/40">
                    <Loader2 size={21} className="animate-spin text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <Text
                      type="label"
                      weight="semibold"
                      display="block"
                      className="text-sm leading-5 text-white"
                    >
                      Exporting Video
                    </Text>
                    <Text
                      type="supporting"
                      display="block"
                      maxLines={2}
                      className="mt-1 text-xs leading-4 text-white/75"
                    >
                      {exportState.phase || "Preparing..."}
                    </Text>
                  </div>
                </div>

                <div className="mb-4 min-w-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[11px] font-medium text-white/80">
                      Export Progress
                    </span>
                    <span className="shrink-0 font-mono text-[11px] font-semibold text-white">
                      {Math.round(exportState.progress)}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, exportState.progress))}%`,
                      }}
                    />
                  </div>
                </div>

                <Text
                  type="supporting"
                  display="block"
                  className="text-center text-[11px] leading-4 text-white/70"
                >
                  You can keep editing once the export finishes.
                </Text>
              </div>
            </div>
          )}

          {/* Resize/Transform Overlay */}
          {!cropMode && showResizeHandles && clipBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: clipBounds.x,
                top: clipBounds.y,
                width: clipBounds.width,
                height: clipBounds.height,
              }}
            >
              {/* Selection border */}
              <div className="absolute inset-0 border-2 border-primary pointer-events-none" />

              {/* Move handle (center) */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-primary/80 rounded-full flex items-center justify-center cursor-move pointer-events-auto hover:bg-primary transition-colors"
                onMouseDown={handleClipMouseDown}
                title="Drag to move"
              >
                <Move size={14} className="text-white" />
              </div>

              {/* Aspect ratio lock toggle */}
              <Button
                label={lockAspectRatio ? "Unlock aspect ratio" : "Lock aspect ratio"}
                variant="ghost"
                className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] rounded pointer-events-auto transition-colors ${
                  lockAspectRatio
                    ? "bg-primary text-white"
                    : "bg-background-tertiary text-text-secondary border border-border hover:bg-background-elevated"
                }`}
                onClick={() => setLockAspectRatio(!lockAspectRatio)}
              >
                {lockAspectRatio ? "🔒 Locked" : "🔓 Free"}
              </Button>

              {/* Corner resize handles */}
              <div
                className="absolute -left-2 -top-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-nw-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "nw")}
              />
              <div
                className="absolute -right-2 -top-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-ne-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "ne")}
              />
              <div
                className="absolute -left-2 -bottom-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-sw-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "sw")}
              />
              <div
                className="absolute -right-2 -bottom-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-se-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "se")}
              />

              {/* Edge resize handles */}
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-4 bg-white border-2 border-primary rounded-sm cursor-n-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "n")}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-6 h-4 bg-white border-2 border-primary rounded-sm cursor-s-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "s")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-6 bg-white border-2 border-primary rounded-sm cursor-w-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "w")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 bg-white border-2 border-primary rounded-sm cursor-e-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "e")}
              />
            </div>
          )}

          {/* Text Clip Resize/Transform Overlay */}
          {showTextClipHandles && textClipBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: textClipBounds.x,
                top: textClipBounds.y,
                width: textClipBounds.width,
                height: textClipBounds.height,
              }}
            >
              {/* Selection border - cyan for text clips */}
              <div className="absolute inset-0 border-2 border-cyan-500 pointer-events-none" />

              {/* Move handle (center) */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-cyan-500/80 rounded-full flex items-center justify-center cursor-move pointer-events-auto hover:bg-cyan-500 transition-colors"
                onMouseDown={handleTextClipMouseDown}
                title="Drag to move text"
              >
                <Move size={14} className="text-white" />
              </div>

              {/* Aspect ratio lock toggle */}
              <Button
                label={lockAspectRatio ? "Unlock aspect ratio" : "Lock aspect ratio"}
                variant="ghost"
                className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] rounded pointer-events-auto transition-colors ${
                  lockAspectRatio
                    ? "bg-cyan-500 text-white"
                    : "bg-background-tertiary text-text-secondary border border-border hover:bg-background-elevated"
                }`}
                onClick={() => setLockAspectRatio(!lockAspectRatio)}
              >
                {lockAspectRatio ? "🔒 Locked" : "🔓 Free"}
              </Button>

              {/* Corner resize handles */}
              <div
                className="absolute -left-2 -top-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-nw-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "nw")}
              />
              <div
                className="absolute -right-2 -top-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-ne-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "ne")}
              />
              <div
                className="absolute -left-2 -bottom-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-sw-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "sw")}
              />
              <div
                className="absolute -right-2 -bottom-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-se-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "se")}
              />

              {/* Edge resize handles */}
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-n-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "n")}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-6 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-s-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "s")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-6 bg-white border-2 border-cyan-500 rounded-sm cursor-w-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "w")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 bg-white border-2 border-cyan-500 rounded-sm cursor-e-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "e")}
              />
            </div>
          )}

          {/* Shape Clip Resize/Transform Overlay */}
          {showShapeClipHandles && shapeClipBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: shapeClipBounds.x,
                top: shapeClipBounds.y,
                width: shapeClipBounds.width,
                height: shapeClipBounds.height,
              }}
            >
              {selectedShapeClip.type !== "svg" && (
                <div className="absolute inset-0 border-2 border-green-500 pointer-events-none" />
              )}

              {/* Move handle (center) */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-green-500/80 rounded-full flex items-center justify-center cursor-move pointer-events-auto hover:bg-green-500 transition-colors"
                onMouseDown={handleShapeClipMouseDown}
                title="Drag to move shape"
              >
                <Move size={14} className="text-white" />
              </div>

              {/* Aspect ratio lock toggle */}
              <Button
                label={lockAspectRatio ? "Unlock aspect ratio" : "Lock aspect ratio"}
                variant="ghost"
                className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] rounded pointer-events-auto transition-colors ${
                  lockAspectRatio
                    ? "bg-green-500 text-white"
                    : "bg-background-tertiary text-text-secondary border border-border hover:bg-background-elevated"
                }`}
                onClick={() => setLockAspectRatio(!lockAspectRatio)}
              >
                {lockAspectRatio ? "🔒 Locked" : "🔓 Free"}
              </Button>

              {/* Corner resize handles */}
              <div
                className="absolute -left-2 -top-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-nw-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "nw")}
              />
              <div
                className="absolute -right-2 -top-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-ne-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "ne")}
              />
              <div
                className="absolute -left-2 -bottom-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-sw-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "sw")}
              />
              <div
                className="absolute -right-2 -bottom-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-se-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "se")}
              />

              {/* Edge resize handles */}
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-4 bg-white border-2 border-green-500 rounded-sm cursor-n-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "n")}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-6 h-4 bg-white border-2 border-green-500 rounded-sm cursor-s-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "s")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-6 bg-white border-2 border-green-500 rounded-sm cursor-w-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "w")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 bg-white border-2 border-green-500 rounded-sm cursor-e-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "e")}
              />
            </div>
          )}

          {/* Subtitle Selection Overlay */}
          {showSubtitleOverlay && subtitleBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: subtitleBounds.x,
                top: subtitleBounds.y,
                width: subtitleBounds.width,
                height: subtitleBounds.height,
              }}
            >
              {/* Selection border - yellow/orange for subtitles */}
              <div className="absolute inset-0 border-2 border-yellow-500 rounded-lg pointer-events-none animate-pulse" />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-yellow-500 rounded text-[10px] font-medium text-black whitespace-nowrap">
                Subtitle Selected - Edit in Inspector
              </div>
            </div>
          )}

          {/* Graphic Clip Hover Indicators */}
          {!cropMode && !isPlaying &&
            activeGraphicClips.map((clip) => {
              if (clip.type === "svg") return null;
              if (clip.id === selectedShapeClipId) return null;
              if (clip.id !== hoveredGraphicClipId) return null;
              const bounds = getGraphicClipDisplayBounds(clip);
              if (!bounds) return null;
              return (
                <div
                  key={clip.id}
                  className="absolute pointer-events-none z-10"
                  style={{
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  }}
                >
                  <div className="absolute inset-0 border-2 border-dashed border-white/80 rounded-sm" />
                  <div
                    aria-hidden="true"
                    className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-black/70 rounded text-[10px] text-white whitespace-nowrap"
                  >
                    Click to select
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Player Controls with integrated Scrub Bar */}
      <div
        className={`border-t border-border transition-all duration-300 ${
          isMaximized || isFullscreen
            ? "absolute bottom-0 left-0 right-0 z-50 bg-bg-1 backdrop-blur-sm"
            : "z-20 bg-bg-1"
        }`}
      >
        {/* Scrub Bar - integrated at top of controls */}
        <div
          className="h-1.5 bg-bg-2 cursor-pointer group hover:h-2.5 transition-all relative"
          onClick={handleScrubClick}
        >
          <div
            className="h-full bg-accent relative pointer-events-none shadow-glow"
            style={{ width: `${progressPercentage}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity transform scale-0 group-hover:scale-100 duration-100 border border-black/20" />
          </div>
        </div>

        {/* Controls row */}
        <div className="h-12 px-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] tabular-nums tracking-tight font-medium">
            <span className="text-fg-2">{formatTime(playheadPosition)}</span>
            <span className="text-fg-muted mx-1.5">/</span>
            <span className="text-fg-muted">{formatTime(actualEndTime)}</span>
          </span>
        </div>

        <div className="flex items-center gap-4 mx-auto">
          <IconButton
            label="Skip back 5s"
            icon={<SkipBack size={18} />}
            variant="ghost"
            size="sm"
            onClick={handleSkipBack}
            className="w-8 h-8 grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
          />
          <IconButton
            label={playbackLockedReason ?? (isPlaying ? "Pause" : "Play")}
            icon={
              isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : playbackLockedReason ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Play size={18} fill="currentColor" className="ml-0.5" />
              )
            }
            variant="ghost"
            size="md"
            onClick={() => {
              togglePlayback();
            }}
            isDisabled={Boolean(playbackLockedReason)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              playbackLockedReason
                ? "bg-bg-2 text-fg-muted cursor-not-allowed"
                : "bg-bg-2 text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label="Skip forward 5s"
            icon={<SkipForward size={18} />}
            variant="ghost"
            size="sm"
            onClick={handleSkipForward}
            className="w-8 h-8 grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
          />
        </div>

        <div className="flex gap-1.5 items-center">
          <IconButton
            label={isMuted ? "Unmute" : "Mute"}
            icon={isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            variant="ghost"
            size="sm"
            onClick={() => setIsMuted(!isMuted)}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isMuted
                ? "bg-bg-2 text-status-error"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />

          {/* Aspect ratio (project canvas size) */}
          <div className="relative">
            <Button
              label="Aspect ratio"
              variant="ghost"
              onClick={() => setShowAspectMenu(!showAspectMenu)}
              className="flex items-center gap-1.5 rounded-[7px] bg-bg-2 px-[11px] py-[7px] text-[12px] font-medium text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors"
            >
              <div className="flex items-center gap-1">
                <Proportions size={12} />
                <span>{aspectLabelFor(settings.width, settings.height)}</span>
              </div>
            </Button>
            {showAspectMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowAspectMenu(false)}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-bg-elev border border-border rounded-md shadow-md py-1 z-50 min-w-[120px]">
                  {ASPECT_PRESETS.map((opt) => {
                    const isActive =
                      settings.width === opt.width &&
                      settings.height === opt.height;
                    return (
                      <Button
                        key={opt.label}
                        label={`${opt.label} ${opt.width} by ${opt.height}`}
                        variant="ghost"
                        onClick={() => {
                          void updateSettings({
                            width: opt.width,
                            height: opt.height,
                          });
                          setShowAspectMenu(false);
                        }}
                        className={`w-full px-3 py-1.5 text-[11px] font-mono text-left hover:bg-hover transition-colors flex items-center justify-between gap-3 ${
                          isActive ? "text-accent" : "text-fg-2"
                        }`}
                        >
                        <span>{opt.label}</span>
                        <span className="text-fg-3 text-[10px]">
                          {opt.width}×{opt.height}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Playback Quality (render resolution) */}
          <div className="relative">
            <Button
              label="Playback quality"
              variant="ghost"
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className="rounded-[7px] bg-bg-2 px-[11px] py-[7px] text-[12px] font-medium text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors"
            >
              {PREVIEW_QUALITY_OPTIONS.find((o) => o.value === playbackQuality)
                ?.label ?? "Auto"}
            </Button>
            {showQualityMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowQualityMenu(false)}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-bg-elev border border-border rounded-md shadow-md py-1 z-50 min-w-[80px]">
                  {PREVIEW_QUALITY_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      label={opt.label}
                      variant="ghost"
                      onClick={() => {
                        setPlaybackQuality(opt.value);
                        setShowQualityMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-[11px] font-mono text-left hover:bg-hover transition-colors ${
                        playbackQuality === opt.value
                          ? "text-accent"
                          : "text-fg-2"
                      }`}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Zoom Control */}
          <div className="relative">
            <Button
              label="Preview Zoom"
              variant="ghost"
              onClick={() => setShowZoomMenu(!showZoomMenu)}
              className="flex items-center gap-1.5 rounded-[7px] bg-bg-2 px-[11px] py-[7px] text-[12px] font-medium text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors"
            >
              <div className="flex items-center gap-1">
                <ZoomIn size={12} />
                <span>{Math.round(zoomLevel * 100)}%</span>
              </div>
            </Button>
            {showZoomMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowZoomMenu(false)}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-bg-elev border border-border rounded-md shadow-md py-1 z-50 min-w-[80px]">
                  {ZOOM_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      label={opt.label}
                      variant="ghost"
                      onClick={() => {
                        setZoomLevel(opt.value);
                        setShowZoomMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-[11px] font-mono text-left hover:bg-hover transition-colors ${
                        zoomLevel === opt.value
                          ? "text-accent"
                          : "text-fg-2"
                      }`}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          <IconButton
            label="Canvas snapping"
            icon={<Magnet size={16} />}
            variant="ghost"
            size="sm"
            aria-pressed={canvasSnappingEnabled}
            onClick={() => {
              setCanvasSnappingEnabled((enabled) => !enabled);
              setCanvasSnapGuides({ x: null, y: null });
            }}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              canvasSnappingEnabled
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label="Composition grid"
            icon={<Move size={16} />}
            variant="ghost"
            size="sm"
            aria-pressed={showCompositionGrid}
            onClick={() => setShowCompositionGrid((visible) => !visible)}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              showCompositionGrid
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label="Title and action safe margins"
            icon={<Proportions size={16} />}
            variant="ghost"
            size="sm"
            aria-pressed={showSafeMargins}
            onClick={() => setShowSafeMargins((visible) => !visible)}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              showSafeMargins
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />

          <IconButton
            label={isFullscreen ? "Exit Full Screen" : "Full Screen"}
            icon={<Monitor size={16} />}
            variant="ghost"
            size="sm"
            onClick={handleFullscreen}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isFullscreen
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label={isMaximized ? "Restore Size" : "Maximize Preview"}
            icon={isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            variant="ghost"
            size="sm"
            onClick={handleMaximize}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isMaximized
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
        </div>
        </div>
      </div>
    </div>
  );
};

export default Preview;
