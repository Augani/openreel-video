import { selectVoiceOverPlaybackMuted, useVoiceOverStore } from "../../services/voiceover/voiceover-recorder";
import { followWarpFootage } from "../../services/warp-footage";
import { consumedMaskId } from "@openreel/core/video/content-aware-fill/apply";
import { clipNeedsFrameProcessing, preparePreviewFrame, renderOverlayLayerWithEffects } from "./preview/frame-processing";
import { inputTransformForClip } from "./preview/clip-input-transform";
import { masksForStabilizedFrame } from "./preview/stabilized-masks";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { MobilePreviewTransport } from "./mobile/MobilePreviewTransport";
import { Button as ShadcnButton, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@openreel/ui";
import { EmptyProjectStart } from "./EmptyProjectStart";
import { registerPreviewCanvas } from "./scopes/preview-canvas-registry";
import { notifyPreviewDeviceLoss, registerProgramRenderer } from "./preview/device-loss";
import { ProgramMonitorOverlays } from "./preview/ProgramMonitorOverlays";
import { useVrViewStore } from "../../stores/vr-view-store";
import { DynamicTrimTwoUp } from "./preview/DynamicTrimTwoUp";
import { TrimMonitor } from "./preview/TrimMonitor";
import { MotionTrackingOverlay } from "./preview/MotionTrackingOverlay";
import { PlanarTrackOverlay } from "./preview/PlanarTrackOverlay";
import { CornerPinOverlay } from "./preview/CornerPinOverlay";
import { registerProgramFrameControl } from "./preview/program-frame-control";
import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import type { InputVideoTrack } from "mediabunny";
import { PreviewTimecode } from "./PreviewTimecode";
import { MonitorTabs } from "./MonitorTabs";
import { PreviewScrubber } from "./PreviewScrubber";
import { PreviewTransportControls, PreviewTransportIcon } from "./PreviewTransportControls";
import { PreviewFrameStatus } from "./PreviewFrameStatus";
import { explainUndecodableVideo } from "./preview/undecodable-reason";
import { buildPreviewLabelIndex, previewLabelAt } from "./preview/active-layer-label";
import { hasShortcutFocus } from "../../services/keyboard-shortcuts";
import { ExportProgressOverlay } from "./ExportProgressOverlay";
import { useProjectFonts } from "../../hooks/useProjectFonts";
import { formatFrameTimecode } from "../../utils/frame-timecode";
import { decodeClipAudioBuffer } from "../../utils/decode-clip-audio";
import {
  VolumeX,
} from "@/icons/lucide-compat";
import { cn } from "@openreel/ui";
import { SequenceColorSpaceMenu } from "./preview/SequenceColorSpaceMenu";
import { useProjectStore } from "../../stores/project-store";
import { currentBurnInSource } from "../../utils/burn-in-source";
import { useEditPointStore } from "../../stores/edit-point-store";
import { getMonitorProject } from "../../services/dynamic-trim";
import { startLiveDuckingSync } from "../../services/live-ducking-sync";
import { previewProxyCache, usePreviewProxyStore } from "../../stores/preview-proxy-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useScrubAudio } from "../../hooks/useScrubAudio";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { getRenderBridge } from "../../bridges/render-bridge";
import { renderCacheService } from "../../services/render-cache-service";
import { getEffectsBridge } from "../../bridges/effects-bridge";
import { getTransitionBridge } from "../../bridges/transition-bridge";
import {
  RendererFactory,
  hasAnimatedVideoEffects,
  type Clip,
  getCaptionWrapWidth,
  type Renderer,
  isWebGPUSupported,
  getSpeedEngine,
  getMasterClock,
  getRealtimeAudioGraph,
  getChannelLayout,
  getEnhanceSpeechBalance,
  getEnhanceSpeechMix,
  getReduceReverbParams,
  hasNativePlugins,
  nativePluginSteps,
  initializeAudioEffectsEngine,
  getPreviewAudioEffects,
  splitProfileAwareNoiseReductionEffects,
  resolveClipAudioEffects as resolveTimelineClipAudioEffects,
  resolveClipPlaybackAudioParams,
  resolveClipVolumeAutomation,
  drawProjectParticles,
  MotionRenderer,
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
  type AdjustmentLayerPlacement,
  AdjustmentLayerSchedule,
  planAdjustmentLayers,
  trackHasAdjustableContent,
  drawImageWithBlend,
  type MediaItem,
  getTrackTransitionAudioFades,
  resolveCanvasFitDimensions,
  getMediaItemCapabilities,
  getCompoundClipId,
  createTimelineClipCapabilityResolver,
  getVisibleTrackRenderOrder,
  trackHasAudioItems,
  calculateProjectDuration,
  claimNativeSource,
  NativeCanvasSink,
  createMediaImageBitmap,
  isDevelopedRaw,
  mediaImageVersion,
  frameSampleTime,
} from "@openreel/core";
import { useEngineStore } from "../../stores/engine-store";
import { getPluginRackPreview } from "../../services/plugin-rack-preview";
import { CompoundAudioPreview, requiresComposedAudio } from "../../services/compound-audio-preview";
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
  setPreviewSequencePar,
  getPreviewSequencePar,
  drawFrameWithTransform,
  drawFrameWithMasks,
  applyEffectsToFrame,
  effectMaskBaseFor,
  clipHasEffectMasks,
  getTransitionAtTime,
  setImageLoadCallback,
  disposePreview3DRenderer,
  renderTransitionFrame,
  renderTransitionCanvas,
  getAnimatedTransform,
  applyEmphasisAnimation,
  CropModeView,
  MaskPenOverlay,
  MotionPathOverlay,
  computePreviewResolution,
  PREVIEW_MAX_DIMENSION,
  previewQualityScale,
  PREVIEW_QUALITY_OPTIONS,
} from "./preview/index";
import { preloadVrRuntimeForProject } from "@openreel/core/video/vr-runtime-loader";
import { displayLayoutWidth, normalizeSequencePar, snapshotInDisplaySpace, withDisplaySpace } from "@openreel/core/video/sequence-par";
import { snapCanvasPosition } from "./preview/canvas-snapping";
import { textSelectionLayout } from "./preview/text-selection-layout";
import { previewFrameSize as fitPreviewFrame, previewViewportSize } from "./preview/preview-frame-layout";
import { PreviewTransformControls } from "./preview/PreviewTransformControls";
import { TextInPlaceEditor } from "./preview/TextInPlaceEditor";
import { MaskPenButton } from "./preview/MaskPenButton";
import { ObjectMaskButton } from "./preview/ObjectMaskButton";
import { ObjectMaskOverlay } from "./preview/ObjectMaskOverlay";
import { ProxyToggleButton } from "./preview/ProxyToggleButton";

import { useMaskPenStore } from "../../stores/mask-pen-store";
import { MIN_LAYER_DECODE_ZOOM, canDecodeBelowMonitorSize, playbackSinkSize } from "./preview/playback-sink-size";
import { IntervalGate, NativeFrameGate, VideoFrameTokens } from "./preview/native-frame-gate";
import { isColorBypassed } from "./preview/program-frame-control";
import { DecoderRefusals, admitDecoder, decoderLimitActive, decoderLimitMessage, noticeAfterFailedProxy, precheckDecoder, requestProxyFallback, syncProxyOutcomes, type ProxyFallbackResult, type ProxyRequestLedger } from "./preview/decoder-refusals";
import { proxiesOn, queueProxies } from "../../services/proxy-ingest";
import { captureNativeVideoFrame, decodeFrameWithWebCodecs } from "./preview/video-frame";
import { cacheProjectPreview } from "../../services/project-preview-cache";
import { pausedSeekTime, seekVideoFrame, waitForVideoMetadata } from "./preview/native-video-ready";
import { ScrubFrameCache, blobIdentity, scrubCacheSize, scrubFrameKey } from "./preview/scrub-frame-cache";
import { getSeekAnchorService } from "./preview/seek-anchor-service";
import { createScrubVideoReleaser } from "./preview/scrub-video-release";
import { createBitmapCache, followBitmapBudget, type PreviewBitmapCache } from "./preview/bitmap-cache";
import { APPROXIMATION_DELAY_MS, APPROXIMATION_MAX_DISTANCE, PresentedFrameTracker, isPlainVideoClip } from "./preview/seek-approximation";
import { LatestPreviewFrames, type PreviewFrameRequest, type PreviewFrameState } from "./preview/latest-preview-frames";
import { resolvePlaybackLoop, resolvePlaybackStart } from "../../utils/playback-loop";
import { ProcessingOverlay } from "./ProcessingOverlay";
import { editingFrameDurationMs } from "./editing-frame-rate";
import {
  getPersonSegmentationEngine,
  getBackgroundRemovalEngine,
  withBurnInText,
  createMotionAwareOcclusionMask,
  getStabilizedTransform,
  clipHasWarp,
  getVidstabEngine,
  frameConformFor,
  clipHasTemporalEffects,
  clipHasTimeInterpolation,
  interpretedDisplaySize,
  channelMapNeedsWideSource,
  resolveClipChannelMap,
} from "@openreel/core";
import {
  ByteBudgetCache,
  DEFAULT_GRAPHICS_WHITE_NITS,
  getMediaMemoryBudget,
  estimateDecoderBytes,
  getMemoryGovernor,
  PresentCadenceTracker,
  sharedDroppedFrames,
  subscribeMediaMemoryBudget,
  type MediaMemoryBudget,
} from "@openreel/core";
import { useMemoryPolicy } from "../../hooks/use-memory-policy";
import { FrameDecodeTimeoutError, withDecodeDeadline } from "./preview/decode-deadline";
import { isLookaheadStale, planLookahead, PLAYBACK_LOOKAHEAD_S } from "./preview/playback-lookahead";
import { recordPlaybackEvent, startFrameWatchdog, tracePlaybackLoopGap, tracePlaybackStage } from "./preview/playback-watchdog";
import { sameProjectForPlayback, useStablePlaybackProject } from "./preview/playback-project";
import type {
  GSAPMotionPathPoint,
  MotionPathConfig,
  SegmentationResult,
} from "@openreel/core";

// Immersive video UI: loaded the first time the VR view is switched on or the VR Properties dialog is opened.
const VrMonitorOverlay = React.lazy(() => import("./preview/VrMonitorOverlay").then((m) => ({ default: m.VrMonitorOverlay })));
const VrPropertiesDialog = React.lazy(() => import("./VrPropertiesDialog").then((m) => ({ default: m.VrPropertiesDialog })));
const SpatialPathOverlay = React.lazy(() => import("./preview/SpatialPathOverlay").then((m) => ({ default: m.SpatialPathOverlay })));
const OcioDialog = React.lazy(() => import("./ocio/OcioDialog"));
const ScopesPanel = React.lazy(() => import("./scopes/ScopesPanel").then((m) => ({ default: m.ScopesPanel })));

/** Seek-anchor sampling window: this many sources nearest the playhead are decoded in the background. */
const ANCHOR_SAMPLED_MEDIA = 2;
/** A clip needed within this many seconds (its start, or the transition into it) gets its decoder opened ahead of time. */
const PLAYBACK_DECODER_LOOKAHEAD_S = PLAYBACK_LOOKAHEAD_S;
/** A transition is warmed only when its first frame is at least this far away, so the warm render never overlaps a real one. */
const TRANSITION_WARM_MIN_LEAD_S = 0.4;
/** At most this many look-ahead decoders are held open at once. */
const PLAYBACK_DECODER_LOOKAHEAD_MAX = 2;
/** Seconds of upcoming audio clips whose decoded buffers are kept resident and decoded ahead of time. */
const AUDIO_PREFETCH_SECONDS = 15;

function audioBufferByteSize(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

interface GPULayer {
  bitmap: ImageBitmap;
  transform: ClipTransform;
}

type PreviewClip = Track["clips"][number];
type PreviewFrameSource = Parameters<typeof drawFrameWithTransform>[1];
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
    // Burn-ins on an adjustment layer count from the layer's first frame, like a clip's.
    const effects = withBurnInText(
      layer.effects.filter((effect) => effect.enabled !== false),
      { id: layer.id, startTime: layer.startTime, inPoint: 0 },
      time - layer.startTime,
      currentBurnInSource(),
    ) as Effect[];
    if (effects.length === 0) continue;
    let source: ImageBitmap | null = null;
    let processed: ImageBitmap | null = null;
    try {
      // Effects see display space (stored width x PAR) so blur-like radii are isotropic where the frame is shown.
      source = await snapshotInDisplaySpace(canvas, canvas.width, canvas.height, getPreviewSequencePar());
      processed = await effectsBridge.processEffectList(source, effects);
      if (processed.width <= 0 || processed.height <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      drawImageWithBlend(ctx, processed, layer.blendMode, canvas.width, canvas.height);
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

const clipCssFilterOnly = (clipId: string, clip?: Partial<Pick<Clip, "keyframes">>): string | null => {
  if (clip && hasAnimatedVideoEffects(clip)) return null;
  if (inputTransformForClip(clipId)) return null;
  // Effect masks need the processed picture as a bitmap next to the raw one, not a CSS filter on the draw.
  if (clipHasEffectMasks(clipId)) return null;
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

followWarpFootage();

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
  crop?: ClipTransform["crop"],
): { x: number; y: number } => {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: 1, y: 1 };
  }
  const visibleSourceWidth = crop ? crop.width * sourceWidth : sourceWidth;
  const visibleSourceHeight = crop ? crop.height * sourceHeight : sourceHeight;
  const { width: drawWidth, height: drawHeight } =
    resolveCanvasFitDimensions(
      fitMode,
      visibleSourceWidth,
      visibleSourceHeight,
      canvasWidth,
      canvasHeight,
    );
  return { x: drawWidth / canvasWidth, y: drawHeight / canvasHeight };
};

const GRAPHICS_WHITE_OPTIONS: ReadonlyArray<{ nits: number; label: string }> = [
  { nits: 100, label: "100 nits" },
  { nits: 150, label: "150 nits" },
  { nits: DEFAULT_GRAPHICS_WHITE_NITS, label: "203 nits (BT.2408, default)" },
  { nits: 300, label: "300 nits" },
  { nits: 400, label: "400 nits" },
];

const SEQUENCE_START_TIMECODES: ReadonlyArray<{ label: string; hours: number }> = [
  { label: "00:00:00:00 (default)", hours: 0 },
  { label: "01:00:00:00", hours: 1 },
  { label: "10:00:00:00 (broadcast)", hours: 10 },
];
/** Start timecode for a whole number of hours; drop-frame (`;`) at 29.97 / 59.94. Undefined = the default 00:00:00:00. */
function sequenceStartTimecodeValue(hours: number, frameRate: number): string | undefined {
  if (hours === 0) return undefined;
  const drop = Math.abs(frameRate - 29.97) < 0.02 || Math.abs(frameRate - 59.94) < 0.02;
  return `${String(hours).padStart(2, "0")}:00:00${drop ? ";" : ":"}00`;
}
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

/**
 * True when the Program monitor must show the engine's float-compositor render instead of the direct per-clip draw:
 * ACES / OCIO colour management (its Output Transform), and HDR / Rec.2020 sequences (Rec.2100 PQ and HLG included),
 * whose tone-mapped SDR view only exists in the half-float compositor. That is the same render the export encodes, so
 * the preview shows what the file will contain.
 */
const isAcesProject = (): boolean => {
  const settings = useProjectStore.getState().project.settings;
  return settings.colorManagement === "aces" || settings.colorManagement === "ocio" || settings.workingColorSpace === "rec2020";
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
      displayLayoutWidth(canvasWidth, getPreviewSequencePar()),
      canvasHeight,
      transform.crop,
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
      crop: transform.crop,
    };

    renderer.renderLayer({
      texture,
      transform: gpuTransform,
      effects: [],
      opacity: transform.opacity,
      borderRadius: transform.borderRadius || 0,
      pixelAspect: getPreviewSequencePar(),
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
        displayLayoutWidth(canvasWidth, getPreviewSequencePar()),
        canvasHeight,
        layer.transform.crop,
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
        crop: layer.transform.crop,
      };

      renderer.renderLayer({
        texture,
        transform: gpuTransform,
        effects: [],
        opacity: layer.transform.opacity,
        borderRadius: layer.transform.borderRadius || 0,
        pixelAspect: getPreviewSequencePar(),
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
  getMediaItem: (mediaId: string) => MediaItem | undefined,
): string => {
  const activeSourceIds = tracks
    .filter((track) => !track.hidden)
    .flatMap((track) =>
      track.clips
        .filter(
          (clip) =>
            time >= clip.startTime &&
            time < clip.startTime + clip.duration &&
            getMediaItemCapabilities(getMediaItem(clip.mediaId)).visual,
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
    { clip: shapeClip, time },
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
      { clip: textClip, time },
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
  const phone = usePhoneEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const renderBridgeInitialized = useRef<boolean>(false);
  const lastGoodFrameRef = useRef<ImageBitmap | null>(null);
  const decoderRefusalsRef = useRef(new DecoderRefusals());
  const [decoderLimitHit, setDecoderLimitHit] = useState(false);
  const [decoderFallback, setDecoderFallback] = useState<ProxyFallbackResult | null>(null);
  const proxyRequestedRef = useRef<ProxyRequestLedger>(new Map());
  // The notice must not outlive the refusal: a released decoder or a new limit moves the governor epoch,
  // which retires the refusal (the next frame retries the layer). The governor does not notify on every epoch
  // move, so re-check while the notice is up.
  useEffect(() => {
    if (!decoderLimitHit) return;
    const timer = window.setInterval(() => {
      if (!decoderLimitActive(decoderRefusalsRef.current, getMemoryGovernor())) setDecoderLimitHit(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [decoderLimitHit]);
  useEffect(() => {
    const refusals = decoderRefusalsRef.current;
    return () => refusals.clear();
  }, []);
  // A ready proxy retires its media's refusal explicitly (not via the governor epoch); a failed proxy job
  // drops the "proxy is being built" notice and is not re-queued.
  useEffect(() => {
    let lastRevision = previewProxyCache.store.getState().revision;
    const sync = () => {
      const state = previewProxyCache.store.getState();
      const retryUnavailable = state.revision !== lastRevision;
      lastRevision = state.revision;
      const outcome = syncProxyOutcomes(decoderRefusalsRef.current, proxyRequestedRef.current, state.entries, { retryUnavailable, proxiesOn: state.proxiesOn });
      if (outcome.failed.length) setDecoderFallback(noticeAfterFailedProxy);
      if (outcome.ready.length) setDecoderLimitHit(decoderLimitActive(decoderRefusalsRef.current, getMemoryGovernor()));
    };
    sync();
    return previewProxyCache.store.subscribe(sync);
  }, []);
  const [presentedFrameTime, setPresentedFrameTime] = useState<number | null>(null);
  const [presentedFrameIsFallback, setPresentedFrameIsFallback] = useState(false);
  // Time of the last EXACT paused frame committed to the canvas (a seek
  // approximation never sets it), so a late approximation can never overwrite it.
  const presentedExact = useRef(new PresentedFrameTracker()).current;
  const pausedBusyRef = useRef(false);
  const pausedFramesRef = useRef<LatestPreviewFrames | null>(null);
  if (!pausedFramesRef.current) pausedFramesRef.current = new LatestPreviewFrames();
  const pausedFrames = pausedFramesRef.current;
  const [pausedFrameState, setPausedFrameState] = useState<PreviewFrameState>({ busy: false, time: null, error: null });
  const requestPausedFrameRef = useRef<(time: number) => void>(() => {});
  useEffect(() => pausedFrames.subscribe((state) => {
    pausedBusyRef.current = state.busy;
    setPausedFrameState(state);
  }), [pausedFrames]);
  useEffect(() => () => pausedFrames.cancel(), [pausedFrames]);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const decodeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decodeDebounceResolveRef = useRef<((value: ImageBitmap | null) => void) | null>(
    null,
  );
  const decodeRequestSeqRef = useRef(0);
  const scrubVideoReleaserRef = useRef(createScrubVideoReleaser());
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
  const nativeImageBitmapCacheRef = useRef<PreviewBitmapCache>(createBitmapCache(0.4));
  /** RAW settings identity each cached native-playback still was developed with (stale pixels are dropped on the next play). */
  const nativeImageVersionRef = useRef<Map<string, string>>(new Map());

  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioGraphRef = useRef<ReturnType<typeof getRealtimeAudioGraph> | null>(
    null,
  );
  // Whole-file decoded audio is the largest single item (a 10 min stereo source is ~230 MB), so it
  // lives in a byte-budgeted LRU sized from device memory. Buffers of clips near the playhead are
  // pinned (see getAudioClipsForScheduler); the rest are re-decoded on demand after eviction.
  const pinnedAudioKeysRef = useRef<Set<string>>(new Set());
  const audioBufferCacheRef = useRef(
    new ByteBudgetCache<string, AudioBuffer>(getMediaMemoryBudget().audioBufferBytes, {
      sizeOf: audioBufferByteSize,
      isPinned: (key) => pinnedAudioKeysRef.current.has(key),
    }),
  );
  const audioDecodeInflightRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const processedAudioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const noAudioBufferRef = useRef<Set<string>>(new Set());
  // Decodes that FAILED (as opposed to sources that have no audio). Cleared on every play, so a
  // transient failure (memory pressure, a file still being copied) no longer silences the source
  // until reload.
  const failedAudioBufferRef = useRef<Set<string>>(new Set());

  // Decoded buffers differ between layouts (5.1 sources keep their channels in a 5.1 sequence).
  const channelLayoutForDecode = useProjectStore((state) => getChannelLayout(state.project.settings));
  const decodedLayoutRef = useRef(channelLayoutForDecode);
  if (decodedLayoutRef.current !== channelLayoutForDecode) {
    decodedLayoutRef.current = channelLayoutForDecode;
    audioBufferCacheRef.current.clear();
    audioDecodeInflightRef.current.clear();
    processedAudioBufferCacheRef.current.clear();
    noAudioBufferRef.current.clear();
    failedAudioBufferRef.current.clear();
  }

  const getAudioBufferCacheKey = (mediaId: string, audioTrackIndex?: number, wide = false): string =>
    `${mediaId}:${audioTrackIndex ?? 0}${wide ? ":wide" : ""}`;

  /** A clip whose channel map reads the file's own channels (multichannel sources) decodes every source channel, not the stereo fold-down. */
  const clipDecodesWide = (clip: Clip): boolean => {
    const media = getOriginalMediaItem(clip.mediaId);
    return channelMapNeedsWideSource(resolveClipChannelMap(clip, media), media?.metadata?.channels);
  };

  const loadAudioBuffer = decodeClipAudioBuffer;

  /** Cache lookup, then a single shared decode per key (predecode, lazy decode and the scheduler can all ask). */
  const decodeAudioBufferCached = async (
    cacheKey: string,
    audioContext: AudioContext | BaseAudioContext,
    blob: Blob,
    audioTrackIndex: number,
    sourceChannels?: number,
    wide = false,
  ): Promise<AudioBuffer | null> => {
    const hit = audioBufferCacheRef.current.get(cacheKey);
    if (hit) return hit;
    if (noAudioBufferRef.current.has(cacheKey) || failedAudioBufferRef.current.has(cacheKey)) return null;
    const inflight = audioDecodeInflightRef.current.get(cacheKey);
    if (inflight) return inflight;
    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const { buffer: decoded, failed } = await loadAudioBuffer(audioContext, blob, audioTrackIndex, sourceChannels, wide);
        if (decoded) audioBufferCacheRef.current.set(cacheKey, decoded);
        else if (failed) failedAudioBufferRef.current.add(cacheKey);
        else noAudioBufferRef.current.add(cacheKey);
        return decoded;
      } catch (error) {
        failedAudioBufferRef.current.add(cacheKey);
        throw error;
      } finally {
        audioDecodeInflightRef.current.delete(cacheKey);
      }
    })();
    audioDecodeInflightRef.current.set(cacheKey, task);
    return task;
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
      // Spectral repair edits the decoded source (source-time regions) before anything else, exactly as the export does.
      const spectral = await getRealtimeAudioGraph().prepareSpectralRepair(
        audioBuffer,
        getPreviewAudioEffects(effects.filter((effect) => effect.enabled)),
      );
      audioBuffer = spectral.buffer;
      if (spectral.key) baseCacheKey = `${baseCacheKey}:spectral:${spectral.key}`;
      const previewEffects = spectral.effects;
      // Reduce Reverb and Enhance Speech stay in the list: the graph plays the original at once and swaps each processed source in when
      // the shared job finishes (Reduce Reverb first, Enhance Speech on its result). Starting the first job here (non-blocking)
      // means a warm-up or a pause-then-play has it under way early.
      const enhanceMix = getEnhanceSpeechMix(previewEffects);
      const reverbParams = getReduceReverbParams(previewEffects);
      if (reverbParams) void getRealtimeAudioGraph().getReduceReverbCache().request({ buffer: audioBuffer, params: reverbParams });
      else if (enhanceMix > 0) void getRealtimeAudioGraph().getEnhanceSpeechCache().request({ buffer: audioBuffer, mix: enhanceMix, balance: getEnhanceSpeechBalance(previewEffects) });
      // Hosted plugins: same idea, started early on the decoded source (the graph waits for Reduce Reverb and Enhance Speech first when they are on).
      if (enhanceMix === 0 && !reverbParams && hasNativePlugins(previewEffects)) void getRealtimeAudioGraph().getNativePluginCache().request(audioBuffer, nativePluginSteps(previewEffects)).catch(() => undefined);
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

  const getResolvedClipPlaybackParams = useCallback((clip: PreviewClip) =>
    resolveClipPlaybackAudioParams(clip, {
      tracks: timelineTracksRef.current,
    }, useProjectStore.getState().getMediaItem(clip.mediaId)), []);

  const rendererRef = useRef<Renderer | null>(null);
  const rendererInitializedRef = useRef<boolean>(false);
  const motionRendererRef = useRef<MotionRenderer | null>(null);
  const motionAssetBitmapCacheRef = useRef<PreviewBitmapCache>(createBitmapCache(0.2));

  useEffect(() => () => {
    motionRendererRef.current?.dispose();
    motionRendererRef.current = null;
  }, []);

  const [userMuted, setIsMuted] = useState(false);
  // Voice-over recording silences playback (when asked to) so speakers cannot feed back into the microphone.
  const recordMuted = useVoiceOverStore(selectVoiceOverPlaybackMuted);
  const isMuted = userMuted || recordMuted;
  const [isRenderBridgeReady, setIsRenderBridgeReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [videoAreaSize, setVideoAreaSize] = useState({ width: 0, height: 0 });
  const [rendererType, setRendererType] = useState<string>("none");
  // A canvas that has handed out a "webgpu" context can never give a 2d one: when GPU recovery fails the <canvas> element is
  // replaced (new key) and the Canvas2D renderer is built on the fresh one.
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [gpuUnavailable, setGpuUnavailable] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showCompositionGrid, setShowCompositionGrid] = useState(false);
  const [showSafeMargins, setShowSafeMargins] = useState(false);
  // Immersive video: the sequence's VR Properties dialog and the monitor's VR view toggle (view only, never exported).
  const [vrDialogOpen, setVrDialogOpen] = useState(false);
  const vrViewOn = useVrViewStore((state) => state.enabled);
  const setVrViewOn = useVrViewStore((state) => state.setEnabled);
  const resetVrView = useVrViewStore((state) => state.reset);
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
  const pendingOverlayTransformRef = useRef<{
    kind: "text" | "shape";
    clipId: string;
    transform: { position?: { x: number; y: number }; scale?: { x: number; y: number } };
  } | null>(null);
  const finishCanvasHistoryRef = useRef<(() => void) | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Track if we're currently interacting to prevent re-renders during resize/move
  const isInteractingRef = useRef<boolean>(false);
  // Throttle store updates during interaction (update at most every 32ms ~30fps)
  const lastStoreUpdateRef = useRef<number>(0);
  const STORE_UPDATE_THROTTLE_MS = 32;
  // Throttle playhead updates during playback to reduce React re-renders.
  // The interval follows the project timebase so 60 fps projects publish a
  // 60 Hz playhead instead of being capped at 30 Hz.
  const lastPlayheadUpdateRef = useRef<number>(0);
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
  // Text clip being edited in place on the monitor (double-click a title).
  const [editingTextClipId, setEditingTextClipId] = useState<string | null>(null);

  // Video element cache for native hardware-accelerated frame decoding (thumbnails/scrubbing)
  // Much more reliable than MediaBunny's CanvasSink for random-access seeking
  const videoElementCacheRef = useRef<
    Map<string, { video: HTMLVideoElement; url: string; blob: Blob; lastUsed: number }>
  >(new Map());

  // Downscaled frames decoded while dragging the playhead; revisiting a frame
  // skips the ~100 ms long-GOP seek. 96 MB budget (~46 frames at 960x540).
  const scrubFrameCacheRef = useRef(new ScrubFrameCache(getMediaMemoryBudget().scrubFrameBytes));
  useEffect(() => {
    const apply = (budget: MediaMemoryBudget): void => {
      scrubFrameCacheRef.current.setMaxBytes(budget.scrubFrameBytes);
      audioBufferCacheRef.current.setBudget(budget.audioBufferBytes);
    };
    apply(getMediaMemoryBudget());
    const unsubscribe = subscribeMediaMemoryBudget(apply);
    // The governor counts what these caches hold; under pressure it shrinks their budgets (above).
    const governor = getMemoryGovernor();
    const unregister = [
      // Decoded audio is ArrayBuffer memory: the page's heap and memory figures already include it.
      governor.registerConsumer("preview-audio", { bytes: () => audioBufferCacheRef.current.byteLength, inPageMemory: true }),
      governor.registerConsumer("preview-scrub-frames", { bytes: () => scrubFrameCacheRef.current.byteLength }),
      governor.registerConsumer("preview-bitmaps", {
        bytes: () =>
          nativeImageBitmapCacheRef.current.byteLength +
          imageBitmapCacheRef.current.byteLength +
          motionAssetBitmapCacheRef.current.byteLength,
      }),
    ];
    const unfollow = [
      followBitmapBudget(nativeImageBitmapCacheRef.current, 0.4),
      followBitmapBudget(imageBitmapCacheRef.current, 0.4),
      followBitmapBudget(motionAssetBitmapCacheRef.current, 0.2),
    ];
    return () => {
      unsubscribe();
      for (const stop of unfollow) stop();
      for (const off of unregister) off();
    };
  }, []);

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
    scrubVideoReleaserRef.current.cancel();
    cancelPendingScrubDecode();
    for (const entry of videoElementCacheRef.current.values()) {
      releaseVideoElement(entry);
    }
    videoElementCacheRef.current.clear();
  }, [cancelPendingScrubDecode, releaseVideoElement]);

  const scheduleScrubVideoRelease = useCallback((): void => {
    scrubVideoReleaserRef.current.schedule(releaseScrubVideoElements);
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
        // CSS resizing only moves handles. Replacing the drawing canvas here
        // can discard an in-flight decoded frame when maximizing or resizing.
        // Render paths allocate it at the actual canvas pixel resolution.
      }
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [canvasEpoch]);

  useEffect(() => {
    const videoArea = videoAreaRef.current;
    if (!videoArea) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const next = previewViewportSize(videoArea, { width, height });
        setVideoAreaSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
      }
    });

    resizeObserver.observe(videoArea);
    return () => resizeObserver.disconnect();
  }, []);

  // Project store - subscribe to the entire project to ensure re-renders
  // when any part of the project changes (including clips)
  // Same identity while only waveforms/thumbnails change (they finish in the background mid-playback and would
  // otherwise restart the playback effect: see playback-project.ts).
  // While a dynamic (JKL) trim runs, the monitor renders the trimmed result (never saved): see services/dynamic-trim.ts.
  const storedProject = useProjectStore((state) => state.project);
  const trimPreviewProject = useEditPointStore((state) => state.dynamicTrim?.previewProject ?? null);
  const project = useStablePlaybackProject(trimPreviewProject ?? storedProject);
  // A project that already holds a VR effect loads the VR effects runtime (a lazy chunk) before its first frame; the
  // effects pass also awaits it, so this only hides the wait.
  useEffect(() => {
    preloadVrRuntimeForProject(project);
  }, [project]);
  const fontRevision = useProjectFonts(project);
  const getOriginalMediaItem = useProjectStore((state) => state.getMediaItem);
  const proxySourceRevision = usePreviewProxyStore((state) => state.revision);
  // The revision restarts visual decoding when proxies are created/toggled/removed.
  const getMediaItem = useCallback((id: string) => {
    const item = getOriginalMediaItem(id);
    return item ? previewProxyCache.resolve(project.id, item) : undefined;
    // Source changes must restart callbacks even though the cache lookup is live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getOriginalMediaItem, project.id, proxySourceRevision]);
  const failProxyPlayback = useCallback((id: string, blob: Blob | null) => {
    if (blob) previewProxyCache.failPlayback(id, blob);
  }, []);
  const capabilityMedia = project.mediaLibrary, capabilityCompounds = project.compoundClips;
  const clipCapabilities = useMemo(() => createTimelineClipCapabilityResolver(capabilityMedia, capabilityCompounds), [capabilityMedia, capabilityCompounds]);
  const compoundAudioPreview = useMemo(() => new CompoundAudioPreview(() => useProjectStore.getState()), []);
  useEffect(() => () => { void compoundAudioPreview.dispose().catch(() => {}); }, [compoundAudioPreview]);
  const mediaClipHasVisual = useCallback(
    (clip: PreviewClip) => getCompoundClipId(clip) ? clipCapabilities(clip).visual
      : getMediaItemCapabilities(getMediaItem(clip.mediaId)).visual,
    [clipCapabilities, getMediaItem],
  );
  const mediaClipHasAudio = useCallback(
    (clip: PreviewClip) => clipCapabilities(clip).audio,
    [clipCapabilities],
  );

  useEffect(() => {
    const cachedFrame = lastGoodFrameRef.current;
    lastGoodFrameRef.current = null;
    cachedFrame?.close();
  }, [project, proxySourceRevision]);

  useEffect(() => {
    pausedFrames.cancel();
    releaseScrubVideoElements();
    scrubFrameCacheRef.current.clear();
    for (const entry of decoderCacheRef.current.values()) entry.input[Symbol.dispose]?.();
    decoderCacheRef.current.clear();
    for (const entry of nativeVideoCacheRef.current.values()) releaseVideoElement(entry);
    nativeVideoCacheRef.current.clear();
  }, [project.id, proxySourceRevision, pausedFrames, releaseScrubVideoElements, releaseVideoElement]);

  // Get text clips from TitleEngine
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const allTextClips = useMemo(() => {
    const clips = project.textClips ?? getTitleEngine()?.getAllTextClips() ?? [];
    if (!editingTextClipId) return clips;
    // The in-place editor draws the live text; hide the canvas copy meanwhile.
    return clips.map((clip) =>
      clip.id === editingTextClipId
        ? { ...clip, transform: { ...clip.transform, opacity: 0 } }
        : clip,
    );
  }, [getTitleEngine, project.textClips, editingTextClipId]);

  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const allShapeClips = useMemo(() => {
    if (
      project.shapeClips ||
      project.svgClips ||
      project.stickerClips
    ) {
      return [
        ...(project.shapeClips ?? []),
        ...(project.svgClips ?? []),
        ...(project.stickerClips ?? []),
      ];
    }
    const graphicsEngine = getGraphicsEngine();
    const shapes = graphicsEngine?.getAllShapeClips() || [];
    const svgs = graphicsEngine?.getAllSVGClips() || [];
    const stickers = graphicsEngine?.getAllStickerClips() || [];
    return [...shapes, ...svgs, ...stickers];
  }, [
    getGraphicsEngine,
    project.shapeClips,
    project.stickerClips,
    project.svgClips,
  ]);

  const getMaskEngine = useEngineStore((state) => state.getMaskEngine);
  const clipMasksById = useMemo(() => {
    // While Remove Object is on, its mask only marks what is removed: it no longer cuts the clip (same rule as the export).
    const consumed = new Set<string>();
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const maskId = consumedMaskId(clip);
        if (maskId) consumed.add(maskId);
      }
    }
    const byClip = new Map<string, Mask[]>();
    for (const mask of project.masks ?? []) {
      if (consumed.has(mask.id)) continue;
      const existing = byClip.get(mask.clipId) ?? [];
      byClip.set(mask.clipId, [...existing, mask]);
    }
    return byClip;
  }, [project.masks, project.timeline.tracks]);

  const clipById = useMemo(() => {
    const byId = new Map<string, Clip>();
    for (const track of project.timeline.tracks) for (const clip of track.clips) byId.set(clip.id, clip);
    return byId;
  }, [project.timeline.tracks]);

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
      const clipMasks = clipMasksById.get(clipId) ?? [];
      const masks = clipMasks.length === 0
        ? clipMasks
        : masksForStabilizedFrame(clipById.get(clipId), clipMasks, frame as { width?: number; height?: number; videoWidth?: number; videoHeight?: number }, transform, canvasWidth, canvasHeight, time);
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
          baseFrame: effectMaskBaseFor(frame),
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
    [clipMasksById, clipById, getMaskEngine],
  );

  // Get subtitles from project timeline
  const allSubtitles = useMemo(() => {
    // Hidden tracks (a translation not chosen for the picture) are not drawn.
    return (project.timeline.subtitles || []).filter((cue) => !cue.hidden);
  }, [project.timeline.subtitles]);

  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );
  const updateTextTransform = useProjectStore(
    (state) => state.updateTextTransform,
  );
  const updateTextContent = useProjectStore((state) => state.updateTextContent);
  const updateShapeTransform = useProjectStore(
    (state) => state.updateShapeTransform,
  );
  const beginHistoryGroup = useProjectStore((state) => state.beginHistoryGroup);
  const endHistoryGroup = useProjectStore((state) => state.endHistoryGroup);
  const beginCanvasGesture = useCallback(() => {
    if (finishCanvasHistoryRef.current) return;
    const history = useProjectStore.getState().actionHistory;
    history.beginGroup("Transform canvas selection");
    finishCanvasHistoryRef.current = () => history.endGroup();
  }, []);
  const finishCanvasGesture = useCallback(() => {
    const finish = finishCanvasHistoryRef.current;
    finishCanvasHistoryRef.current = null;
    finish?.();
  }, []);
  const flushOverlayTransform = useCallback(() => {
    const pending = pendingOverlayTransformRef.current;
    pendingOverlayTransformRef.current = null;
    if (pending?.kind === "text") updateTextTransform(pending.clipId, pending.transform);
    else if (pending) updateShapeTransform(pending.clipId, pending.transform);
  }, [updateTextTransform, updateShapeTransform]);
  useEffect(() => {
    const discardPending = () => {
      pendingOverlayTransformRef.current = null;
      pendingTransformRef.current = null;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      finishCanvasGesture();
    };
    discardPending();
    return discardPending;
  }, [project.id, finishCanvasGesture]);
  const updateSettings = useProjectStore((state) => state.updateSettings);
  const [ocioDialogOpen, setOcioDialogOpen] = React.useState(false);
  const timelineTracks = project.timeline.tracks;
  const settings = project.settings;
  // Sequence pixel aspect: the monitor lays out and shows the frame in display space (stored width x PAR).
  const programPar = normalizeSequencePar(settings.pixelAspectRatio);
  const programWidth = displayLayoutWidth(settings.width, programPar);
  setPreviewSequencePar(programPar);
  const editingFrameDuration = editingFrameDurationMs(settings.frameRate);

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
  const hardwareAcceleration = useUIStore((state) => state.hardwareAcceleration);
  const setPlaybackQuality = useUIStore((state) => state.setPlaybackQuality);
  const scopesVisible = useUIStore((state) => state.scopesVisible);
  const setScopesVisible = useUIStore((state) => state.setScopesVisible);
  // Expose the program canvas to the scopes panel (plain assignment, no re-render).
  useEffect(() => {
    registerPreviewCanvas(canvasRef.current);
  });
  useEffect(() => () => registerPreviewCanvas(null), []);
  // Under memory pressure the governor lowers the preview resolution (export is unaffected).
  const memoryPolicy = useMemoryPolicy();
  const previewRes = useMemo(
    () =>
      computePreviewResolution(
        settings.width,
        settings.height,
        PREVIEW_MAX_DIMENSION *
          previewQualityScale(playbackQuality, settings.width, settings.height) *
          memoryPolicy.previewScale,
      ),
    [settings.width, settings.height, playbackQuality, memoryPolicy.previewScale],
  );

  const previewFrameSize = useMemo(
    () => fitPreviewFrame(videoAreaSize, { width: programWidth, height: settings.height }, zoomLevel, phone),
    [settings.height, programWidth, videoAreaSize, zoomLevel, phone],
  );

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
    loopEnabled,
    loopStart,
    loopEnd,
    isScrubbing,
    scrubPosition,
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

    return Math.max(maxEnd, calculateProjectDuration(project));
  }, [project, allTextClips, allShapeClips]);

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
      scrubFrameCacheRef.current.clear();

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
  }, [previewRes.width, previewRes.height, canvasEpoch]);

  useEffect(() => {
    if (isRenderBridgeReady && canvasRef.current) {
      const bridge = getRenderBridge();
      bridge.setCanvas(canvasRef.current);
    }
  }, [isRenderBridgeReady, canvasEpoch]);

  /**
   * Select the preview backend from the shared editor preference.
   */
  useEffect(() => {
    if (!canvasRef.current) return;
    let disposed = false;
    let ownedRenderer: Renderer | null = null;
    const factory = RendererFactory.getInstance();
    const release = (renderer: Renderer) => {
      if (factory.getCurrentRenderer() === renderer) factory.destroyRenderer();
      else renderer.destroy();
    };
    // The WebGPU context cannot be given back, so the Canvas2D fallback needs a brand-new <canvas>: bumping the epoch
    // remounts it and re-runs this effect with the GPU disabled, which then builds the 2D renderer and repaints.
    const fallBackToCanvas2d = () => {
      setGpuUnavailable(true);
      setCanvasEpoch((epoch) => epoch + 1);
    };

    const initializeRenderer = async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const renderer = await factory.createRenderer({
          canvas,
          width: canvas.width,
          height: canvas.height,
          preferredRenderer:
            hardwareAcceleration && !gpuUnavailable && isWebGPUSupported() ? "webgpu" : "canvas2d",
        });
        if (disposed) {
          release(renderer);
          return;
        }
        ownedRenderer = renderer;

        rendererRef.current = renderer;
        rendererInitializedRef.current = true;
        setRendererType(renderer.type);
        registerProgramRenderer(() => rendererRef.current);

        renderer.onDeviceLost(() => {
          if (disposed) return;
          console.warn("[Preview] GPU device lost, attempting recovery...");
          // The preview cards' engines may hold dead contexts too: rebuild them and re-render every card.
          notifyPreviewDeviceLoss();
          renderer
            .recreateDevice()
            .then((success) => {
              if (disposed) return;
              if (success) {
                // Same canvas, new device: paint the frame under the playhead again (it went black with the old device).
                setRendererType(renderer.type);
                requestPausedFrameRef.current(useTimelineStore.getState().playheadPosition);
                notifyPreviewDeviceLoss();
                return;
              }
              console.error("[Preview] Failed to recover GPU device");
              fallBackToCanvas2d();
            })
            .catch((error) => {
              if (disposed) return;
              console.warn("[Preview] GPU recovery failed:", error);
              fallBackToCanvas2d();
            });
        });
      } catch (error) {
        if (disposed) return;
        console.warn("[Preview] Failed to initialize GPU renderer:", error);
        setRendererType("canvas2d");
      }
    };

    initializeRenderer();

    return () => {
      disposed = true;
      if (ownedRenderer) release(ownedRenderer);
      if (rendererRef.current === ownedRenderer) {
        rendererRef.current = null;
        rendererInitializedRef.current = false;
      }
    };
  }, [hardwareAcceleration, gpuUnavailable, canvasEpoch]);

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
  const playbackDepsRef = useRef<Record<string, unknown> | null>(null);
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

  const imageBitmapCacheRef = useRef<PreviewBitmapCache>(createBitmapCache(0.4));
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

    imageBitmapCacheRef.current.clear();
    motionAssetBitmapCacheRef.current.clear();
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
      onlyTrackId?: string,
    ) => {
      const subjectStreamId = getBehindSubjectStreamId(
        tracks,
        time,
        getMediaItem,
      );
      const videoImageTrackIndices = tracks
        .map((t, idx) => ({ track: t, originalIndex: idx }))
        .filter(
          ({ track }) =>
            !track.hidden &&
            track.clips.some(
              (clip) =>
                time >= clip.startTime &&
                time < clip.startTime + clip.duration &&
                mediaClipHasVisual(clip),
            ),
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

      const overlayTracksWithIndex = getVisibleTrackRenderOrder(tracks);

      const tracksToRender = overlayTracksWithIndex.filter(
        ({ track, originalIndex }) => {
          if (onlyTrackId !== undefined && track.id !== onlyTrackId) return false;
          if (mode === "below-video") {
            return originalIndex > highestVideoIndex;
          } else if (mode === "above-video") {
            return originalIndex < lowestVideoIndex;
          }
          return true;
        },
      );

      for (const { track } of tracksToRender) {
        const trackShapeClips = shapeClips.filter(
          (clip) => clip.trackId === track.id,
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
        const trackTextClips = textClips.filter(
          (clip) => clip.trackId === track.id,
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
    },
    [getMediaItem, isPlaying, mediaClipHasVisual, renderMotionInstancesForTrack],
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
      const audioTracks = tracks.filter(
        (track) => !track.hidden && trackHasAudioItems(project, track.id),
      );

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setPreviewMuted(isMuted);

      const speedEngine = getSpeedEngine();
      const scheduledClips: AudioClipSchedule[] = [];
      // Tracks whose hosted plugins are rendered play their processed stem instead of their clips.
      const rackPreview = getPluginRackPreview();
      const stemmedTrackIds = rackPreview.stemmedTrackIds(project);

      for (const audioTrack of audioTracks) {
        audioGraph.createTrack({
          trackId: audioTrack.id,
          volume: 1,
          pan: 0,
          muted: audioTrack.muted || false,
          solo: audioTrack.solo || false,
          soloSafe: audioTrack.soloSafe === true,
          effects: [],
        });

        if (audioTrack.muted || stemmedTrackIds.has(audioTrack.id)) {
          continue;
        }

        for (const audioClip of audioTrack.clips) {
          if (!mediaClipHasAudio(audioClip) || requiresComposedAudio(audioClip)) {
            continue;
          }
          const clipEnd = audioClip.startTime + audioClip.duration;

          if (
            timelinePosition >= audioClip.startTime &&
            timelinePosition < clipEnd
          ) {
            const mediaItem = getOriginalMediaItem(audioClip.mediaId);
            if (!mediaItem?.blob) {
              continue;
            }

            const wideDecode = clipDecodesWide(audioClip);
            const audioCacheKey = getAudioBufferCacheKey(
              audioClip.mediaId,
              audioClip.audioTrackIndex,
              wideDecode,
            );
            pinnedAudioKeysRef.current.add(audioCacheKey);
            let audioBuffer: AudioBuffer | null | undefined;
            try {
              audioBuffer = await decodeAudioBufferCached(
                audioCacheKey,
                audioGraph.getAudioContext(),
                mediaItem.blob,
                audioClip.audioTrackIndex ?? 0,
                mediaItem.metadata?.channels,
                wideDecode,
              );
            } catch (error) {
              console.warn(
                `[Preview] Failed to decode audio for clip ${audioClip.id}:`,
                error,
              );
              continue;
            }
            if (!audioBuffer) continue;

            const audioEffects = getResolvedClipAudioEffects(audioClip);

            const enabledEffects = audioEffects.filter(
              (e: Effect) => e.enabled,
            );
            const previewAudio = await getPreviewAudioBufferForEffects(
              audioBuffer,
              audioCacheKey,
              enabledEffects,
            );


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
              pan: 0,
              effects: previewAudio.effects,
              speed: audioClip.speed ?? 1,
              ...getResolvedClipPlaybackParams(audioClip),
              fadeIn: audioClip.fade?.fadeIn,
              fadeOut: audioClip.fade?.fadeOut,
              fadeOrigin: audioClip.fade?.origin,
              transitionFadeIn: transitionFades.fadeIn,
              transitionFadeOut: transitionFades.fadeOut,
            });
          }
        }
      }

      await compoundAudioPreview.prepareAt(project, timelinePosition);
      scheduledClips.push(...compoundAudioPreview.schedulesAt(project, timelinePosition).filter((schedule) => !stemmedTrackIds.has(schedule.trackId)));
      scheduledClips.push(...rackPreview.schedulesAt(project, timelinePosition));
      if (scheduledClips.length > 0) {
        await audioGraph.resume();
        audioGraph.scheduleClips(scheduledClips);
      }
    },
    [
      compoundAudioPreview,
      getOriginalMediaItem,
      getPreviewAudioBufferForEffects,
      getResolvedClipAudioEffects,
      getResolvedClipVolumeAutomation,
      getResolvedClipPlaybackParams,
      isMuted,
      mediaClipHasAudio,
      project,
    ],
  );

  const preDecodeAllAudioBuffers = useCallback(async (): Promise<void> => {
    const tracks = timelineTracksRef.current;
    const audioTracks = tracks.filter((track) => !track.hidden);

    if (!audioGraphRef.current) {
      audioGraphRef.current = getRealtimeAudioGraph();
    }
    const audioGraph = audioGraphRef.current;
    const audioContext = audioGraph.getAudioContext();

    // Nearest clips first, and stop decoding new sources once the audio budget is nearly full:
    // evicting one source to decode a far-away one would only thrash.
    // Under critical memory pressure nothing is decoded ahead of need; the scheduler still decodes what is about to play.
    if (!getMemoryGovernor().policy.readAhead) return;
    const playhead = useTimelineStore.getState().playheadPosition;
    const ordered = audioTracks
      .flatMap((track) => track.clips)
      .sort(
        (a, b) =>
          Math.abs(a.startTime - playhead) - Math.abs(b.startTime - playhead),
      );
    for (const clip of ordered) {
        if (!mediaClipHasAudio(clip) || requiresComposedAudio(clip)) {
          continue;
        }
        const wideDecode = clipDecodesWide(clip);
        const cacheKey = getAudioBufferCacheKey(clip.mediaId, clip.audioTrackIndex, wideDecode);
        let audioBuffer: AudioBuffer | null | undefined =
          audioBufferCacheRef.current.get(cacheKey);

        if (!audioBuffer) {
          if (noAudioBufferRef.current.has(cacheKey)) {
            continue;
          }
          const cache = audioBufferCacheRef.current;
          if (cache.byteLength >= cache.maxBytes * 0.9) {
            continue;
          }
          const mediaItem = getOriginalMediaItem(clip.mediaId);
          if (!mediaItem?.blob) {
            continue;
          }

          try {
            audioBuffer = await decodeAudioBufferCached(
              cacheKey,
              audioContext,
              mediaItem.blob,
              clip.audioTrackIndex ?? 0,
              mediaItem.metadata?.channels,
              wideDecode,
            );
          } catch {
            audioBuffer = null;
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
    await compoundAudioPreview.prepareAt(project, useTimelineStore.getState().playheadPosition);
  }, [compoundAudioPreview, project,
    getOriginalMediaItem,
    getPreviewAudioBufferForEffects,
    getResolvedClipAudioEffects,
    mediaClipHasAudio,
  ]);

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
        (track) => !track.hidden && !track.muted,
      );
      const schedules: AudioClipSchedule[] = [];
      const pinned = new Set<string>();
      const rackPreview = getPluginRackPreview();
      const stemmedTrackIds = rackPreview.stemmedTrackIds(project);

      for (const track of tracksWithAudio) {
        if (stemmedTrackIds.has(track.id)) continue;
        for (const clip of track.clips) {
          if (!mediaClipHasAudio(clip) || requiresComposedAudio(clip)) {
            continue;
          }
          const clipEnd = clip.startTime + clip.duration;
          if (clipEnd <= time || clip.startTime > time + AUDIO_PREFETCH_SECONDS) {
            continue;
          }

          const wideDecode = clipDecodesWide(clip);
          const audioCacheKey = getAudioBufferCacheKey(clip.mediaId, clip.audioTrackIndex, wideDecode);
          pinned.add(audioCacheKey);
          const audioBuffer = audioBufferCacheRef.current.get(audioCacheKey);
          if (!audioBuffer) {
            // Evicted (or never decoded): start decoding now, ahead of the clip's start when possible.
            const mediaItem = getOriginalMediaItem(clip.mediaId);
            const audioGraphForDecode = audioGraphRef.current;
            if (mediaItem?.blob && audioGraphForDecode) {
              void decodeAudioBufferCached(
                audioCacheKey,
                audioGraphForDecode.getAudioContext(),
                mediaItem.blob,
                clip.audioTrackIndex ?? 0,
                mediaItem.metadata?.channels,
                wideDecode,
              ).catch(() => {});
            }
            continue;
          }
          if (clip.startTime > time + 1) {
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
              wideDecode,
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
            pan: 0,
            effects: scheduleEffects,
            speed: clip.speed ?? 1,
            ...getResolvedClipPlaybackParams(clip),
            fadeIn: clip.fade?.fadeIn,
            fadeOut: clip.fade?.fadeOut,
            fadeOrigin: clip.fade?.origin,
            transitionFadeIn: transitionFades.fadeIn,
            transitionFadeOut: transitionFades.fadeOut,
          });
        }
      }

      pinnedAudioKeysRef.current = pinned;
      schedules.push(...compoundAudioPreview.schedulesAt(project, time).filter((schedule) => !stemmedTrackIds.has(schedule.trackId)));
      schedules.push(...rackPreview.schedulesAt(project, time));
      return schedules;
    },
    [
      compoundAudioPreview,
      project,
      getAudioEffectSignature,
      getResolvedClipAudioEffects,
      getResolvedClipVolumeAutomation,
      getResolvedClipPlaybackParams,
      getOriginalMediaItem,
      mediaClipHasAudio,
    ],
  );

  // Audible scrubbing: short grains at the playhead while it is dragged (toggle in the timeline toolbar).
  useScrubAudio({
    scrubbing: isScrubbing && playbackState !== "playing",
    position: scrubPosition,
    getSchedules: getAudioClipsForScheduler,
    getGraph: () => {
      if (!audioGraphRef.current) audioGraphRef.current = getRealtimeAudioGraph();
      // Tracks are normally created when playback starts: mirror mute/solo now so grains honour them.
      audioGraphRef.current.syncTrackStates(
        timelineTracksRef.current.map((track) => ({
          trackId: track.id,
          muted: track.muted === true || track.hidden === true,
          solo: track.solo === true,
          soloSafe: track.soloSafe === true,
        })),
      );
      return audioGraphRef.current;
    },
  });

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
      signal?: AbortSignal,
    ): Promise<ImageBitmap | null> => {
      if (signal?.aborted) return null;
      const mediaItem = getMediaItem(clip.mediaId);
      if (!mediaItem?.blob) return null;
      const vidstab = getVidstabEngine();
      const mediaBlob = (vidstab.hasStabilized(clip.id)
        ? vidstab.getStabilizedBlob(clip.id)
        : mediaItem.blob)!;

      if (mediaItem.type === "image") {
        try {
          const frame = await createMediaImageBitmap(mediaItem);
          if (signal?.aborted) { frame.close(); return null; }
          return frame;
        } catch {
          return null;
        }
      }

      const requestSeq = ++decodeRequestSeqRef.current;
      const isStaleRequest = () => requestSeq !== decodeRequestSeqRef.current || signal?.aborted;

      // Codecs the browser cannot decode (ProRes...): the desktop sidecar decodes the frame on demand,
      // straight from the original file, so scrubbing never waits for a proxy.
      const nativeSource = mediaItem.type === "video" ? await claimNativeSource(mediaBlob) : null;
      if (nativeSource) {
        // The release timer armed by the previous paused frame would bump the request sequence mid-decode and
        // discard this (slower, sidecar-served) frame as stale, leaving the monitor on "unavailable".
        scrubVideoReleaserRef.current.cancel();
        const nativeTime =
          (clip.inPoint || 0) +
          getSpeedEngine().getSourceTimeAtPlaybackTime(clip.id, time - clip.startTime);
        const frame = await new NativeCanvasSink(nativeSource, {
          width: canvasRef.current?.width || undefined,
          quality: "preview",
        }).getCanvas(nativeTime);
        if (!frame || isStaleRequest()) return null;
        return createImageBitmap(frame.canvas);
      }

      scrubVideoReleaserRef.current.cancel();

      if (decodeDebounceRef.current) {
        clearTimeout(decodeDebounceRef.current);
        decodeDebounceRef.current = null;
      }
      decodeDebounceResolveRef.current?.(null);
      decodeDebounceResolveRef.current = null;

      // While the playhead is being dragged, answer from the scrub cache when
      // this exact source frame was already decoded.
      let scrubKey: string | null = null;
      if (useTimelineStore.getState().isScrubbing && !vidstab.hasStabilized(clip.id)) {
        const sourceTime =
          (clip.inPoint || 0) +
          getSpeedEngine().getSourceTimeAtPlaybackTime(clip.id, time - clip.startTime);
        scrubKey = scrubFrameKey(
          blobIdentity(mediaBlob),
          sourceTime,
          mediaItem.metadata?.frameRate || 30,
        );
        const hit = scrubFrameCacheRef.current.get(scrubKey);
        if (hit) {
          try {
            const copy = await createImageBitmap(hit);
            if (isStaleRequest()) { copy.close(); return null; }
            return copy;
          } catch {
            // Fall through to a real decode.
          }
        }
      }

      return new Promise<ImageBitmap | null>((resolve) => {
        let settled = false;
        const finish = (frame: ImageBitmap | null) => {
          if (settled) { frame?.close(); return; }
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(frame);
        };
        const onAbort = () => {
          if (decodeDebounceResolveRef.current === finish) {
            if (decodeDebounceRef.current) clearTimeout(decodeDebounceRef.current);
            decodeDebounceRef.current = null;
            decodeDebounceResolveRef.current = null;
          }
          finish(null);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        decodeDebounceResolveRef.current = finish;
        // One automatic retry on a fresh element before reporting "Preview
        // unavailable" (what the Retry button does): a slow or software
        // decoder can leave a just-created element unusable for this frame.
        let retried = false;
        const sourceTime = getSpeedEngine().getSourceTimeAtPlaybackTime(clip.id, time - clip.startTime);
        const isStabilized = vidstab.hasStabilized(clip.id);
        const mediaTime = isStabilized ? sourceTime : (clip.inPoint || 0) + sourceTime;
        const cacheKey = isStabilized ? `${clip.mediaId}:stabilized` : clip.mediaId;
        let fallbackMediaTime = pausedSeekTime(mediaTime, Infinity);
        const decodePausedFrame = async (): Promise<void> => {
          decodeDebounceRef.current = null;
          decodeDebounceResolveRef.current = null;

          if (isStaleRequest()) {
            finish(null);
            return;
          }

          try {
            let cached = videoElementCacheRef.current.get(cacheKey);
            if (cached && cached.blob !== mediaBlob) {
              releaseVideoElement(cached);
              videoElementCacheRef.current.delete(cacheKey);
              cached = undefined;
            }

            if (!cached) {
              previewProxyCache.noteDecode(clip.mediaId, mediaBlob);
              const url = URL.createObjectURL(mediaBlob);
              const video = document.createElement("video");
              video.src = url;
              video.muted = true;
              video.playsInline = true;
              // A paused first frame needs decoded data, including when the
              // requested time is already zero and no seek event is emitted.
              video.preload = "auto";
              video.crossOrigin = "anonymous";

              cached = { video, url, blob: mediaBlob, lastUsed: Date.now() };
              videoElementCacheRef.current.set(cacheKey, cached);

              while (videoElementCacheRef.current.size > 2) {
                evictOldestVideoElement();
              }
            }

            await waitForVideoMetadata(cached.video, signal);
            if (isStaleRequest()) { finish(null); return; }
            cached.lastUsed = Date.now();
            const { video } = cached;

            const clampedTime = pausedSeekTime(mediaTime, video.duration);
            fallbackMediaTime = clampedTime;
            await seekVideoFrame(video, clampedTime, signal);
            if (isStaleRequest()) {
              finish(null);
              return;
            }

            const frame = await captureNativeVideoFrame(video);
            if (isStaleRequest()) {
              frame.close();
              finish(null);
              return;
            }
            if (scrubKey && useTimelineStore.getState().isScrubbing && frame.width > 0) {
              try {
                const target = scrubCacheSize(frame.width, frame.height);
                const small = await createImageBitmap(frame, {
                  resizeWidth: target.width,
                  resizeHeight: target.height,
                  resizeQuality: "low",
                });
                scrubFrameCacheRef.current.set(scrubKey, small);
              } catch {
                // Caching is best-effort.
              }
            }
            scheduleScrubVideoRelease();
            finish(frame);
          } catch (error) {
            if (!isStaleRequest()) {
              console.warn("Paused video frame decoding failed", error);
              const cached = videoElementCacheRef.current.get(cacheKey);
              if (cached?.blob === mediaBlob) {
                releaseVideoElement(cached);
                videoElementCacheRef.current.delete(cacheKey);
              }
              if (!retried) {
                retried = true;
                await decodePausedFrame();
                return;
              }
              // A video element can fail to present a valid proxy on a software decoder.
              // Keep the proxy selected if the independent packet decoder can display it.
              const fallback = await decodeFrameWithWebCodecs(mediaBlob, fallbackMediaTime).catch((fallbackError: unknown) => {
                console.warn("WebCodecs paused-frame fallback failed", fallbackError);
                return null;
              });
              if (isStaleRequest()) { fallback?.close(); finish(null); return; }
              scheduleScrubVideoRelease();
              if (fallback) { finish(fallback); return; }
              failProxyPlayback(clip.mediaId, mediaBlob);
            }
            finish(null);
          }
        };
        decodeDebounceRef.current = setTimeout(() => { void decodePausedFrame(); }, signal ? 0 : 50);
      });
    },
    [
      evictOldestVideoElement,
      failProxyPlayback,
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
    async (playheadTime: number, request?: PreviewFrameRequest): Promise<boolean> => {
      // Composite at the instant the export renders for the frame under the playhead (transition progress,
      // keyframes and effects included); the playhead itself stays the key for commit checks and the shown time.
      const time = frameSampleTime(playheadTime, project.settings.frameRate);
      const canvas = canvasRef.current;
      if (!canvas) return false;

      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = previewRes.width;
        canvas.height = previewRes.height;
      }

      const mainCtx = canvas.getContext("2d");
      if (!mainCtx) return false;
      const frameWidth = canvas.width;
      const frameHeight = canvas.height;
      const canCommit = () => canvasRef.current === canvas
        && canvas.width === frameWidth && canvas.height === frameHeight
        && sameProjectForPlayback(getMonitorProject(), project)
        && previewProxyCache.store.getState().revision === proxySourceRevision
        && isPlaying === (useTimelineStore.getState().playbackState === "playing")
        && (!request || (!request.signal.aborted && request.isCurrent()
          && useTimelineStore.getState().playbackState !== "playing"
          && (request.allowStale
            || Math.abs(useTimelineStore.getState().playheadPosition - playheadTime) < 1e-7)));
      if (!canCommit()) return false;

      let missingVisualFrame = false;

      // Compound clips are full nested timelines rather than media blobs.
      // Route those frames through the canonical compositor so preview and
      // export share identical nesting, timing, effects and transforms.
      // ACES mode: the Output Transform lives in the canonical float compositor, so every frame goes through it.
      const hasActiveCompound = isAcesProject() || timelineTracks.some((track) =>
        !track.hidden &&
        track.clips.some(
          (clip) =>
            (getCompoundClipId(clip) !== null || clipHasTemporalEffects(clip) || clipHasTimeInterpolation(clip)) &&
            time >= clip.startTime &&
            time < clip.startTime + clip.duration,
        ),
      );
      if (hasActiveCompound) {
        const frame = await getRenderBridge().renderFrame(time, canCommit);
        if (frame) {
          if (!canCommit()) { frame.image.close(); return false; }
          mainCtx.clearRect(0, 0, canvas.width, canvas.height);
          mainCtx.drawImage(frame.image, 0, 0, canvas.width, canvas.height);
          if (!isPlaying) { presentedExact.markExact(playheadTime); setPresentedFrameTime(playheadTime); setPresentedFrameIsFallback(false); }
          return true;
        }
        missingVisualFrame = true;
      }

      // Paused and playback renders must never draw into each other's workspace.
      const frameCanvas = new OffscreenCanvas(canvas.width, canvas.height);
      const ctx = frameCanvas.getContext("2d") as unknown as CanvasRenderingContext2D;
      if (!ctx) return false;

      const videoTracks = timelineTracks.filter(
        (track) =>
          !track.hidden && track.clips.some((clip) => mediaClipHasVisual(clip)),
      );

      let hasRenderedFrame = false;
      let shouldClearCanvas = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

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

      const transitionInfo = getTransitionAtTime(
        time,
        timelineTracks,
        mediaClipHasVisual,
      );

      // Same Premiere semantics as the export renderer: a layer touches only the tracks below it (and
      // only affectedTracks when set), applied in painter order so titles/graphics above are untouched.
      const adjustmentSchedule = new AdjustmentLayerSchedule(
        planAdjustmentLayers(project.adjustmentLayers ?? [], timelineTracks, time),
      );
      let isolatedTrack: { base: ImageBitmap; placements: AdjustmentLayerPlacement[] } | null = null;
      const closeIsolatedTrack = async (): Promise<void> => {
        if (!isolatedTrack) return;
        const { base, placements } = isolatedTrack;
        isolatedTrack = null;
        try {
          if (await applyPreviewAdjustmentLayers(frameCanvas, ctx, placements.map((p) => p.layer), time)) {
            hasRenderedFrame = true;
          }
          ctx.save();
          ctx.globalCompositeOperation = "destination-over";
          ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        } finally {
          base.close();
        }
      };
      // Error path: a throw mid-frame must not leak the isolated backdrop bitmap.
      const discardIsolatedTrack = (): void => {
        const pending = isolatedTrack as { base: ImageBitmap } | null;
        isolatedTrack = null;
        pending?.base.close();
      };
      // Runs before a track (or the transition stage) paints: applies layers sitting at/below it to what is
      // already on the canvas, then isolates the track when a track-restricted layer targets it.
      const beginAdjustedStage = async (
        stackIndex: number,
        scopedPlacements: AdjustmentLayerPlacement[],
        hasContent: boolean,
      ): Promise<void> => {
        await closeIsolatedTrack();
        const compositeLayers = adjustmentSchedule.takeCompositeBefore(stackIndex);
        if (compositeLayers.length > 0) {
          await applyPreviewAdjustmentLayers(frameCanvas, ctx, compositeLayers.map((p) => p.layer), time);
        }
        if (scopedPlacements.length > 0 && hasContent) {
          // Paint this stage alone on a clear canvas so the effects reach only it; the backdrop returns beneath.
          isolatedTrack = { base: await createImageBitmap(frameCanvas), placements: scopedPlacements };
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      };
      const trackHasVisualAt = (track: Track): boolean =>
        track.clips.some((clip) => mediaClipHasVisual(clip) && time >= clip.startTime && time < clip.startTime + clip.duration);
      const trackHasContent = (track: Track): boolean =>
        trackHasAdjustableContent(track.id, time, {
          hasMedia: trackHasVisualAt(track),
          overlays: [activeShapeClips, activeTextClips],
          motionInstances: project.motionInstances ?? [],
        });

      // A clip-to-clip transition flattens every video track into one frame. Paint it in the same stage order
      // as the per-track loop (overlays below the video, the transition, overlays above) so layers hit the
      // same content here as in export.
      const paintTransitionStack = async (frame: ImageBitmap, transitionClipId: string): Promise<void> => {
        if (shouldClearCanvas) {
          fillPreviewBackground(ctx, time, canvas.width, canvas.height);
          shouldClearCanvas = false;
        }
        const ordered = getVisibleTrackRenderOrder(timelineTracks);
        const videoIndices = ordered.filter(({ track }) => trackHasVisualAt(track)).map(({ originalIndex }) => originalIndex);
        const lowestVideo = videoIndices.length > 0 ? Math.min(...videoIndices) : Infinity;
        const highestVideo = videoIndices.length > 0 ? Math.max(...videoIndices) : -1;
        const transitionTrackIndex = timelineTracks.findIndex((t) => t.clips.some((c) => c.id === transitionClipId));
        const subject = hasBehindSubjectText(activeTextClips) ? frame : null;
        const paintOverlays = async (mode: "below-video" | "above-video", inRange: (index: number) => boolean) => {
          for (const { track, originalIndex } of ordered) {
            if (!inRange(originalIndex)) continue;
            await beginAdjustedStage(originalIndex, adjustmentSchedule.scopedFor(track.id), trackHasContent(track));
            await renderOverlayClipsInTrackOrder(
              ctx, timelineTracks, activeShapeClips, activeTextClips, time, canvas.width, canvas.height,
              mode, mode === "above-video" ? subject : null, track.id,
            );
          }
        };
        await paintOverlays("below-video", (index) => index > highestVideo);
        const videoScoped = new Map<string, AdjustmentLayerPlacement>();
        for (const { track } of ordered) {
          if (!trackHasVisualAt(track)) continue;
          for (const placement of adjustmentSchedule.scopedFor(track.id)) videoScoped.set(placement.layer.id, placement);
        }
        await beginAdjustedStage(
          transitionTrackIndex >= 0 ? transitionTrackIndex : highestVideo,
          [...videoScoped.values()],
          true,
        );
        drawFrameWithTransform(ctx, frame, DEFAULT_TRANSFORM, canvas.width, canvas.height);
        await paintOverlays("above-video", (index) => index < lowestVideo);
      };

      if (transitionInfo) {
        try {
          const clipAFrame = await decodeClipFrame(transitionInfo.clipA, time, request?.signal);
          const clipBFrame = transitionInfo.clipB
            ? await decodeClipFrame(transitionInfo.clipB, time, request?.signal)
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

          if (!canCommit()) {
            closeOnce(clipAFrame); closeOnce(clipBFrame); closeOnce(blankFrame);
            return false;
          }

          missingVisualFrame = !clipAFrame || Boolean(transitionInfo.clipB && !clipBFrame);

          if (clipAFrame && (clipBFrame || blankFrame)) {
            const processedA = await applyEffectsToFrame(
              transitionInfo.clipA.id,
              clipAFrame,
              { clip: transitionInfo.clipA, time },
            );
            const processedB =
              transitionInfo.clipB && clipBFrame
                ? await applyEffectsToFrame(transitionInfo.clipB.id, clipBFrame, { clip: transitionInfo.clipB, time })
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
              await paintTransitionStack(blendedFrame, transitionInfo.clipA.id);
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
              { clip: transitionInfo.clipA, time },
            );
            const validFrame =
              processed.width > 0 && processed.height > 0
                ? processed
                : clipAFrame;
            await paintTransitionStack(validFrame, transitionInfo.clipA.id);
            if (processed !== clipAFrame) {
              closeOnce(processed);
            }
            closeOnce(clipAFrame);
            hasRenderedFrame = true;
          } else if (clipBFrame && transitionInfo.clipB) {
            const processed = await applyEffectsToFrame(
              transitionInfo.clipB.id,
              clipBFrame,
              { clip: transitionInfo.clipB, time },
            );
            const validFrame =
              processed.width > 0 && processed.height > 0
                ? processed
                : clipBFrame;
            await paintTransitionStack(validFrame, transitionInfo.clipA.id);
            if (processed !== clipBFrame) {
              closeOnce(processed);
            }
            closeOnce(clipBFrame);
            hasRenderedFrame = true;
          }
          closeOnce(blankFrame);
        } catch (error) {
          discardIsolatedTrack();
          console.warn("[Preview] Transition render failed:", error);
        }
      }

      if (!hasRenderedFrame) {
        const hasVideoContent = videoTracks.some((track) =>
          track.clips.some(
            (clip) =>
              mediaClipHasVisual(clip) &&
              time >= clip.startTime &&
              time < clip.startTime + clip.duration,
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
        const allRenderableTracks = getVisibleTrackRenderOrder(timelineTracks);

        let subjectFrame: ImageBitmap | null = null;
        const shouldCompositeSubject = hasBehindSubjectText(activeTextClips);
        let blurBackdropDrawn = false;

        try {
        for (const { track, originalIndex } of allRenderableTracks) {
          await beginAdjustedStage(originalIndex, adjustmentSchedule.scopedFor(track.id), trackHasContent(track));
          {
            for (const clip of track.clips) {
              if (!mediaClipHasVisual(clip)) continue;
              const clipStart = clip.startTime;
              const clipEnd = clip.startTime + clip.duration;

              if (time >= clipStart && time < clipEnd) {
                const frame = await decodeClipFrame(clip, time, request?.signal);
                if (!canCommit()) { frame?.close(); return false; }
                if (!frame) missingVisualFrame = true;

                if (frame) {
                  // The decoder returns native, un-letterboxed frames for both
                  // images and videos. Paint the first visible layer cover-fit
                  // behind the composition when the project uses blur fill.
                  if (
                    canvasFillModeRef.current === "blur" &&
                    !blurBackdropDrawn
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

                  const nativeCssFilter = clipCssFilterOnly(clip.id, clip);
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
                      processedFrame = await applyEffectsToFrame(clip.id, frame, { clip, time });
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
          }
          const trackShapeClips = activeShapeClips.filter(
            (clip) => clip.trackId === track.id,
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
          const trackTextClips = activeTextClips.filter(
            (clip) => clip.trackId === track.id,
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
              getBehindSubjectStreamId(timelineTracks, time, getMediaItem),
            );

            hasRenderedFrame = true;
          }
        }
        } finally {
          discardIsolatedTrack();
        }
        subjectFrame?.close();
      }

      await closeIsolatedTrack();
      const remainingLayers = adjustmentSchedule.takeRemainingComposite();
      if (remainingLayers.length > 0) {
        if (await applyPreviewAdjustmentLayers(frameCanvas, ctx, remainingLayers.map((p) => p.layer), time)) {
          hasRenderedFrame = true;
        }
      }

      // Particles and subtitles sit above every track, so no adjustment layer reaches them.
      let particlesDrawn = 0;
      withDisplaySpace(ctx, canvas.width, getPreviewSequencePar(), (layoutWidth) => {
        particlesDrawn = drawProjectParticles(ctx, project, time, layoutWidth, canvas.height);
      });
      hasRenderedFrame = particlesDrawn > 0 || hasRenderedFrame;

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

      if (!canCommit()) return false;

      if (!canCommit()) return false;

      if (hasRenderedFrame && frameCanvas) {
        mainCtx.clearRect(0, 0, canvas.width, canvas.height);
        mainCtx.drawImage(frameCanvas, 0, 0);
        if (!isPlaying && !missingVisualFrame) cacheProjectPreview(project, actualEndTime, canvas);
        if (!isPlaying) { presentedExact.markExact(playheadTime); setPresentedFrameTime(playheadTime); setPresentedFrameIsFallback(missingVisualFrame); }
        // The last-good fallback copy is a full-resolution GPU copy; mid-drag
        // frames are superseded within milliseconds, so only keep it once the
        // playhead settles.
        if (!useTimelineStore.getState().isScrubbing) {
          try {
            const cachedFrame = await createImageBitmap(frameCanvas);
            if (canCommit()) {
              lastGoodFrameRef.current?.close();
              lastGoodFrameRef.current = cachedFrame;
            } else cachedFrame.close();
          } catch {}
        }
        return true;
      }

      return hasRenderedFrame;
    },
    [
      timelineTracks,
      getMediaItem,
      decodeClipFrame,
      actualEndTime,
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
      project,
      proxySourceRevision,
      mediaClipHasVisual,
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

  // Retry audio decodes that failed earlier: a failure is only remembered until the next play.
  useEffect(() => {
    if (isPlaying) failedAudioBufferRef.current.clear();
  }, [isPlaying]);

  const playheadPositionRef = useRef(playheadPosition);
  useEffect(() => {
    playheadPositionRef.current = playheadPosition;
  }, [playheadPosition]);

  useEffect(() => {
    setImageLoadCallback(() => {
      if (!isPlayingRef.current) {
        requestPausedFrameRef.current(playheadPositionRef.current);
      }
    });
    return () => {
      setImageLoadCallback(null);
      disposePreview3DRenderer();
    };
  }, []);

  const renderFallbackFrame = useCallback(
    async (time: number, request?: PreviewFrameRequest): Promise<boolean> => {
      const canvas = canvasRef.current;
      if (!canvas) return false;

      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = previewRes.width;
        canvas.height = previewRes.height;
      }

      const frameCanvas = new OffscreenCanvas(canvas.width, canvas.height);
      const ctx = frameCanvas.getContext("2d") as unknown as CanvasRenderingContext2D;
      if (!ctx) return false;
      const canCommit = () => canvasRef.current === canvas
        && canvas.width === frameCanvas.width && canvas.height === frameCanvas.height
        && sameProjectForPlayback(getMonitorProject(), project)
        && previewProxyCache.store.getState().revision === proxySourceRevision
        && (!request || (!request.signal.aborted && request.isCurrent()
          && useTimelineStore.getState().playbackState !== "playing"
          && (request.allowStale
            || Math.abs(useTimelineStore.getState().playheadPosition - time) < 1e-7)));
      if (!canCommit()) return false;

      const emptyBg = isDark ? "#0f0f11" : "#ffffff";
      const emptyText = isDark ? "#52525b" : "#a1a1aa";
      const textPrimary = isDark ? "#ffffff" : "#18181b";
      const textSecondary = isDark ? "#a1a1aa" : "#71717a";

      const activeShapeClips = getActiveShapeClips(allShapeClips, time);
      const activeTextClips = getActiveTextClips(allTextClips, time);

      const videoTracks = timelineTracks.filter(
        (track) =>
          !track.hidden && track.clips.some((clip) => mediaClipHasVisual(clip)),
      );

      const hasVideoContent = videoTracks.some((track) =>
        track.clips.some(
          (clip) =>
            mediaClipHasVisual(clip) &&
            time >= clip.startTime &&
            time < clip.startTime + clip.duration,
        ),
      );

      ctx.fillStyle = hasVideoContent
        ? isDark
          ? "#18181b"
          : "#f4f4f5"
        : emptyBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let hasRenderedContent = false;

      const allRenderableTracks = getVisibleTrackRenderOrder(timelineTracks);

      for (const { track } of allRenderableTracks) {
        {
          for (const clip of track.clips) {
            if (!mediaClipHasVisual(clip)) continue;
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
        }
        const trackShapeClips = activeShapeClips.filter(
          (clip) => clip.trackId === track.id,
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
        const trackTextClips = activeTextClips.filter(
          (clip) => clip.trackId === track.id,
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
            getBehindSubjectStreamId(timelineTracks, time, getMediaItem),
          );
          hasRenderedContent = true;
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

      const audioTracks = timelineTracks.filter((track) => !track.hidden);
      const hasActiveAudioClip = audioTracks.some((track) =>
        track.clips.some(
          (clip) =>
            mediaClipHasAudio(clip) &&
            time >= clip.startTime && time < clip.startTime + clip.duration,
        ),
      );

      if (
        !hasRenderedContent &&
        activeTextClips.length === 0 &&
        activeShapeClips.length === 0 &&
        activeSubtitles.length === 0 &&
        !hasActiveMotionInstances(time) &&
        !hasActiveAudioClip &&
        // Gaps and the playhead parked at the timeline end have nothing active
        // either; only an empty timeline should invite an import.
        !timelineTracks.some((track) => track.clips.length > 0)
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
      if (!canCommit()) return false;
      const mainCtx = canvas.getContext("2d");
      if (!mainCtx) return false;
      mainCtx.clearRect(0, 0, canvas.width, canvas.height);
      mainCtx.drawImage(frameCanvas, 0, 0);
      presentedExact.markExact(time);
      setPresentedFrameTime(time);
      setPresentedFrameIsFallback(hasVideoContent || timelineTracks.some(track => !track.hidden && track.clips.some(clip => getCompoundClipId(clip) !== null && time >= clip.startTime && time < clip.startTime + clip.duration)));
      return true;
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
      mediaClipHasAudio,
      mediaClipHasVisual,
      project,
      proxySourceRevision,
    ],
  );

  // Seek anchors: sparse low-res frames sampled in the background. A slow exact
  // decode (long-GOP seek) first gets the nearest anchor painted, then the exact
  // frame replaces it; the presented-frame time/label only ever reflects the
  // exact frame.
  const seekAnchors = getSeekAnchorService();
  const anchorWindow = `${isPlaying ? "play" : "idle"}:${Math.floor(playheadPosition / 30)}`;
  // Lazy sampling: only the sources nearest the playhead are decoded (each sampling pass opens a
  // full-resolution decoder, which is what stacked on top of playback in the 4K startup peak).
  // The window is recomputed when playback stops and every 30 s of playhead travel.
  const anchorSources = useMemo(() => {
    const nearestDistance = new Map<Blob, number>();
    for (const track of timelineTracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        const media = getMediaItem(clip.mediaId);
        if (media?.type !== "video" || !media.blob) continue;
        const end = clip.startTime + clip.duration;
        const at = playheadPositionRef.current;
        const distance = at >= clip.startTime && at < end ? 0 : Math.min(Math.abs(clip.startTime - at), Math.abs(at - end));
        nearestDistance.set(media.blob, Math.min(nearestDistance.get(media.blob) ?? Infinity, distance));
      }
    }
    const all = [...nearestDistance.keys()];
    const first = [...all].sort((a, b) => (nearestDistance.get(a) ?? 0) - (nearestDistance.get(b) ?? 0)).slice(0, ANCHOR_SAMPLED_MEDIA);
    return { all, first };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the playhead is read through a ref; `anchorWindow` re-keys it.
  }, [timelineTracks, getMediaItem, anchorWindow]);
  useEffect(() => {
    seekAnchors.setBlobs(
      anchorSources.all,
      () => !isPlayingRef.current && !isScrubbingRef.current && !pausedBusyRef.current,
      anchorSources.first,
    );
  }, [anchorSources, seekAnchors]);
  useEffect(() => () => seekAnchors.dispose(), [seekAnchors]);

  const paintSeekApproximation = useCallback((time: number, request: PreviewFrameRequest): boolean => {
    if (request.signal.aborted || !request.isCurrent()) return false;
    if (!presentedExact.allowsApproximation(time)) return false;
    if (useTimelineStore.getState().playbackState === "playing") return false;
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    if (canvasFillModeRef.current === "blur") return false;
    if (project.particleEffects?.length || (project.adjustmentLayers?.length ?? 0) > 0) return false;
    if (getActiveShapeClips(allShapeClips, time).length > 0 || getActiveTextClips(allTextClips, time).length > 0) return false;
    if (getActiveSubtitles(allSubtitles, time).length > 0 || hasActiveMotionInstances(time)) return false;
    if (getTransitionAtTime(time, timelineTracks, mediaClipHasVisual)) return false;
    let only: (typeof timelineTracks)[number]["clips"][number] | null = null;
    for (const track of timelineTracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (!mediaClipHasVisual(clip) || time < clip.startTime || time >= clip.startTime + clip.duration) continue;
        if (only) return false;
        only = clip;
      }
    }
    if (!only) return false;
    const media = getMediaItem(only.mediaId);
    if (media?.type !== "video" || !media.blob) return false;
    if (!isPlainVideoClip(only as Clip, clipMasksById.has(only.id)) || getVidstabEngine().hasStabilized(only.id)) return false;
    const sourceTime = (only.inPoint || 0)
      + getSpeedEngine().getSourceTimeAtPlaybackTime(only.id, time - only.startTime);
    const anchor = seekAnchors.nearest(media.blob, sourceTime, APPROXIMATION_MAX_DISTANCE);
    if (!anchor) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fillPreviewBackground(ctx, time, canvas.width, canvas.height);
    drawFrameWithTransform(ctx, anchor.frame, DEFAULT_TRANSFORM, canvas.width, canvas.height);
    presentedExact.markApproximate();
    return true;
  }, [
    allShapeClips, allTextClips, allSubtitles, clipMasksById, fillPreviewBackground, getMediaItem,
    hasActiveMotionInstances, mediaClipHasVisual, presentedExact, project, seekAnchors, timelineTracks,
  ]);

  const renderPausedFrame = useCallback(async (time: number, request: PreviewFrameRequest) => {
    const approximationTimer = setTimeout(() => paintSeekApproximation(time, request), APPROXIMATION_DELAY_MS);
    try {
      const rendered = await renderFrameDirectly(time, request);
      if (!request.isCurrent()) return false;
      return rendered || await renderFallbackFrame(time, request);
    } finally {
      clearTimeout(approximationTimer);
      if (request.isCurrent()) scheduleScrubVideoRelease();
    }
  }, [renderFrameDirectly, renderFallbackFrame, scheduleScrubVideoRelease, paintSeekApproximation]);
  const requestPausedFrame = useCallback((time: number) => {
    if (useTimelineStore.getState().playbackState === "playing") { pausedFrames.cancel(); return; }
    pausedFrames.request(time, renderPausedFrame, {
      scrubbing: useTimelineStore.getState().isScrubbing,
    });
  }, [pausedFrames, renderPausedFrame]);
  useEffect(() => { requestPausedFrameRef.current = requestPausedFrame; }, [requestPausedFrame]);
  // Lets the comparison view / matte view render a frame on demand and wait for it.
  useEffect(() => {
    registerProgramFrameControl({
      renderAt: (time, { scrubbing }) => new Promise<void>((resolve) => {
        if (useTimelineStore.getState().playbackState === "playing") { resolve(); return; }
        let settled = false;
        let unsubscribe: () => void = () => {};
        const timer = setTimeout(() => finish(), 6000);
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          resolve();
        };
        pausedFrames.request(time, renderPausedFrame, { scrubbing });
        unsubscribe = pausedFrames.subscribe((state) => { if (!state.busy) finish(); });
        if (settled) unsubscribe();
      }),
    });
    return () => registerProgramFrameControl(null);
  }, [pausedFrames, renderPausedFrame]);
  // Mid-drag frames can be reduced-quality cache hits or slightly stale, and the
  // playhead already equals the final position when the drag ends, so redraw the
  // settled frame at full quality explicitly.
  const wasScrubbingRef = useRef(false);
  useEffect(() => {
    if (wasScrubbingRef.current && !isScrubbing) {
      requestPausedFrame(useTimelineStore.getState().playheadPosition);
    }
    wasScrubbingRef.current = isScrubbing;
  }, [isScrubbing, requestPausedFrame]);
  useEffect(() => {
    if (fontRevision > 0) requestPausedFrameRef.current(useTimelineStore.getState().playheadPosition);
  }, [fontRevision]);

  const previewFramePending = !isPlaying && !pausedFrameState.error && (pausedFrameState.busy
    || presentedFrameTime === null || Math.abs(presentedFrameTime - playheadPosition) > 1e-7);
  const previewFrameFailed = !isPlaying && (Boolean(pausedFrameState.error)
    || (!pausedFrameState.busy && presentedFrameIsFallback && presentedFrameTime !== null
      && Math.abs(presentedFrameTime - playheadPosition) < 1e-7));

  // A failed frame on a codec the browser cannot decode gets an explanation instead of a bare "unavailable".
  const [previewFailureReason, setPreviewFailureReason] = useState<string | null>(null);
  useEffect(() => {
    if (!previewFrameFailed) {
      setPreviewFailureReason(null);
      return;
    }
    let cancelled = false;
    const at = useTimelineStore.getState().playheadPosition;
    const blobs: Blob[] = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (at < clip.startTime || at >= clip.startTime + clip.duration) continue;
        const media = getMediaItem(clip.mediaId);
        if (media?.type === "video" && media.blob && !blobs.includes(media.blob)) blobs.push(media.blob);
      }
    }
    void (async () => {
      const desktop = window.openreel?.platform === "desktop";
      for (const blob of blobs) {
        const message = await explainUndecodableVideo(blob, desktop);
        if (message) {
          if (!cancelled) setPreviewFailureReason(message);
          return;
        }
      }
    })();
    return () => {
      cancelled = true
    };
  }, [previewFrameFailed, playheadPosition, getMediaItem, project]);

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
      // The video element draws display-referred pixels; ACES mode renders every frame through the float compositor.
      if (isAcesProject()) return { canUse: false, clips: [] };
      if (
        tracks.some(
          (track) =>
            !track.hidden &&
            track.clips.some(
              (clip) =>
                clip.startTime + clip.duration > startPosition &&
                getCompoundClipId(clip) !== null,
            ),
        )
      ) {
        return { canUse: false, clips: [] };
      }
      const videoTracks = tracks.filter((track) => !track.hidden);

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
            if (mediaItem?.type === "image" && clipNeedsFrameProcessing(clip.id, clip)) {
              return { canUse: false, clips: [] };
            }
            if (mediaItem?.blob && mediaItem.type === "video") {
              const clipSpeed = speedEngine.getClipSpeed(clip.id);
              const isReverse = speedEngine.isReverse(clip.id);
              // Non-square pixels / interlaced footage need the engine's conform step (display aspect, deinterlace);
              // a raw video-element draw would squeeze or comb them during playback only.
              if (frameConformFor(mediaItem) !== null) {
                return { canUse: false, clips: [] };
              }
              // Echo / Posterize Time need frames other than the one the element is playing.
              if (clipHasTemporalEffects(clip)) {
                return { canUse: false, clips: [] };
              }
              // Frame Blending / Optical Flow make frames the element is not playing: the engine renders them.
              if (clipHasTimeInterpolation(clip)) {
                return { canUse: false, clips: [] };
              }
              if (
                clipSpeed !== 1 ||
                isReverse ||
                (clipNeedsFrameProcessing(clip.id, clip) &&
                  clipCssFilterOnly(clip.id, clip) === null)
              ) {
                return { canUse: false, clips: [] };
              }
              // A processed clip with rendered frames must play through the
              // frame loop, which is where the render cache is consulted.
              if (clipNeedsFrameProcessing(clip.id, clip) && renderCacheService.hasCachedFrames()) {
                return { canUse: false, clips: [] };
              }
              allVideoClips.push({ clip, mediaItem });
            }
          }
        }
      }

      const hasActiveAudioEffects = tracks.some(
        (track) =>
          !track.hidden &&
          track.clips.some((clip) => {
            if (clip.startTime + clip.duration <= startPosition) {
              return false;
            }
            if (!mediaClipHasAudio(clip)) return false;

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
      const imageTracks = tracks.filter((track) => !track.hidden);
      const imageClips: Array<{
        clip: (typeof tracks)[0]["clips"][0];
        trackIndex: number;
      }> = [];
      imageTracks.forEach((track) => {
        const trackIndex = tracks.indexOf(track);
        for (const clip of track.clips) {
          if (getMediaItem(clip.mediaId)?.type === "image") {
            imageClips.push({ clip, trackIndex });
          }
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
      mediaClipHasAudio,
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
      shouldContinue: () => boolean,
    ): Promise<() => void> => {
      let isActive = true;
      const isCurrentPlayback = () => isActive && shouldContinue();
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

      const frameTokens = new VideoFrameTokens();
      const frameGate = new NativeFrameGate();
      const lastGoodCopyGate = new IntervalGate(500);

      const imageBitmapCache = nativeImageBitmapCacheRef.current;
      // The cache is byte-budgeted, so a still can be evicted while its clip is still on screen:
      // a miss in the draw loop re-decodes it in the background (drawn from the next frame).
      const imageReloads = new Set<string>();
      const reloadNativeImage = (clipId: string) => {
        if (imageReloads.has(clipId) || imageBitmapCache.has(clipId)) return;
        const clipMedia = imageClips.find((entry) => entry.clip.id === clipId);
        const item = clipMedia ? getMediaItem(clipMedia.clip.mediaId) : undefined;
        if (item?.type !== "image" || !item.blob) return;
        imageReloads.add(clipId);
        createMediaImageBitmap(item)
          .then((bitmap) => {
            if (!isCurrentPlayback()) bitmap.close();
            else {
              imageBitmapCache.set(clipId, bitmap);
              nativeImageVersionRef.current.set(clipId, mediaImageVersion(item));
            }
          })
          .catch(() => {})
          .finally(() => imageReloads.delete(clipId));
      };
      for (const { clip } of imageClips) {
        const mediaItem = getMediaItem(clip.mediaId);
        if (imageBitmapCache.has(clip.id)) {
          // RAW Source Settings can change while paused (or undone); a still developed with other settings is stale.
          const stale = !!mediaItem && (nativeImageVersionRef.current.get(clip.id) ?? "") !== mediaImageVersion(mediaItem);
          if (!stale) continue;
          imageBitmapCache.delete(clip.id);
        }
        if (mediaItem?.type === "image" && mediaItem.blob) {
          try {
            const bitmap = await createMediaImageBitmap(mediaItem);
            if (!isCurrentPlayback()) { bitmap.close(); return () => {}; }
            imageBitmapCache.set(clip.id, bitmap);
            nativeImageVersionRef.current.set(clip.id, mediaImageVersion(mediaItem));
          } catch (error) {
            console.warn(`Failed to cache image bitmap for ${clip.id}:`, error);
          }
        }
      }

      if (!isCurrentPlayback()) return () => {};
      preDecodeAllAudioBuffers().catch((error) => {
        console.warn("[Preview] Audio warmup failed:", error);
      });

      const videoCache = nativeVideoCacheRef.current;
      const loadingVideos = new Map<string, Promise<void>>();

      const loadVideoForClip = (
        clip: (typeof timelineTracks)[0]["clips"][0],
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>,
      ): Promise<void> => {
        if (!isCurrentPlayback()) return Promise.resolve();
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
        previewProxyCache.noteDecode(clip.mediaId, playBlob);
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
          video.onerror = () => {
            if (isCurrentPlayback() && !isStabilized) failProxyPlayback(clip.mediaId, playBlob);
            finish();
          };
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
      if (!isCurrentPlayback()) return () => {};

      const masterClock = getMasterClock();
      masterClock.setDuration(actualEndTime);
      masterClock.seek(startPosition);

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setPreviewMuted(isMuted);

      const tracksWithAudio = timelineTracks.filter(
        (track) => !track.hidden && trackHasAudioItems(project, track.id),
      );
      for (const audioTrack of tracksWithAudio) {
        audioGraph.createTrack({
          trackId: audioTrack.id,
          volume: 1,
          pan: 0,
          muted: audioTrack.muted || false,
          solo: audioTrack.solo || false,
          soloSafe: audioTrack.soloSafe === true,
          effects: [],
        });
      }

      await audioGraph.resume();
      if (!isCurrentPlayback()) return () => {};
      audioGraph.seekTo(startPosition);
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

      const nativeVideoCacheId = (clip: (typeof clips)[0]["clip"]): string =>
        getVidstabEngine().hasStabilized(clip.id) ? `stabilized:${clip.id}` : clip.mediaId;

      /** Releases every decoded element that is neither the playing clip nor the one queued after it. */
      const releaseUnneededNativeVideos = (activeClipId: string): void => {
        const active = findNativeClipById(activeClipId);
        if (!active) return;
        const keep = new Set<string>([nativeVideoCacheId(active.clip)]);
        const upcoming = findNextNativeClip(activeClipId);
        if (upcoming) keep.add(nativeVideoCacheId(upcoming.clip));
        for (const [cacheId, entry] of [...videoCache]) {
          if (keep.has(cacheId) || loadingVideos.has(cacheId)) continue;
          releaseVideoElement(entry);
          videoCache.delete(cacheId);
        }
      };

      const findNativeClipById = (clipId: string) =>
        clips.find(({ clip }) => clip.id === clipId) ?? null;

      // Only the clip that is playing and the one after it are kept decoded. Clips load on demand
      // (drawFrame) and the next one is prefetched a second before the cut, so opening a decoder
      // for every source on the timeline up front only costs memory: each 4K element buffers
      // demuxed data and holds a hardware decoder's frame pool.
      if (activeStartClip) {
        const upcoming = findNextNativeClip(activeStartClip.clip.id);
        if (upcoming) loadVideoForClip(upcoming.clip, upcoming.mediaItem).catch(() => {});
      } else if (clips[0]) {
        loadVideoForClip(clips[0].clip, clips[0].mediaItem).catch(() => {});
      }

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
        if (nowPlayhead - lastPlayheadUpdateRef.current >= editingFrameDuration) {
          lastPlayheadUpdateRef.current = nowPlayhead;
          setPlayheadPosition(currentPlayhead);
        }

        const transitionInfo = getTransitionAtTime(
          currentPlayhead,
          timelineTracksRef.current,
          mediaClipHasVisual,
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
                editingFrameDuration
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
              if (!bitmap) reloadNativeImage(imgClip.id);
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
          if (nowNoClip - lastPlayheadUpdateRef.current >= editingFrameDuration) {
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
          if (nowNoCached - lastPlayheadUpdateRef.current >= editingFrameDuration) {
            lastPlayheadUpdateRef.current = nowNoCached;
            setPlayheadPosition(currentPlayhead);
          }
          rafId = requestAnimationFrame(() => { drawFrame(); });
          return;
        }

        const { video } = cached;

        if (currentClipId !== clip.id) {
          currentClipId = clip.id;
          releaseUnneededNativeVideos(clip.id);
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

        // A 30 fps clip presents a new frame every 33 ms but this loop runs at the display rate (up to
        // 120 Hz): when the decoded frame and everything drawn with it are unchanged, keep what the canvas
        // already shows instead of repainting, re-drawing the video and copying the canvas again.
        frameTokens.watch(video);
        const gateKey = ((): string | null => {
          const token = frameTokens.token(video);
          if (token === null || canvasFillModeRef.current === "blur") return null;
          if (latestClip.stabilization?.enabled) return null;
          const bg = getBackgroundRemovalEngine();
          if (bg?.isInitialized() && bg.getSettings(clip.id).enabled) return null;
          for (const { clip: imgClip } of imageClips) {
            if (currentPlayhead >= imgClip.startTime && currentPlayhead < imgClip.startTime + imgClip.duration) return null;
          }
          if (
            getActiveShapeClips(allShapeClipsRef.current, currentPlayhead).length > 0 ||
            getActiveTextClips(allTextClipsRef.current, currentPlayhead).length > 0 ||
            hasActiveMotionInstances(currentPlayhead) ||
            getActiveSubtitles(allSubtitles, currentPlayhead).length > 0
          ) {
            return null;
          }
          return JSON.stringify([
            clip.id, token, canvas.width, canvas.height, video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
            transform, clipCssFilterOnly(clip.id, clip), canvasFillModeRef.current, canvasFillColorRef.current,
            previewBgRef.current, isColorBypassed(), getEffectsBridge().whiteBalanceInputView(),
          ]);
        })();
        if (!frameGate.shouldDraw(gateKey)) {
          rafId = requestAnimationFrame(() => { drawFrame(); });
          return;
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
            if (!bitmap) reloadNativeImage(imgClip.id);
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
        const hasBgRemoval = (bgEngine?.isInitialized() && bgEngine.getSettings(clip.id).enabled) || clipHasWarp(latestClip);

        let videoFrame: HTMLVideoElement | ImageBitmap = video;
        if (hasBgRemoval) {
          try {
            const rawBitmap = await createImageBitmap(video);
            const processed = await applyEffectsToFrame(clip.id, rawBitmap, { clip: latestClip, time: currentPlayhead });
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
          videoFrame === video ? clipCssFilterOnly(clip.id, clip) : null;
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

        // The last-good copy is only a fallback for a failed decode: a full canvas readback every painted
        // frame is wasted work, a copy at most twice a second is enough.
        if (lastGoodCopyGate.due(performance.now())) {
          try {
            lastGoodFrameRef.current?.close();
            lastGoodFrameRef.current = await createImageBitmap(canvas);
          } catch {}
        }

        rafId = requestAnimationFrame(() => {
          drawFrame();
        });
      };

      const cleanup = (preserveCaches = false) => {
        isActive = false;
        nativePlaybackActiveRef.current = false;
        if (rafId) cancelAnimationFrame(rafId);
        frameTokens.dispose();

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

      if (!isCurrentPlayback()) return () => {};
      await masterClock.play();
      if (!isCurrentPlayback()) return () => {};
      audioGraph.startScheduler(getAudioClipsForScheduler);
      rafId = requestAnimationFrame(() => { drawFrame(); });

      return cleanup;
    },
    [
      actualEndTime,
      editingFrameDuration,
      allSubtitles,
      getMediaItem,
      failProxyPlayback,
      getAudioClipsForScheduler,
      isMuted,
      preDecodeAllAudioBuffers,
      releaseVideoElement,
      hasActiveMotionInstances,
      renderOverlayClipsInTrackOrder,
      fillPreviewBackground,
      setPlayheadPosition,
      timelineTracks,
      project,
      mediaClipHasVisual,
      previewRes.scale,
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
    {
      // Which dependency restarted playback (a restart mid-play is where a silent freeze can start).
      const now: Record<string, unknown> = {
        project, getAudioClipsForScheduler, preDecodeAllAudioBuffers, getMediaItem, getOriginalMediaItem,
        failProxyPlayback, proxySourceRevision, cleanupPlaybackResources, setupAudioFromAudioTrack,
        compoundAudioPreview, isMuted, previewW: previewRes.width, previewH: previewRes.height,
        hasActiveMotionInstances, renderMotionInstancesForTrack, mediaClipHasAudio, mediaClipHasVisual,
        clipMasksById, drawClipFrame, fillPreviewBackground, actualEndTime,
      };
      const before = playbackDepsRef.current;
      const changed = before ? Object.keys(now).filter((k) => before[k] !== now[k]) : ["first"];
      playbackDepsRef.current = now;
      recordPlaybackEvent(`effect-start changed=${changed.join(",") || "none"}`, startPositionRef.current);
    }

    const startPosition = resolvePlaybackStart(
      startPositionRef.current,
      actualEndTime,
      resolvePlaybackLoop(useTimelineStore.getState(), actualEndTime),
    );
    if (startPosition !== startPositionRef.current) {
      startPositionRef.current = startPosition;
      setPlayheadPosition(startPosition);
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
        if (!track.hidden) {
          for (const clip of track.clips) {
            if (
              mediaClipHasVisual(clip) &&
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

          previewProxyCache.noteDecode(clip.mediaId, mediaItem.blob);
          // ProRes and friends: frames come from the desktop sidecar, no proxy needed.
          const nativeSource = await claimNativeSource(mediaItem.blob);
          let input: { [Symbol.dispose]?: () => void };
          let videoTrack: { computeDuration(): Promise<number> };
          let webTrack: InputVideoTrack | null = null;
          if (nativeSource) {
            input = {};
            videoTrack = { computeDuration: async () => nativeSource.duration };
          } else {
            const mediabunnyInput = new Input({
              source: new BlobSource(mediaItem.blob),
              formats: ALL_FORMATS,
            });
            input = mediabunnyInput;

            const mediabunnyTrack = await mediabunnyInput.getPrimaryVideoTrack();
            if (!mediabunnyTrack || !isActive) {
              input[Symbol.dispose]?.();
              return;
            }
            videoTrack = mediabunnyTrack;
            webTrack = mediabunnyTrack;

            const canDecode = await mediabunnyTrack.canDecode();
            if (!canDecode || !isActive) {
              input[Symbol.dispose]?.();
              if (isActive && !canDecode) failProxyPlayback(clip.mediaId, mediaItem.blob);
              return;
            }
          }

          // Ensure canvas has valid dimensions BEFORE creating CanvasSink
          if (canvas.width === 0 || canvas.height === 0) {
            console.warn(
              "[Preview] Canvas has zero dimensions, setting from project settings",
            );
            canvas.width = previewRes.width;
            canvas.height = previewRes.height;
          }

          const sink = nativeSource
            ? new NativeCanvasSink(nativeSource, { width: canvas.width, quality: "preview" })
            : new CanvasSink(webTrack as InputVideoTrack, { poolSize: 3 });

          const speedEngine = getSpeedEngine();
          const clipLocalTime = Math.max(0, timelinePosition - clip.startTime);

          let currentSpeed = speedEngine.getClipSpeed(clip.id);
          let isReverse = speedEngine.isReverse(clip.id);
          let speedSourceClip = clip.id;

          // If video clip has default speed, check for linked audio clip's speed
          if (currentSpeed === 1 && !isReverse) {
            const tracks = timelineTracksRef.current;
            const audioTracks = tracks;

            for (const audioTrack of audioTracks) {
              for (const audioClip of audioTrack.clips) {
                if (
                  mediaClipHasAudio(audioClip) &&
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

          const frameDuration = editingFrameDuration;

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
                { clip, time: currentPlayhead },
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
              if (nowPh - lastPlayheadUpdateRef.current >= editingFrameDuration) {
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
          if (!isActive) return;
          if (mediaItem.blob !== getOriginalMediaItem(clip.mediaId)?.blob) {
            failProxyPlayback(clip.mediaId, mediaItem.blob);
          } else {
            pause();
          }
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

      // Refused for the memory budget and nothing has been released since: hold the last frame, do not re-probe.
      if (!precheckDecoder(decoderRefusalsRef.current, getMemoryGovernor(), clip.mediaId)) return null;

      try {
        const mediabunny = await import("mediabunny");
        const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunny;

        previewProxyCache.noteDecode(clip.mediaId, mediaItem.blob);
        const nativeSource = await claimNativeSource(mediaItem.blob);
        if (nativeSource) {
          if (!isActive) return null;
          return {
            input: {} as { [Symbol.dispose]?: () => void },
            sink: new NativeCanvasSink(nativeSource, { width: canvasRef.current?.width || undefined, quality: "preview" }),
            mediaId: clip.mediaId,
            clipId: clip.id,
            trackIndex,
          };
        }
        const input = new Input({
          source: new BlobSource(mediaItem.blob),
          formats: ALL_FORMATS,
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack || !isActive) {
          input[Symbol.dispose]?.();
          return null;
        }

        const canDecode = await videoTrack.canDecode();
        if (!canDecode || !isActive) {
          input[Symbol.dispose]?.();
          if (isActive) failProxyPlayback(clip.mediaId, mediaItem.blob);
          return null;
        }

        // Decode into canvases no larger than the monitor can show (4K sources: 4x less memory
        // per pooled canvas and per captured frame, with the same decode work).
        const monitor = canvasRef.current;
        const clipScale = clip.transform?.scale;
        const sinkSize = playbackSinkSize(
          videoTrack.displayWidth,
          videoTrack.displayHeight,
          Math.max(monitor?.width ?? 0, monitor?.height ?? 0),
          Math.max(Math.abs(clipScale?.x ?? 1), Math.abs(clipScale?.y ?? 1)),
          canDecodeBelowMonitorSize(clip) ? MIN_LAYER_DECODE_ZOOM : 1,
        );
        // Another 4K long-GOP decoder on top of the current ones would take the renderer past the memory
        // budget (soak: 0.85-1.1 GB each): fall back to the proxy path instead of opening it.
        const decoderBytes = estimateDecoderBytes(videoTrack.displayWidth, videoTrack.displayHeight);
        const governor = getMemoryGovernor();
        if (admitDecoder(decoderRefusalsRef.current, governor, clip.mediaId, decoderBytes) === "refused") {
          input[Symbol.dispose]?.();
          if (isActive) {
            // Falls back from an enabled proxy to the original (a no-op for an original). An original has no
            // cheaper source, so the layer is left out of the frame and the monitor says why.
            failProxyPlayback(clip.mediaId, mediaItem.blob);
            setDecoderFallback(requestProxyFallback(proxyRequestedRef.current, clip.mediaId, { proxiesOn, queue: (ids) => queueProxies(ids) }));
            setDecoderLimitHit(true);
          }
          return null;
        }
        setDecoderLimitHit(decoderLimitActive(decoderRefusalsRef.current, governor));
        const sink = new CanvasSink(videoTrack, {
          poolSize: 3,
          ...(sinkSize ?? {}),
        });

        // The decoder's frame pool lives in the renderer and no JS counter reports it: count it in the memory
        // governor for as long as this layer's decoder is open (released with the input).
        const releaseDecoder = getMemoryGovernor().registerDecoder(
          `playback:${clip.id}`,
          estimateDecoderBytes(videoTrack.displayWidth, videoTrack.displayHeight),
        );
        const trackedInput: { [Symbol.dispose]?: () => void } = {
          [Symbol.dispose]: () => {
            releaseDecoder();
            input[Symbol.dispose]?.();
          },
        };

        return {
          input: trackedInput,
          sink,
          mediaId: clip.mediaId,
          clipId: clip.id,
          trackIndex,
        };
      } catch (error) {
        if (isActive) failProxyPlayback(clip.mediaId, mediaItem.blob);
        console.error(
          `[Preview] Failed to init resources for clip ${clip.id}:`,
          error,
        );
        return null;
      }
    };

    type LayerResources = NonNullable<Awaited<ReturnType<typeof initClipResources>>>;

    // Look-ahead decoders: a clip that starts within PLAYBACK_DECODER_LOOKAHEAD_S gets its decoder opened (container
    // parse, canDecode, codec configuration: 100s of ms for 4K HEVC) while the current frames are still playing, so a
    // cut does not stall the frame loop on a cold open. Held here, not in playbackResourcesRef: that map is pruned to
    // the clips active at the playhead every frame.
    const lookahead = new Map<string, { clipId: string; needAt: number; endTime: number; promise: Promise<LayerResources | null> }>();
    const disposeLookahead = (entry: { promise: Promise<LayerResources | null> }) => {
      void entry.promise.then((resources) => {
        try {
          resources?.input[Symbol.dispose]?.();
        } catch {
          // Already closed.
        }
      });
    };
    const takeOrOpenResources = async (
      clip: (typeof timelineTracksRef.current)[0]["clips"][0],
      trackIndex: number,
    ): Promise<LayerResources | null> => {
      const warmed = lookahead.get(clip.id);
      if (warmed) {
        lookahead.delete(clip.id);
        const resources = await warmed.promise;
        if (resources) return resources;
      }
      return initClipResources(clip, trackIndex);
    };
    /** Opens every listed clip's decoder at once (they used to open one after another, each waiting for the last). */
    const openClipResources = async (
      entries: ReadonlyArray<{ clip: (typeof timelineTracksRef.current)[0]["clips"][0]; trackIndex: number }>,
    ) => {
      const missing = entries.filter(({ clip }) => !playbackResourcesRef.current.has(clip.id));
      if (missing.length === 0) return;
      const opened = await Promise.all(missing.map(({ clip, trackIndex }) => takeOrOpenResources(clip, trackIndex)));
      missing.forEach(({ clip }, i) => {
        const resources = opened[i];
        if (!resources) return;
        if (!isActive || playbackResourcesRef.current.has(clip.id)) {
          try {
            resources.input[Symbol.dispose]?.();
          } catch {
            // Already closed.
          }
          return;
        }
        playbackResourcesRef.current.set(clip.id, resources);
      });
    };
    const warmLayerInFlight = new Set<string>();
    const keepLayersWarm = (
      activeClips: ReadonlyArray<{ clip: Clip }>,
      skip: ReadonlySet<string>,
      playhead: number,
    ) => {
      for (const { clip } of activeClips) {
        if (skip.has(clip.id) || warmLayerInFlight.has(clip.id) || !mediaClipHasVisual(clip)) continue;
        const resources = playbackResourcesRef.current.get(clip.id);
        if (!resources) continue;
        const localTime = getSpeedEngine().getSourceTimeAtPlaybackTime(clip.id, playhead - clip.startTime);
        const sourceTime = Math.max(clip.inPoint, Math.min(clip.outPoint, (clip.inPoint || 0) + localTime));
        warmLayerInFlight.add(clip.id);
        void withDecodeDeadline((resources.sink as { getCanvas: (time: number) => Promise<unknown> }).getCanvas(sourceTime))
          .catch(() => undefined)
          .finally(() => warmLayerInFlight.delete(clip.id));
      }
    };
    const warmedTransitions = new Set<string>();
    const warmUpcomingClips = (time: number) => {
      for (const [clipId, entry] of lookahead) {
        // Left behind by a seek or loop: release the decoder rather than hold it open.
        if (isLookaheadStale(entry, time)) {
          lookahead.delete(clipId);
          disposeLookahead(entry);
        }
      }
      const governor = getMemoryGovernor();
      const tracks = timelineTracksRef.current;
      const transitionBridge = getTransitionBridge();
      const clipById = new Map(tracks.flatMap((t) => t.clips).map((c) => [c.id, c] as const));
      // Most urgent first. A transition shows the incoming clip before its own start, so the need point is the
      // transition's first frame, not the cut: opening on the cut leaves the decoder no head start at all.
      const plan = planLookahead({
        tracks,
        transitionsByTrack: tracks.map((track) => ((globalThis as { __orLegacyLookahead?: boolean }).__orLegacyLookahead ? [] : transitionBridge.getTransitionsForTrack(track.id))),
        time,
        horizonS: (globalThis as { __orLegacyLookahead?: boolean }).__orLegacyLookahead ? 1.5 : PLAYBACK_DECODER_LOOKAHEAD_S,
        transitionWindow: (transition, clipA) => {
          const full = clipById.get(clipA.id);
          return (full && transitionBridge.getTransitionWindow(transition as Parameters<typeof transitionBridge.getTransitionWindow>[0], full)) ?? { start: clipA.startTime + clipA.duration, end: clipA.startTime + clipA.duration };
        },
        isDecodable: (candidate) => {
          const clip = clipById.get(candidate.id);
          if (!clip || !mediaClipHasVisual(clip)) return false;
          const media = getMediaItem(clip.mediaId);
          return Boolean(media?.blob) && media?.type !== "image";
        },
      });
      // Warm each upcoming transition once, early enough that it finishes well before its first frame renders
      // (the warm render shares the engine canvas with real renders, so it never runs close to one).
      for (const target of plan.transitions) {
        if (warmedTransitions.has(target.transitionId) || target.needAt - time < TRANSITION_WARM_MIN_LEAD_S) continue;
        const transition = transitionBridge.getTransition(target.transitionId);
        if (!transition) continue;
        warmedTransitions.add(target.transitionId);
        const warmAt = performance.now();
        void transitionBridge.warmUp(transition).then(() => tracePlaybackStage("lookahead:transition-warm", warmAt, time)).catch(() => undefined);
      }
      for (const target of plan.clips) {
        if (lookahead.size >= PLAYBACK_DECODER_LOOKAHEAD_MAX) break;
        const clip = tracks[target.trackIndex]?.clips.find((c) => c.id === target.clipId);
        if (!clip || playbackResourcesRef.current.has(clip.id) || lookahead.has(clip.id)) continue;
        // Never provoke a refusal (its fallback side effects) for a clip that is not on screen yet.
        if (!precheckDecoder(decoderRefusalsRef.current, governor, clip.mediaId)) continue;
        if (!governor.canOpenDecoder(estimateDecoderBytes(3840, 2160))) break;
        const warmStartedAt = performance.now();
        lookahead.set(clip.id, {
          clipId: clip.id,
          needAt: target.needAt,
          endTime: clip.startTime + clip.duration,
          promise: initClipResources(clip, target.trackIndex)
            .then(async (resources) => {
              // Prime: decoding the first frame configures the codec and warms the hardware decoder, which is the
              // other half of a cold start. The sink reuses its pooled canvas, so nothing is kept.
              try {
                const primed = (await (resources?.sink as { getCanvas?: (time: number) => Promise<{ canvas?: HTMLCanvasElement | OffscreenCanvas } | null> } | undefined)?.getCanvas?.(
                  clip.inPoint || 0,
                )) ?? null;
                // Pre-roll the clip's effect and colour pipeline on that first frame, the way it runs once the clip is
                // on screen (shader compile, LUT texture upload, per-clip caches): the first real frame then pays none
                // of it. The result is discarded. Clips the engine renderer composites (temporal effects) are left alone.
                if (primed?.canvas && isActive && !clipHasTemporalEffects(clip) && clipNeedsFrameProcessing(clip.id, clip, 0)) {
                  // Not awaited: the call snapshots the primed canvas synchronously, and a slow pre-roll must never hold
                  // the decoder back from the frame loop that takes it over.
                  void preparePreviewFrame(clip.id, primed.canvas, rendererRef.current?.type === "webgpu", false, { clip, time: clip.startTime })
                    .then((prerolled) => {
                      tracePlaybackStage("lookahead:effects-preroll", warmStartedAt, time);
                      prerolled.cleanup();
                    })
                    .catch(() => undefined);
                }
              } catch {
                // The first real frame request reports a decode problem.
              }
              tracePlaybackStage("lookahead:open+prime", warmStartedAt, time);
              return resources;
            })
            .catch(() => null),
        });
      }
    };

    const preCacheAllImageBitmaps = async () => {
      const tracks = timelineTracksRef.current;
      const visualTracks = tracks.filter((track) => !track.hidden);

      for (const track of visualTracks) {
        for (const clip of track.clips) {
          if (imageBitmapCacheRef.current.has(clip.id)) continue;

          const mediaItem = getMediaItem(clip.mediaId);
          if (mediaItem?.type === "image" && mediaItem.blob) {
            try {
              const bitmap = await createMediaImageBitmap(mediaItem);
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
      recordPlaybackEvent("multi-start", playbackStartPosition);
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
        (track) => !track.hidden,
      );
      const hasActiveAudioClip = audioTracks.some((track) =>
        track.clips.some(
          (clip) =>
            mediaClipHasAudio(clip) &&
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

      await openClipResources(initialClips);

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
        (track) => !track.hidden && trackHasAudioItems(project, track.id),
      );
      for (const track of tracksWithAudio) {
        audioGraph.createTrack({
          trackId: track.id,
          volume: 1,
          pan: 0,
          muted: track.muted || false,
          solo: track.solo || false,
          soloSafe: track.soloSafe === true,
          effects: [],
        });
      }

      await compoundAudioPreview.prepareAt(project, playbackStartPosition);
      if (!isActive) return;
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
      recordPlaybackEvent("clock-play-await", playbackStartPosition);
      await masterClock.play();
      recordPlaybackEvent("clock-playing", playbackStartPosition);
      audioGraph.startScheduler(getAudioClipsForScheduler);

      const frameDuration = editingFrameDuration;
      let lastFrameTimestamp = performance.now();
      let frameCount = 0;
      // Feeds the dropped-frame indicator: frames that reach the canvas late count as dropped.
      const presentCadence = new PresentCadenceTracker(sharedDroppedFrames, frameDuration);
      sharedDroppedFrames.reset();
      let isProcessingFrame = false;
      // What the frame in flight is waiting on and since when: the watchdog below names it if the frame never ends.
      let frameStartedAt = 0;
      let frameStage = "idle";
      let previousFrameStartedAt = 0;
      let previousFramePlayhead = 0;
      let lastCachedFrameIndex = -1;

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
        frameStartedAt = performance.now();
        const currentPlayhead = masterClock.currentTime;
        if (previousFrameStartedAt > 0) {
          tracePlaybackLoopGap(frameStage, frameStartedAt - previousFrameStartedAt, currentPlayhead - previousFramePlayhead, currentPlayhead);
        }
        previousFrameStartedAt = frameStartedAt;
        previousFramePlayhead = currentPlayhead;
        frameStage = "start";

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
            recordPlaybackEvent("loop-exit:clock-not-playing", currentPlayhead);
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
          if (nowPlayhead - lastPlayheadUpdateRef.current >= editingFrameDuration) {
            lastPlayheadUpdateRef.current = nowPlayhead;
            setPlayheadPosition(currentPlayhead);
          }

          // Rendered (cached) segments play straight from the render cache so
          // effects-heavy frames never re-run the compositor during playback.
          const cachedFrameIndex = renderCacheService.cachedFrameIndex(currentPlayhead);
          if (cachedFrameIndex !== null) {
            if (cachedFrameIndex === lastCachedFrameIndex) {
              isProcessingFrame = false;
              if (isActive) animationRef.current = requestAnimationFrame(processMultiTrackFrame);
              return;
            }
            const cachedBitmap = await renderCacheService.takePlaybackFrame(currentPlayhead);
            if (cachedBitmap) {
              if (!isActive || !masterClock.isPlaying) {
                cachedBitmap.close();
                isProcessingFrame = false;
                return;
              }
              try {
                mainCtx.drawImage(cachedBitmap, 0, 0, canvas.width, canvas.height);
              } finally {
                cachedBitmap.close();
              }
              lastCachedFrameIndex = cachedFrameIndex;
              renderCacheService.logFrame(currentPlayhead, "cache");
              frameCount++;
          presentCadence.presented(performance.now(), rateRef.current);
              masterClock.reportVideoTime(currentPlayhead);
              lastFrameTimestamp = performance.now();
              isProcessingFrame = false;
              if (isActive) animationRef.current = requestAnimationFrame(processMultiTrackFrame);
              return;
            }
          }
          lastCachedFrameIndex = -1;

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
            (track) => !track.hidden,
          );
          const hasCurrentAudioClip = audioTracksForFrame.some((track) =>
            track.clips.some(
              (clip) =>
                mediaClipHasAudio(clip) &&
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
            if (resolvePlaybackLoop(useTimelineStore.getState(), actualEndTime)) {
              // Preserve empty portions of the marked range while looping.
              // Skipping to later content could jump beyond the loop's out point.
              fillPreviewBackground(mainCtx, currentPlayhead, canvas.width, canvas.height);
              masterClock.reportVideoTime(currentPlayhead);
              isProcessingFrame = false;
              animationRef.current = requestAnimationFrame(processMultiTrackFrame);
              return;
            }
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

          // Echo / Posterize Time pick other frames of the clip: the engine renderer (export's) decodes them.
          const hasActiveCompound = isAcesProject() || activeClips.some(
            ({ clip }) => getCompoundClipId(clip) !== null || clipHasTemporalEffects(clip) || clipHasTimeInterpolation(clip),
          );
          // Anamorphic / interlaced footage is conformed by the engine renderer, never the raw video-element draw.
          const hasActiveConformClip = activeClips.some(({ clip }) => {
            const media = getMediaItem(clip.mediaId);
            return media?.type === "video" && frameConformFor(media) !== null;
          });
          if (hasActiveCompound || hasActiveConformClip) {
            await renderFrameDirectlyRef.current(currentPlayhead);
            frameCount++;
          presentCadence.presented(performance.now(), rateRef.current);
            masterClock.reportVideoTime(currentPlayhead);
            const now = performance.now();
            const elapsed = now - lastFrameTimestamp;
            renderCacheService.logFrame(currentPlayhead, "live");
            renderCacheService.recordLiveFrameInterval(currentPlayhead, elapsed);
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

          frameStage = "open-decoders";
          const openAt = performance.now();
          await openClipResources(activeClips);
          tracePlaybackStage("frame:open-decoders", openAt, currentPlayhead);
          warmUpcomingClips(currentPlayhead);
          frameStage = "transition-or-decode";

          // Active transition takes over the whole frame: decode both clips
          // (one will be outside its visible window — its sink will clamp to
          // the nearest edge frame) and blend them. Overlays still render on
          // top below.
          const transitionInfoMulti = getTransitionAtTime(
            currentPlayhead,
            timelineTracksRef.current,
            mediaClipHasVisual,
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

            // A transition frame composites only the two transitioning clips, so the other layers' decoders are not asked
            // for a frame for the whole transition. A sequential decoder (the desktop ProRes stream, a long-GOP decode)
            // that is not read for a second falls out of its read-ahead window and restarts with a seek the moment the
            // transition ends: a 0.5 s stall. Keep each such layer reading in step with the playhead, off the frame's
            // critical path and one request at a time per layer.
            keepLayersWarm(
              activeClips,
              new Set([transitionInfoMulti.clipA.id, transitionInfoMulti.clipB?.id].filter((id): id is string => Boolean(id))),
              currentPlayhead,
            );

            const aLookup = findClipById(transitionInfoMulti.clipA.id);
            const bLookup = transitionInfoMulti.clipB
              ? findClipById(transitionInfoMulti.clipB.id)
              : null;

            if (aLookup && (!transitionInfoMulti.clipB || bLookup)) {
              const lookups = bLookup ? [aLookup, bLookup] : [aLookup];
              const trOpenAt = performance.now();
              await openClipResources(lookups.map((lookup) => ({ clip: lookup.clip, trackIndex: lookup.trackIndex })));
              tracePlaybackStage("transition:open-decoders", trOpenAt, currentPlayhead);

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
                  const result = await withDecodeDeadline(
                    (
                      resources.sink as {
                        getCanvas: (time: number) => Promise<{
                          canvas: HTMLCanvasElement | OffscreenCanvas;
                        } | null>;
                      }
                    ).getCanvas(sourceTime),
                  );
                  if (!result?.canvas) return null;
                  return result.canvas;
                } catch (error) {
                  if (error instanceof FrameDecodeTimeoutError && playbackResourcesRef.current.get(clip.id) === resources) {
                    try {
                      resources.input[Symbol.dispose]?.();
                    } catch {
                      // Already closed.
                    }
                    playbackResourcesRef.current.delete(clip.id);
                  }
                  console.warn(
                    `[Preview] Transition decode failed for clip ${clip.id}:`,
                    error,
                  );
                  return null;
                }
              };

              frameStage = "transition-decode";
              const trDecodeAt = performance.now();
              const [clipAFrame, clipBFrame] = await Promise.all([
                decodeClipFrameForTransition(aLookup.clip),
                bLookup
                  ? decodeClipFrameForTransition(bLookup.clip)
                  : Promise.resolve(null),
              ]);
              tracePlaybackStage("transition:decode", trDecodeAt, currentPlayhead);

              frameStage = "transition-effects";
              const trPrepareAt = performance.now();
              const preparedA = clipAFrame ? await preparePreviewFrame(
                aLookup.clip.id, clipAFrame, false, true, { clip: aLookup.clip, time: currentPlayhead },
              ) : null;
              const preparedB = clipBFrame && bLookup ? await preparePreviewFrame(
                bLookup.clip.id, clipBFrame, false, true, { clip: bLookup.clip, time: currentPlayhead },
              ) : null;
              tracePlaybackStage("transition:prepare-effects", trPrepareAt, currentPlayhead);
              const sampledA = preparedA?.frame ?? clipAFrame;
              const sampledB = preparedB?.frame ?? clipBFrame;
              const blank = transitionInfoMulti.clipB
                ? null
                : createTransparentCanvasSource(canvas.width, canvas.height);
              const outgoing =
                transitionInfoMulti.clipB || transitionInfoMulti.edge !== "in"
                  ? sampledA
                  : blank;
              const incoming = transitionInfoMulti.clipB
                ? sampledB
                : transitionInfoMulti.edge === "in"
                  ? sampledA
                  : blank;

              if (outgoing && incoming) {
                try {
                  frameStage = "transition-render";
                  const trRenderAt = performance.now();
                  const blended = await renderTransitionCanvas(
                    transitionInfoMulti,
                    outgoing,
                    incoming,
                  );
                  tracePlaybackStage("transition:render", trRenderAt, currentPlayhead);
                  frameStage = "transition-present";

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
                          getMediaItem,
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
          presentCadence.presented(performance.now(), rateRef.current);
                  masterClock.reportVideoTime(currentPlayhead);
                  const nowTr = performance.now();
                  // Transition frames are live frames like any other: without this entry the render-cache telemetry
                  // (and the playback benchmark built on it) sees a hole as long as the transition.
                  renderCacheService.logFrame(currentPlayhead, "live");
                  renderCacheService.recordLiveFrameInterval(currentPlayhead, nowTr - lastFrameTimestamp);
                  if (
                    nowTr - lastPlayheadUpdateRef.current >=
                    editingFrameDuration
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
                } finally {
                  preparedA?.cleanup();
                  preparedB?.cleanup();
                }
              } else {
                preparedA?.cleanup();
                preparedB?.cleanup();
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
            cleanup: () => void;
          }> = [];

          const videoClipPromises: Array<
            Promise<{
              clip: (typeof sortedClips)[0]["clip"];
              transform: ClipTransform;
              frame: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
              cleanup: () => void;
            } | null>
          > = [];

          for (const { clip } of sortedClips) {
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
            if (clipMedia?.type === "image") {
              let cachedBitmap = imageBitmapCacheRef.current.get(clip.id);
              if (
                !cachedBitmap &&
                clipMedia?.type === "image" &&
                clipMedia.blob instanceof Blob &&
                !failedImageDecodesRef.current.has(clip.id)
              ) {
                try {
                  cachedBitmap = await createMediaImageBitmap(clipMedia);
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
                const processed = clipNeedsFrameProcessing(clip.id, clip)
                  ? await applyEffectsToFrame(clip.id, cachedBitmap, { clip, time: currentPlayhead })
                  : cachedBitmap;
                if (!isActive) {
                  if (processed !== cachedBitmap) processed.close();
                  continue;
                }
                imageClipFrames.push({ clip, transform, frame: processed, cleanup: () => {
                  if (processed !== cachedBitmap) processed.close();
                } });
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
                  const sinkAt = performance.now();
                  const frameResult = await withDecodeDeadline(
                    (
                      resources.sink as {
                        getCanvas: (time: number) => Promise<{
                          canvas: HTMLCanvasElement | OffscreenCanvas;
                          timestamp: number;
                          duration: number;
                        } | null>;
                      }
                    ).getCanvas(sourceTime),
                  );

                  if (!isActive) return null;

                  tracePlaybackStage(`layer:sink-getCanvas:${getMediaItem(clip.mediaId)?.name ?? clip.id}`, sinkAt, currentPlayhead);
                  if (frameResult?.canvas) {
                    const prepareAt = performance.now();
                    const preparedFrame = await preparePreviewFrame(
                      clip.id,
                      frameResult.canvas,
                      useGPUFrames,
                      false,
                      { clip, time: currentPlayhead },
                    );
                    tracePlaybackStage("layer:prepare-effects", prepareAt, currentPlayhead);

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
                  if (error instanceof FrameDecodeTimeoutError) {
                    // The layer's decoder stopped answering: drop it (the next frame opens a fresh one) and
                    // paint without this layer for now instead of freezing playback.
                    const stuck = playbackResourcesRef.current.get(clip.id);
                    if (stuck === resources) {
                      try {
                        resources.input[Symbol.dispose]?.();
                      } catch {
                        // Already closed.
                      }
                      playbackResourcesRef.current.delete(clip.id);
                    }
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

          frameStage = "decode-frames";
          const decodeFramesAt = performance.now();
          const videoFrameResults = await Promise.all(videoClipPromises);
          tracePlaybackStage("frame:decode-frames", decodeFramesAt, currentPlayhead);
          frameStage = "composite";
          const compositeAt = performance.now();
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
              if (!track.hidden) {
                for (const clip of track.clips) {
                  if (mediaClipHasVisual(clip)) {
                    clipToTrackIndex.set(clip.id, idx);
                  }
                }
              }
            });

            const allRenderableTracks = getVisibleTrackRenderOrder(tracks);

            if (canvasFillModeRef.current === "blur") {
              for (const { originalIndex } of allRenderableTracks) {
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
              currentTextClips.length === 0 &&
              currentShapeClips.length === 0 &&
              !hasActiveMotionInstances(currentPlayhead) &&
              !validFrames.some(({ clip }) => clipMasksById.has(clip.id));

            if (useGPU) {
              const gpuLayers: GPULayer[] = [];
              const tempBitmaps: ImageBitmap[] = [];

              for (const { originalIndex } of allRenderableTracks) {
                const trackFrames = validFrames.filter(
                  (frame) =>
                    clipToTrackIndex.get(frame.clip.id) === originalIndex,
                );
                for (const { transform, frame } of trackFrames) {
                  if (frame instanceof ImageBitmap) {
                    gpuLayers.push({
                      bitmap: frame,
                      transform,
                    });
                  } else {
                    const bitmap = await createImageBitmap(frame);
                    tempBitmaps.push(bitmap);
                    gpuLayers.push({ bitmap, transform });
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
                const trackFrames = validFrames.filter(
                  (frame) =>
                    clipToTrackIndex.get(frame.clip.id) === originalIndex,
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
                const trackShapeClips = activeShapeClips.filter(
                  (clip) => clip.trackId === track.id,
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
                const trackTextClips = activeTextClips.filter(
                  (clip) => clip.trackId === track.id,
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
                      getMediaItem,
                    ),
                  );
                }
              }
              subjectFrame?.close();
            }

            for (const frame of validFrames) {
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
          tracePlaybackStage("frame:composite", compositeAt, currentPlayhead);

          frameCount++;
          presentCadence.presented(performance.now(), rateRef.current);
          masterClock.reportVideoTime(currentPlayhead);
          const now = performance.now();
          const elapsed = now - lastFrameTimestamp;
          renderCacheService.logFrame(currentPlayhead, "live");
          renderCacheService.recordLiveFrameInterval(currentPlayhead, elapsed);
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

      // A frame that never ends would freeze the preview for good (docs/known-limitations.md, Memory): after
      // FRAME_STALL_MS drop every layer decoder, restart the loop and record where it was waiting.
      const stopWatchdog = startFrameWatchdog({
        isProcessing: () => {
          if (!isActive) {
            stopWatchdog();
            return false;
          }
          return isProcessingFrame;
        },
        frameStartedAt: () => frameStartedAt,
        stage: () => frameStage,
        playhead: () => masterClock.currentTime,
        recover: (stall) => {
          console.warn(
            `[Preview] Playback frame stalled ${stall.stalledMs} ms waiting on "${stall.stage}" at ${stall.atPlayhead.toFixed(2)} s; rebuilding the layer decoders and restarting the frame loop`,
          );
          for (const [, resource] of playbackResourcesRef.current) {
            try {
              resource.input[Symbol.dispose]?.();
            } catch {
              // Already closed.
            }
          }
          playbackResourcesRef.current = new Map();
          isProcessingFrame = false;
          animationRef.current = requestAnimationFrame(processMultiTrackFrame);
        },
      });

      recordPlaybackEvent("loop-armed", playbackStartPosition);
      animationRef.current = requestAnimationFrame(processMultiTrackFrame);
    };

    const findNextClipStartTime = (afterTime: number): number | null => {
      const tracks = timelineTracksRef.current;
      const videoTracks = tracks.filter((track) => !track.hidden);
      let nextStart: number | null = null;

      for (const track of videoTracks) {
        for (const clip of track.clips) {
          if (mediaClipHasVisual(clip) && clip.startTime > afterTime) {
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
      const audioTracks = tracks.filter((track) => !track.hidden);
      let nextStart: number | null = null;

      for (const track of audioTracks) {
        for (const clip of track.clips) {
          if (mediaClipHasAudio(clip) && clip.startTime > afterTime) {
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
          recordPlaybackEvent("native-start-await", playbackStartPosition);
          nativeCleanup = await startNativeVideoPlayback(
            nativeCheck.clips,
            nativeCheck.imageClips || [],
            playbackStartPosition,
            () => pause(),
            () => isActive && previewProxyCache.store.getState().revision === proxySourceRevision,
          );
          recordPlaybackEvent("native-started", playbackStartPosition);
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
      for (const entry of lookahead.values()) disposeLookahead(entry);
      lookahead.clear();
      nativePlaybackActiveRef.current = false;
      const masterClock = getMasterClock();
      recordPlaybackEvent("effect-cleanup", masterClock.currentTime);
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
    getOriginalMediaItem,
    failProxyPlayback,
    proxySourceRevision,
    cleanupPlaybackResources,
    cleanupAudioResources,
    setupAudioFromAudioTrack,
    compoundAudioPreview,
    preDecodeAllAudioBuffers,
    getAudioClipsForScheduler,
    isMuted,
    previewRes.width,
    previewRes.height,
    previewRes.scale,
    editingFrameDuration,
    hasActiveMotionInstances,
    renderMotionInstancesForTrack,
    project,
    mediaClipHasAudio,
    mediaClipHasVisual,
    clipMasksById,
    drawClipFrame,
    fillPreviewBackground,
  ]);

  const lastProjectForRenderRef = useRef(project);
  const lastRenderSurfaceRef = useRef<string | null>(null);
  const lastProxyRevisionForRenderRef = useRef(proxySourceRevision);
  const lastPlayheadForRenderRef = useRef<number>(playheadPosition);
  const lastTextForRenderRef = useRef(allTextClips);
  const modifiedRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isPlaying) { pausedFrames.cancel(); releaseScrubVideoElements(); return; }

    if (isInteractingRef.current) {
      lastProjectForRenderRef.current = project;
      if (interactionTargetType === "text-clip") requestPausedFrame(playheadPosition);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Initial recovery has the same project and playhead as the refs above.
    // Draw that first frame, and redraw after resizing the backing canvas or
    // changing the renderer/theme, even when playback has not moved.
    const surface = `${project.id}:${previewRes.width}x${previewRes.height}:${isRenderBridgeReady}:${isDark}:${hardwareAcceleration}:${rendererType}`;
    const surfaceChanged = surface !== lastRenderSurfaceRef.current;
    lastRenderSurfaceRef.current = surface;

    const playheadChanged = playheadPosition !== lastPlayheadForRenderRef.current;
    const projectChanged = project !== lastProjectForRenderRef.current;
    const textChanged = allTextClips !== lastTextForRenderRef.current;
    lastTextForRenderRef.current = allTextClips;
    const sourceChanged = proxySourceRevision !== lastProxyRevisionForRenderRef.current;

    lastProjectForRenderRef.current = project;
    lastProxyRevisionForRenderRef.current = proxySourceRevision;
    lastPlayheadForRenderRef.current = playheadPosition;

    // A live dynamic-trim preview changes every tick; the usual 150 ms edit debounce would never fire mid-shuttle.
    if (surfaceChanged || playheadChanged || sourceChanged || textChanged || (projectChanged && trimPreviewProject !== null)) {
      requestPausedFrame(playheadPosition);
    } else if (projectChanged) {
      pausedFrames.cancel();
      if (modifiedRenderTimerRef.current) {
        clearTimeout(modifiedRenderTimerRef.current);
      }
      modifiedRenderTimerRef.current = setTimeout(() => {
        modifiedRenderTimerRef.current = null;
        requestPausedFrameRef.current(useTimelineStore.getState().playheadPosition);
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
    requestPausedFrame,
    releaseScrubVideoElements,
    interactionTargetType,
    allTextClips,
    pausedFrames,
    hardwareAcceleration,
    rendererType,
    project,
    trimPreviewProject,
    proxySourceRevision,
    isDark,
    previewRes.width,
    previewRes.height,
    isRenderBridgeReady,
  ]);

  useEffect(() => {
    renderCacheService.ensureStarted();
  }, []);

  // Live ducking follows the dialogue clips: re-schedule the audio when one moves or trims.
  useEffect(() => startLiveDuckingSync(), []);

  const [previewInvalidateCounter, setPreviewInvalidateCounter] = useState(0);
  const handledPreviewInvalidateRef = useRef(0);
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

  // A Morph Cut finished analysing (or failed): its span now renders differently, so repaint the frame on screen.
  useEffect(() => {
    const repaint = () => setPreviewInvalidateCounter((c) => c + 1);
    window.addEventListener("openreel:transition-render-changed", repaint);
    return () => window.removeEventListener("openreel:transition-render-changed", repaint);
  }, []);

  useEffect(() => {
    if (isPlaying || previewInvalidateCounter === handledPreviewInvalidateRef.current) return;
    handledPreviewInvalidateRef.current = previewInvalidateCounter;
    const canvas = canvasRef.current;
    if (!canvas) return;
    requestPausedFrame(playheadPosition);
  }, [previewInvalidateCounter, isPlaying, requestPausedFrame, playheadPosition]);

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
    const videoTracks = timelineTracks.filter((track) => !track.hidden);
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (!mediaClipHasVisual(clip)) {
          continue;
        }
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;
        if (playheadPosition >= clipStart && playheadPosition < clipEnd) {
          return clip;
        }
      }
    }
    return null;
  }, [timelineTracks, playheadPosition, mediaClipHasVisual]);

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
    if (
      !clip ||
      !mediaClipHasVisual(clip) ||
      !canvasRef.current ||
      !overlayRef.current
    ) return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

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

    const canvasWidth = programWidth;
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
    // Non-square pixels: the render fits the display shape, so the handles must too.
    const displaySize = mediaItem ? interpretedDisplaySize(mediaItem) : null;
    const sourceWidth = displaySize?.width;
    const sourceHeight = displaySize?.height;
    const mediaWidth = sourceWidth && sourceWidth > 0 ? sourceWidth : canvasWidth;
    const mediaHeight = sourceHeight && sourceHeight > 0 ? sourceHeight : canvasHeight;

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

    const offsetX = transform.position.x * programPar * displayScale;
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
      originX: canvasOffsetX + actualWidth / 2,
      originY: canvasOffsetY + actualHeight / 2,
      par: programPar,
    };
  }, [
    selectedClip,
    clipAtPlayhead,
    programWidth,
    programPar,
    settings.height,
    canvasSize,
    liveTransform,
    getMediaItem,
    mediaClipHasVisual,
  ]);

  // Web fonts finishing after the first measure would leave the selection box sized for the fallback face.
  const [fontsRevision, setFontsRevision] = useState(0);
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts?.addEventListener) return;
    const bump = () => setFontsRevision((revision) => revision + 1);
    fonts.addEventListener("loadingdone", bump);
    return () => fonts.removeEventListener("loadingdone", bump);
  }, []);
  const textClipBounds = useMemo(() => {
    if (!selectedTextClip || !canvasRef.current || !overlayRef.current)
      return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const { transform, style, text } = selectedTextClip;

    const canvasWidth = programWidth;
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

    const captionMetrics = getTitleEngine()?.measureText(
      text, style, getCaptionWrapWidth(selectedTextClip, canvasWidth),
    );
    const lines = captionMetrics?.lines.map((line) => line.text) ?? text.split("\n");
    const lineHeight = style.fontSize * style.lineHeight;
    const estimatedWidth = captionMetrics?.width ??
      style.fontSize * Math.max(...lines.map((l) => l.length)) * 0.6;

    const layout = textSelectionLayout(estimatedWidth, lines.length, lineHeight, style, transform);
    const textWidth = layout.width * displayScale;
    const textHeight = layout.height * displayScale;

    const posX = transform.position.x * canvasWidth * displayScale;
    const posY = transform.position.y * canvasHeight * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const x = canvasOffsetX + posX + layout.left * displayScale;
    const y = canvasOffsetY + posY + layout.top * displayScale;

    return {
      x,
      y,
      width: textWidth,
      height: textHeight,
      originX: -layout.left * displayScale,
      originY: -layout.top * displayScale,
      rotatedOffsets: layout.rotated,
      displayScale,
      isTextClip: true,
    };
  }, [selectedTextClip, programWidth, settings.height, canvasSize, getTitleEngine, fontsRevision]);

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
      if (!hasShortcutFocus(event.nativeEvent)) return;
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
      const normalizedX = pixelX / Math.max(1, programWidth);
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
      programWidth,
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

    const canvasWidth = programWidth;
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
  }, [selectedShapeClip, programWidth, settings.height, canvasSize]);

  const getGraphicClipDisplayBounds = useCallback(
    (clip: ShapeClip | SVGClip | StickerClip) => {
      if (!canvasRef.current || !overlayRef.current) return null;

      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      const overlayRect = overlay.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      const { transform } = clip;

      const canvasWidth = programWidth;
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
    [programWidth, settings.height],
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

    const canvasWidth = programWidth;
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
    programWidth,
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

      beginCanvasGesture();
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
    [selectedClip, clipAtPlayhead, beginCanvasGesture],
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

      beginCanvasGesture();
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
    [selectedClip, clipAtPlayhead, beginCanvasGesture],
  );

  const handleTextClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeTextClip) return;

      const { transform } = activeTextClip;

      beginCanvasGesture();
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
    [activeTextClip, beginCanvasGesture],
  );

  const handleTextHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeTextClip) return;

      const { transform } = activeTextClip;

      beginCanvasGesture();
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
    [activeTextClip, beginCanvasGesture],
  );

  const handleShapeClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeShapeClip) return;

      const { transform } = activeShapeClip;

      beginCanvasGesture();
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
    [activeShapeClip, beginCanvasGesture],
  );

  const handleShapeHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeShapeClip) return;

      const { transform } = activeShapeClip;

      beginCanvasGesture();
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
    [activeShapeClip, beginCanvasGesture],
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
            deltaX / displayScale / programWidth;
          const rawY =
            interactionStartRef.current.transform.y +
            deltaY / displayScale / settings.height;
          const offsets = textClipBounds.rotatedOffsets;
          const left = offsets.left / programWidth;
          const right = offsets.right / programWidth;
          const top = offsets.top / settings.height;
          const bottom = offsets.bottom / settings.height;
          const snapped = snapCanvasPosition({
            x: rawX,
            y: rawY,
            xCandidates: [
              { value: -left, guide: 0 },
              { value: 0.5 - (left + right) / 2, guide: 0.5 },
              { value: 1 - right, guide: 1 },
            ],
            yCandidates: [
              { value: -top, guide: 0 },
              { value: 0.5 - (top + bottom) / 2, guide: 0.5 },
              { value: 1 - bottom, guide: 1 },
            ],
            thresholdX: 8 / displayScale / programWidth,
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

          const radians = activeTextClip.transform.rotation * Math.PI / 180;
          const scaleDeltaX = (deltaX * Math.cos(radians) + deltaY * Math.sin(radians)) / displayScale / 100;
          const scaleDeltaY = (-deltaX * Math.sin(radians) + deltaY * Math.cos(radians)) / displayScale / 100;

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

        pendingOverlayTransformRef.current = { kind: "text", clipId: activeTextClip.id, transform: newTransform };
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            const now = performance.now();
            if (
              now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS
            ) {
              lastStoreUpdateRef.current = now;
              flushOverlayTransform();
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
            deltaX / displayScale / programWidth;
          const rawY =
            interactionStartRef.current.transform.y +
            deltaY / displayScale / settings.height;
          const halfWidth =
            shapeClipBounds.width / displayScale / programWidth / 2;
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
            thresholdX: 8 / displayScale / programWidth,
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

        pendingOverlayTransformRef.current = { kind: "shape", clipId: activeShapeClip.id, transform: newTransform };
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            const now = performance.now();
            if (now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS) {
              lastStoreUpdateRef.current = now;
              flushOverlayTransform();
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
          interactionStartRef.current.transform.x + deltaX / displayScale / programPar;
        const rawY =
          interactionStartRef.current.transform.y + deltaY / displayScale;
        const halfWidth = clipBounds.width / displayScale / 2;
        const halfHeight = clipBounds.height / displayScale / 2;
        const snapped = snapCanvasPosition({
          x: rawX,
          y: rawY,
          xCandidates: [
            { value: (-programWidth / 2 + halfWidth) / programPar, guide: 0 },
            { value: 0, guide: 0.5 },
            { value: (programWidth / 2 - halfWidth) / programPar, guide: 1 },
          ],
          yCandidates: [
            { value: -settings.height / 2 + halfHeight, guide: 0 },
            { value: 0, guide: 0.5 },
            { value: settings.height / 2 - halfHeight, guide: 1 },
          ],
          thresholdX: 8 / displayScale / programPar,
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
            newX = startTransform.x + deltaX / displayScale / programPar / 2;
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
            newX = startTransform.x + deltaX / displayScale / programPar / 2;
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
            newX = startTransform.x + deltaX / displayScale / programPar / 2;
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
      programWidth,
      programPar,
      settings.height,
      canvasSnappingEnabled,
      lockAspectRatio,
      interactionTargetType,
      activeShapeClip,
      shapeClipBounds,
      textClipBounds,
      activeTextClip,
      flushOverlayTransform,
    ],
  );

  const handleMouseUp = useCallback(() => {
    flushOverlayTransform();
    let transformCommit: ReturnType<typeof updateClipTransform> | null = null;
    if (pendingTransformRef.current) {
      transformCommit = updateClipTransform(
        pendingTransformRef.current.clipId,
        pendingTransformRef.current.transform,
      );
      pendingTransformRef.current = null;
    }
    finishCanvasGesture();
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
      if (transformCommit) {
        void transformCommit.then(() => requestPausedFrameRef.current(useTimelineStore.getState().playheadPosition));
      } else {
        requestPausedFrameRef.current(useTimelineStore.getState().playheadPosition);
      }
    }
  }, [updateClipTransform, flushOverlayTransform, finishCanvasGesture]);

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
        flushOverlayTransform();
        let transformCommit: ReturnType<
          typeof updateClipTransform
        > | null = null;
        if (pendingTransformRef.current) {
          transformCommit = updateClipTransform(
            pendingTransformRef.current.clipId,
            pendingTransformRef.current.transform,
          );
          pendingTransformRef.current = null;
        }
        finishCanvasGesture();
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
          if (transformCommit) {
            void transformCommit.then(() =>
              requestPausedFrameRef.current(useTimelineStore.getState().playheadPosition),
            );
          } else {
            requestPausedFrameRef.current(useTimelineStore.getState().playheadPosition);
          }
        }
      };

      window.addEventListener("mouseup", handleGlobalMouseUp);
      return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
    }
  }, [
    interactionMode,
    updateClipTransform,
    flushOverlayTransform,
    finishCanvasGesture,
  ]);

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

  const previewLoopRange = resolvePlaybackLoop(
    { loopEnabled: true, loopStart, loopEnd },
    actualEndTime,
  );
  const handleToggleLoop = () => {
    const state = useTimelineStore.getState();
    if (!state.loopEnabled && previewLoopRange) {
      state.setLoopRange(previewLoopRange.start, previewLoopRange.end);
    }
    state.setLoopEnabled(!state.loopEnabled);
  };

  // The mask pen owns the frame while it is armed: no transform handles under it.
  const maskPenActive = useMaskPenStore((state) => state.active);
  const showResizeHandles = !isPlaying && !maskPenActive && selectedClip && clipBounds;

  const showTextClipHandles = !isPlaying && selectedTextClip && textClipBounds;
  const editingTextClip =
    !isPlaying && editingTextClipId && selectedTextClip?.id === editingTextClipId
      ? selectedTextClip
      : null;
  const textEditorCenter = (() => {
    if (!editingTextClip || !textClipBounds) return null;
    const radians = (editingTextClip.transform.rotation * Math.PI) / 180;
    const dx = textClipBounds.width / 2 - textClipBounds.originX;
    const dy = textClipBounds.height / 2 - textClipBounds.originY;
    return {
      x: textClipBounds.x + textClipBounds.originX + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: textClipBounds.y + textClipBounds.originY + dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  })();


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
    if (isDevelopedRaw(mediaItem) && mediaItem.thumbnailUrl) {
      // The browser cannot show a camera file; the crop overlay uses the library thumbnail of the developed image.
      src = mediaItem.thumbnailUrl;
    } else if (mediaItem.blob) {
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

  const previewLabelIndex = useMemo(
    () => buildPreviewLabelIndex(project, allTextClips, allShapeClips),
    [project, allTextClips, allShapeClips],
  );
  const phoneFrameRemainder = phone && previewFrameSize.height > videoAreaSize.height && previewFrameSize.height - videoAreaSize.height < 1;
  const previewHeader = (<>
      {/* ── Panel bar header (mockup: 'Player') ───────────────── */}
      {!isMaximized && !isFullscreen && (
        <div className="workspace-preview-header">
          <MonitorTabs active="program" /><span>Timeline 1</span>
          <div className="workspace-preview-options">
            <MaskPenButton />
            <ObjectMaskButton />
            <ProxyToggleButton />
            {settings.colorManagement === "aces" && (
              <span
                data-testid="aces-badge"
                role="status"
                className="workspace-preview-choice text-xs"
                title="ACES color management: input transform, ACEScct grading, RRT and output transform. The monitor and scopes show the output transform."
              >
                {`ACES · ${(settings.acesOutput ?? "srgb") === "rec709" ? "Rec.709" : "sRGB"}`}
              </span>
            )}
            {settings.colorManagement === "ocio" && settings.ocio && (
              <span
                data-testid="ocio-badge"
                role="status"
                className="workspace-preview-choice text-xs"
                title="OpenColorIO: footage enters through its OCIO colour space, compositing runs in the working space, and the monitor shows the config's display and view."
              >
                {`OCIO · ${settings.ocio.display} / ${settings.ocio.view}`}
              </span>
            )}
            {memoryPolicy.pressure !== "normal" && (
              <span
                data-testid="memory-pressure-badge"
                role="status"
                className="workspace-preview-choice text-xs text-amber-500"
                title="Memory is running low. The preview runs at a lower resolution and keeps fewer decoded frames; exports are not affected. Close other apps or use proxies (Shift+P) to recover."
              >
                {memoryPolicy.pressure === "critical" ? "Low memory: reduced preview" : "Memory high: preview ×0.75"}
              </span>
            )}
            <DropdownMenu><DropdownMenuTrigger asChild><ShadcnButton variant="secondary" aria-label="Preview Zoom" className="workspace-preview-choice"><span>{zoomLevel === 1 ? "Fit" : `${Math.round(zoomLevel*100)}%`} <span aria-hidden="true">▾</span></span></ShadcnButton></DropdownMenuTrigger><DropdownMenuContent>{ZOOM_OPTIONS.map((opt) => <DropdownMenuItem key={opt.value} onSelect={() => setZoomLevel(opt.value)}>{opt.value === 1 ? "Fit" : opt.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
            <DropdownMenu><DropdownMenuTrigger asChild><ShadcnButton variant="secondary" aria-label="Playback quality" className="workspace-preview-choice"><span>{playbackQuality === "full" ? "Full res" : PREVIEW_QUALITY_OPTIONS.find((o) => o.value === playbackQuality)?.label ?? "Auto"} <span aria-hidden="true">▾</span></span></ShadcnButton></DropdownMenuTrigger><DropdownMenuContent>{PREVIEW_QUALITY_OPTIONS.map((opt) => <DropdownMenuItem key={opt.value} onSelect={() => setPlaybackQuality(opt.value)}>{opt.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
            <DropdownMenu><DropdownMenuTrigger asChild><ShadcnButton variant="ghost" aria-label="Preview options" className="workspace-preview-guides text-accent bg-accent-soft"><PreviewTransportIcon name="guides" size={16} strokeWidth={1.8} /></ShadcnButton></DropdownMenuTrigger><DropdownMenuContent align="end">
              <DropdownMenuLabel>Preview</DropdownMenuLabel>
              <DropdownMenuItem disabled={Boolean(playbackLockedReason) || exportState.isExporting || actualEndTime <= 0} onSelect={handleSkipBack}>Skip back 5s</DropdownMenuItem>
              <DropdownMenuItem disabled={Boolean(playbackLockedReason) || exportState.isExporting || actualEndTime <= 0} onSelect={handleSkipForward}>Skip forward 5s</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={scopesVisible} onCheckedChange={setScopesVisible}>Video scopes (Shift+S)</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showSafeMargins} onCheckedChange={setShowSafeMargins}>Title and action safe margins</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showCompositionGrid} onCheckedChange={setShowCompositionGrid}>Composition grid</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={canvasSnappingEnabled} onCheckedChange={(enabled) => { setCanvasSnappingEnabled(enabled); setCanvasSnapGuides({x:null,y:null}); }}>Canvas snapping</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem data-testid="vr-view-toggle" checked={vrViewOn && Boolean(settings.vr && settings.vr.projection !== "none")} disabled={!settings.vr || settings.vr.projection === "none"} onCheckedChange={setVrViewOn}>VR video view{!settings.vr || settings.vr.projection === "none" ? " (set VR Properties first)" : ""}</DropdownMenuCheckboxItem>
              <DropdownMenuItem data-testid="vr-view-reset-menu" disabled={!settings.vr || settings.vr.projection === "none"} onSelect={resetVrView}>Reset VR view</DropdownMenuItem>
              <DropdownMenuItem data-testid="sequence-vr-properties" onSelect={() => setVrDialogOpen(true)}>Sequence VR Properties…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub><DropdownMenuSubTrigger data-testid="color-management-trigger">Color management</DropdownMenuSubTrigger><DropdownMenuSubContent>
                {([["display-referred", "Display-referred (default)"], ["aces", "ACES (ACEScct grading)"], ["ocio", "OpenColorIO config"]] as const).map(([value, label]) => (
                  <DropdownMenuCheckboxItem key={value} data-testid={`color-management-${value}`} checked={(settings.colorManagement ?? "display-referred") === value} onCheckedChange={() => {
                    if (value === "ocio") {
                      // Without a stored config the dialog loads one; with one, switching back on is a single undoable step.
                      if (settings.ocio) void updateSettings({ colorManagement: "ocio", acesOutput: undefined });
                      else setOcioDialogOpen(true);
                      return;
                    }
                    void updateSettings({ colorManagement: value === "aces" ? "aces" : undefined, ...(value === "aces" ? {} : { acesOutput: undefined }) });
                  }}>{label}</DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuItem data-testid="ocio-open-dialog" onSelect={() => setOcioDialogOpen(true)}>OpenColorIO configuration…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] font-normal text-fg-3">ACES output transform</DropdownMenuLabel>
                {([["srgb", "sRGB (RRT + ODT)"], ["rec709", "Rec.709 (BT.1886)"]] as const).map(([value, label]) => (
                  <DropdownMenuCheckboxItem key={value} data-testid={`aces-output-${value}`} disabled={settings.colorManagement !== "aces"} checked={(settings.acesOutput ?? "srgb") === value} onCheckedChange={() => { void updateSettings({ acesOutput: value === "srgb" ? undefined : value }); }}>{label}</DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="max-w-[260px] whitespace-normal text-[10px] font-normal leading-snug">OpenColorIO: a config you load (with its LUT files) decides how each clip is read, the working space, and the display, view and looks the monitor and exports show. Settings are stored in the project and are one undo step. ACES: footage enters through an input transform (Interpret footage picks it per footage item), compositing runs in ACEScg half float, grading in ACEScct, and the picture leaves through the ACES RRT and the output transform above. HDR10 and HLG exports use the Rec.2020 1000 nit transforms. The monitor, scopes and SDR exports show the output transform. Frames with adjustment layers or text behind subject still render display-referred.</DropdownMenuLabel>
              </DropdownMenuSubContent></DropdownMenuSub>
              <SequenceColorSpaceMenu />
              <DropdownMenuSub><DropdownMenuSubTrigger disabled={(settings.workingColorSpace ?? "rec709") !== "rec2020" && settings.colorManagement !== "aces" && settings.colorManagement !== "ocio"}>HDR graphics white</DropdownMenuSubTrigger><DropdownMenuSubContent>
                {GRAPHICS_WHITE_OPTIONS.map(({ nits, label }) => (
                  <DropdownMenuCheckboxItem key={nits} checked={(settings.graphicsWhiteNits ?? DEFAULT_GRAPHICS_WHITE_NITS) === nits} onCheckedChange={() => { void updateSettings({ graphicsWhiteNits: nits === DEFAULT_GRAPHICS_WHITE_NITS ? undefined : nits }); }}>{label}</DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="max-w-[240px] whitespace-normal text-[10px] font-normal leading-snug">Where titles, shapes, stickers and subtitles sit in an HDR project: the brightness of their white. 203 nits is ITU-R BT.2408 graphics white. Video is not affected.</DropdownMenuLabel>
              </DropdownMenuSubContent></DropdownMenuSub>
              <DropdownMenuSub><DropdownMenuSubTrigger>Sequence start timecode</DropdownMenuSubTrigger><DropdownMenuSubContent>
                {SEQUENCE_START_TIMECODES.map(({ label, hours }) => {
                  const value = sequenceStartTimecodeValue(hours, settings.frameRate);
                  return <DropdownMenuCheckboxItem key={label} checked={(settings.startTimecode ?? "").replace(";", ":") === (value ?? "").replace(";", ":")} onCheckedChange={() => { void updateSettings({ startTimecode: value }); }}>{label}</DropdownMenuCheckboxItem>;
                })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="max-w-[240px] whitespace-normal text-[10px] font-normal leading-snug">Written into MOV and MXF exports from the desktop app and used as the record timecode of EDL, XML and FCPXML exports. Set a custom value in the Export dialog.</DropdownMenuLabel>
              </DropdownMenuSubContent></DropdownMenuSub>
              <DropdownMenuSub><DropdownMenuSubTrigger>Aspect ratio</DropdownMenuSubTrigger><DropdownMenuSubContent>{ASPECT_PRESETS.map((opt) => <DropdownMenuItem key={opt.label} onSelect={() => { void updateSettings({width:opt.width,height:opt.height}); }}>{opt.label} · {opt.width}×{opt.height}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub>
              <DropdownMenuItem onSelect={handleMaximize}>{isMaximized ? "Restore Size" : "Maximize Preview"}</DropdownMenuItem>
              <DropdownMenuItem onSelect={handleFullscreen}>{isFullscreen ? "Exit Full Screen" : "Full Screen"}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
          </div>
        </div>
      )}

  </>);
  const transportControls = (<>
      {/* Shared transport controls, backed by the existing playback engine. */}
      <div className="workspace-preview-controls">
        <div className="workspace-preview-scrub-row"><PreviewScrubber position={playheadPosition} duration={actualEndTime} frameRate={settings.frameRate} disabled={Boolean(playbackLockedReason) || exportState.isExporting} onSeek={seekTo} /></div>

        {/* Controls row */}
        <div data-preview-transport className="min-h-12 px-3 py-1 flex flex-wrap items-center gap-2">
        <div data-preview-timecode className="flex items-center gap-2">
          <PreviewTimecode position={playheadPosition} duration={actualEndTime} frameRate={settings.frameRate} startTimecode={settings.startTimecode}
            disabled={Boolean(playbackLockedReason) || exportState.isExporting} />
        </div>

        <PreviewTransportControls duration={actualEndTime} frameRate={settings.frameRate} playing={isPlaying}
          lockedReason={playbackLockedReason} exporting={exportState.isExporting} onTogglePlayback={togglePlayback} />
        <div data-preview-tools className="flex gap-1.5 items-center">
          <ShadcnButton variant="ghost" size="icon-sm" title={`Loop ${formatFrameTimecode(previewLoopRange?.start ?? 0, settings.frameRate)} to ${formatFrameTimecode(previewLoopRange?.end ?? 0, settings.frameRate)} • I: mark start • O: mark end • Shift+L: toggle`} aria-pressed={loopEnabled} onClick={handleToggleLoop} type="button" aria-label={loopEnabled ? "Disable preview loop" : "Enable preview loop"} disabled={(actualEndTime <= 0 || exportState.isExporting)} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg", `w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${loopEnabled ? "bg-accent/15 text-accent" : "bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"}`)}>
            {<PreviewTransportIcon name="loop" size={16} strokeWidth={1.8} />}
          </ShadcnButton>
          <ShadcnButton variant="ghost" size="icon-sm" onClick={() => setIsMuted(!userMuted)} type="button" aria-label={isMuted ? "Unmute" : "Mute"} title={isMuted ? "Unmute" : "Mute"} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg", `w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isMuted
                ? "bg-bg-2 text-status-error"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`)}>
            {isMuted ? <VolumeX size={16} /> : <PreviewTransportIcon name="volume" size={16} strokeWidth={1.8} />}
          </ShadcnButton>

          <ShadcnButton variant="ghost" size="icon-sm" data-preview-fullscreen aria-pressed={isFullscreen} onClick={handleFullscreen} type="button" aria-label={isFullscreen ? "Exit Full Screen" : "Full Screen"} title={isFullscreen ? "Exit Full Screen" : "Full Screen"} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg", `w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isFullscreen
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`)}>
            {<PreviewTransportIcon name="fullscreen" size={16} strokeWidth={1.8} />}
          </ShadcnButton>

        </div>
        </div>
      </div>
  </>);

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
      {!phone && previewHeader}
      {ocioDialogOpen && (
        <React.Suspense fallback={null}>
          <OcioDialog onClose={() => setOcioDialogOpen(false)} />
        </React.Suspense>
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
        className={`workspace-preview-area flex-1 min-h-0 min-w-0 relative flex items-center justify-center bg-bg-1 transition-all duration-300 ${
          isMaximized || isFullscreen ? "p-0" : "p-[18px]"
        } ${zoomLevel > 1 ? "overflow-auto" : ""}`}
        data-preview-zoomed={zoomLevel > 1}
        onMouseMove={interactionMode !== "none" ? handleMouseMove : undefined}
        onMouseUp={handleMouseUp}
      >
        <div className="workspace-preview-meta"><span>{settings.width}×{settings.height} · {Math.round(previewFrameSize.width / programWidth * 100)}%</span><span>{previewLabelAt(previewLabelIndex, playheadPosition)}</span></div>
        <EmptyProjectStart />
        {scopesVisible && (
          <React.Suspense fallback={null}>
            <ScopesPanel />
          </React.Suspense>
        )}
        <div
          ref={overlayRef}
          className={`workspace-preview-frame relative isolate bg-[var(--screen-bg)] overflow-visible transition-all duration-300 ${
            isMaximized || isFullscreen
              ? "rounded-none ring-0 shadow-none"
              : isDark
                ? "shadow-2xl rounded-[10px] ring-1 ring-border shadow-[0_0_50px_rgba(0,0,0,0.5)]"
                : "rounded-[10px] ring-1 ring-border shadow-sm"
          }`}
          style={{
            width: `${previewFrameSize.width}px`,
            height: `${previewFrameSize.height}px`,
            alignSelf: phoneFrameRemainder ? "flex-start" : undefined,
            flexShrink: zoomLevel > 1 ? 0 : undefined,
            maxWidth: zoomLevel > 1 ? "none" : "100%",
            maxHeight: phoneFrameRemainder || zoomLevel > 1 ? "none" : "100%",
          }}
          onMouseMove={!isPlaying ? handleGraphicsMouseMove : undefined}
          onClick={!isPlaying ? handleGraphicsClick : undefined}
          onMouseLeave={() => setHoveredGraphicClipId(null)}
        >
          <canvas
            key={canvasEpoch}
            ref={canvasRef}
            role="img"
            aria-busy={previewFramePending}
            aria-label={isPlaying ? "Program preview (playing)" : presentedFrameTime === null ? "Program preview" : `${presentedFrameIsFallback ? "Program preview unavailable at" : "Program frame"} ${formatFrameTimecode(presentedFrameTime, settings.frameRate)}`}
            width={previewRes.width}
            height={previewRes.height}
            className="w-full h-full object-contain bg-[var(--screen-bg)] rounded-[10px]"
            style={{
              cursor: hoveredGraphicClipId && !isPlaying ? "pointer" : "default",
            }}
          />

          <ProgramMonitorOverlays />
          {vrViewOn ? (
            <React.Suspense fallback={null}>
              <VrMonitorOverlay />
            </React.Suspense>
          ) : null}
          {vrDialogOpen ? (
            <React.Suspense fallback={null}>
              <VrPropertiesDialog
                title="Sequence VR Properties"
                subtitle="Projection, frame layout and captured view of this sequence"
                value={settings.vr}
                onClose={() => setVrDialogOpen(false)}
                onApply={(vr) => { void updateSettings({ vr: vr ?? undefined }); if (!vr) setVrViewOn(false); }}
              />
            </React.Suspense>
          ) : null}
          <DynamicTrimTwoUp />
          <TrimMonitor />
          <MotionTrackingOverlay clipId={(selectedClip || clipAtPlayhead)?.id ?? null} bounds={clipBounds} />
          <PlanarTrackOverlay clipId={(selectedClip || clipAtPlayhead)?.id ?? null} bounds={clipBounds} />
          <CornerPinOverlay />
          {(selectedClip || clipAtPlayhead)?.keyframes?.some((key) => key.property.startsWith("position")) && (
            <React.Suspense fallback={null}>
              <SpatialPathOverlay clipId={(selectedClip || clipAtPlayhead)?.id ?? null} bounds={clipBounds} disabled={isPlaying} />
            </React.Suspense>
          )}

          {decoderLimitHit && (
            <div role="status" aria-live="polite" data-testid="decoder-limit-notice" className="absolute left-1/2 top-3 z-30 w-max max-w-[min(92%,34rem)] -translate-x-1/2 rounded-md border border-border bg-bg-2 px-2.5 py-1.5 text-[11px] text-fg-2 shadow-sm">
              {decoderLimitMessage(decoderFallback)}
            </div>
          )}
          <PreviewFrameStatus busy={previewFramePending} failed={previewFrameFailed} reason={previewFailureReason} onRetry={() => requestPausedFrame(useTimelineStore.getState().playheadPosition)} />

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

          {/* Mask pen tool: draw / edit Bezier masks directly on the frame */}
          {!cropMode && <MaskPenOverlay disabled={isPlaying} />}
          {!cropMode && <ObjectMaskOverlay disabled={isPlaying} />}

          {/* Resize/Transform Overlay */}
          {!cropMode && showResizeHandles && clipBounds && (
            <div data-video-transform-handles className="absolute pointer-events-none"
              style={{ left: clipBounds.x, top: clipBounds.y, width: clipBounds.width, height: clipBounds.height }}>
              <PreviewTransformControls kind="clip" aspectLocked={lockAspectRatio}
                onToggleAspect={() => setLockAspectRatio(value => !value)}
                onMove={handleClipMouseDown} onResize={handleHandleMouseDown}
                onFocusCanvas={() => containerRef.current?.focus({ preventScroll: true })} />
            </div>
          )}

          {/* Text Clip Resize/Transform Overlay */}
          {showTextClipHandles && textClipBounds && (
            <div data-text-transform-handles className="absolute pointer-events-none"
              style={{
                left: textClipBounds.x, top: textClipBounds.y,
                width: textClipBounds.width, height: textClipBounds.height,
                transform: `rotate(${selectedTextClip?.transform.rotation ?? 0}deg)`,
                transformOrigin: `${textClipBounds.originX}px ${textClipBounds.originY}px`,
              }}>
              {!editingTextClip && (
                <div data-text-edit-hit-area aria-hidden="true"
                  className="absolute inset-0 pointer-events-auto cursor-text"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (selectedTextClip) setEditingTextClipId(selectedTextClip.id);
                  }} />
              )}
              <PreviewTransformControls kind="text" aspectLocked={lockAspectRatio}
                onToggleAspect={() => setLockAspectRatio(value => !value)}
                onMove={handleTextClipMouseDown} onResize={handleTextHandleMouseDown}
                onFocusCanvas={() => containerRef.current?.focus({ preventScroll: true })}
                moveStyle={{
                  left: textClipBounds.height < 40
                    ? textClipBounds.x < (phone ? 78 : 52)
                      ? `calc(100% + ${phone ? 34 : 12}px)` : phone ? -78 : -52
                    : "50%",
                  transform: textClipBounds.height < 40 ? "translateY(-50%)" : "translate(-50%, -50%)",
                }} />
            </div>
          )}

          {/* In-place text editor (double-click a title) */}
          {editingTextClip && textClipBounds && textEditorCenter && (
            <TextInPlaceEditor
              key={editingTextClip.id}
              clip={editingTextClip}
              centerX={textEditorCenter.x}
              centerY={textEditorCenter.y}
              minWidth={textClipBounds.width}
              displayScale={textClipBounds.displayScale}
              onCommit={(text) => {
                updateTextContent(editingTextClip.id, text);
                setEditingTextClipId(null);
                containerRef.current?.focus({ preventScroll: true });
              }}
              onCancel={() => {
                setEditingTextClipId(null);
                containerRef.current?.focus({ preventScroll: true });
              }} />
          )}

          {/* Shape Clip Resize/Transform Overlay */}
          {showShapeClipHandles && shapeClipBounds && (
            <div data-shape-transform-handles className="absolute pointer-events-none"
              style={{ left: shapeClipBounds.x, top: shapeClipBounds.y, width: shapeClipBounds.width, height: shapeClipBounds.height }}>
              <PreviewTransformControls kind="graphic" aspectLocked={lockAspectRatio}
                onToggleAspect={() => setLockAspectRatio(value => !value)}
                onMove={handleShapeClipMouseDown} onResize={handleShapeHandleMouseDown}
                onFocusCanvas={() => containerRef.current?.focus({ preventScroll: true })}
                showBorder={selectedShapeClip.type !== "svg"} />
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
              <div className="absolute inset-0 border-2 border-yellow-500 rounded-lg pointer-events-none" />
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
        {exportState.isExporting && <ExportProgressOverlay progress={exportState.progress} phase={exportState.phase} width={videoAreaSize.width} height={videoAreaSize.height} />}
      </div>

      {phone ? <MobilePreviewTransport position={playheadPosition} duration={actualEndTime} playing={isPlaying} lockedReason={playbackLockedReason ?? null} onTogglePlayback={() => { togglePlayback(); }} onFullscreen={handleFullscreen}>{transportControls}{previewHeader}</MobilePreviewTransport> : transportControls}
    </div>
  );
};
