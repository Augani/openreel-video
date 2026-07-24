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
import { graphicsEngine } from "../graphics/graphics-engine";
import { VideoEffectsEngine } from "./video-effects-engine";
import {
  ColorGradingEngine,
  type ClipColorGrading,
  type CpuGradingStages,
  type LUTData,
} from "./color-grading-engine";
import {
  isNeutralColorGrading,
  isNeutralColorWheels,
  isNeutralCurves,
  isNeutralHsl,
  isNeutralLut,
} from "./color-grading-defaults";
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
import { getSpeedEngine } from "./speed-engine";
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
import { getBackgroundRemovalEngine } from "../ai/background-removal-engine";
import {
  type GifFrameCache,
  createGifFrameCache,
  getGifFrameAtTime,
  isAnimatedGif,
} from "../media/gif-decoder";
import { getParticleEngine } from "../effects/particle-engine";
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

const DEFAULT_CACHE_CONFIG: FrameCacheConfig = {
  maxFrames: 100,
  maxSizeBytes: 500 * 1024 * 1024, // 500MB
  preloadAhead: 30, // ~1 second at 30fps
  preloadBehind: 10,
};

function adjustmentBlendOperation(mode: BlendMode): GlobalCompositeOperation {
  if (mode === "add" || mode === "linear-dodge") return "lighter";
  return mode as GlobalCompositeOperation;
}

export interface FrameRenderOptions {
  textClips?: TextClip[];
  shapeClips?: ShapeClip[];
  realtime?: boolean;
}

type RenderableClipColorGrading = Omit<ClipColorGrading, "lut"> & {
  lut?: LUTData;
};

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
  private mediabunny: typeof import("mediabunny") | null = null;
  private initialized = false;
  private frameCache: Map<string, CachedFrame> = new Map();
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
  private compositeBuffer: CompositeFrameBuffer | null = null;
  private useParallelDecoding = true;
  private videoElementCache: Map<
    string,
    { video: HTMLVideoElement; url: string }
  > = new Map();
  private compoundEngines = new Map<string, VideoEngine>();
  private renderingCompounds = new Set<string>();

  private gpuCompositor: GPUCompositor | null = null;
  private gpuRenderer: Renderer | null = null;
  private effectsEngine: VideoEffectsEngine | null = null;
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
  private lastExportTime: number = -1;
  private exportFrameRate: number = 30;
  exportMode: boolean = false;

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

    try {
      if (this.useParallelDecoding) {
        this.parallelDecoder = getParallelFrameDecoder();
        await this.parallelDecoder.initialize();
      }
    } catch (error) {
      console.warn(
        "[VideoEngine] Parallel decoder initialization failed:",
        error,
      );
      this.parallelDecoder = null;
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
    return this.parallelDecoder;
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
  ): Promise<ImageBitmap | null> {
    let cached = this.videoElementCache.get(mediaId);

    if (!cached) {
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

    const videoAspect = video.videoWidth / video.videoHeight;
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
    ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);

    return createImageBitmap(this.decodeCanvas);
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
  }

  /**
   * Invalidate every cache keyed by a specific media id, so that a media item
   * whose blob was swapped in place (e.g. an AI tool result replacing a clip's
   * source video) is re-decoded instead of serving stale frames.
   */
  invalidateMedia(mediaId: string): void {
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
    this.ensureInitialized();

    const { timeline, mediaLibrary, settings } = project;
    const width = targetWidth ?? settings.width;
    const height = targetHeight ?? settings.height;

    const scaleX = width / settings.width;
    const scaleY = height / settings.height;

    const activeTextClips = this.getActiveTextClips(timeline, time);
    const activeShapeClips = this.getActiveShapeClips(timeline, time);
    const activeSVGClips = this.getActiveSVGClips(timeline, time);
    const activeStickerClips = this.getActiveStickerClips(timeline, time);
    const activeSubtitles = this.getActiveSubtitles(timeline, time);


    const allRenderableTracks = timeline.tracks
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
    if (fillMode === "color" && timeline.layoutBackgroundColor) {
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
      .filter(
        ({ track }) => track.type === "video" || track.type === "image",
      )
      .flatMap(({ track }) =>
        track.clips
          .filter(
            (clip) =>
              time >= clip.startTime && time < clip.startTime + clip.duration,
          )
          .map((clip) => clip.id),
      )
      .sort()
      .join("|") || "canvas"}`;

    for (const { track } of allRenderableTracks) {
      if (track.type === "video" || track.type === "image") {
        // If a clip-to-clip transition is active in this track at `time`,
        // decode both participating clips, blend them, and draw the result.
        // The clip IDs that were rendered as part of the transition are
        // returned so the normal per-clip loop can skip them.
        const renderedTransitionClips = await this.renderActiveTransition(
          track,
          time,
          mediaLibrary,
          settings,
          width,
          height,
          ctx,
        );

        if (activeTextNeedsSubject && renderedTransitionClips.size > 0) {
          subjectFrame?.close();
          subjectFrame = await this.captureSubjectFrame(ctx, width, height);
        }

        const clips = this.getClipsAtTime(track, time);
        for (const clip of clips) {
          if (renderedTransitionClips.has(clip.id)) continue;
          const clipInfo = this.createClipRenderInfo(clip, time);
          const compoundId =
            typeof clip.metadata?.compoundClipId === "string"
              ? clip.metadata.compoundClipId
              : clip.mediaId.startsWith("compound:")
                ? clip.mediaId.slice("compound:".length)
                : null;
          if (compoundId) {
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
                scale: {
                  x: transform.scale.x * scaleX,
                  y: transform.scale.y * scaleY,
                },
              };
              let processed = compoundFrame;
              try {
                processed = await this.applyClipVideoProcessing(
                  clip.id,
                  compoundFrame,
                  compoundFrame,
                  clipInfo.effects ?? [],
                  clip.colorGrading,
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

          if (mediaItem.type === "image") {
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
                    clipLocalTime * 1000,
                  );
                  bitmap = gifCache.frames[frameIndex];
                  bitmapFromCache = true;
                } else {
                  bitmap = await createImageBitmap(mediaItem.blob);
                }
              } else {
                const cached = this.staticImageCache.get(mediaItem.id);
                if (cached) {
                  bitmap = cached;
                  bitmapFromCache = true;
                } else {
                  bitmap = await createImageBitmap(mediaItem.blob);
                  this.staticImageCache.set(mediaItem.id, bitmap);
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
              );
            }
          }

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
              scale: {
                x: finalTransform.scale.x * scaleX,
                y: finalTransform.scale.y * scaleY,
              },
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
              clip.colorGrading,
              width,
              height,
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
    }

    // Overlays composite on top of all clip tracks, matching the preview's layering.
    for (const shapeClip of activeShapeClips) {
      await this.renderShapeClipToCanvasCtx(ctx, shapeClip, time, width, height);
    }
    for (const svgClip of activeSVGClips) {
      await this.renderSVGClipToCanvasCtx(ctx, svgClip, time, width, height);
    }
    for (const stickerClip of activeStickerClips) {
      await this.renderStickerClipToCanvasCtx(ctx, stickerClip, time, width, height);
    }
    await this.renderMotionInstancesToCanvasCtx(
      ctx,
      project,
      time,
      width,
      height,
      scaleX,
      scaleY,
    );
    for (const textClip of activeTextClips) {
      await this.renderTextClipWithSubjectMask(
        ctx,
        textClip,
        time,
        width,
        height,
        subjectFrame,
        options.realtime ?? false,
        subjectStreamId,
      );
    }
    subjectFrame?.close();

    this.renderParticlesToContext(ctx, time, width, height);

    for (const subtitle of activeSubtitles) {
      this.renderSubtitleToCanvasCtx(ctx, subtitle, width, height);
    }

    await this.applyAdjustmentLayersToComposite(
      ctx,
      project.adjustmentLayers ?? [],
      time,
      width,
      height,
    );

    const imageBitmap = await createImageBitmap(canvas);

    return {
      image: imageBitmap,
      timestamp: time,
      width,
      height,
    };
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
      await engine.initialize();
      this.compoundEngines.set(compoundId, engine);
    }

    const nestedProject: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: compound.content.tracks,
        duration: compound.content.duration,
      },
      textClips: [],
      shapeClips: [],
      svgClips: [],
      stickerClips: [],
      adjustmentLayers: [],
      motionInstances: [],
      compoundClips: project.compoundClips?.filter(
        (item) => item.id !== compoundId,
      ),
    };

    this.renderingCompounds.add(compoundId);
    try {
      const frame = await engine.renderFrame(
        nestedProject,
        Math.max(0, Math.min(localTime, compound.content.duration)),
        width,
        height,
      );
      return frame.image;
    } finally {
      this.renderingCompounds.delete(compoundId);
    }
  }

  private async applyAdjustmentLayersToComposite(
    ctx: OffscreenCanvasRenderingContext2D,
    layers: NonNullable<Project["adjustmentLayers"]>,
    time: number,
    width: number,
    height: number,
  ): Promise<void> {
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
        source = await createImageBitmap(ctx.canvas, 0, 0, width, height);
        const effectsEngine = await this.ensureEffectsEngine(width, height);
        const result = await effectsEngine.applyEffects(source, effects);
        processed = result.image;
        if (!processed || processed.width <= 0 || processed.height <= 0) continue;
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
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    ctx.translate(
      centerX + transform.position.x,
      centerY + transform.position.y,
    );

    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale.x, transform.scale.y);

    if (transform.crop) {
      const sx = transform.crop.x * frame.width;
      const sy = transform.crop.y * frame.height;
      const sWidth = transform.crop.width * frame.width;
      const sHeight = transform.crop.height * frame.height;

      const croppedAspect = sWidth / sHeight;
      const canvasAspect = canvasWidth / canvasHeight;

      let cropDrawWidth: number;
      let cropDrawHeight: number;

      if (croppedAspect > canvasAspect) {
        cropDrawWidth = canvasWidth;
        cropDrawHeight = canvasWidth / croppedAspect;
      } else {
        cropDrawHeight = canvasHeight;
        cropDrawWidth = canvasHeight * croppedAspect;
      }

      const cropDrawX = -cropDrawWidth * transform.anchor.x;
      const cropDrawY = -cropDrawHeight * transform.anchor.y;

      ctx.drawImage(
        frame,
        sx,
        sy,
        sWidth,
        sHeight,
        cropDrawX,
        cropDrawY,
        cropDrawWidth,
        cropDrawHeight,
      );
    } else {
      // Treat a missing or "none" fit as "contain" so clips preserve their
      // aspect ratio on export/compositing, matching the preview.
      const fitMode =
        !transform.fitMode || transform.fitMode === "none"
          ? "contain"
          : transform.fitMode;
      let drawWidth = frame.width;
      let drawHeight = frame.height;

      const sourceAspect = frame.width / frame.height;
      const canvasAspect = canvasWidth / canvasHeight;
      if (fitMode === "stretch") {
        drawWidth = canvasWidth;
        drawHeight = canvasHeight;
      } else if (fitMode === "cover") {
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

      const drawX = -drawWidth * transform.anchor.x;
      const drawY = -drawHeight * transform.anchor.y;
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

    let maskedLayer = await createImageBitmap(layerCanvas);
    try {
      for (const mask of masks) {
        const result = await this.maskEngine.applyMask(maskedLayer, mask, time);
        maskedLayer.close();
        maskedLayer = result.image;
      }
      ctx.drawImage(maskedLayer, 0, 0, canvasWidth, canvasHeight);
    } finally {
      maskedLayer.close();
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
      .filter(
        ({ track }) =>
          (track.type === "video" || track.type === "image") && !track.hidden,
      )
      // Highest index renders behind, so the bottom-most layer is the backdrop.
      .sort((a, b) => b.idx - a.idx);

    let frame: ImageBitmap | null = null;
    let ownsFrame = false;
    for (const { track } of baseTracks) {
      const clips = this.getClipsAtTime(track, time);
      if (clips.length === 0) continue;
      const clip = clips[0];
      const clipInfo = this.createClipRenderInfo(clip, time);
      const mediaItem = mediaLibrary.items.find(
        (m: MediaItem) => m.id === clipInfo.mediaId,
      );
      if (!mediaItem?.blob) continue;

      if (mediaItem.type === "image") {
        const cached = this.staticImageCache.get(mediaItem.id);
        if (cached) {
          frame = cached;
        } else {
          try {
            frame = await createImageBitmap(mediaItem.blob);
            this.staticImageCache.set(mediaItem.id, frame);
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
      await this.renderTextClipToCanvasCtx(ctx, textClip, time, width, height);
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
    const textTracks = timeline.tracks.filter(
      (t) => t.type === "text" && !t.hidden,
    );
    const textTrackIds = new Set(textTracks.map((t) => t.id));

    return allTextClips.filter((clip) => {
      if (!textTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private getActiveShapeClips(timeline: Timeline, time: number): ShapeClip[] {
    const allShapeClips = graphicsEngine.getAllShapeClips();
    const graphicsTracks = timeline.tracks.filter(
      (t) => t.type === "graphics" && !t.hidden,
    );
    const graphicsTrackIds = new Set(graphicsTracks.map((t) => t.id));

    return allShapeClips.filter((clip) => {
      if (!graphicsTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private getActiveSVGClips(
    timeline: Timeline,
    time: number,
  ): import("../graphics/types").SVGClip[] {
    const allSVGClips = graphicsEngine.getAllSVGClips();
    const graphicsTracks = timeline.tracks.filter(
      (t) => t.type === "graphics" && !t.hidden,
    );
    const graphicsTrackIds = new Set(graphicsTracks.map((t) => t.id));

    return allSVGClips.filter((clip) => {
      if (!graphicsTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private getActiveStickerClips(
    timeline: Timeline,
    time: number,
  ): import("../graphics/types").StickerClip[] {
    const allStickerClips = graphicsEngine.getAllStickerClips();
    const graphicsTracks = timeline.tracks.filter(
      (t) => t.type === "graphics" && !t.hidden,
    );
    const graphicsTrackIds = new Set(graphicsTracks.map((t) => t.id));

    return allStickerClips.filter((clip) => {
      if (!graphicsTrackIds.has(clip.trackId)) return false;
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private async renderTextClipToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    textClip: TextClip,
    time: number,
    width: number,
    height: number,
  ): Promise<void> {
    const clipLocalTime = time - textClip.startTime;
    const result = titleEngine.renderText(
      textClip,
      width,
      height,
      clipLocalTime,
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      textClip.effects ?? [],
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
    const result = await graphicsEngine.renderGraphic(
      shapeClip,
      clipLocalTime,
      width,
      height,
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      shapeClip.effects ?? [],
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
    const result = await graphicsEngine.renderGraphic(
      svgClip,
      clipLocalTime,
      width,
      height,
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      svgClip.effects ?? [],
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
    const result = await graphicsEngine.renderGraphic(
      stickerClip,
      clipLocalTime,
      width,
      height,
    );

    await this.drawOverlayCanvasWithEffects(
      ctx,
      result.canvas,
      stickerClip.effects ?? [],
      width,
      height,
    );
  }

  private async drawOverlayCanvasWithEffects(
    ctx: OffscreenCanvasRenderingContext2D,
    source: OffscreenCanvas | HTMLCanvasElement,
    effects: readonly Effect[],
    width: number,
    height: number,
  ): Promise<void> {
    const enabledEffects = effects.filter((effect) => effect.enabled);
    if (enabledEffects.length === 0) {
      ctx.drawImage(source, 0, 0);
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
      ctx.drawImage(processedBitmap, 0, 0, width, height);
    } catch (error) {
      console.warn("[VideoEngine] Overlay effect render failed:", error);
      ctx.drawImage(source, 0, 0);
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
      return time >= sub.startTime && time < sub.endTime;
    });
  }

  private renderParticlesToContext(
    ctx: OffscreenCanvasRenderingContext2D,
    time: number,
    width: number,
    height: number,
  ): void {
    const particleEngine = getParticleEngine();
    particleEngine.setCanvasSize(width, height);

    const deltaTime = this.lastExportTime >= 0
      ? Math.max(0, time - this.lastExportTime)
      : 1 / this.exportFrameRate;
    this.lastExportTime = time;

    particleEngine.update(time, deltaTime);
    const particles = particleEngine.getParticles();

    if (particles.length === 0) return;

    ctx.save();

    for (const particle of particles) {
      if (!particle.active || particle.opacity <= 0) continue;

      ctx.globalAlpha = particle.opacity;
      ctx.fillStyle = particle.color;

      const screenY = height - particle.position.y;

      ctx.beginPath();
      ctx.arc(
        particle.position.x,
        screenY,
        particle.size / 2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();
  }

  resetExportState(): void {
    this.lastExportTime = -1;
    const particleEngine = getParticleEngine();
    particleEngine.reset();
  }

  private renderSubtitleToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    subtitle: Subtitle,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const { text, style } = subtitle;
    if (!text || text.trim().length === 0) return;

    ctx.save();

    const fontSize = style?.fontSize || 24;
    const fontFamily = style?.fontFamily || "Inter";
    const color = style?.color || "#ffffff";
    const backgroundColor = style?.backgroundColor || "rgba(0, 0, 0, 0.7)";
    const position = style?.position || "bottom";

    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = text.split("\n");
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;

    let baseY: number;
    if (position === "top") {
      baseY = fontSize * 2;
    } else if (position === "center") {
      baseY = canvasHeight / 2 - totalHeight / 2;
    } else {
      baseY = canvasHeight - fontSize * 2 - totalHeight;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;

      const y = baseY + i * lineHeight + lineHeight / 2;
      const metrics = ctx.measureText(line);
      const bgWidth = metrics.width + 20;
      const bgHeight = lineHeight;

      ctx.fillStyle = backgroundColor;
      ctx.fillRect(
        canvasWidth / 2 - bgWidth / 2,
        y - bgHeight / 2,
        bgWidth,
        bgHeight,
      );

      ctx.fillStyle = color;
      ctx.fillText(line, canvasWidth / 2, y);
    }

    ctx.restore();
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
  ): Promise<ImageBitmap | null> {
    if (!mediaItem.blob) return null;

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
            const clipLocalTime = time - clip.startTime;
            const idx = getGifFrameAtTime(gifCache, clipLocalTime * 1000);
            return gifCache.frames[idx];
          }
        }
        const cached = this.staticImageCache.get(mediaItem.id);
        if (cached) return cached;
        const bitmap = await createImageBitmap(mediaItem.blob);
        this.staticImageCache.set(mediaItem.id, bitmap);
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
    const localTime = time - clip.startTime;
    const sourceTime = Math.max(
      clip.inPoint,
      Math.min(
        clip.outPoint,
        clip.inPoint + speedEngine.getSourceTimeAtPlaybackTime(clip.id, localTime),
      ),
    );

    let bitmap = await this.decodeFrameWithMediaBunny(
      mediaItem.blob,
      sourceTime,
      width,
      height,
      mediaItem.id,
    );
    if (!bitmap) {
      bitmap = await this.decodeFrameWithVideoElement(
        mediaItem.id,
        mediaItem.blob,
        sourceTime,
        width,
        height,
      );
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
    if (!mediaA?.blob || (clipB && !mediaB?.blob)) return rendered;

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
      processedA = await this.applyClipVideoProcessing(
        clipA.id,
        bitmapA,
        bitmapA,
        this.getAnimatedEffects(clipA, time - clipA.startTime),
        clipA.colorGrading,
        width,
        height,
      );
      processedB =
        clipB && mediaB
          ? await this.applyClipVideoProcessing(
              clipB.id,
              bitmapB,
              bitmapB,
              this.getAnimatedEffects(clipB, time - clipB.startTime),
              clipB.colorGrading,
              width,
              height,
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

    const speedEngine = getSpeedEngine();
    const sourceTime =
      clip.inPoint +
      speedEngine.getSourceTimeAtPlaybackTime(clip.id, clipLocalTime);

    const animatedTransform = this.getAnimatedTransform(clip, clipLocalTime);
    const animatedEffects = this.getAnimatedEffects(clip, clipLocalTime);

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

  private async applyClipVideoProcessing(
    clipId: string,
    image: ImageBitmap,
    sourceImage: ImageBitmap,
    effects: Effect[],
    colorGrading: ClipColorGrading | undefined,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    let processed = await this.applyClipEffects(
      clipId,
      image,
      sourceImage,
      effects,
      width,
      height,
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
  ): Promise<ImageBitmap> {
    const enabledEffects = effects.filter((effect) => effect.enabled);
    if (enabledEffects.length === 0) {
      return image;
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

    if (
      renderableColorGrading.colorWheels &&
      !isNeutralColorWheels(renderableColorGrading.colorWheels)
    ) {
      try {
        const gradingEngine = this.ensureColorGradingEngine(width, height);
        gradingEngine.initialize();
        const result = await gradingEngine.applyColorWheels(
          processed,
          renderableColorGrading.colorWheels,
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

    const cpuStages = this.buildCpuGradingStages(renderableColorGrading);
    if (cpuStages) {
      try {
        const gradingEngine = this.ensureColorGradingEngine(width, height);
        const result = await gradingEngine.applyCpuGrading(
          processed,
          cpuStages,
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

    const whiteBalanceEffects =
      this.buildWhiteBalanceEffects(renderableColorGrading);
    if (whiteBalanceEffects.length > 0) {
      try {
        const effectsEngine = await this.ensureEffectsEngine(width, height);
        const result = await effectsEngine.applyEffects(
          processed,
          whiteBalanceEffects,
        );
        processed = this.adoptProcessedBitmap(
          processed,
          sourceImage,
          result.image,
        );
      } catch (error) {
        console.warn(
          `Failed to apply white balance to clip ${clipId}:`,
          error,
        );
        this.effectsEngine?.dispose();
        this.effectsEngine = null;
      }
    }

    return processed;
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

  private buildCpuGradingStages(
    colorGrading: RenderableClipColorGrading,
  ): CpuGradingStages | null {
    const stages: CpuGradingStages = {};
    let hasStage = false;

    if (colorGrading.curves && !isNeutralCurves(colorGrading.curves)) {
      stages.curves = colorGrading.curves;
      hasStage = true;
    }
    if (colorGrading.lut && !isNeutralLut(colorGrading.lut)) {
      stages.lut = colorGrading.lut;
      hasStage = true;
    }
    if (colorGrading.hsl && !isNeutralHsl(colorGrading.hsl)) {
      stages.hsl = colorGrading.hsl;
      hasStage = true;
    }

    return hasStage ? stages : null;
  }

  private normalizeClipColorGrading(
    colorGrading: ClipColorGrading,
  ): RenderableClipColorGrading {
    const lut = this.normalizeClipLut(colorGrading.lut);
    return {
      ...colorGrading,
      lut,
    };
  }

  private normalizeClipLut(
    lut: ClipColorGrading["lut"] | undefined,
  ): LUTData | undefined {
    if (!lut) {
      return undefined;
    }

    return {
      data:
        lut.data instanceof Uint8Array
          ? lut.data
          : new Uint8Array(lut.data),
      size: lut.size,
      intensity: lut.intensity,
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
    const keyframes = clip.keyframes || [];
    const baseEffects = clip.effects || [];

    if (keyframes.length === 0) {
      return baseEffects;
    }

    // Each entry maps a keyframe property → effect type and the actual
    // param key the renderer reads (see EFFECT_DEFINITIONS in types/effects.ts).
    const effectPropertyMap: Array<{
      keyframeProp: string;
      effectType: string;
      paramKey: string;
    }> = [
      { keyframeProp: "effect.brightness", effectType: "brightness", paramKey: "value" },
      { keyframeProp: "effect.contrast", effectType: "contrast", paramKey: "value" },
      { keyframeProp: "effect.saturation", effectType: "saturation", paramKey: "value" },
      { keyframeProp: "effect.blur", effectType: "blur", paramKey: "radius" },
    ];

    const animatedByType = new Map<string, { paramKey: string; value: number }>();

    for (const { keyframeProp, effectType, paramKey } of effectPropertyMap) {
      const effectKfs = keyframeEngine.getKeyframesForProperty(
        keyframes,
        keyframeProp,
      );
      if (effectKfs.length === 0) continue;
      const result = keyframeEngine.getValueAtTime(effectKfs, localTime);
      if (typeof result.value === "number") {
        animatedByType.set(effectType, { paramKey, value: result.value });
      }
    }

    if (animatedByType.size === 0) {
      return baseEffects;
    }

    // Patch existing effects with interpolated values.
    const seen = new Set<string>();
    const patched = baseEffects.map((effect) => {
      const animated = animatedByType.get(effect.type);
      if (!animated) return effect;
      seen.add(effect.type);
      return {
        ...effect,
        params: { ...effect.params, [animated.paramKey]: animated.value },
      };
    });

    // Synthesize effects that have keyframes but aren't on the clip yet,
    // so users can animate brightness/contrast/etc. without first adding the
    // effect manually.
    for (const [effectType, { paramKey, value }] of animatedByType) {
      if (seen.has(effectType)) continue;
      patched.push({
        id: `kf-synth-${clip.id}-${effectType}`,
        type: effectType as Effect["type"],
        enabled: true,
        params: { [paramKey]: value },
      } as Effect);
    }

    return patched;
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
        return await createImageBitmap(mediaItem.blob);
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

      // VideoSample wraps a VideoFrame - convert to ImageBitmap for rendering
      let imageBitmap: ImageBitmap;
      try {
        const hasToVideoFrame =
          typeof (sample as { toVideoFrame?: () => VideoFrame })
            .toVideoFrame === "function";
        const videoFrame = hasToVideoFrame
          ? (sample as { toVideoFrame: () => VideoFrame }).toVideoFrame()
          : sample;
        imageBitmap = await createImageBitmap(videoFrame as VideoFrame);
        if (hasToVideoFrame && videoFrame !== sample) {
          (videoFrame as VideoFrame).close();
        }
      } catch {
        const canvas = new OffscreenCanvas(
          sample.displayWidth,
          sample.displayHeight,
        );
        const ctx = canvas.getContext("2d");
        const hasDraw =
          typeof (
            sample as {
              draw?: (
                ctx: OffscreenCanvasRenderingContext2D,
                x: number,
                y: number,
              ) => void;
            }
          ).draw === "function";
        if (ctx && hasDraw) {
          (
            sample as {
              draw: (
                ctx: OffscreenCanvasRenderingContext2D,
                x: number,
                y: number,
              ) => void;
            }
          ).draw(ctx, 0, 0);
          imageBitmap = await createImageBitmap(canvas);
        } else {
          sample.close();
          return null;
        }
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
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    ctx.translate(
      centerX + transform.position.x,
      centerY + transform.position.y,
    );

    ctx.rotate((transform.rotation * Math.PI) / 180);

    ctx.scale(transform.scale.x, transform.scale.y);

    if (transform.crop) {
      const sx = transform.crop.x * frame.width;
      const sy = transform.crop.y * frame.height;
      const sWidth = transform.crop.width * frame.width;
      const sHeight = transform.crop.height * frame.height;

      const croppedAspect = sWidth / sHeight;
      const canvasAspect = canvasWidth / canvasHeight;

      let cropDrawWidth: number;
      let cropDrawHeight: number;

      if (croppedAspect > canvasAspect) {
        cropDrawWidth = canvasWidth;
        cropDrawHeight = canvasWidth / croppedAspect;
      } else {
        cropDrawHeight = canvasHeight;
        cropDrawWidth = canvasHeight * croppedAspect;
      }

      const cropDrawX = -cropDrawWidth * transform.anchor.x;
      const cropDrawY = -cropDrawHeight * transform.anchor.y;

      ctx.drawImage(
        frame,
        sx,
        sy,
        sWidth,
        sHeight,
        cropDrawX,
        cropDrawY,
        cropDrawWidth,
        cropDrawHeight,
      );
    } else {
      // Treat a missing or "none" fit as "contain" so clips preserve their
      // aspect ratio on export/compositing, matching the preview.
      const fitMode =
        !transform.fitMode || transform.fitMode === "none"
          ? "contain"
          : transform.fitMode;
      let drawWidth = frame.width;
      let drawHeight = frame.height;

      const sourceAspect = frame.width / frame.height;
      const canvasAspect = canvasWidth / canvasHeight;
      if (fitMode === "stretch") {
        drawWidth = canvasWidth;
        drawHeight = canvasHeight;
      } else if (fitMode === "cover") {
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

      const drawX = -drawWidth * transform.anchor.x;
      const drawY = -drawHeight * transform.anchor.y;
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

  private getCanvasBlendMode(blendMode: BlendMode): GlobalCompositeOperation {
    const modeMap: Record<BlendMode, GlobalCompositeOperation> = {
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

        // VideoSample is a VideoFrame which can be used with createImageBitmap
        const imageBitmap = await createImageBitmap(
          sample as unknown as VideoFrame,
        );
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

        // VideoSample is a VideoFrame which can be used with createImageBitmap
        const imageBitmap = await createImageBitmap(
          sample as unknown as VideoFrame,
        );
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

/**
 * Gets the VideoEngine singleton and initializes it.
 * Use this for a single-call initialization pattern.
 *
 * @returns Promise resolving to initialized VideoEngine
 */
export async function initializeVideoEngine(): Promise<VideoEngine> {
  const engine = getVideoEngine();
  await engine.initialize();
  return engine;
}
