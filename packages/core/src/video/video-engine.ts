import {
  displayLayoutWidth,
  normalizeSequencePar,
  snapshotInDisplaySpace,
  squeezeOverlayToStored,
  withDisplaySpace,
} from "./sequence-par";
import { drawCaption } from "../captions/caption-layout";
import { sampleToUprightBitmap } from "../media/rotation";
import { estimateDecoderBytes, getMemoryGovernor } from "../device/memory-governor";
import { applyInputTransformToBitmap, inputTransformFor, type InputTransform } from "../color/input-transform";
import { inputSpaceForItem } from "../color/source-color";
import { createMediaImageBitmap, invalidateRawMedia, mediaImageVersion } from "../raw/raw-media";
import type { RawStillInfo } from "../raw/settings";
import {
  DEFAULT_GRAPHICS_WHITE_NITS,
  computeLayerGeometry,
  graphicsWhiteGain,
  hdrPipelineFor,
  hdrSourceDecode,
  registerAcesOutputTransform,
  isHdrWorkingMode,
  prepareHdrGrade,
  attachHdrPayload,
  type HdrCompositor,
  type SourceCodes,
} from "../color/hdr-working";
import { resolveHdrEffects } from "../color/hdr-effects";
import { acesOutputTransform } from "../color/aces-output";
import { isHdrTransitionKind, planHdrTransition } from "./hdr-transition";
import { getNativeFrameCodes } from "../media/native-frame-source";
import {
  createHdrCompositor,
  exportPayload,
  hdrOfTarget,
  isHdrEligibleClip,
  type HdrExportTarget,
} from "./hdr-frame";
import type {
  Timeline,
  Track,
  Clip,
  Effect,
  Transform,
  Subtitle,
} from "../types/timeline";
import type {
  MediaItem,
  Project,
  MediaLibrary,
  ProjectSettings,
} from "../types/project";
import type { TextClip } from "../text/types";
import type { ShapeClip, EmphasisAnimation } from "../graphics/types";
import { titleEngine } from "../text/title-engine";
import type { ThreeJSLayerRenderer } from "./overlay-three-renderer";
import { graphicsEngine } from "../graphics/graphics-engine";
import { VideoEffectsEngine } from "./video-effects-engine";
import { EchoCompositor } from "./echo-compositor";
import {
  clipHasTemporalEffects,
  findActiveEcho,
  isTemporalEffectType,
  planEcho,
  posterizedClipTime,
} from "./temporal-effects";
import {
  ColorGradingEngine,
  type ClipColorGrading,
  type LUTData,
} from "./color-grading-engine";
import {
  isNeutralColorGrading,
} from "./color-grading-defaults";
import { planColorGrading } from "./lumetri-pipeline";
import { TransitionEngine } from "./transition-engine";
import { MaskEngine, type Mask } from "./mask-engine";
import type { Transition } from "../types/timeline";
import { getMediaEngine } from "../media/mediabunny-engine";
import type {
  RenderedFrame,
  CompositeLayer,
  BlendMode,
  FrameCacheConfig,
  FrameCacheStats,
  CachedFrame,
  VideoClipRenderInfo,
  VideoCodecSupport,
  FilterDefinition,
  PreloadRequest,
} from "./types";
import { getAnimatedImageSourceTime, getSpeedEngine } from "./speed-engine";
import { getFrameInterpolationEngine } from "./frame-interpolation";
import {
  getStabilizedTransform,
  getVidstabEngine,
} from "./stabilization";
import {
  ParallelFrameDecoder,
  getParallelFrameDecoder,
} from "./parallel-frame-decoder";
import {
  CompositeFrameBuffer,
  getCompositeFrameBuffer,
} from "./frame-ring-buffer";
import { GPUCompositor, initializeGPUCompositor } from "./gpu-compositor";
import { getRendererFactory, type Renderer } from "./renderer-factory";
import { keyframeEngine } from "./keyframe-engine";
import { getAnimatedVideoEffects, isRenderableVideoEffect } from "./animated-video-effects";
import { createBurnInSource, drawBurnIn, timecodeBurnInOverlay, withBurnInText, type BurnInSource, type TimecodeBurnInSettings } from "./burn-in";
import { getAnimatedColorGrading } from "./animated-color-grading";
import { getBackgroundRemovalEngine } from "../ai/background-removal-engine";
import {
  type GifFrameCache,
  createGifFrameCache,
  getGifFrameAtTime,
  isAnimatedGif,
} from "../media/gif-decoder";
import { drawProjectParticles } from "../effects/particle-sampling";
import {
  createMotionAwareOcclusionMask,
  getPersonSegmentationEngine,
  type SegmentationResult,
} from "../ai/person-segmentation-engine";
import {
  MotionRenderer,
  type MotionRendererAssetResolver,
} from "../motion/motion-renderer";
import { MotionHighQualityRenderer } from "../motion/motion-gpu-render";
import { renderAuroraPreviewToImageBitmap } from "../motion/native-aurora-bridge";
import type { MotionAsset } from "../motion/types";
import { resolveCreationMotionSceneBinding } from "../creation/render-binding";
import { resolveCanvasFitDimensions } from "./canvas-fit";
import { conformBitmap } from "./deinterlace";
import { frameConformFor, type FieldOrder, type FrameConform } from "../media/interpretation";
import {
  AdjustmentLayerSchedule,
  planAdjustmentLayers,
  trackHasAdjustableContent,
  type AdjustmentLayerPlacement,
} from "./adjustment-layer-engine";
import {
  getMediaItemCapabilities,
  getVisibleTrackRenderOrder,
} from "../timeline/timeline-items";

const DEFAULT_CACHE_CONFIG: FrameCacheConfig = {
  maxFrames: 100,
  maxSizeBytes: 500 * 1024 * 1024, // 500MB
  preloadAhead: 30, // ~1 second at 30fps
  preloadBehind: 10,
};

function adjustmentBlendOperation(mode: BlendMode): CanvasRenderingContext2D["globalCompositeOperation"] {
  if (mode === "add" || mode === "linear-dodge") return "lighter";
  return mode as CanvasRenderingContext2D["globalCompositeOperation"];
}

interface FrameRenderOptions {
  textClips?: TextClip[];
  shapeClips?: ShapeClip[];
  realtime?: boolean;
  /** Export "Timecode burn-in": drawn last, over every track, adjustment layer and caption. */
  timecodeBurnIn?: TimecodeBurnInSettings;
}

type RenderableClipColorGrading = Omit<ClipColorGrading, "lut" | "inputLut"> & {
  lut?: LUTData;
  inputLut?: LUTData;
};

/** What a clip's effect stack needs to read other moments of the same clip (Echo). */
interface TemporalClipContext {
  readonly clip: Clip;
  readonly media: MediaItem;
  /** Clip-local time of the frame being rendered, with Posterize Time already applied. */
  readonly localTime: number;
  /** Size echo frames are decoded at (the project size the main frame was decoded at). */
  readonly decodeWidth: number;
  readonly decodeHeight: number;
}

/**
 * VideoEngine handles video frame rendering and composition.
 * Supports GPU acceleration, parallel decoding, frame caching, and effects.
 *
 * Usage:
 * ```ts
 * const engine = new VideoEngine({ maxFrames: 200 });
 * await engine.initialize();
 * const frame = await engine.renderFrame(project, 1.5);
 * ```
 */
export class VideoEngine {
  private overlay3DRenderer: ThreeJSLayerRenderer | null = null;
  private overlay3DLoading: Promise<ThreeJSLayerRenderer | null> | null = null;
  private overlay3DGeneration = 0;
  private mediabunny: typeof import("mediabunny") | null = null;
  private initialized = false;
  private frameCache: Map<string, CachedFrame> = new Map();
  /** Pixel aspect of the sequence being rendered (1 = square); clips are squeezed by it so they keep their display shape. */
  private sequencePixelAspect = 1;
  /** Burn-in source of the project being composed (frames are serialized, so one slot is enough). */
  private burnInSource: BurnInSource | undefined;
  private gifFrameCache: Map<string, GifFrameCache> = new Map();
  private staticImageCache: Map<string, ImageBitmap> = new Map();
  private cacheConfig: FrameCacheConfig;
  private cacheStats = { hits: 0, misses: 0 };
  private preloadQueue: PreloadRequest[] = [];
  private isPreloading = false;
  private compositeCanvas: OffscreenCanvas | null = null;
  private compositeCtx: OffscreenCanvasRenderingContext2D | null = null;
  private decodeCanvas: OffscreenCanvas | null = null;
  private decodeCtx: OffscreenCanvasRenderingContext2D | null = null;

  private parallelDecoder: ParallelFrameDecoder | null = null;
  private parallelDecoderStarted = false;
  private compositeBuffer: CompositeFrameBuffer | null = null;
  private useParallelDecoding = true;
  private videoElementCache: Map<
    string,
    { video: HTMLVideoElement; url: string }
  > = new Map();
  private compoundEngines = new Map<string, VideoEngine>();
  private renderingCompounds = new Set<string>();
  private frameCompositionTail: Promise<void> = Promise.resolve();
  /** Input transform (source colour space -> working image) of every clip in the frame being composed; empty for plain SDR projects. */
  private clipInputTransforms = new Map<string, InputTransform>();
  private inputTransformItems: Project["mediaLibrary"]["items"] | null = null;
  private inputTransformByMedia = new Map<string, InputTransform>();
  /** Set by an HDR export: the output colour space and chroma layout the float frames are encoded to. */
  private hdrExportTarget: HdrExportTarget | null = null;
  private hdrCompositor: HdrCompositor | null = null;
  private hdrGpuFailed = false;

  private gpuCompositor: GPUCompositor | null = null;
  private gpuRenderer: Renderer | null = null;
  private effectsEngine: VideoEffectsEngine | null = null;
  private readonly echoCompositor = new EchoCompositor();
  private colorGradingEngine: ColorGradingEngine | null = null;
  private transitionEngine: TransitionEngine | null = null;
  private maskEngine: MaskEngine | null = null;
  private motionRenderer: MotionRenderer | null = null;
  private motionHqRenderer: MotionHighQualityRenderer | null = null;
  private subjectMaskRequestCache = new WeakMap<
    ImageBitmap,
    Map<string, Promise<SegmentationResult | null>>
  >();
  private subjectOcclusionMaskCache = new WeakMap<
    ImageBitmap,
    WeakMap<SegmentationResult, ImageData>
  >();
  exportMode: boolean = false;
  /**
   * Nested-sequence engines composite onto a transparent canvas: a nest only
   * covers what its own content covers, so tracks below it in the parent show through.
   */
  transparentBackground: boolean = false;

  /**
   * Creates a new VideoEngine instance.
   *
   * @param config - Optional frame cache configuration
   */
  constructor(config: Partial<FrameCacheConfig> = {}) {
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Initializes the VideoEngine, setting up decoders and GPU compositor.
   * Must be called before rendering frames.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.isWebCodecsSupported()) {
      console.warn("[VideoEngine] WebCodecs not supported in this browser");
    }

    try {
      this.mediabunny = await import("mediabunny");
    } catch (error) {
      console.warn(
        "[VideoEngine] MediaBunny not available, some features will be limited:",
        error,
      );
      this.mediabunny = null;
    }

    // The decode workers (one mediabunny instance each) are only consumed by
    // parallel decoding, so spawning them stays off the editor's startup path:
    // they come up on the first getParallelDecoder() call.
    if (this.useParallelDecoding) {
      this.parallelDecoder = getParallelFrameDecoder();
    }

    this.compositeBuffer = getCompositeFrameBuffer();
    this.initialized = true;
  }

  private isWebCodecsSupported(): boolean {
    return (
      typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined"
    );
  }

  /**
   * Checks if MediaBunny (media utility library) is available.
   *
   * @returns true if MediaBunny is loaded, false otherwise
   */
  isMediaBunnyAvailable(): boolean {
    return this.mediabunny !== null;
  }

  /**
   * Gets the parallel frame decoder instance.
   *
   * @returns ParallelFrameDecoder or null if not initialized
   */
  getParallelDecoder(): ParallelFrameDecoder | null {
    const decoder = this.parallelDecoder;
    if (decoder && !this.parallelDecoderStarted) {
      this.parallelDecoderStarted = true;
      decoder.initialize().catch((error) => {
        console.warn(
          "[VideoEngine] Parallel decoder initialization failed:",
          error,
        );
        this.parallelDecoder = null;
      });
    }
    return decoder;
  }

  /**
   * Gets the composite frame buffer for frame management.
   *
   * @returns CompositeFrameBuffer or null if not initialized
   */
  getCompositeBuffer(): CompositeFrameBuffer | null {
    return this.compositeBuffer;
  }

  /**
   * Gets the GPU compositor instance.
   *
   * @returns GPUCompositor or null if not initialized
   */
  getGPUCompositor(): GPUCompositor | null {
    return this.gpuCompositor;
  }

  /**
   * Initializes GPU acceleration for frame compositing.
   *
   * @param width - Canvas width in pixels
   * @param height - Canvas height in pixels
   */
  async initializeGPUCompositor(width: number, height: number): Promise<void> {
    if (this.gpuCompositor) return;

    try {
      const canvas = new OffscreenCanvas(width, height);
      const factory = getRendererFactory();
      this.gpuRenderer = await factory.createRenderer({
        canvas,
        width,
        height,
      });

      this.gpuCompositor = initializeGPUCompositor({
        width,
        height,
        backgroundColor: [0, 0, 0, 1],
        antialias: true,
      });

      this.gpuCompositor.setRenderer(this.gpuRenderer);
    } catch (error) {
      console.warn(
        "[VideoEngine] GPU compositor initialization failed, using CPU fallback:",
        error,
      );
    }
  }

  /**
   * Checks if the VideoEngine is initialized.
   *
   * @returns true if engine is ready for rendering, false otherwise
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Enable or disable parallel decoding. Disable for export to ensure reliable sequential decoding.
   */
  setParallelDecoding(enabled: boolean): void {
    this.useParallelDecoding = enabled;
  }

  /**
   * Decode a frame using MediaBunny's WebCodecs-based decoder.
   * Much faster than video element seeking for export.
   */
  async decodeFrameWithMediaBunny(
    blob: Blob,
    time: number,
    width: number,
    _height: number,
    mediaId?: string,
  ): Promise<ImageBitmap | null> {
    try {
      const mediaEngine = getMediaEngine();
      if (!mediaEngine.isAvailable()) {
        await mediaEngine.initialize();
      }

      if (mediaId) {
        const exportDecoder = mediaEngine.getExportDecoder(mediaId);
        if (exportDecoder) {
          const canvas = await exportDecoder.getFrame(time);
          if (canvas) {
            return createImageBitmap(canvas);
          }
        }
      }

      const result = await mediaEngine.getFrameAtTime(blob, time, width);
      if (result?.canvas) {
        return createImageBitmap(result.canvas);
      }
      return null;
    } catch (error) {
      console.warn("[VideoEngine] MediaBunny frame decode failed:", error);
      return null;
    }
  }

  private interpFrameCache: Map<string, { bitmap: ImageBitmap; time: number }> =
    new Map();
  private static readonly INTERP_FRAME_CACHE_MAX = 2;

  private getCachedInterpFrame(key: string): ImageBitmap | null {
    const entry = this.interpFrameCache.get(key);
    if (!entry) return null;
    entry.time = performance.now();
    return entry.bitmap;
  }

  private setCachedInterpFrame(key: string, bitmap: ImageBitmap): void {
    if (this.interpFrameCache.size >= VideoEngine.INTERP_FRAME_CACHE_MAX) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of this.interpFrameCache) {
        if (v.time < oldestTime) {
          oldestTime = v.time;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.interpFrameCache.get(oldestKey)?.bitmap.close();
        this.interpFrameCache.delete(oldestKey);
      }
    }
    this.interpFrameCache.set(key, { bitmap, time: performance.now() });
  }

  private async decodeInterpolatedFrame(
    clip: Clip,
    mediaItem: MediaItem,
    _sourceTime: number,
    _timelineTime: number,
    width: number,
    height: number,
  ): Promise<ImageBitmap | null> {
    try {
      const frameRate = mediaItem.metadata?.frameRate ?? 30;
      const speedEngine = getSpeedEngine();
      const clipLocalTime = _timelineTime - clip.startTime;
      const interpInfo = speedEngine.getInterpolationInfo(
        clip.id,
        clipLocalTime,
        frameRate,
      );

      if (!interpInfo.needsInterpolation) return null;

      const timeBefore = clip.inPoint + interpInfo.frameBefore;
      const timeAfter = clip.inPoint + interpInfo.frameAfter;

      const cacheKey1 = `${mediaItem.id}:${timeBefore.toFixed(4)}`;
      const cacheKey2 = `${mediaItem.id}:${timeAfter.toFixed(4)}`;

      let frame1 = this.getCachedInterpFrame(cacheKey1);
      if (!frame1) {
        frame1 = await this.decodeFrameWithMediaBunny(
          mediaItem.blob!,
          timeBefore,
          width,
          height,
          mediaItem.id,
        );
        if (frame1) {
          const clone = await createImageBitmap(frame1);
          this.setCachedInterpFrame(cacheKey1, clone);
        }
      }

      let frame2 = this.getCachedInterpFrame(cacheKey2);
      if (!frame2) {
        frame2 = await this.decodeFrameWithMediaBunny(
          mediaItem.blob!,
          timeAfter,
          width,
          height,
          mediaItem.id,
        );
        if (frame2) {
          const clone = await createImageBitmap(frame2);
          this.setCachedInterpFrame(cacheKey2, clone);
        }
      }

      if (!frame1 || !frame2) return null;

      if (!this.exportMode) {
        const canvas = new OffscreenCanvas(frame1.width, frame1.height);
        const ctx = canvas.getContext("2d")!;
        ctx.globalAlpha = 1 - interpInfo.t;
        ctx.drawImage(frame1, 0, 0);
        ctx.globalAlpha = interpInfo.t;
        ctx.drawImage(frame2, 0, 0);
        ctx.globalAlpha = 1;
        return canvas.transferToImageBitmap();
      }

      const engine = getFrameInterpolationEngine();
      const quality = clip.interpolationQuality ?? "medium";
      engine.setQuality(quality);

      const result = await engine.interpolate(
        frame1,
        frame2,
        interpInfo.t,
        mediaItem.id,
        timeBefore,
        timeAfter,
      );

      return result.frame;
    } catch {
      return null;
    }
  }

  /**
   * Decode a frame using native video element (fallback method).
   */
  async decodeFrameWithVideoElement(
    mediaId: string,
    blob: Blob,
    time: number,
    width: number,
    height: number,
    conform?: FrameConform | null,
    sequenceFieldOrder?: FieldOrder,
  ): Promise<ImageBitmap | null> {
    let cached = this.videoElementCache.get(mediaId);

    if (cached) {
      // Map order is recency: the element in use moves to the back.
      this.videoElementCache.delete(mediaId);
      this.videoElementCache.set(mediaId, cached);
    } else {
      // Every element holds a hardware decoder and its frame pool (tens of MB at 4K), so only the
      // most recent few stay open; a timeline that hops across many sources used to keep one each.
      while (this.videoElementCache.size >= this.maxVideoElements) {
        const oldest = this.videoElementCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.releaseVideoElementEntry(oldest);
      }
      const url = URL.createObjectURL(blob);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Video load failed"));
        setTimeout(() => reject(new Error("Video load timeout")), 10000);
      });

      cached = { video, url };
      this.videoElementCache.set(mediaId, cached);
      // The decoder's frame pool is invisible to JS: register its estimated size so the memory governor counts it.
      this.videoElementDecoderRelease.get(mediaId)?.();
      this.videoElementDecoderRelease.set(
        mediaId,
        getMemoryGovernor().registerDecoder(`video-element:${mediaId}`, estimateDecoderBytes(video.videoWidth, video.videoHeight)),
      );
    }

    const { video } = cached;

    video.currentTime = time;

    await new Promise<void>((resolve) => {
      let resolved = false;
      const onSeeked = () => {
        if (resolved) return;
        resolved = true;
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      if (video.readyState >= 2) {
        onSeeked();
      }
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          video.removeEventListener("seeked", onSeeked);
          resolve();
        }
      }, 3000);
    });

    if (
      !this.decodeCanvas ||
      this.decodeCanvas.width !== width ||
      this.decodeCanvas.height !== height
    ) {
      this.decodeCanvas = new OffscreenCanvas(width, height);
      this.decodeCtx = this.decodeCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    }
    const ctx = this.decodeCtx!;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Pixel aspect / field order are applied to the stored frame first, so the letterbox below fits the display
    // shape and deinterlacing sees the real field rows (not rows of an already letterboxed canvas).
    let drawSource: CanvasImageSource = video;
    let sourceWidth = video.videoWidth;
    let sourceHeight = video.videoHeight;
    let conformedSource: ImageBitmap | null = null;
    if (conform) {
      try {
        const raw = await createImageBitmap(video);
        const conformed = await conformBitmap(raw, conform, sequenceFieldOrder);
        if (conformed !== raw) raw.close();
        conformedSource = conformed;
        drawSource = conformed;
        sourceWidth = conformed.width;
        sourceHeight = conformed.height;
      } catch (error) {
        console.warn("Could not apply pixel aspect / field order to the video-element frame:", error);
      }
    }

    const videoAspect = sourceWidth / sourceHeight;
    const canvasAspect = width / height;
    let drawWidth: number, drawHeight: number, drawX: number, drawY: number;

    if (videoAspect > canvasAspect) {
      drawWidth = width;
      drawHeight = width / videoAspect;
      drawX = 0;
      drawY = (height - drawHeight) / 2;
    } else {
      drawHeight = height;
      drawWidth = height * videoAspect;
      drawX = (width - drawWidth) / 2;
      drawY = 0;
    }

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(drawSource, drawX, drawY, drawWidth, drawHeight);
    conformedSource?.close();

    return createImageBitmap(this.decodeCanvas);
  }

  private static readonly MAX_VIDEO_ELEMENTS = 2;
  private maxVideoElements = VideoEngine.MAX_VIDEO_ELEMENTS;
  private videoElementDecoderRelease = new Map<string, () => void>();

  /** Decoder elements kept open (the memory governor lowers it under pressure); excess elements close at once. */
  setMaxVideoElements(count: number): void {
    this.maxVideoElements = Math.max(1, Math.floor(count));
    while (this.videoElementCache.size > this.maxVideoElements) {
      const oldest = this.videoElementCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.releaseVideoElementEntry(oldest);
    }
  }

  private releaseVideoElementEntry(mediaId: string): void {
    const cached = this.videoElementCache.get(mediaId);
    if (!cached) return;
    cached.video.pause();
    cached.video.removeAttribute("src");
    cached.video.load();
    URL.revokeObjectURL(cached.url);
    this.videoElementCache.delete(mediaId);
    this.videoElementDecoderRelease.get(mediaId)?.();
    this.videoElementDecoderRelease.delete(mediaId);
  }

  /**
   * Clear the video element cache, releasing resources.
   */
  clearVideoElementCache(): void {
    for (const [, cached] of this.videoElementCache) {
      cached.video.pause();
      cached.video.removeAttribute("src");
      cached.video.load();
      URL.revokeObjectURL(cached.url);
    }
    this.videoElementCache.clear();
    for (const release of this.videoElementDecoderRelease.values()) release();
    this.videoElementDecoderRelease.clear();
  }

  /**
   * Invalidate every cache keyed by a specific media id, so that a media item
   * whose blob was swapped in place (e.g. an AI tool result replacing a clip's
   * source video) is re-decoded instead of serving stale frames.
   */
  /** Cache key of a still: the media id, plus the RAW settings identity so a settings change never serves stale pixels. */
  private staticImageKey(item: { id: string; raw?: RawStillInfo }): string {
    return item.id + mediaImageVersion(item);
  }

  private cacheStaticImage(item: { id: string; raw?: RawStillInfo }, bitmap: ImageBitmap): void {
    const key = this.staticImageKey(item);
    if (item.raw) {
      // Older developments of the same RAW still are dead weight once the settings changed.
      for (const other of [...this.staticImageCache.keys()]) {
        if (other !== key && other.startsWith(`${item.id}#raw:`)) this.staticImageCache.delete(other);
      }
    }
    this.staticImageCache.set(key, bitmap);
  }

  invalidateMedia(mediaId: string): void {
    invalidateRawMedia(mediaId);
    for (const key of [...this.staticImageCache.keys()]) {
      if (key.startsWith(`${mediaId}#raw:`)) this.staticImageCache.delete(key);
    }
    const cachedVideo = this.videoElementCache.get(mediaId);
    if (cachedVideo) {
      cachedVideo.video.pause();
      cachedVideo.video.removeAttribute("src");
      cachedVideo.video.load();
      URL.revokeObjectURL(cachedVideo.url);
      this.videoElementCache.delete(mediaId);
    }

    const cachedImage = this.staticImageCache.get(mediaId);
    if (cachedImage) {
      try {
        cachedImage.close();
      } catch {
        // already released
      }
      this.staticImageCache.delete(mediaId);
    }

    const gifCache = this.gifFrameCache.get(mediaId);
    if (gifCache) {
      for (const frame of gifCache.frames) {
        try {
          frame.close();
        } catch {
          // already released
        }
      }
      this.gifFrameCache.delete(mediaId);
    }

    const prefix = `${mediaId}:`;
    for (const key of [...this.frameCache.keys()]) {
      if (key.startsWith(prefix)) {
        const entry = this.frameCache.get(key);
        try {
          entry?.image.close();
        } catch {
          // already released
        }
        this.frameCache.delete(key);
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.mediabunny) {
      throw new Error("VideoEngine not initialized. Call initialize() first.");
    }
  }

  /**
   * Renders a single video frame at a specific time with all overlays.
   * Combines video tracks, text clips, shape graphics, and subtitles.
   * Uses GPU acceleration if available, otherwise falls back to CPU rendering.
   * Renders tracks using painter's algorithm: higher index tracks render first (appear behind),
   * lower index tracks render last (appear on top).
   *
   * @param project - The project containing timeline and media
   * @param time - Time in seconds to render at
   * @param targetWidth - Optional canvas width (defaults to project settings)
   * @param targetHeight - Optional canvas height (defaults to project settings)
   * @returns Rendered frame with ImageBitmap and metadata
   */
  async renderFrame(
    project: Project,
    time: number,
    targetWidth?: number,
    targetHeight?: number,
    options: FrameRenderOptions = {},
  ): Promise<RenderedFrame> {
    const previous = this.frameCompositionTail;
    let release!: () => void;
    this.frameCompositionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.composeFrame(project, time, targetWidth, targetHeight, options);
    } finally {
      release();
    }
  }

  /**
   * Switches the scene-referred HDR export on or off. With a target, frames of a project that renders in HDR
   * working mode also carry float-derived encoder planes (see `takeHdrPayload`); with null the engine renders
   * for the preview / SDR export again.
   */
  setHdrExportTarget(target: HdrExportTarget | null): void {
    this.hdrExportTarget = target;
  }

  private async composeFrame(
    project: Project,
    time: number,
    targetWidth?: number,
    targetHeight?: number,
    options: FrameRenderOptions = {},
  ): Promise<RenderedFrame> {
    try {
      return await this.composeFrameOnce(project, time, targetWidth, targetHeight, options);
    } catch (error) {
      if (this.hdrCompositor?.kind !== "gpu" || this.hdrGpuFailed) throw error;
      // The half-float GPU path failed mid-frame (context loss, driver limits): retry this frame, and every
      // later one, on the identical CPU reference.
      console.warn("[hdr] GPU half-float compositing failed, falling back to the CPU reference:", error);
      this.hdrGpuFailed = true;
      this.hdrCompositor.dispose();
      this.hdrCompositor = null;
      return this.composeFrameOnce(project, time, targetWidth, targetHeight, options);
    }
  }

  private hdrAdjustmentLayersActive(project: Project, time: number): boolean {
    return (project.adjustmentLayers ?? []).some(
      (layer) =>
        layer.enabled &&
        layer.opacity > 0 &&
        time >= layer.startTime &&
        time < layer.startTime + layer.duration &&
        layer.effects.some((effect) => effect.enabled !== false),
    );
  }

  /** Merges what the 8-bit canvas holds into the float image at graphics white, then clears the canvas. */
  private flushHdrOverlay(
    hdr: HdrCompositor,
    ctx: OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    hdr.drawOverlay(ctx.canvas as OffscreenCanvas);
    ctx.clearRect(0, 0, width, height);
  }

  private async composeFrameOnce(
    project: Project,
    time: number,
    targetWidth?: number,
    targetHeight?: number,
    options: FrameRenderOptions = {},
  ): Promise<RenderedFrame> {
    this.ensureInitialized();

    const { timeline, mediaLibrary, settings } = project;
    const width = targetWidth ?? settings.width;
    const height = targetHeight ?? settings.height;
    this.prepareInputTransforms(project);

    const scaleX = width / settings.width;
    const scaleY = height / settings.height;
    this.sequencePixelAspect = normalizeSequencePar(settings.pixelAspectRatio);
    this.burnInSource = createBurnInSource(project);

    const activeTextClips = this.getActiveTextClips(timeline, time);
    const activeShapeClips = this.getActiveShapeClips(timeline, time);
    const activeSVGClips = this.getActiveSVGClips(timeline, time);
    const activeStickerClips = this.getActiveStickerClips(timeline, time);
    const activeSubtitles = this.getActiveSubtitles(timeline, time);


    const allRenderableTracks = getVisibleTrackRenderOrder(timeline.tracks);
    const compoundIds = new Set((project.compoundClips ?? []).map((compound) => compound.id));
    const compoundIdForClip = (clip: Clip) => typeof clip.metadata?.compoundClipId === "string"
      ? clip.metadata.compoundClipId : clip.mediaId.startsWith("compound:") ? clip.mediaId.slice("compound:".length) : null;

    if (
      !this.compositeCanvas ||
      this.compositeCanvas.width !== width ||
      this.compositeCanvas.height !== height
    ) {
      this.compositeCanvas = new OffscreenCanvas(width, height);
      this.compositeCtx = this.compositeCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    }
    const canvas = this.compositeCanvas;
    const ctx = this.compositeCtx!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Canvas background fill behind letterboxed clips. Color paints the chosen
    // hex; blur paints a blurred cover-fit copy of the base clip; default is
    // black. Drawn before the clip loop so contained clips composite on top.
    const fillMode = timeline.backgroundFillMode;
    if (this.transparentBackground) {
      ctx.clearRect(0, 0, width, height);
    } else if (fillMode === "color" && timeline.layoutBackgroundColor) {
      ctx.fillStyle = timeline.layoutBackgroundColor;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      if (fillMode === "blur") {
        await this.renderBlurredBackdrop(
          ctx,
          timeline,
          mediaLibrary,
          settings,
          time,
          width,
          height,
        );
      }
    }

    let subjectFrame: ImageBitmap | null = null;
    const activeTextNeedsSubject = activeTextClips.some(
      (clip) => clip.behindSubject,
    );
    const subjectStreamId = `video-engine:text-behind-subject:${allRenderableTracks
      .flatMap(({ track }) =>
        track.clips
          .filter(
            (clip) =>
              time >= clip.startTime &&
              time < clip.startTime + clip.duration &&
              getMediaItemCapabilities(
                mediaLibrary.items.find((item) => item.id === clip.mediaId),
              ).visual,
          )
          .map((clip) => clip.id),
      )
      .sort()
      .join("|") || "canvas"}`;

    // Scene-referred HDR: the project works in Rec.2020 (or an HDR export runs). Frames that text-behind-subject
    // or adjustment layers need to read back from the 8-bit canvas keep the classic path.
    const hdrActive =
      !this.transparentBackground &&
      !activeTextNeedsSubject &&
      !this.hdrAdjustmentLayersActive(project, time) &&
      isHdrWorkingMode(settings, hdrOfTarget(this.hdrExportTarget));
    let hdr: HdrCompositor | null = null;
    if (hdrActive) {
      this.hdrCompositor ??= createHdrCompositor(!this.hdrGpuFailed);
      hdr = this.hdrCompositor;
      hdr.begin(width, height);
      hdr.setColorPipeline(hdrPipelineFor(settings));
      // The CPU reference compositor's ACES output (the GPU one runs the shader port).
      registerAcesOutputTransform(acesOutputTransform);
      hdr.setGraphicsWhite(settings.graphicsWhiteNits ?? DEFAULT_GRAPHICS_WHITE_NITS);
    }
    const colorPipeline = hdrPipelineFor(settings);
    let hdrDirty = false;

    await this.renderMotionInstancesToCanvasCtx(
      ctx,
      project,
      time,
      width,
      height,
      scaleX,
      scaleY,
      null,
    );
    // The background (and untracked motion graphics) enter the float image at graphics white.
    if (hdr) this.flushHdrOverlay(hdr, ctx, width, height);

    // Layers that live inside a nested sequence run on that nest's clock, inside the nest.
    const ownTrackIds = new Set(timeline.tracks.map((track) => track.id));
    const nestedTrackIds = new Set(
      (project.compoundClips ?? []).flatMap((compound) => compound.content.tracks.map((track) => track.id)),
    );
    // Premiere semantics: a layer touches only the tracks below it (and only affectedTracks when set), so
    // it is applied in painter order, between the tracks beneath it and the track it sits on.
    const adjustmentSchedule = new AdjustmentLayerSchedule(
      planAdjustmentLayers(
        (project.adjustmentLayers ?? []).filter(
          (layer) => ownTrackIds.has(layer.trackId) || !nestedTrackIds.has(layer.trackId),
        ),
        timeline.tracks,
        time,
      ),
    );
    let isolatedTrack: { base: ImageBitmap; placements: AdjustmentLayerPlacement[] } | null = null;
    const closeIsolatedTrack = async (): Promise<void> => {
      if (!isolatedTrack) return;
      const { base, placements } = isolatedTrack;
      isolatedTrack = null;
      try {
        for (const placement of placements) {
          await this.applyAdjustmentLayerToCtx(ctx, placement.layer, width, height, time);
        }
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";
        ctx.drawImage(base, 0, 0, width, height);
        ctx.restore();
      } finally {
        base.close();
      }
    };

    try {
    for (const { track, originalIndex } of allRenderableTracks) {
      await closeIsolatedTrack();
      for (const placement of adjustmentSchedule.takeCompositeBefore(originalIndex)) {
        await this.applyAdjustmentLayerToCtx(ctx, placement.layer, width, height, time);
      }
      const scopedPlacements = adjustmentSchedule.scopedFor(track.id);
      if (
        scopedPlacements.length > 0 &&
        trackHasAdjustableContent(track.id, time, {
          hasMedia: this.getClipsAtTime(track, time).length > 0,
          overlays: [activeShapeClips, activeSVGClips, activeStickerClips, activeTextClips],
          motionInstances: project.motionInstances ?? [],
        })
      ) {
        // Paint this track alone on a clear canvas so the effects reach only it; the backdrop returns beneath.
        isolatedTrack = {
          base: await createImageBitmap(ctx.canvas, 0, 0, width, height),
          placements: scopedPlacements,
        };
        ctx.clearRect(0, 0, width, height);
      }
      {
        // If a clip-to-clip transition is active in this track at `time`,
        // decode both participating clips, blend them, and draw the result.
        // The clip IDs that were rendered as part of the transition are
        // returned so the normal per-clip loop can skip them.
        let renderedTransitionClips = new Set<string>();
        if (hdr) {
          if (hdrDirty) {
            this.flushHdrOverlay(hdr, ctx, width, height);
            hdrDirty = false;
          }
          renderedTransitionClips = await this.renderActiveTransitionHdr(hdr, project, track, time, width, height);
        }
        let renderedOnCanvas = false;
        if (renderedTransitionClips.size === 0) {
          renderedTransitionClips = await this.renderActiveTransition(
            track,
            time,
            mediaLibrary,
            settings,
            width,
            height,
            ctx,
          );
          renderedOnCanvas = true;
        }

        if (hdr && renderedOnCanvas && renderedTransitionClips.size > 0) hdrDirty = true;
        if (activeTextNeedsSubject && renderedTransitionClips.size > 0) {
          subjectFrame?.close();
          subjectFrame = await this.captureSubjectFrame(ctx, width, height);
        }

        const clips = this.getClipsAtTime(track, time).filter((clip) => compoundIds.has(compoundIdForClip(clip) ?? "") ||
          getMediaItemCapabilities(
            mediaLibrary.items.find((item) => item.id === clip.mediaId),
          ).visual,
        );
        for (const clip of clips) {
          if (renderedTransitionClips.has(clip.id)) continue;
          const clipInfo = this.createClipRenderInfo(clip, time);
          const compoundId = compoundIdForClip(clip);
          if (compoundId) {
            if (hdr) hdrDirty = true;
            const compoundFrame = await this.renderCompoundFrame(
              project,
              compoundId,
              clipInfo.sourceTime,
              width,
              height,
            );
            if (compoundFrame) {
              const transform = clipInfo.transform;
              const scaledTransform: Transform = {
                ...transform,
                position: {
                  x: transform.position.x * scaleX,
                  y: transform.position.y * scaleY,
                },
                scale: { ...transform.scale },
              };
              let processed = compoundFrame;
              try {
                processed = await this.applyClipVideoProcessing(
                  clip.id,
                  compoundFrame,
                  compoundFrame,
                  clipInfo.effects ?? [],
                  getAnimatedColorGrading(clip, time - clip.startTime),
                  width,
                  height,
                );
                await this.drawClipFrameToContext(
                  ctx,
                  processed,
                  scaledTransform,
                  transform.opacity,
                  width,
                  height,
                  (project.masks ?? []).filter((mask) => mask.clipId === clip.id),
                  time,
                );
              } finally {
                if (processed !== compoundFrame) processed.close();
                compoundFrame.close();
              }
            }
            continue;
          }
          const mediaItem = mediaLibrary.items.find(
            (m) => m.id === clipInfo.mediaId,
          );
          if (!mediaItem?.blob) continue;

          let bitmap: ImageBitmap | null = null;
          let bitmapFromCache = false;
          let conformedByFallback = false;

          const clipGrading = getAnimatedColorGrading(clip, time - clip.startTime);
          // Anamorphic / interlaced video is conformed (display width, deinterlace) in the 8-bit path only, so such
          // clips are not float-eligible: HDR and SDR mode then render the same picture.
          const needsConform = mediaItem.type === "video" && frameConformFor(mediaItem) !== null;
          const hdrClip =
            hdr !== null &&
            !needsConform &&
            this.isHdrClipEligible(project, clip, clipInfo, clipGrading);
          // Natively decoded footage (ProRes, DNxHD, MXF...) arrives as exact 16-bit code values for the float path.
          const hdrNativeFrame =
            hdrClip && mediaItem.type === "video" && mediaItem.nativeSource
              ? await getNativeFrameCodes(mediaItem.blob, clipInfo.sourceTime, settings.width).catch(() => null)
              : null;

          if (hdrNativeFrame) {
            // decoded as float codes below
          } else if (mediaItem.type === "image") {
            try {
              if (isAnimatedGif(mediaItem.blob)) {
                let gifCache = this.gifFrameCache.get(mediaItem.id);
                if (!gifCache) {
                  const newCache = await createGifFrameCache(mediaItem.blob);
                  if (newCache) {
                    this.gifFrameCache.set(mediaItem.id, newCache);
                    gifCache = newCache;
                  }
                }
                if (gifCache && gifCache.frames.length > 0) {
                  const clipLocalTime = time - clip.startTime;
                  const frameIndex = getGifFrameAtTime(
                    gifCache,
                    getAnimatedImageSourceTime(clip, clipLocalTime) * 1000,
                  );
                  bitmap = gifCache.frames[frameIndex];
                  bitmapFromCache = true;
                } else {
                  bitmap = await createImageBitmap(mediaItem.blob);
                }
              } else {
                const cached = this.staticImageCache.get(this.staticImageKey(mediaItem));
                if (cached) {
                  bitmap = cached;
                  bitmapFromCache = true;
                } else {
                  bitmap = await createMediaImageBitmap(mediaItem);
                  this.cacheStaticImage(mediaItem, bitmap);
                  bitmapFromCache = true;
                }
              }
            } catch (error) {
              console.warn(
                `Failed to create ImageBitmap for image ${mediaItem.id}:`,
                error,
              );
            }
          } else {
            const effectiveSpeed = clip.speed ?? 1;
            const shouldInterpolate =
              clip.smoothSlowMo === true && effectiveSpeed < 1;

            if (shouldInterpolate && mediaItem.metadata?.frameRate) {
              bitmap = await this.decodeInterpolatedFrame(
                clip,
                mediaItem,
                clipInfo.sourceTime,
                time,
                settings.width,
                settings.height,
              );
            }

            if (!bitmap) {
              const vidstabForDecode = getVidstabEngine();
              const useStabilizedBlob = vidstabForDecode.hasStabilized(clip.id);
              const decodeBlob = useStabilizedBlob
                ? vidstabForDecode.getStabilizedBlob(clip.id)!
                : mediaItem.blob;
              const decodeTime = useStabilizedBlob
                ? clipInfo.sourceTime - clip.inPoint
                : clipInfo.sourceTime;

              bitmap = await this.decodeFrameWithMediaBunny(
                decodeBlob,
                decodeTime,
                settings.width,
                settings.height,
                useStabilizedBlob ? `stabilized:${clip.id}` : clipInfo.mediaId,
              );
            }
            if (!bitmap) {
              const vidstabForDecode = getVidstabEngine();
              const useStabilizedBlob = vidstabForDecode.hasStabilized(clip.id);
              const decodeBlob = useStabilizedBlob
                ? vidstabForDecode.getStabilizedBlob(clip.id)!
                : mediaItem.blob;
              const decodeTime = useStabilizedBlob
                ? clipInfo.sourceTime - clip.inPoint
                : clipInfo.sourceTime;

              bitmap = await this.decodeFrameWithVideoElement(
                useStabilizedBlob ? `stabilized:${clip.id}` : mediaItem.id,
                decodeBlob,
                decodeTime,
                settings.width,
                settings.height,
                mediaItem.type === "video" ? frameConformFor(mediaItem) : null,
                settings.fieldOrder,
              );
              // The fallback decoder drew the conformed frame itself (letterboxed at display shape).
              conformedByFallback = true;
            }
          }

          if (bitmap && mediaItem.type === "video" && !hdrNativeFrame && !conformedByFallback) {
            // Pixel aspect ratio and field order: the frame leaves here at display shape and deinterlaced.
            const conform = frameConformFor(mediaItem);
            if (conform) {
              try {
                const conformed = await conformBitmap(bitmap, conform, settings.fieldOrder);
                if (conformed !== bitmap) {
                  if (!bitmapFromCache) bitmap.close();
                  bitmap = conformed;
                  bitmapFromCache = false;
                }
              } catch (error) {
                console.warn(`Could not apply pixel aspect / field order to ${mediaItem.id}:`, error);
              }
            }
          }

          if (hdr && hdrClip && (hdrNativeFrame || bitmap)) {
            const t = clipInfo.transform;
            const frame = hdrNativeFrame?.frame;
            const codes: SourceCodes | { readonly depth: "canvas"; readonly source: ImageBitmap | OffscreenCanvas } =
              frame?.codes16
                ? { depth: 16, width: frame.codes16.width, height: frame.codes16.height, data: frame.codes16.data }
                : { depth: "canvas", source: frame ? frame.canvas : bitmap! };
            const source = codes.depth === "canvas" ? codes.source : codes;
            const geometry = computeLayerGeometry(
              { ...t, position: { x: t.position.x * scaleX, y: t.position.y * scaleY } },
              source.width,
              source.height,
              width,
              height,
            );
            if (hdrDirty) {
              this.flushHdrOverlay(hdr, ctx, width, height);
              hdrDirty = false;
            }
            hdr.drawCodes(codes, hdrSourceDecode(inputSpaceForItem(mediaItem, clip.colorInterpretation), colorPipeline), {
              geometry,
              opacity: t.opacity,
              grade: prepareHdrGrade(clipGrading, colorPipeline),
              effects: resolveHdrEffects(clipInfo.effects ?? []).effects,
            });
            if (bitmap && !bitmapFromCache) bitmap.close();
            continue;
          }
          if (hdr && bitmap) hdrDirty = true;

          if (bitmap) {
            let finalTransform = clipInfo.transform;
            const clipLocalTime = time - clip.startTime;

            if (
              clip.emphasisAnimation &&
              (clip.emphasisAnimation as EmphasisAnimation).type !== "none"
            ) {
              const emphasisState = this.applyEmphasisAnimation(
                clip.emphasisAnimation as EmphasisAnimation,
                clipLocalTime,
              );
              finalTransform = {
                ...finalTransform,
                opacity: finalTransform.opacity * emphasisState.opacity,
                scale: {
                  x:
                    finalTransform.scale.x *
                    emphasisState.scale *
                    emphasisState.scaleX,
                  y:
                    finalTransform.scale.y *
                    emphasisState.scale *
                    emphasisState.scaleY,
                },
                position: {
                  x:
                    finalTransform.position.x +
                    emphasisState.offsetX * settings.width,
                  y:
                    finalTransform.position.y +
                    emphasisState.offsetY * settings.height,
                },
                rotation: finalTransform.rotation + emphasisState.rotation,
              };
            }

            const scaledTransform: Transform = {
              ...finalTransform,
              position: {
                x: finalTransform.position.x * scaleX,
                y: finalTransform.position.y * scaleY,
              },
              scale: { ...finalTransform.scale },
            };

            let processedBitmap = bitmap;

            const bgEngine = getBackgroundRemovalEngine();
            if (bgEngine && bgEngine.isInitialized()) {
              const bgSettings = bgEngine.getSettings(clip.id);
              if (bgSettings.enabled) {
                try {
                  const bgResult = await bgEngine.processFrame(
                    clip.id,
                    processedBitmap,
                    processedBitmap.width,
                    processedBitmap.height,
                    time * 1000,
                  );
                  if (bgResult && bgResult !== processedBitmap) {
                    if (processedBitmap !== bitmap) {
                      processedBitmap.close();
                    }
                    processedBitmap = bgResult;
                  }
                } catch {}
              }
            }

            processedBitmap = await this.applyClipVideoProcessing(
              clip.id,
              processedBitmap,
              bitmap,
              clipInfo.effects ?? [],
              getAnimatedColorGrading(clip, time - clip.startTime),
              width,
              height,
              {
                clip,
                media: mediaItem,
                localTime: posterizedClipTime(clipInfo.effects ?? [], time - clip.startTime),
                decodeWidth: settings.width,
                decodeHeight: settings.height,
              },
            );

            const vidstabEng = getVidstabEngine();
            const drawTransform = vidstabEng.hasStabilized(clip.id)
              ? scaledTransform
              : getStabilizedTransform(
                  clip,
                  scaledTransform,
                  clipInfo.sourceTime,
                  {
                    canvasWidth: width,
                    canvasHeight: height,
                    sourceWidth: processedBitmap.width,
                    sourceHeight: processedBitmap.height,
                  },
                );

            await this.drawClipFrameToContext(
              ctx,
              processedBitmap,
              drawTransform,
              finalTransform.opacity,
              width,
              height,
              (project.masks ?? []).filter((mask) => mask.clipId === clip.id),
              time,
            );

            if (activeTextNeedsSubject) {
              subjectFrame?.close();
              subjectFrame = await this.captureSubjectFrame(ctx, width, height);
            }

            if (processedBitmap !== bitmap) {
              processedBitmap.close();
            }
            if (!bitmapFromCache) {
              bitmap.close();
            }
          }
        }
      }

      if (hdr) {
        hdrDirty ||=
          activeShapeClips.some((c) => c.trackId === track.id) ||
          activeSVGClips.some((c) => c.trackId === track.id) ||
          activeStickerClips.some((c) => c.trackId === track.id) ||
          activeTextClips.some((c) => c.trackId === track.id) ||
          (project.motionInstances ?? []).some(
            (i) => i.trackId === track.id && time >= i.startTime && time < i.startTime + i.duration,
          );
      }
      for (const shapeClip of activeShapeClips.filter(
        (clip) => clip.trackId === track.id,
      )) {
        await this.renderShapeClipToCanvasCtx(
          ctx,
          shapeClip,
          time,
          width,
          height,
        );
      }
      for (const svgClip of activeSVGClips.filter(
        (clip) => clip.trackId === track.id,
      )) {
        await this.renderSVGClipToCanvasCtx(ctx, svgClip, time, width, height);
      }
      for (const stickerClip of activeStickerClips.filter(
        (clip) => clip.trackId === track.id,
      )) {
        await this.renderStickerClipToCanvasCtx(
          ctx,
          stickerClip,
          time,
          width,
          height,
        );
      }
      await this.renderMotionInstancesToCanvasCtx(
        ctx,
        project,
        time,
        width,
        height,
        scaleX,
        scaleY,
        track.id,
      );
      for (const textClip of activeTextClips.filter(
        (clip) => clip.trackId === track.id,
      )) {
        await this.renderTextClipWithSubjectMask(
          ctx,
          textClip,
          time,
          width,
          height,
          settings.width,
          settings.height,
          subjectFrame,
          options.realtime ?? false,
          subjectStreamId,
        );
      }
      if (hdr && hdrDirty) {
        this.flushHdrOverlay(hdr, ctx, width, height);
        hdrDirty = false;
      }
    }
    } finally {
      // A track render that throws must not leak the isolated backdrop bitmap.
      isolatedTrack?.base.close();
      isolatedTrack = null;
    }
    subjectFrame?.close();
    await closeIsolatedTrack();
    for (const placement of adjustmentSchedule.takeRemainingComposite()) {
      await this.applyAdjustmentLayerToCtx(ctx, placement.layer, width, height, time);
    }

    // Particles and subtitles sit above every track, so no adjustment layer reaches them.
    withDisplaySpace(ctx, width, this.sequencePixelAspect, (layoutWidth) => {
      drawProjectParticles(ctx, project, time, layoutWidth, height);
    });

    for (const subtitle of activeSubtitles) {
      this.renderSubtitleToCanvasCtx(ctx, subtitle, width, height);
    }

    const burnInOverlay = timecodeBurnInOverlay(project, options.timecodeBurnIn, time);
    if (burnInOverlay) {
      withDisplaySpace(ctx, width, this.sequencePixelAspect, (layoutWidth) => {
        drawBurnIn(ctx, "burn-in-timecode", burnInOverlay.params, layoutWidth, height);
      });
    }

    if (hdr) {
      // Particles and subtitles were drawn on the canvas after the last track: merge them, then show the
      // tone-mapped SDR view (the preview) and, for an HDR export, encode the float image itself.
      this.flushHdrOverlay(hdr, ctx, width, height);
      ctx.putImageData(new ImageData(hdr.readSdrView() as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
      const hdrBitmap = await createImageBitmap(canvas);
      if (this.hdrExportTarget) {
        attachHdrPayload(hdrBitmap, exportPayload(hdr, this.hdrExportTarget, width, height));
      }
      return { image: hdrBitmap, timestamp: time, width, height };
    }

    const imageBitmap = await createImageBitmap(canvas);

    return {
      image: imageBitmap,
      timestamp: time,
      width,
      height,
    };
  }

  private isHdrClipEligible(
    project: Project,
    clip: Clip,
    clipInfo: VideoClipRenderInfo,
    grading: ClipColorGrading | undefined,
  ): boolean {
    return isHdrEligibleClip({
      clip,
      effects: clipInfo.effects ?? [],
      hasMasks: (project.masks ?? []).some((mask) => mask.clipId === clip.id),
      grading,
      transform: clipInfo.transform,
      rewritesFrame: this.rewritesClipFrame(clip.id),
    });
  }

  /**
   * Draws one clip into the float image at `opacityScale` of its own opacity (the building block of the float
   * transitions). Returns false when the clip could not be decoded; nothing is drawn then.
   */
  private async drawHdrClipLayer(
    hdr: HdrCompositor,
    project: Project,
    clip: Clip,
    mediaItem: MediaItem,
    time: number,
    opacityScale: number,
    width: number,
    height: number,
  ): Promise<boolean> {
    if (!mediaItem.blob) return false;
    const { settings } = project;
    const clipInfo = this.createClipRenderInfo(clip, time);
    const grading = getAnimatedColorGrading(clip, time - clip.startTime);
    const native =
      mediaItem.type === "video" && mediaItem.nativeSource
        ? await getNativeFrameCodes(mediaItem.blob, clipInfo.sourceTime, settings.width).catch(() => null)
        : null;
    const bitmap = native ? null : await this.decodeClipBitmap(clip, mediaItem, time, settings.width, settings.height);
    if (!native && !bitmap) return false;
    try {
      const frame = native?.frame;
      const codes: SourceCodes | { readonly depth: "canvas"; readonly source: ImageBitmap | OffscreenCanvas } =
        frame?.codes16
          ? { depth: 16, width: frame.codes16.width, height: frame.codes16.height, data: frame.codes16.data }
          : { depth: "canvas", source: frame ? frame.canvas : bitmap! };
      const source = codes.depth === "canvas" ? codes.source : codes;
      const t = clipInfo.transform;
      const scaleX = width / settings.width;
      const scaleY = height / settings.height;
      const geometry = computeLayerGeometry(
        { ...t, position: { x: t.position.x * scaleX, y: t.position.y * scaleY } },
        source.width,
        source.height,
        width,
        height,
      );
      const colorPipeline = hdrPipelineFor(project.settings);
      hdr.drawCodes(codes, hdrSourceDecode(inputSpaceForItem(mediaItem, clip.colorInterpretation), colorPipeline), {
        geometry,
        opacity: t.opacity * opacityScale,
        grade: prepareHdrGrade(grading, colorPipeline),
        effects: resolveHdrEffects(clipInfo.effects ?? []).effects,
      });
      return true;
    } finally {
      // Stills live in the image cache; video frames belong to this call.
      if (bitmap && mediaItem.type !== "image") bitmap.close();
    }
  }

  /**
   * Crossfade and dip transitions on the float image, in linear light. Returns the clips it rendered; empty when the
   * transition is another kind or a clip cannot take the float path, and the 8-bit transition engine then runs.
   */
  private async renderActiveTransitionHdr(
    hdr: HdrCompositor,
    project: Project,
    track: Track,
    time: number,
    width: number,
    height: number,
  ): Promise<Set<string>> {
    const rendered = new Set<string>();
    const active = this.findActiveTransition(track, time);
    if (!active || !isHdrTransitionKind(active.transition.type)) return rendered;
    const { transition, clipA, clipB, progress } = active;
    const items = project.mediaLibrary.items;
    const mediaA = items.find((m) => m.id === clipA.mediaId);
    const mediaB = clipB ? items.find((m) => m.id === clipB.mediaId) : undefined;
    const usable = (clip: Clip | undefined, media: MediaItem | undefined): boolean => {
      if (!clip) return true;
      if (!media?.blob || !getMediaItemCapabilities(media).visual) return false;
      if (clip.mediaId.startsWith("compound:") || typeof clip.metadata?.compoundClipId === "string") return false;
      if (media.type === "video" && frameConformFor(media) !== null) return false;
      const info = this.createClipRenderInfo(clip, time);
      return this.isHdrClipEligible(project, clip, info, getAnimatedColorGrading(clip, time - clip.startTime));
    };
    if (!usable(clipA, mediaA) || !usable(clipB, mediaB)) return rendered;

    const eased = this.transitionEngine
      ? this.transitionEngine.easedProgress(transition, progress)
      : Math.max(0, Math.min(1, progress));
    const steps = planHdrTransition({
      kind: transition.type as "crossfade" | "dipToBlack" | "dipToWhite",
      progress: eased,
      holdDuration: Number(transition.params.holdDuration) || 0,
      edge: clipB ? undefined : transition.edge === "in" ? "in" : "out",
    });
    const outgoing = clipB ? { clip: clipA, media: mediaA } : transition.edge === "in" ? null : { clip: clipA, media: mediaA };
    const incoming = clipB ? { clip: clipB, media: mediaB } : transition.edge === "in" ? { clip: clipA, media: mediaA } : null;
    const white = graphicsWhiteGain(project.settings.graphicsWhiteNits);
    for (const step of steps) {
      if (step.layer === "solid") {
        const level = step.color === "white" ? white : 0;
        hdr.drawSolid([level, level, level], step.opacity);
        continue;
      }
      const target = step.layer === "outgoing" ? outgoing : incoming;
      if (!target?.media) continue;
      await this.drawHdrClipLayer(hdr, project, target.clip, target.media, time, step.opacity, width, height);
    }
    rendered.add(clipA.id);
    if (clipB) rendered.add(clipB.id);
    return rendered;
  }

  /** Background removal or an applied stabilizer rewrite the frame on the 8-bit path, so the float path leaves them alone. */
  private rewritesClipFrame(clipId: string): boolean {
    const bg = getBackgroundRemovalEngine();
    if (bg && bg.isInitialized() && bg.getSettings(clipId).enabled) return true;
    return getVidstabEngine().hasStabilized(clipId);
  }

  private async renderCompoundFrame(
    project: Project,
    compoundId: string,
    localTime: number,
    width: number,
    height: number,
  ): Promise<ImageBitmap | null> {
    const compound = project.compoundClips?.find((item) => item.id === compoundId);
    if (!compound || this.renderingCompounds.has(compoundId)) return null;

    let engine = this.compoundEngines.get(compoundId);
    if (!engine) {
      engine = new VideoEngine(this.cacheConfig);
      engine.exportMode = this.exportMode;
      engine.transparentBackground = true;
      await engine.initialize();
      this.compoundEngines.set(compoundId, engine);
    }

    // The nest renders in its OWN design space (size, frame rate). Its frame keeps the nested
    // aspect and is fitted into the parent by the normal clip draw (contain by default, cover
    // when the nest clip is set to fill), so a 720p nest in a 1080p parent scales instead of
    // being cropped or pillar-boxed wrongly.
    const nestedSettings = compound.settings ?? project.settings;
    const fit = Math.min(width / nestedSettings.width, height / nestedSettings.height);
    const sameAspect = Math.abs(nestedSettings.width / nestedSettings.height - width / height) < 1e-3;
    const renderWidth = sameAspect ? width : Math.max(1, Math.round(nestedSettings.width * fit));
    const renderHeight = sameAspect ? height : Math.max(1, Math.round(nestedSettings.height * fit));
    // Frame times map onto the nest's own frame grid when its rate differs from the parent's.
    const nestedRate = nestedSettings.frameRate;
    const snapped = nestedRate > 0 && nestedRate !== project.settings.frameRate
      ? Math.floor(localTime * nestedRate + 1e-6) / nestedRate
      : localTime;
    const trackIds = new Set(compound.content.tracks.map((track) => track.id));

    const nestedProject: Project = {
      ...project,
      settings: nestedSettings,
      timeline: {
        // Own captions / duration only: nothing of the parent's timeline leaks into the nest.
        tracks: compound.content.tracks,
        subtitles: compound.content.subtitles ?? [],
        markers: [],
        duration: compound.content.duration,
      },
      textClips: [],
      shapeClips: [],
      svgClips: [],
      stickerClips: [],
      adjustmentLayers: (project.adjustmentLayers ?? []).filter((layer) => trackIds.has(layer.trackId)),
      motionInstances: [],
      compoundClips: project.compoundClips?.filter(
        (item) => item.id !== compoundId,
      ),
    };

    this.renderingCompounds.add(compoundId);
    try {
      const frame = await engine.renderFrame(
        nestedProject,
        Math.max(0, Math.min(snapped, compound.content.duration)),
        renderWidth,
        renderHeight,
      );
      return frame.image;
    } finally {
      this.renderingCompounds.delete(compoundId);
    }
  }

  private async applyAdjustmentLayerToCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: NonNullable<Project["adjustmentLayers"]>[number],
    width: number,
    height: number,
    time: number,
  ): Promise<void> {
    {
      // Burn-ins on an adjustment layer count from the layer's first frame, like a clip's.
      const effects = withBurnInText(
        layer.effects.filter((effect) => effect.enabled !== false),
        { id: layer.id, startTime: layer.startTime, inPoint: 0 },
        time - layer.startTime,
        this.burnInSource,
      ) as Effect[];
      if (effects.length === 0) return;

      let source: ImageBitmap | null = null;
      let processed: ImageBitmap | null = null;
      try {
        // Effects see display space (stored width x PAR), so blur-like radii are isotropic where the frame is shown.
        source = await snapshotInDisplaySpace(ctx.canvas, width, height, this.sequencePixelAspect);
        const effectsEngine = await this.ensureEffectsEngine(width, height);
        const result = await effectsEngine.applyEffects(source, effects);
        processed = result.image;
        if (!processed || processed.width <= 0 || processed.height <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
        ctx.globalCompositeOperation = adjustmentBlendOperation(layer.blendMode);
        ctx.drawImage(processed, 0, 0, width, height);
        ctx.restore();
      } catch (error) {
        console.warn(`[VideoEngine] Adjustment layer ${layer.id} failed:`, error);
      } finally {
        if (processed && processed !== source) processed.close();
        source?.close();
      }
    }
  }

  private async renderMotionInstancesToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    project: Project,
    time: number,
    width: number,
    height: number,
    scaleX: number,
    scaleY: number,
    targetTrackId?: string | null,
  ): Promise<void> {
    const compositions = project.motionCompositions ?? [];
    const instances = (project.motionInstances ?? [])
      .map((instance) => {
        const trackIndex = instance.trackId
          ? project.timeline.tracks.findIndex(
              (track) => track.id === instance.trackId,
            )
          : Number.MAX_SAFE_INTEGER;
        const track = trackIndex >= 0 ? project.timeline.tracks[trackIndex] : null;
        return { instance, track, trackIndex };
      })
      .filter(({ instance, track }) => {
        if (track?.hidden) return false;
        if (
          targetTrackId !== undefined &&
          (instance.trackId ?? null) !== targetTrackId
        ) {
          return false;
        }
        return (
          time >= instance.startTime &&
          time < instance.startTime + instance.duration
        );
      })
      .sort((a, b) => b.trackIndex - a.trackIndex);

    if (instances.length === 0) return;

    if (!this.motionRenderer) {
      this.motionRenderer = new MotionRenderer();
    }
    if (this.exportMode && !this.motionHqRenderer) {
      this.motionHqRenderer = new MotionHighQualityRenderer(this.motionRenderer);
    }
    const assetResolver = this.createMotionAssetResolver(project);

    for (const { instance } of instances) {
      const composition = compositions.find(
        (candidate) => candidate.id === instance.compositionId,
      );
      if (!composition) continue;

      let bitmap: ImageBitmap | null = null;
      try {
        bitmap =
          this.exportMode && this.motionHqRenderer
            ? await this.motionHqRenderer.render(
                composition,
                Math.max(0, time - instance.startTime),
                {
                  compositionLibrary: compositions,
                  assetResolver,
                  variableOverrides: instance.variableOverrides,
                  supersample: 2,
                },
              )
            : await this.motionRenderer.renderInstance(
                composition,
                instance,
                time,
                compositions,
                assetResolver,
                this.exportMode ? 2 : 1,
              );
        const transform = {
          ...instance.transform,
          position: {
            x: instance.transform.position.x * scaleX,
            y: instance.transform.position.y * scaleY,
          },
        };
        this.drawFrameToContext(
          ctx,
          bitmap,
          transform,
          instance.opacity * instance.transform.opacity,
          width,
          height,
        );
      } catch (error) {
        console.warn(
          `[VideoEngine] Motion render failed for instance ${instance.id}:`,
          error,
        );
      } finally {
        bitmap?.close();
      }
    }
  }

  private createMotionAssetResolver(project: Project): MotionRendererAssetResolver {
    return {
      resolveImageAsset: async (asset: MotionAsset) =>
        this.resolveMotionImageAsset(project, asset),
      renderScene3D: async (input) => {
        const bound = resolveCreationMotionSceneBinding(
          project.creation,
          input.composition.id,
          input.layer.id,
        );
        if (!bound) return null;
        const image = await renderAuroraPreviewToImageBitmap({
          scene: bound.scene,
          assets: bound.assets,
          width: input.width,
          height: input.height,
          background: input.backgroundColor,
          timeSeconds: input.localTime,
          quality: input.quality ? "preview" : "final",
        });
        if (!image) return null;
        return {
          image,
          release: () => image.close(),
        };
      },
    };
  }

  private async resolveMotionImageAsset(
    project: Project,
    asset: MotionAsset,
  ): Promise<ImageBitmap | null> {
    const cacheKey = asset.mediaId
      ? `motion-media:${asset.mediaId}`
      : asset.url
        ? `motion-url:${asset.url}`
        : `motion-asset:${asset.id}`;
    const cached = this.staticImageCache.get(cacheKey);
    if (cached) return cached;

    let blob: Blob | null = null;
    if (asset.mediaId) {
      const mediaItem = project.mediaLibrary.items.find(
        (item) => item.id === asset.mediaId,
      );
      if (mediaItem?.type === "image" && mediaItem.blob) {
        blob = mediaItem.blob;
      }
    } else if (asset.url) {
      try {
        blob = await fetch(asset.url).then((response) =>
          response.ok ? response.blob() : null,
        );
      } catch {
        blob = null;
      }
    }

    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    this.staticImageCache.set(cacheKey, bitmap);
    return bitmap;
  }

  private drawFrameToContext(
    ctx: OffscreenCanvasRenderingContext2D,
    frame: ImageBitmap,
    transform: Transform,
    opacity: number,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = opacity;
    // A non-square sequence pixel: lay out in display space, then squeeze back to stored pixels.
    const sequencePar = this.sequencePixelAspect;
    if (sequencePar !== 1) ctx.scale(1 / sequencePar, 1);
    const layoutWidth = canvasWidth * sequencePar;
    const centerX = layoutWidth / 2;
    const centerY = canvasHeight / 2;

    ctx.translate(
      centerX + transform.position.x * sequencePar,
      centerY + transform.position.y,
    );

    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale.x, transform.scale.y);

    const crop = transform.crop;
    const sourceWidth = crop ? crop.width * frame.width : frame.width;
    const sourceHeight = crop ? crop.height * frame.height : frame.height;
    const { width: drawWidth, height: drawHeight } =
      resolveCanvasFitDimensions(
        transform.fitMode,
        sourceWidth,
        sourceHeight,
        layoutWidth,
        canvasHeight,
      );
    const drawX = -drawWidth * transform.anchor.x;
    const drawY = -drawHeight * transform.anchor.y;

    if (crop) {
      const sx = crop.x * frame.width;
      const sy = crop.y * frame.height;

      ctx.drawImage(
        frame,
        sx,
        sy,
        sourceWidth,
        sourceHeight,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
      );
    } else {
      ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  private async drawClipFrameToContext(
    ctx: OffscreenCanvasRenderingContext2D,
    frame: ImageBitmap,
    transform: Transform,
    opacity: number,
    canvasWidth: number,
    canvasHeight: number,
    masks: readonly Mask[],
    time: number,
  ): Promise<void> {
    if (masks.length === 0) {
      this.drawFrameToContext(
        ctx,
        frame,
        transform,
        opacity,
        canvasWidth,
        canvasHeight,
      );
      return;
    }

    const layerCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const layerCtx = layerCanvas.getContext("2d");
    if (!layerCtx) return;
    this.drawFrameToContext(
      layerCtx,
      frame,
      transform,
      opacity,
      canvasWidth,
      canvasHeight,
    );

    this.maskEngine ??= new MaskEngine({
      width: canvasWidth,
      height: canvasHeight,
    });
    this.maskEngine.loadMasks([...masks]);

    const sourceLayer = await createImageBitmap(layerCanvas);
    try {
      const result = await this.maskEngine.applyMasks(sourceLayer, masks, time);
      try {
        ctx.drawImage(result.image, 0, 0, canvasWidth, canvasHeight);
      } finally {
        result.image.close();
      }
    } finally {
      sourceLayer.close();
    }
  }

  /**
   * Paints a blurred, cover-fit copy of the base (bottom-most) video/image
   * clip across the whole canvas — the CapCut-style backdrop revealed by a
   * contain-fitted clip's letterbox bars. The video frame is decoded fresh and
   * closed here; cached image bitmaps are left open.
   */
  private async renderBlurredBackdrop(
    ctx: OffscreenCanvasRenderingContext2D,
    timeline: Timeline,
    mediaLibrary: MediaLibrary,
    settings: ProjectSettings,
    time: number,
    width: number,
    height: number,
  ): Promise<void> {
    const baseTracks = timeline.tracks
      .map((track, idx) => ({ track, idx }))
      .filter(({ track }) => !track.hidden)
      // Highest index renders behind, so the bottom-most layer is the backdrop.
      .sort((a, b) => b.idx - a.idx);

    let frame: ImageBitmap | null = null;
    let ownsFrame = false;
    for (const { track } of baseTracks) {
      const clips = this.getClipsAtTime(track, time).filter((candidate) =>
        getMediaItemCapabilities(
          mediaLibrary.items.find((item) => item.id === candidate.mediaId),
        ).visual,
      );
      if (clips.length === 0) continue;
      const clip = clips[0];
      const clipInfo = this.createClipRenderInfo(clip, time);
      const mediaItem = mediaLibrary.items.find(
        (m: MediaItem) => m.id === clipInfo.mediaId,
      );
      if (!mediaItem?.blob) continue;

      if (mediaItem.type === "image") {
        const cached = this.staticImageCache.get(this.staticImageKey(mediaItem));
        if (cached) {
          frame = cached;
        } else {
          try {
            frame = await createMediaImageBitmap(mediaItem);
            this.cacheStaticImage(mediaItem, frame);
          } catch {
            frame = null;
          }
        }
      } else {
        frame = await this.decodeFrameWithMediaBunny(
          mediaItem.blob,
          clipInfo.sourceTime,
          settings.width,
          settings.height,
          clipInfo.mediaId,
        );
        ownsFrame = frame !== null;
      }
      if (frame) break;
    }

    if (!frame) return;

    const sourceAspect = frame.width / frame.height;
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
    ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    if (ownsFrame) {
      try {
        frame.close();
      } catch {
        // already released
      }
    }
  }

  private async captureSubjectFrame(
    ctx: OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
  ): Promise<ImageBitmap | null> {
    try {
      return await createImageBitmap(ctx.canvas, 0, 0, width, height);
    } catch {
      return null;
    }
  }

  private async getSubjectMaskForFrame(
    subjectFrame: ImageBitmap,
    time: number,
    realtime: boolean,
    streamId: string,
  ): Promise<SegmentationResult | null> {
    let requests = this.subjectMaskRequestCache.get(subjectFrame);
    if (!requests) {
      requests = new Map();
      this.subjectMaskRequestCache.set(subjectFrame, requests);
    }
    const key = `${streamId}:${time}:${Number(realtime)}`;
    const cached = requests.get(key);
    if (cached) return cached;

    const request = (async () => {
      const segEngine = getPersonSegmentationEngine();
      if (!segEngine.isInitialized()) await segEngine.initialize();
      return segEngine.getPersonMask(subjectFrame, {
        timestampMs: time * 1000,
        streamId,
        realtime,
      });
    })();
    requests.set(key, request);
    return request;
  }

  private applySubjectOcclusionMask(
    textCtx: OffscreenCanvasRenderingContext2D,
    subjectFrame: ImageBitmap | null,
    width: number,
    height: number,
    maskResult: SegmentationResult | null,
  ): boolean {
    if (!subjectFrame || !maskResult) return false;

    try {
      const maskCanvas = new OffscreenCanvas(
        maskResult.width,
        maskResult.height,
      );
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) return false;

      let occlusionMask = this.subjectOcclusionMaskCache
        .get(subjectFrame)
        ?.get(maskResult);
      if (!occlusionMask) {
        occlusionMask = maskResult.mask;
      }
      if (
        !this.subjectOcclusionMaskCache.get(subjectFrame)?.has(maskResult) &&
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
            occlusionMask = new ImageData(
              maskResult.width,
              maskResult.height,
            );
            occlusionMask.data.set(motionAwareMaskRgba);
          }
        } catch {
          // A transient readback/flow failure must not remove the text layer.
          // The exact model matte is still a safe occlusion fallback.
          occlusionMask = maskResult.mask;
        }
      }

      let frameMasks = this.subjectOcclusionMaskCache.get(subjectFrame);
      if (!frameMasks) {
        frameMasks = new WeakMap();
        this.subjectOcclusionMaskCache.set(subjectFrame, frameMasks);
      }
      frameMasks.set(maskResult, occlusionMask);

      maskCtx.putImageData(occlusionMask, 0, 0);
      textCtx.save();
      textCtx.globalCompositeOperation = "destination-out";
      textCtx.imageSmoothingEnabled = true;
      textCtx.imageSmoothingQuality = "high";
      textCtx.drawImage(maskCanvas, 0, 0, width, height);
      textCtx.restore();
      return true;
    } catch {
      return false;
    }
  }

  private async renderTextClipWithSubjectMask(
    ctx: OffscreenCanvasRenderingContext2D,
    textClip: TextClip,
    time: number,
    width: number,
    height: number,
    projectWidth: number,
    projectHeight: number,
    subjectFrame: ImageBitmap | null,
    realtime: boolean,
    streamId: string,
  ): Promise<void> {
    let subjectMask: SegmentationResult | null = null;
    if (textClip.behindSubject && subjectFrame) {
      try {
        subjectMask = await this.getSubjectMaskForFrame(
          subjectFrame,
          time,
          realtime,
          streamId,
        );
      } catch {
        subjectMask = null;
      }
      // During the worker's first realtime inference the matte is not ready
      // yet; skipping this frame beats flashing text in front of the subject.
      if (!subjectMask && realtime) return;
    }

    if (!textClip.behindSubject || !subjectFrame || !subjectMask) {
      await this.renderTextClipToCanvasCtx(
        ctx,
        textClip,
        time,
        width,
        height,
        projectWidth,
        projectHeight,
      );
      return;
    }

    const textLayerCanvas = new OffscreenCanvas(width, height);
    const textLayerCtx = textLayerCanvas.getContext("2d");
    if (!textLayerCtx) return;
    await this.renderTextClipToCanvasCtx(
      textLayerCtx,
      textClip,
      time,
      width,
      height,
      projectWidth,
      projectHeight,
    );
    if (
      !this.applySubjectOcclusionMask(
        textLayerCtx,
        subjectFrame,
        width,
        height,
        subjectMask,
      )
    ) {
      return;
    }
    ctx.drawImage(textLayerCanvas, 0, 0, width, height);
  }

  private getActiveTextClips(timeline: Timeline, time: number): TextClip[] {
    const allTextClips = titleEngine.getAllTextClips();
    const visibleTrackIds = new Set(
      timeline.tracks.filter((track) => !track.hidden).map((track) => track.id),
    );

    return allTextClips.filter((clip) => {
      if (!visibleTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private getActiveShapeClips(timeline: Timeline, time: number): ShapeClip[] {
    const allShapeClips = graphicsEngine.getAllShapeClips();
    const visibleTrackIds = new Set(
      timeline.tracks.filter((track) => !track.hidden).map((track) => track.id),
    );

    return allShapeClips.filter((clip) => {
      if (!visibleTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private getActiveSVGClips(
    timeline: Timeline,
    time: number,
  ): import("../graphics/types").SVGClip[] {
    const allSVGClips = graphicsEngine.getAllSVGClips();
    const visibleTrackIds = new Set(
      timeline.tracks.filter((track) => !track.hidden).map((track) => track.id),
    );

    return allSVGClips.filter((clip) => {
      if (!visibleTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private getActiveStickerClips(
    timeline: Timeline,
    time: number,
  ): import("../graphics/types").StickerClip[] {
    const allStickerClips = graphicsEngine.getAllStickerClips();
    const visibleTrackIds = new Set(
      timeline.tracks.filter((track) => !track.hidden).map((track) => track.id),
    );

    return allStickerClips.filter((clip) => {
      if (!visibleTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private getOverlay3DRenderer(width: number, height: number): Promise<ThreeJSLayerRenderer | null> {
    if (this.overlay3DRenderer) return Promise.resolve(this.overlay3DRenderer);
    if (!this.overlay3DLoading) {
      const generation = this.overlay3DGeneration;
      this.overlay3DLoading = import("./overlay-three-renderer")
        .then(({ ThreeJSLayerRenderer }) => {
          if (generation !== this.overlay3DGeneration) return null;
          this.overlay3DRenderer = new ThreeJSLayerRenderer(width, height);
          return this.overlay3DRenderer;
        })
        .catch((error: unknown) => {
          if (generation === this.overlay3DGeneration) this.overlay3DLoading = null;
          throw error;
        });
    }
    return this.overlay3DLoading;
  }

  private async renderTextClipToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    textClip: TextClip,
    time: number,
    width: number,
    height: number,
    projectWidth: number,
    projectHeight: number,
  ): Promise<void> {
    const clipLocalTime = time - textClip.startTime;
    const rotation = textClip.transform.rotate3d;
    if (textClip.text3d?.enabled || (rotation && (rotation.x !== 0 || rotation.y !== 0))) {
      const generation = this.overlay3DGeneration;
      const state = titleEngine.getAnimatedTextState(textClip, clipLocalTime);
      if (state.opacity <= 0 || state.visibleText.length === 0) return;
      const renderer = await this.getOverlay3DRenderer(width, height);
      if (!renderer || generation !== this.overlay3DGeneration) return;
      const animatedClip: TextClip = {
        ...textClip, text: state.visibleText, style: state.style,
        transform: { ...state.transform, opacity: state.opacity },
      };
      await renderer.prepareTextClip(animatedClip);
      if (generation !== this.overlay3DGeneration) return;
      const par = this.sequencePixelAspect;
      const layoutWidth = displayLayoutWidth(width, par);
      const sceneWidth = displayLayoutWidth(projectWidth > 0 ? projectWidth : width, par);
      const sceneHeight = projectHeight > 0 ? projectHeight : height;
      renderer.resize(layoutWidth, height, sceneWidth, sceneHeight);
      renderer.clear();
      const mesh = renderer.renderTextClip(animatedClip, sceneWidth, sceneHeight);
      if (!mesh) return;
      renderer.getScene().add(mesh);
      await this.drawOverlayCanvasWithEffects(
        ctx,
        renderer.render(),
        getAnimatedVideoEffects(textClip, clipLocalTime, this.burnInSource),
        width,
        height,
      );
      return;
    }
    const par = this.sequencePixelAspect;
    const result = titleEngine.renderText(
      textClip,
      displayLayoutWidth(width, par),
      height,
      clipLocalTime,
      {
        x: projectWidth > 0 ? width / projectWidth : 1,
        y: projectHeight > 0 ? height / projectHeight : 1,
      },
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      getAnimatedVideoEffects(textClip, clipLocalTime, this.burnInSource),
      width,
      height,
    );
  }

  private async renderShapeClipToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    shapeClip: ShapeClip,
    time: number,
    width: number,
    height: number,
  ): Promise<void> {
    const clipLocalTime = time - shapeClip.startTime;
    const par = this.sequencePixelAspect;
    const result = await graphicsEngine.renderGraphic(
      shapeClip,
      clipLocalTime,
      displayLayoutWidth(width, par),
      height,
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      getAnimatedVideoEffects(shapeClip, clipLocalTime, this.burnInSource),
      width,
      height,
    );
  }

  private async renderSVGClipToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    svgClip: import("../graphics/types").SVGClip,
    time: number,
    width: number,
    height: number,
  ): Promise<void> {
    const clipLocalTime = time - svgClip.startTime;
    const par = this.sequencePixelAspect;
    const result = await graphicsEngine.renderGraphic(
      svgClip,
      clipLocalTime,
      displayLayoutWidth(width, par),
      height,
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      getAnimatedVideoEffects(svgClip, clipLocalTime, this.burnInSource),
      width,
      height,
    );
  }

  private async renderStickerClipToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    stickerClip: import("../graphics/types").StickerClip,
    time: number,
    width: number,
    height: number,
  ): Promise<void> {
    const clipLocalTime = time - stickerClip.startTime;
    const par = this.sequencePixelAspect;
    const result = await graphicsEngine.renderGraphic(
      stickerClip,
      clipLocalTime,
      displayLayoutWidth(width, par),
      height,
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      getAnimatedVideoEffects(stickerClip, clipLocalTime, this.burnInSource),
      width,
      height,
    );
  }

  /**
   * Draws an overlay canvas laid out in display space (stored width x PAR). Effects run on that display-space canvas,
   * so blur, glow and shadow radii are isotropic where the frame is shown; the result is then squeezed into stored
   * pixels, like the overlay itself.
   */
  private async drawOverlayCanvasWithEffects(
    ctx: OffscreenCanvasRenderingContext2D,
    source: OffscreenCanvas | HTMLCanvasElement,
    effects: readonly Effect[],
    width: number,
    height: number,
  ): Promise<void> {
    const par = this.sequencePixelAspect;
    const enabledEffects = effects.filter(isRenderableVideoEffect);
    if (enabledEffects.length === 0) {
      ctx.drawImage(squeezeOverlayToStored(source, width, height, par), 0, 0);
      return;
    }

    let sourceBitmap: ImageBitmap | null = null;
    let processedBitmap: ImageBitmap | null = null;
    try {
      sourceBitmap = await createImageBitmap(source);
      const effectsEngine = await this.ensureEffectsEngine(width, height);
      const result = await effectsEngine.applyEffects(
        sourceBitmap,
        enabledEffects as Effect[],
      );
      processedBitmap = result.image;
      // drawImage to the stored size squeezes the display-space result by 1/PAR.
      ctx.drawImage(processedBitmap, 0, 0, width, height);
    } catch (error) {
      console.warn("[VideoEngine] Overlay effect render failed:", error);
      ctx.drawImage(squeezeOverlayToStored(source, width, height, par), 0, 0);
    } finally {
      if (processedBitmap && processedBitmap !== sourceBitmap) {
        processedBitmap.close();
      }
      sourceBitmap?.close();
    }
  }

  private getActiveSubtitles(timeline: Timeline, time: number): Subtitle[] {
    const subtitles = timeline.subtitles || [];
    return subtitles.filter((sub) => {
      // Hidden cues (e.g. the other language of a translation) stay out of the picture on every path.
      return !sub.hidden && time >= sub.startTime && time < sub.endTime;
    });
  }

  resetExportState(): void {
    // Particle frames are sampled from absolute project time; no shared state to reset.
  }

  private renderSubtitleToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    subtitle: Subtitle,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    withDisplaySpace(ctx, canvasWidth, this.sequencePixelAspect, (layoutWidth) => {
      drawCaption(ctx, subtitle, layoutWidth, canvasHeight);
    });
  }

  private getClipsAtTime(track: Track, time: number): Clip[] {
    return track.clips.filter((clip) => {
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  // Find a transition on `track` whose active window contains `time`.
  private findActiveTransition(
    track: Track,
    time: number,
  ): {
    transition: Transition;
    clipA: Clip;
    clipB?: Clip;
    progress: number;
  } | null {
    const transitions = track.transitions || [];
    if (
      !this.transitionEngine ||
      this.transitionEngine.getEngineDimensions().width <= 0 ||
      this.transitionEngine.getEngineDimensions().height <= 0
    ) {
      this.transitionEngine = new TransitionEngine({ width: 1, height: 1 });
    }

    for (const transition of transitions) {
      const clipA = track.clips.find((c) => c.id === transition.clipAId);
      const clipB = transition.clipBId
        ? track.clips.find((c) => c.id === transition.clipBId)
        : undefined;
      if (!clipA || (transition.clipBId && !clipB)) continue;

      if (!this.transitionEngine.isTimeInTransition(transition, clipA, time)) {
        continue;
      }

      const progress = this.transitionEngine.calculateTransitionProgress(
        transition,
        clipA,
        time,
      );
      return { transition, clipA, clipB, progress };
    }
    return null;
  }

  private async createTransparentTransitionBitmap(
    width: number,
    height: number,
  ): Promise<ImageBitmap | null> {
    if (typeof OffscreenCanvas === "undefined") {
      return null;
    }

    try {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d")?.clearRect(0, 0, width, height);
      return await createImageBitmap(canvas);
    } catch {
      return null;
    }
  }

  // Decode a single video/image clip frame at the given absolute project
  // `time` and return it as an ImageBitmap sized to (width, height). Returns
  // null when decoding fails or the media is missing.
  private async decodeClipBitmap(
    clip: Clip,
    mediaItem: MediaItem,
    time: number,
    width: number,
    height: number,
    sourceLocalTime?: number,
  ): Promise<ImageBitmap | null> {
    if (!mediaItem.blob) return null;
    // Clip-local time the frame is read at: Posterize Time holds it, Echo frames pass their own.
    const frameLocalTime = sourceLocalTime ?? this.posterizedLocalTime(clip, time - clip.startTime);

    if (mediaItem.type === "image") {
      try {
        if (isAnimatedGif(mediaItem.blob)) {
          let gifCache = this.gifFrameCache.get(mediaItem.id);
          if (!gifCache) {
            const created = await createGifFrameCache(mediaItem.blob);
            if (created) {
              this.gifFrameCache.set(mediaItem.id, created);
              gifCache = created;
            }
          }
          if (gifCache && gifCache.frames.length > 0) {
            const idx = getGifFrameAtTime(gifCache, getAnimatedImageSourceTime(clip, frameLocalTime) * 1000);
            return gifCache.frames[idx];
          }
        }
        const cached = this.staticImageCache.get(this.staticImageKey(mediaItem));
        if (cached) return cached;
        const bitmap = await createMediaImageBitmap(mediaItem);
        this.cacheStaticImage(mediaItem, bitmap);
        return bitmap;
      } catch (error) {
        console.warn(
          `[VideoEngine] decodeClipBitmap (image) failed for ${mediaItem.id}:`,
          error,
        );
        return null;
      }
    }

    const speedEngine = getSpeedEngine();
    const sourceTime = Math.max(
      clip.inPoint,
      Math.min(
        clip.outPoint,
        clip.inPoint + speedEngine.getSourceTimeAtPlaybackTime(clip.id, frameLocalTime),
      ),
    );

    let bitmap = await this.decodeFrameWithMediaBunny(
      mediaItem.blob,
      sourceTime,
      width,
      height,
      mediaItem.id,
    );
    const conform = frameConformFor(mediaItem);
    if (!bitmap) {
      // The fallback decoder applies the conform itself (it letterboxes into a canvas-sized bitmap).
      return this.decodeFrameWithVideoElement(mediaItem.id, mediaItem.blob, sourceTime, width, height, conform);
    }
    if (conform) {
      try {
        const conformed = await conformBitmap(bitmap, conform);
        if (conformed !== bitmap) {
          bitmap.close();
          bitmap = conformed;
        }
      } catch (error) {
        console.warn(`Could not apply pixel aspect / field order to ${mediaItem.id}:`, error);
      }
    }
    return bitmap;
  }

  private async renderActiveTransition(
    track: Track,
    time: number,
    mediaLibrary: Project["mediaLibrary"],
    _settings: Project["settings"],
    width: number,
    height: number,
    ctx: OffscreenCanvasRenderingContext2D,
  ): Promise<Set<string>> {
    const rendered = new Set<string>();

    const active = this.findActiveTransition(track, time);
    if (!active) return rendered;

    const { transition, clipA, clipB, progress } = active;

    const mediaA = mediaLibrary.items.find((m) => m.id === clipA.mediaId);
    const mediaB = clipB
      ? mediaLibrary.items.find((m) => m.id === clipB.mediaId)
      : undefined;
    if (
      !mediaA?.blob ||
      !getMediaItemCapabilities(mediaA).visual ||
      (clipB &&
        (!mediaB?.blob || !getMediaItemCapabilities(mediaB).visual))
    ) {
      return rendered;
    }

    let bitmapA: ImageBitmap | null = null;
    let bitmapB: ImageBitmap | null = null;
    let processedA: ImageBitmap | null = null;
    let processedB: ImageBitmap | null = null;

    try {
      [bitmapA, bitmapB] = await Promise.all([
        this.decodeClipBitmap(clipA, mediaA, time, width, height),
        clipB && mediaB
          ? this.decodeClipBitmap(clipB, mediaB, time, width, height)
          : this.createTransparentTransitionBitmap(width, height),
      ]);
      if (!bitmapA || !bitmapB) {
        return rendered;
      }
      const effectsA = this.getAnimatedEffects(clipA, time - clipA.startTime);
      processedA = await this.applyClipVideoProcessing(
        clipA.id,
        bitmapA,
        bitmapA,
        effectsA,
        getAnimatedColorGrading(clipA, time - clipA.startTime),
        width,
        height,
        {
          clip: clipA,
          media: mediaA,
          localTime: posterizedClipTime(effectsA, time - clipA.startTime),
          decodeWidth: width,
          decodeHeight: height,
        },
      );
      const effectsB =
        clipB && mediaB ? this.getAnimatedEffects(clipB, time - clipB.startTime) : [];
      processedB =
        clipB && mediaB
          ? await this.applyClipVideoProcessing(
              clipB.id,
              bitmapB,
              bitmapB,
              effectsB,
              getAnimatedColorGrading(clipB, time - clipB.startTime),
              width,
              height,
              {
                clip: clipB,
                media: mediaB,
                localTime: posterizedClipTime(effectsB, time - clipB.startTime),
                decodeWidth: width,
                decodeHeight: height,
              },
            )
          : bitmapB;

      if (
        !this.transitionEngine ||
        this.transitionEngine.getEngineDimensions().width !== width ||
        this.transitionEngine.getEngineDimensions().height !== height
      ) {
        this.transitionEngine = new TransitionEngine({ width, height });
      }

      const outgoingBitmap =
        !clipB && transition.edge === "in" ? processedB : processedA;
      const incomingBitmap =
        !clipB && transition.edge === "in" ? processedA : processedB;

      const result = await this.transitionEngine.renderTransition(
        outgoingBitmap,
        incomingBitmap,
        transition,
        progress,
      );

      if (result.frame) {
        ctx.drawImage(result.frame, 0, 0, width, height);
        result.frame.close();
      }

      rendered.add(clipA.id);
      if (clipB) rendered.add(clipB.id);
    } catch (error) {
      console.warn(
        `[VideoEngine] transition render failed (clipA=${clipA.id} clipB=${clipB?.id ?? "edge"}):`,
        error,
      );
    } finally {
      if (processedA && processedA !== bitmapA) processedA.close();
      if (processedB && processedB !== bitmapB) processedB.close();
      if (bitmapA && mediaA.type !== "image") bitmapA.close();
      if (bitmapB && (!mediaB || mediaB.type !== "image")) bitmapB.close();
    }

    return rendered;
  }

  private createClipRenderInfo(clip: Clip, time: number): VideoClipRenderInfo {
    const clipLocalTime = time - clip.startTime;

    const animatedTransform = this.getAnimatedTransform(clip, clipLocalTime);
    const animatedEffects = this.getAnimatedEffects(clip, clipLocalTime);

    // Posterize Time holds the frame: the source is read at the start of the posterized frame, not at `time`.
    const speedEngine = getSpeedEngine();
    const sourceTime =
      clip.inPoint +
      speedEngine.getSourceTimeAtPlaybackTime(
        clip.id,
        posterizedClipTime(animatedEffects, clipLocalTime),
      );

    return {
      clipId: clip.id,
      mediaId: clip.mediaId,
      media: null as unknown as Blob,
      sourceTime,
      transform: animatedTransform,
      effects: animatedEffects,
      opacity: animatedTransform.opacity,
    };
  }

  /**
   * Resolves each clip's input transform for this frame. The per-media
   * resolution is cached on the media list identity, so a project with no
   * wide-gamut / HDR / reinterpreted footage costs one pointer comparison.
   */
  private prepareInputTransforms(project: Project): void {
    const items = project.mediaLibrary.items;
    if (this.inputTransformItems !== items) {
      this.inputTransformItems = items;
      this.inputTransformByMedia = new Map();
      for (const item of items) {
        if (item.type !== "video" && item.type !== "image") continue;
        const transform = inputTransformFor(inputSpaceForItem(item));
        if (transform) this.inputTransformByMedia.set(item.id, transform);
      }
    }
    this.clipInputTransforms = new Map();
    const itemById = new Map(items.map((item) => [item.id, item] as const));
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        // A clip's own Interpret Footage override wins over its footage item's.
        const item = clip.colorInterpretation ? itemById.get(clip.mediaId) : undefined;
        const transform = item
          ? (item.type === "video" || item.type === "image") ? inputTransformFor(inputSpaceForItem(item, clip.colorInterpretation)) : null
          : this.inputTransformByMedia.get(clip.mediaId);
        if (transform) this.clipInputTransforms.set(clip.id, transform);
      }
    }
  }

  private async applyClipInputTransform(
    clipId: string,
    image: ImageBitmap,
    sourceImage: ImageBitmap,
  ): Promise<ImageBitmap> {
    const transform = this.clipInputTransforms.get(clipId);
    if (!transform) return image;
    const next = await applyInputTransformToBitmap(image, transform);
    return this.adoptProcessedBitmap(image, sourceImage, next);
  }

  private async applyClipVideoProcessing(
    clipId: string,
    image: ImageBitmap,
    sourceImage: ImageBitmap,
    effects: Effect[],
    colorGrading: ClipColorGrading | undefined,
    width: number,
    height: number,
    temporal?: TemporalClipContext,
  ): Promise<ImageBitmap> {
    image = await this.applyClipInputTransform(clipId, image, sourceImage);
    let processed = await this.applyClipEffects(
      clipId,
      image,
      sourceImage,
      effects,
      width,
      height,
      temporal,
    );
    processed = await this.applyClipColorGrading(
      clipId,
      processed,
      sourceImage,
      colorGrading,
      width,
      height,
    );
    return processed;
  }

  private async applyClipEffects(
    clipId: string,
    image: ImageBitmap,
    sourceImage: ImageBitmap,
    effects: Effect[],
    width: number,
    height: number,
    temporal?: TemporalClipContext,
  ): Promise<ImageBitmap> {
    const enabledEffects = effects.filter((effect) => effect.enabled);
    if (enabledEffects.length === 0) {
      return image;
    }

    const echo = temporal ? findActiveEcho(enabledEffects) : null;
    if (echo && temporal) {
      return this.applyEchoStack(
        clipId,
        image,
        sourceImage,
        enabledEffects,
        echo,
        temporal,
        width,
        height,
      );
    }

    try {
      const effectsEngine = await this.ensureEffectsEngine(width, height);
      const result = await effectsEngine.applyEffects(image, enabledEffects);
      return this.adoptProcessedBitmap(image, sourceImage, result.image);
    } catch (error) {
      console.warn(
        `Failed to apply effects to clip ${clipId}:`,
        error,
      );
      this.effectsEngine?.dispose();
      this.effectsEngine = null;

      // A transient effects-engine failure must not turn into a single raw
      // frame in an otherwise processed export. Recreate the engine and retry
      // once; if that also fails, abort the export instead of writing a visual
      // discontinuity into the output file. Preview rendering keeps its
      // existing best-effort fallback so editing remains responsive.
      if (this.exportMode) {
        let retryEngine: VideoEffectsEngine | null = null;
        try {
          retryEngine = await this.ensureEffectsEngine(width, height);
          const result = await retryEngine.applyEffects(image, enabledEffects);
          return this.adoptProcessedBitmap(image, sourceImage, result.image);
        } catch (retryError) {
          retryEngine?.dispose();
          this.effectsEngine = null;
          throw new Error(`Failed to apply effects to clip ${clipId} during export`, {
            cause: retryError,
          });
        }
      }

      return image;
    }
  }

  /**
   * Runs a clip colour grade (input LUT, white balance, wheels, curves, LUT, HSL, vignette) over a still with the
   * very routine the renderer applies to clips, so a look or LUT preview shows what applying it will render.
   * `image` is never closed or consumed; the result is a new bitmap (or `image` itself for a neutral grade).
   */
  async gradeBitmap(
    image: ImageBitmap,
    colorGrading: ClipColorGrading,
  ): Promise<ImageBitmap> {
    return this.applyClipColorGrading(
      "look-preview",
      image,
      image,
      colorGrading,
      image.width,
      image.height,
    );
  }

  private async applyClipColorGrading(
    clipId: string,
    image: ImageBitmap,
    sourceImage: ImageBitmap,
    colorGrading: ClipColorGrading | undefined,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    if (!colorGrading) {
      return image;
    }

    const renderableColorGrading =
      this.normalizeClipColorGrading(colorGrading);
    if (isNeutralColorGrading(renderableColorGrading)) {
      return image;
    }

    let processed = image;
    const plan = planColorGrading(renderableColorGrading);

    // Input LUT first: the grade below sees the already-transformed picture.
    if (plan.inputLut) {
      try {
        const gradingEngine = this.ensureColorGradingEngine(width, height);
        const result = await gradingEngine.applyCpuGrading(processed, {
          lut: plan.inputLut,
        });
        processed = this.adoptProcessedBitmap(
          processed,
          sourceImage,
          result.image,
        );
      } catch (error) {
        console.warn(`Failed to apply input LUT to clip ${clipId}:`, error);
      }
    }

    if (plan.whiteBalanceFirst) {
      processed = await this.applyClipWhiteBalance(
        clipId,
        processed,
        sourceImage,
        renderableColorGrading,
        width,
        height,
      );
    }

    if (plan.legacyWheels) {
      try {
        const gradingEngine = this.ensureColorGradingEngine(width, height);
        gradingEngine.initialize();
        const result = await gradingEngine.applyColorWheels(
          processed,
          plan.legacyWheels,
        );
        processed = this.adoptProcessedBitmap(
          processed,
          sourceImage,
          result.image,
        );
      } catch (error) {
        console.warn(
          `Failed to apply color wheels to clip ${clipId}:`,
          error,
        );
        this.colorGradingEngine?.dispose();
        this.colorGradingEngine = null;
      }
    }

    if (plan.fused) {
      try {
        const gradingEngine = this.ensureColorGradingEngine(width, height);
        const result = await gradingEngine.applyFusedGrading(
          processed,
          plan.fused,
        );
        processed = this.adoptProcessedBitmap(
          processed,
          sourceImage,
          result.image,
        );
      } catch (error) {
        console.warn(
          `Failed to apply float color grading to clip ${clipId}:`,
          error,
        );
      }
    }

    if (plan.cpu) {
      try {
        const gradingEngine = this.ensureColorGradingEngine(width, height);
        const result = await gradingEngine.applyCpuGrading(
          processed,
          plan.cpu,
        );
        processed = this.adoptProcessedBitmap(
          processed,
          sourceImage,
          result.image,
        );
      } catch (error) {
        console.warn(
          `Failed to apply CPU color grading to clip ${clipId}:`,
          error,
        );
      }
    }

    if (!plan.whiteBalanceFirst) {
      processed = await this.applyClipWhiteBalance(
        clipId,
        processed,
        sourceImage,
        renderableColorGrading,
        width,
        height,
      );
    }

    return processed;
  }

  private async applyClipWhiteBalance(
    clipId: string,
    image: ImageBitmap,
    sourceImage: ImageBitmap,
    colorGrading: RenderableClipColorGrading,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    const whiteBalanceEffects = this.buildWhiteBalanceEffects(colorGrading);
    if (whiteBalanceEffects.length === 0) return image;
    try {
      const effectsEngine = await this.ensureEffectsEngine(width, height);
      const result = await effectsEngine.applyEffects(image, whiteBalanceEffects);
      return this.adoptProcessedBitmap(image, sourceImage, result.image);
    } catch (error) {
      console.warn(`Failed to apply white balance to clip ${clipId}:`, error);
      this.effectsEngine?.dispose();
      this.effectsEngine = null;
      return image;
    }
  }

  /** Clip-local time a frame is read at once Posterize Time is applied (the time itself without the effect). */
  private posterizedLocalTime(clip: Clip, localTime: number): number {
    if (!clipHasTemporalEffects(clip)) return localTime;
    return posterizedClipTime(this.getAnimatedEffects(clip, localTime), localTime);
  }

  /**
   * Runs an effect stack that contains an active Echo. Effects above the echo
   * see every frame it combines (each echo frame is decoded at its own
   * clip-local time and graded with the stack sampled at that time), the echo
   * combines them, and the effects below it see the combined frame. The set of
   * source frames is a pure function of the clip-local time and the echo
   * parameters, so preview, scrubbing and export agree.
   */
  private async applyEchoStack(
    clipId: string,
    image: ImageBitmap,
    sourceImage: ImageBitmap,
    enabledEffects: Effect[],
    active: NonNullable<ReturnType<typeof findActiveEcho>>,
    temporal: TemporalClipContext,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    const { clip, localTime } = temporal;
    const echoEffect = enabledEffects[active.index];
    const above = enabledEffects.slice(0, active.index).filter((e) => !isTemporalEffectType(e.type));
    const below = enabledEffects.slice(active.index + 1);
    const samples = planEcho(localTime, clip.duration, active.echo);

    let current = above.length > 0
      ? await this.applyClipEffects(clipId, image, sourceImage, above, width, height)
      : image;
    if (samples.length > 0) {
      const echoes: { frame: ImageBitmap; owned: boolean; weight: number }[] = [];
      try {
        for (const sample of samples) {
          const frame = await this.decodeEchoFrame(temporal, echoEffect.id, sample.localTime, width, height);
          if (!frame) {
            if (this.exportMode) {
              throw new Error(`Echo frame at ${sample.localTime.toFixed(3)}s of clip ${clipId} could not be decoded`);
            }
            continue;
          }
          echoes.push({ ...frame, weight: sample.weight });
        }
        const composed = await this.echoCompositor.compose(
          current,
          echoes.map((e) => ({ image: e.frame, weight: e.weight })),
          active.echo,
        );
        current = this.adoptProcessedBitmap(current, sourceImage, composed);
      } finally {
        for (const echoFrame of echoes) {
          if (echoFrame.owned) this.closeBitmap(echoFrame.frame);
        }
      }
    }
    return below.length > 0
      ? this.applyClipEffects(clipId, current, sourceImage, below, width, height)
      : current;
  }

  /**
   * One echo frame: the clip's source frame at clip-local `localTime`, through
   * the input transform and the effects stacked above the echo, sampled at
   * that time. `owned` says whether the caller must close the bitmap (stills
   * come from the shared image cache and must not be closed).
   */
  private async decodeEchoFrame(
    temporal: TemporalClipContext,
    echoEffectId: string,
    localTime: number,
    width: number,
    height: number,
  ): Promise<{ frame: ImageBitmap; owned: boolean } | null> {
    const { clip, media } = temporal;
    const decoded = await this.decodeClipBitmap(
      clip,
      media,
      clip.startTime + localTime,
      temporal.decodeWidth,
      temporal.decodeHeight,
      localTime,
    );
    if (!decoded) return null;
    const isVideo = media.type !== "image";
    let current = decoded;
    try {
      current = await this.applyClipInputTransform(clip.id, current, decoded);
      const stack = this.getAnimatedEffects(clip, localTime).filter((e) => e.enabled);
      const cut = stack.findIndex((e) => e.id === echoEffectId);
      const above = (cut < 0 ? stack : stack.slice(0, cut)).filter((e) => !isTemporalEffectType(e.type));
      if (above.length > 0) {
        current = await this.applyClipEffects(clip.id, current, decoded, above, width, height);
      }
    } catch (error) {
      if (current !== decoded) this.closeBitmap(current);
      if (isVideo) this.closeBitmap(decoded);
      throw error;
    }
    if (current !== decoded && isVideo) this.closeBitmap(decoded);
    return { frame: current, owned: current !== decoded || isVideo };
  }

  private async ensureEffectsEngine(
    width: number,
    height: number,
  ): Promise<VideoEffectsEngine> {
    if (this.effectsEngine) {
      return this.effectsEngine;
    }

    const effectsEngine = new VideoEffectsEngine({
      width,
      height,
      useGPU: true,
      preferWebGPU: false,
    });
    this.effectsEngine = effectsEngine;

    try {
      const initPromise = effectsEngine.initialize();
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("Effects init timeout")), 5000),
      );
      await Promise.race([initPromise, timeoutPromise]);
      return effectsEngine;
    } catch (error) {
      effectsEngine.dispose();
      this.effectsEngine = null;
      throw error;
    }
  }

  private ensureColorGradingEngine(
    width: number,
    height: number,
  ): ColorGradingEngine {
    if (!this.colorGradingEngine) {
      this.colorGradingEngine = new ColorGradingEngine(width, height);
    }
    return this.colorGradingEngine;
  }

  private adoptProcessedBitmap(
    currentImage: ImageBitmap,
    sourceImage: ImageBitmap,
    nextImage: ImageBitmap | null | undefined,
  ): ImageBitmap {
    if (!nextImage || nextImage.width <= 0 || nextImage.height <= 0) {
      if (nextImage && nextImage !== currentImage) {
        this.closeBitmap(nextImage);
      }
      return currentImage;
    }

    if (nextImage === currentImage) {
      return currentImage;
    }

    if (currentImage !== sourceImage) {
      this.closeBitmap(currentImage);
    }
    return nextImage;
  }

  private closeBitmap(bitmap: ImageBitmap): void {
    try {
      bitmap.close();
    } catch {}
  }

  private normalizeClipColorGrading(
    colorGrading: ClipColorGrading,
  ): RenderableClipColorGrading {
    const lut = this.normalizeClipLut(colorGrading.lut);
    return {
      ...colorGrading,
      lut,
      inputLut: this.normalizeClipLut(colorGrading.inputLut),
    };
  }

  private normalizeClipLut(
    lut: ClipColorGrading["lut"] | undefined,
  ): LUTData | undefined {
    if (!lut) {
      return undefined;
    }

    const toF32 = (v: Float32Array | number[]): Float32Array =>
      v instanceof Float32Array ? v : Float32Array.from(v);
    return {
      data:
        lut.data instanceof Uint8Array
          ? lut.data
          : new Uint8Array(lut.data),
      ...(lut.floatData ? { floatData: toF32(lut.floatData) } : {}),
      ...(lut.curve1d
        ? { curve1d: { ...lut.curve1d, data: toF32(lut.curve1d.data) } }
        : {}),
      size: lut.size,
      intensity: lut.intensity,
      ...(lut.space ? { space: lut.space } : {}),
    };
  }

  private buildWhiteBalanceEffects(
    colorGrading: RenderableClipColorGrading,
  ): Effect[] {
    const effects: Effect[] = [];
    if (
      colorGrading.temperature !== undefined &&
      colorGrading.temperature !== 0
    ) {
      effects.push({
        id: "wb-temperature",
        type: "temperature",
        enabled: true,
        params: { value: colorGrading.temperature },
      });
    }
    if (colorGrading.tint !== undefined && colorGrading.tint !== 0) {
      effects.push({
        id: "wb-tint",
        type: "tint",
        enabled: true,
        params: { value: colorGrading.tint },
      });
    }
    return effects;
  }

  private getAnimatedEffects(clip: Clip, localTime: number): Effect[] {
    return getAnimatedVideoEffects(clip, localTime, this.burnInSource);
  }

  private getAnimatedTransform(clip: Clip, localTime: number): Transform {
    const keyframes = clip.keyframes || [];

    if (keyframes.length === 0) {
      return clip.transform;
    }

    const base = clip.transform;
    let opacity = base.opacity;
    let positionX = base.position.x;
    let positionY = base.position.y;
    let scaleX = base.scale.x;
    let scaleY = base.scale.y;
    let rotation = base.rotation;

    const opacityKfs = keyframeEngine.getKeyframesForProperty(
      keyframes,
      "opacity",
    );
    if (opacityKfs.length > 0) {
      const result = keyframeEngine.getValueAtTime(opacityKfs, localTime);
      if (typeof result.value === "number") {
        opacity = result.value;
      }
    }

    const posXKfs = keyframeEngine.getKeyframesForProperty(
      keyframes,
      "position.x",
    );
    if (posXKfs.length > 0) {
      const result = keyframeEngine.getValueAtTime(posXKfs, localTime);
      if (typeof result.value === "number") {
        positionX = result.value;
      }
    }

    const posYKfs = keyframeEngine.getKeyframesForProperty(
      keyframes,
      "position.y",
    );
    if (posYKfs.length > 0) {
      const result = keyframeEngine.getValueAtTime(posYKfs, localTime);
      if (typeof result.value === "number") {
        positionY = result.value;
      }
    }

    const scaleXKfs = keyframeEngine.getKeyframesForProperty(
      keyframes,
      "scale.x",
    );
    if (scaleXKfs.length > 0) {
      const result = keyframeEngine.getValueAtTime(scaleXKfs, localTime);
      if (typeof result.value === "number") {
        scaleX = result.value;
      }
    }

    const scaleYKfs = keyframeEngine.getKeyframesForProperty(
      keyframes,
      "scale.y",
    );
    if (scaleYKfs.length > 0) {
      const result = keyframeEngine.getValueAtTime(scaleYKfs, localTime);
      if (typeof result.value === "number") {
        scaleY = result.value;
      }
    }

    const rotationKfs = keyframeEngine.getKeyframesForProperty(
      keyframes,
      "rotation",
    );
    if (rotationKfs.length > 0) {
      const result = keyframeEngine.getValueAtTime(rotationKfs, localTime);
      if (typeof result.value === "number") {
        rotation = result.value;
      }
    }

    return {
      ...base,
      position: { x: positionX, y: positionY },
      scale: { x: scaleX, y: scaleY },
      rotation,
      opacity,
      anchor: base.anchor,
      borderRadius: base.borderRadius,
      fitMode: base.fitMode,
      crop: base.crop,
    };
  }

  private applyEmphasisAnimation(
    animation: EmphasisAnimation,
    time: number,
  ): {
    opacity: number;
    scale: number;
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
  } {
    const { type, speed, intensity, loop, startTime, animationDuration } =
      animation;

    const animStart = startTime ?? 0;
    if (time < animStart) {
      return {
        opacity: 1,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
      };
    }

    if (animationDuration !== undefined && animationDuration > 0) {
      const animEnd = animStart + animationDuration;
      if (time > animEnd) {
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
    }

    const adjustedTime = time - animStart;
    const cycleTime = loop
      ? (adjustedTime * speed) % 1
      : Math.min(adjustedTime * speed, 1);
    const t = cycleTime * Math.PI * 2;

    switch (type) {
      case "pulse": {
        const pulseScale = 1 + Math.sin(t) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: pulseScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "shake": {
        const shakeX = Math.sin(t * 5) * 0.02 * intensity;
        const shakeY = Math.cos(t * 5) * 0.02 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: shakeX,
          offsetY: shakeY,
          rotation: 0,
        };
      }
      case "bounce": {
        const bounceY = Math.abs(Math.sin(t)) * -0.05 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: bounceY,
          rotation: 0,
        };
      }
      case "float": {
        const floatY = Math.sin(t) * 0.03 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: floatY,
          rotation: 0,
        };
      }
      case "spin": {
        const spinRotation = cycleTime * 360 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: spinRotation,
        };
      }
      case "flash": {
        const flashOpacity = 0.5 + Math.abs(Math.sin(t)) * 0.5;
        return {
          opacity: flashOpacity,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "heartbeat": {
        const phase = cycleTime * 4;
        let heartScale = 1;
        if (phase < 1)
          heartScale = 1 + 0.15 * intensity * Math.sin(phase * Math.PI);
        else if (phase < 2)
          heartScale = 1 + 0.1 * intensity * Math.sin((phase - 1) * Math.PI);
        return {
          opacity: 1,
          scale: heartScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "swing": {
        const swingRotation = Math.sin(t) * 15 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: swingRotation,
        };
      }
      case "wobble": {
        const wobbleRotation = Math.sin(t * 3) * 5 * intensity;
        const wobbleX = Math.sin(t) * 0.02 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: wobbleX,
          offsetY: 0,
          rotation: wobbleRotation,
        };
      }
      case "jello": {
        const jelloScaleX = 1 + Math.sin(t * 2) * 0.1 * intensity;
        const jelloScaleY = 1 - Math.sin(t * 2) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: jelloScaleX,
          scaleY: jelloScaleY,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "rubber-band": {
        const rubberScaleX = 1 + Math.sin(t) * 0.2 * intensity;
        const rubberScaleY = 1 - Math.sin(t) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: rubberScaleX,
          scaleY: rubberScaleY,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "tada": {
        const tadaRotation = Math.sin(t * 4) * 10 * intensity;
        const tadaScale = 1 + Math.sin(t * 2) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: tadaScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: tadaRotation,
        };
      }
      case "vibrate": {
        const vibrateX = (Math.random() - 0.5) * 0.02 * intensity;
        const vibrateY = (Math.random() - 0.5) * 0.02 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: vibrateX,
          offsetY: vibrateY,
          rotation: 0,
        };
      }
      case "flicker": {
        const flickerOpacity = Math.random() > 0.1 ? 1 : 0.3;
        return {
          opacity: flickerOpacity,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "glow": {
        const glowScale = 1 + Math.sin(t) * 0.05 * intensity;
        const glowOpacity = 0.8 + Math.sin(t) * 0.2;
        return {
          opacity: glowOpacity,
          scale: glowScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "breathe": {
        const breatheScale = 1 + Math.sin(t * 0.5) * 0.08 * intensity;
        return {
          opacity: 1,
          scale: breatheScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "wave": {
        const waveY = Math.sin(t + adjustedTime * 2) * 0.03 * intensity;
        const waveRotation = Math.sin(t) * 5 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: waveY,
          rotation: waveRotation,
        };
      }
      case "tilt": {
        const tiltRotation = Math.sin(t * 0.5) * 10 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: tiltRotation,
        };
      }
      case "zoom-pulse": {
        const zoomScale = 1 + Math.sin(t) * 0.15 * intensity;
        return {
          opacity: 1,
          scale: zoomScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "focus-zoom": {
        const focusPoint = animation.focusPoint || { x: 0.5, y: 0.5 };
        const zoomAmount = animation.zoomScale || 1.5;
        const holdDuration = animation.holdDuration || 0.3;
        const zoomInPhase = 0.3;
        const zoomOutPhase = 1 - holdDuration - zoomInPhase;

        let focusScale = 1;
        let focusOffsetX = 0;
        let focusOffsetY = 0;

        if (cycleTime < zoomInPhase) {
          const zoomProgress = cycleTime / zoomInPhase;
          const eased = 1 - Math.pow(1 - zoomProgress, 3);
          focusScale = 1 + (zoomAmount - 1) * eased * intensity;
          focusOffsetX = (0.5 - focusPoint.x) * (focusScale - 1);
          focusOffsetY = (0.5 - focusPoint.y) * (focusScale - 1);
        } else if (cycleTime < zoomInPhase + holdDuration) {
          focusScale = zoomAmount * intensity;
          focusOffsetX = (0.5 - focusPoint.x) * (focusScale - 1);
          focusOffsetY = (0.5 - focusPoint.y) * (focusScale - 1);
        } else {
          const zoomOutProgress =
            (cycleTime - zoomInPhase - holdDuration) / zoomOutPhase;
          const eased = Math.pow(zoomOutProgress, 3);
          focusScale = zoomAmount - (zoomAmount - 1) * eased * intensity;
          focusOffsetX = (0.5 - focusPoint.x) * (focusScale - 1);
          focusOffsetY = (0.5 - focusPoint.y) * (focusScale - 1);
        }

        return {
          opacity: 1,
          scale: focusScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: focusOffsetX,
          offsetY: focusOffsetY,
          rotation: 0,
        };
      }
      case "pan-left": {
        const panLeftX = -cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: panLeftX,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "pan-right": {
        const panRightX = cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: panRightX,
          offsetY: 0,
          rotation: 0,
        };
      }
      case "pan-up": {
        const panUpY = -cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: panUpY,
          rotation: 0,
        };
      }
      case "pan-down": {
        const panDownY = cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: panDownY,
          rotation: 0,
        };
      }
      case "ken-burns": {
        const kbZoom = 1 + cycleTime * 0.3 * intensity;
        const kbX = cycleTime * 0.1 * intensity;
        const kbY = cycleTime * 0.05 * intensity;
        return {
          opacity: 1,
          scale: kbZoom,
          scaleX: 1,
          scaleY: 1,
          offsetX: kbX,
          offsetY: kbY,
          rotation: 0,
        };
      }
      case "none":
      default:
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
    }
  }

  async decodeFrame(
    mediaItem: MediaItem,
    time: number,
  ): Promise<ImageBitmap | null> {
    if (!mediaItem.blob) {
      console.warn(`No blob available for media item ${mediaItem.id}`);
      return null;
    }

    // Special handling for static images - they don't need mediabunny
    if (mediaItem.type === "image") {
      try {
        return await createMediaImageBitmap(mediaItem);
      } catch (error) {
        console.warn(`Failed to create ImageBitmap from image: ${error}`);
        return null;
      }
    }

    this.ensureInitialized();

    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      this.mediabunny!;

    const input = new Input({
      source: new BlobSource(mediaItem.blob),
      formats: ALL_FORMATS,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return null;
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        console.warn(`Cannot decode video track for media ${mediaItem.id}`);
        return null;
      }

      const sink = new VideoSampleSink(videoTrack);
      const sample = await sink.getSample(time);

      if (!sample) {
        return null;
      }

      // Drawn through VideoSample.draw so the file's rotation metadata is applied.
      let imageBitmap: ImageBitmap | null;
      try {
        imageBitmap = await sampleToUprightBitmap(sample);
      } catch {
        imageBitmap = null;
      }
      if (!imageBitmap) {
        sample.close();
        return null;
      }

      sample.close();
      return imageBitmap;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async decodeFrameToCanvas(
    mediaItem: MediaItem,
    time: number,
    targetWidth?: number,
    targetHeight?: number,
  ): Promise<OffscreenCanvas | null> {
    this.ensureInitialized();

    const { Input, ALL_FORMATS, BlobSource, CanvasSink } = this.mediabunny!;

    if (!mediaItem.blob) {
      return null;
    }

    const input = new Input({
      source: new BlobSource(mediaItem.blob),
      formats: ALL_FORMATS,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return null;
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        return null;
      }

      // Configure sink with optional resize
      const sinkOptions: Record<string, unknown> = {
        poolSize: 1,
        fit: "contain" as const,
      };

      if (targetWidth) {
        sinkOptions.width = targetWidth;
      }
      if (targetHeight) {
        sinkOptions.height = targetHeight;
      }

      const sink = new CanvasSink(videoTrack, sinkOptions);
      const result = await sink.getCanvas(time);

      if (!result) {
        return null;
      }

      // Clone the canvas since CanvasSink may reuse it
      const clone = new OffscreenCanvas(
        result.canvas.width,
        result.canvas.height,
      );
      const ctx = clone.getContext("2d");
      if (ctx) {
        ctx.drawImage(result.canvas, 0, 0);
      }

      return clone;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  private async compositeFrame(
    frame: ImageBitmap,
    transform: Transform,
    opacity: number,
  ): Promise<void> {
    if (!this.compositeCtx) return;

    const ctx = this.compositeCtx;
    const canvasWidth = this.compositeCanvas!.width;
    const canvasHeight = this.compositeCanvas!.height;

    ctx.save();
    ctx.globalAlpha = opacity;
    // A non-square sequence pixel: lay out in display space, then squeeze back to stored pixels.
    const sequencePar = this.sequencePixelAspect;
    if (sequencePar !== 1) ctx.scale(1 / sequencePar, 1);
    const layoutWidth = canvasWidth * sequencePar;
    const centerX = layoutWidth / 2;
    const centerY = canvasHeight / 2;

    ctx.translate(
      centerX + transform.position.x * sequencePar,
      centerY + transform.position.y,
    );

    ctx.rotate((transform.rotation * Math.PI) / 180);

    ctx.scale(transform.scale.x, transform.scale.y);

    const crop = transform.crop;
    const sourceWidth = crop ? crop.width * frame.width : frame.width;
    const sourceHeight = crop ? crop.height * frame.height : frame.height;
    const { width: drawWidth, height: drawHeight } =
      resolveCanvasFitDimensions(
        transform.fitMode,
        sourceWidth,
        sourceHeight,
        layoutWidth,
        canvasHeight,
      );
    const drawX = -drawWidth * transform.anchor.x;
    const drawY = -drawHeight * transform.anchor.y;

    if (crop) {
      const sx = crop.x * frame.width;
      const sy = crop.y * frame.height;

      ctx.drawImage(
        frame,
        sx,
        sy,
        sourceWidth,
        sourceHeight,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
      );
    } else {
      ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  async composite(
    layers: CompositeLayer[],
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    this.ensureCompositeCanvas(width, height);

    const ctx = this.compositeCtx!;
    ctx.clearRect(0, 0, width, height);

    for (const layer of layers) {
      if (!layer.visible) continue;

      ctx.save();
      ctx.globalCompositeOperation = this.getCanvasBlendMode(layer.blendMode);
      await this.compositeFrame(
        layer.image instanceof ImageBitmap
          ? layer.image
          : await createImageBitmap(layer.image),
        layer.transform,
        layer.transform.opacity,
      );

      ctx.restore();
    }

    return createImageBitmap(this.compositeCanvas!);
  }

  private getCanvasBlendMode(blendMode: BlendMode): CanvasRenderingContext2D["globalCompositeOperation"] {
    const modeMap: Record<BlendMode, CanvasRenderingContext2D["globalCompositeOperation"]> = {
      normal: "source-over",
      multiply: "multiply",
      screen: "screen",
      overlay: "overlay",
      darken: "darken",
      lighten: "lighten",
      "color-dodge": "color-dodge",
      "color-burn": "color-burn",
      "hard-light": "hard-light",
      "soft-light": "soft-light",
      difference: "difference",
      exclusion: "exclusion",
      hue: "hue",
      saturation: "saturation",
      color: "color",
      luminosity: "luminosity",
      add: "lighter",
      "linear-dodge": "lighter",
    };
    return modeMap[blendMode] || "source-over";
  }

  private ensureCompositeCanvas(width: number, height: number): void {
    if (
      !this.compositeCanvas ||
      this.compositeCanvas.width !== width ||
      this.compositeCanvas.height !== height
    ) {
      this.compositeCanvas = new OffscreenCanvas(width, height);
      this.compositeCtx = this.compositeCanvas.getContext("2d");
    }
  }

  private getCacheKey(mediaId: string, time: number): string {
    // Round time to nearest frame (assuming 30fps for cache key)
    const frameTime = Math.round(time * 30) / 30;
    return `${mediaId}:${frameTime.toFixed(4)}`;
  }

  private cacheFrame(key: string, image: ImageBitmap, mediaId: string): void {
    // Estimate frame size (4 bytes per pixel for RGBA)
    const sizeBytes = image.width * image.height * 4;
    this.evictIfNeeded(sizeBytes);

    this.frameCache.set(key, {
      image,
      timestamp: parseFloat(key.split(":")[1]),
      mediaId,
      width: image.width,
      height: image.height,
      sizeBytes,
      lastAccessed: Date.now(),
    });
  }

  private evictIfNeeded(newFrameSize: number): void {
    while (this.frameCache.size >= this.cacheConfig.maxFrames) {
      this.evictOldestFrame();
    }
    let totalSize = this.getTotalCacheSize();
    while (
      totalSize + newFrameSize > this.cacheConfig.maxSizeBytes &&
      this.frameCache.size > 0
    ) {
      this.evictOldestFrame();
      totalSize = this.getTotalCacheSize();
    }
  }

  private evictOldestFrame(): void {
    let oldestKey = "";
    let oldestTime = Infinity;

    for (const [key, entry] of this.frameCache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.frameCache.get(oldestKey);
      if (entry) {
        entry.image.close();
      }
      this.frameCache.delete(oldestKey);
    }
  }

  private getTotalCacheSize(): number {
    let total = 0;
    for (const entry of this.frameCache.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }

  /**
   * Gets frame cache statistics and performance metrics.
   *
   * @returns Cache stats including hit rate, memory usage, and entry count
   */
  getCacheStats(): FrameCacheStats {
    const totalRequests = this.cacheStats.hits + this.cacheStats.misses;
    return {
      entries: this.frameCache.size,
      sizeBytes: this.getTotalCacheSize(),
      hitRate: totalRequests > 0 ? this.cacheStats.hits / totalRequests : 0,
      maxSizeBytes: this.cacheConfig.maxSizeBytes,
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
    };
  }

  /**
   * Replaces the frame cache limits (e.g. a RAM-scaled budget on desktop),
   * evicting immediately if the new limits are lower.
   */
  setCacheConfig(config: Partial<FrameCacheConfig>): void {
    this.cacheConfig = { ...this.cacheConfig, ...config };
    this.evictIfNeeded(0);
  }

  /**
   * Clears the frame cache, freeing memory.
   * Resets cache statistics.
   */
  clearCache(): void {
    for (const entry of this.frameCache.values()) {
      entry.image.close();
    }
    this.frameCache.clear();
    this.cacheStats = { hits: 0, misses: 0 };

    for (const gifCache of this.gifFrameCache.values()) {
      for (const frame of gifCache.frames) {
        try { frame.close(); } catch {}
      }
    }
    this.gifFrameCache.clear();
  }

  /**
   * Preloads frames around a specific time for efficient playback.
   * Frames are cached based on preloadAhead and preloadBehind settings.
   *
   * @param mediaItem - Media to preload frames from
   * @param centerTime - Time around which to preload (in seconds)
   * @param frameRate - Frame rate for preloading (default: 30 fps)
   */
  async preloadFrames(
    mediaItem: MediaItem,
    centerTime: number,
    frameRate: number = 30,
  ): Promise<void> {
    this.ensureInitialized();

    if (!mediaItem.blob) return;

    const frameDuration = 1 / frameRate;
    const startTime = Math.max(
      0,
      centerTime - this.cacheConfig.preloadBehind * frameDuration,
    );
    const endTime = Math.min(
      mediaItem.metadata.duration,
      centerTime + this.cacheConfig.preloadAhead * frameDuration,
    );

    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      this.mediabunny!;

    const input = new Input({
      source: new BlobSource(mediaItem.blob),
      formats: ALL_FORMATS,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) return;

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) return;

      const sink = new VideoSampleSink(videoTrack);
      const timestamps: number[] = [];
      for (let t = startTime; t <= endTime; t += frameDuration) {
        const cacheKey = this.getCacheKey(mediaItem.id, t);
        if (!this.frameCache.has(cacheKey)) {
          timestamps.push(t);
        }
      }

      // Preload frames
      for await (const sample of sink.samplesAtTimestamps(timestamps)) {
        if (!sample) continue;

        // Upright (rotation metadata applied), unlike createImageBitmap(frame).
        const imageBitmap = await sampleToUprightBitmap(sample);
        if (!imageBitmap) {
          sample.close();
          continue;
        }
        const cacheKey = this.getCacheKey(
          mediaItem.id,
          sample.timestamp / 1_000_000,
        );
        this.cacheFrame(cacheKey, imageBitmap, mediaItem.id);

        sample.close();
      }
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  queuePreload(request: PreloadRequest): void {
    this.preloadQueue = this.preloadQueue.filter(
      (r) => r.mediaId !== request.mediaId,
    );
    this.preloadQueue.push(request);
    this.preloadQueue.sort((a, b) => b.priority - a.priority);
    this.processPreloadQueue();
  }

  private async processPreloadQueue(): Promise<void> {
    if (this.isPreloading || this.preloadQueue.length === 0) return;

    this.isPreloading = true;

    while (this.preloadQueue.length > 0) {
      const request = this.preloadQueue.shift()!;

      try {
        await this.preloadFramesRange(
          request.media,
          request.mediaId,
          request.startTime,
          request.endTime,
          request.frameRate,
        );
      } catch (error) {
        console.warn(`Preload failed for media ${request.mediaId}:`, error);
      }
    }

    this.isPreloading = false;
  }

  private async preloadFramesRange(
    media: Blob | File,
    mediaId: string,
    startTime: number,
    endTime: number,
    frameRate: number,
  ): Promise<void> {
    this.ensureInitialized();

    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      this.mediabunny!;

    const input = new Input({
      source: new BlobSource(media),
      formats: ALL_FORMATS,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) return;

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) return;

      const sink = new VideoSampleSink(videoTrack);
      const frameDuration = 1 / frameRate;
      const timestamps: number[] = [];
      for (let t = startTime; t <= endTime; t += frameDuration) {
        const cacheKey = this.getCacheKey(mediaId, t);
        if (!this.frameCache.has(cacheKey)) {
          timestamps.push(t);
        }
      }

      // Preload frames
      for await (const sample of sink.samplesAtTimestamps(timestamps)) {
        if (!sample) continue;

        // Upright (rotation metadata applied), unlike createImageBitmap(frame).
        const imageBitmap = await sampleToUprightBitmap(sample);
        if (!imageBitmap) {
          sample.close();
          continue;
        }
        const cacheKey = this.getCacheKey(
          mediaId,
          sample.timestamp / 1_000_000,
        );
        this.cacheFrame(cacheKey, imageBitmap, mediaId);

        sample.close();
      }
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  /**
   * Gets supported video and audio codecs for encoding and decoding.
   *
   * @returns CodecSupport with lists of decodable and encodable codecs
   */
  async getSupportedCodecs(): Promise<VideoCodecSupport> {
    this.ensureInitialized();

    const { getEncodableVideoCodecs, getEncodableAudioCodecs } =
      this.mediabunny!;

    try {
      const [videoEncode, audioEncode] = await Promise.all([
        getEncodableVideoCodecs(),
        getEncodableAudioCodecs(),
      ]);

      return {
        decode: ["avc", "hevc", "vp8", "vp9", "av1"], // Common decodable codecs
        encode: [...videoEncode, ...audioEncode],
        hardware: true, // WebCodecs typically uses hardware acceleration
      };
    } catch {
      return {
        decode: [],
        encode: [],
        hardware: false,
      };
    }
  }

  /**
   * Checks if a video format MIME type is supported for playback.
   *
   * @param mimeType - MIME type to check (e.g., "video/mp4")
   * @returns true if the format is supported, false otherwise
   */
  isFormatSupported(mimeType: string): boolean {
    const supportedFormats = [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-matroska",
    ];
    return supportedFormats.includes(mimeType);
  }

  /**
   * Returns all available video filters for effects.
   *
   * @returns Array of filter definitions
   */
  getAvailableFilters(): FilterDefinition[] {
    return [
      {
        type: "brightness",
        name: "Brightness",
        category: "color",
        gpuAccelerated: true,
      },
      {
        type: "contrast",
        name: "Contrast",
        category: "color",
        gpuAccelerated: true,
      },
      {
        type: "saturation",
        name: "Saturation",
        category: "color",
        gpuAccelerated: true,
      },
      {
        type: "hue",
        name: "Hue Rotation",
        category: "color",
        gpuAccelerated: true,
      },
      { type: "blur", name: "Blur", category: "blur", gpuAccelerated: true },
      {
        type: "sharpen",
        name: "Sharpen",
        category: "blur",
        gpuAccelerated: true,
      },
      {
        type: "vignette",
        name: "Vignette",
        category: "stylize",
        gpuAccelerated: true,
      },
      {
        type: "grain",
        name: "Film Grain",
        category: "stylize",
        gpuAccelerated: true,
      },
      {
        type: "chromaKey",
        name: "Chroma Key",
        category: "keying",
        gpuAccelerated: true,
      },
    ];
  }

  /**
   * Applies a filter effect to a rendered frame.
   *
   * @param frame - ImageBitmap to filter
   * @param filter - Effect configuration to apply
   * @returns Filtered ImageBitmap
   */
  async applyFilter(frame: ImageBitmap, filter: Effect): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return frame;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(frame, 0, 0);
    const filterString = this.buildFilterString(filter);
    if (filterString) {
      ctx.filter = filterString;
      ctx.drawImage(canvas, 0, 0);
    }

    return createImageBitmap(canvas);
  }

  private buildFilterString(filter: Effect): string {
    if (!filter.enabled) return "";

    const params = filter.params as Record<string, number>;

    switch (filter.type) {
      case "brightness":
        return `brightness(${1 + (params.value || 0)})`;
      case "contrast":
        return `contrast(${params.value || 1})`;
      case "saturation":
        return `saturate(${params.value || 1})`;
      case "hue":
        return `hue-rotate(${params.rotation || 0}deg)`;
      case "blur":
        return `blur(${params.radius || 0}px)`;
      default:
        return "";
    }
  }

  /**
   * Disposes of resources and cleans up the engine.
   * Call when the engine is no longer needed to free memory.
   */
  dispose(): void {
    this.overlay3DGeneration += 1;
    this.overlay3DLoading = null;
    this.overlay3DRenderer?.dispose();
    this.overlay3DRenderer = null;
    this.clearCache();
    this.clearVideoElementCache();
    for (const bitmap of this.staticImageCache.values()) {
      try { bitmap.close(); } catch {}
    }
    this.staticImageCache.clear();
    for (const engine of this.compoundEngines.values()) engine.dispose();
    this.compoundEngines.clear();
    this.renderingCompounds.clear();
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.decodeCanvas = null;
    this.decodeCtx = null;
    this.preloadQueue = [];
    this.initialized = false;
    this.mediabunny = null;
    this.motionHqRenderer?.destroy();
    this.motionHqRenderer = null;
    this.motionRenderer?.dispose();
    this.motionRenderer = null;
    this.effectsEngine?.dispose();
    this.effectsEngine = null;
    this.echoCompositor.dispose();
    this.colorGradingEngine?.dispose();
    this.colorGradingEngine = null;
    this.maskEngine = null;
  }
}
let videoEngineInstance: VideoEngine | null = null;

/**
 * Gets or creates the singleton VideoEngine instance.
 * Does not initialize the engine - call initialize() separately.
 *
 * @returns The VideoEngine singleton instance
 */
export function getVideoEngine(): VideoEngine {
  if (!videoEngineInstance) {
    videoEngineInstance = new VideoEngine();
  }
  return videoEngineInstance;
}
