import type {
  Timeline,
  Track,
  Clip,
  Effect,
  Transform,
  Subtitle,
} from "../types/timeline";
import type { MediaItem, Project } from "../types/project";
import type { TextClip } from "../text/types";
import type { ShapeClip, EmphasisAnimation } from "../graphics/types";
import { titleEngine } from "../text/title-engine";
import { graphicsEngine } from "../graphics/graphics-engine";
import { VideoEffectsEngine } from "./video-effects-engine";
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
import {
  type GifFrameCache,
  createGifFrameCache,
  getGifFrameAtTime,
  isAnimatedGif,
} from "../media/gif-decoder";
import { getParticleEngine } from "../effects/particle-engine";

const DEFAULT_CACHE_CONFIG: FrameCacheConfig = {
  maxFrames: 100,
  maxSizeBytes: 500 * 1024 * 1024, // 500MB
  preloadAhead: 30, // ~1 second at 30fps
  preloadBehind: 10,
};

export interface FrameRenderOptions {
  textClips?: TextClip[];
  shapeClips?: ShapeClip[];
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
  private mediabunny: typeof import("mediabunny") | null = null;
  private initialized = false;
  private frameCache: Map<string, CachedFrame> = new Map();
  private gifFrameCache: Map<string, GifFrameCache> = new Map();
  private cacheConfig: FrameCacheConfig;
  private cacheStats = { hits: 0, misses: 0 };
  private preloadQueue: PreloadRequest[] = [];
  private isPreloading = false;
  private compositeCanvas: OffscreenCanvas | null = null;
  private compositeCtx: OffscreenCanvasRenderingContext2D | null = null;

  private parallelDecoder: ParallelFrameDecoder | null = null;
  private compositeBuffer: CompositeFrameBuffer | null = null;
  private useParallelDecoding = true;
  private videoElementCache: Map<
    string,
    { video: HTMLVideoElement; url: string }
  > = new Map();

  private gpuCompositor: GPUCompositor | null = null;
  private gpuRenderer: Renderer | null = null;
  private effectsEngine: VideoEffectsEngine | null = null;
  private lastExportTime: number = -1;
  private exportFrameRate: number = 30;

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

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

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

    return createImageBitmap(canvas);
  }

  /**
   * Clear the video element cache, releasing resources.
   */
  clearVideoElementCache(): void {
    for (const [, cached] of this.videoElementCache) {
      cached.video.src = "";
      URL.revokeObjectURL(cached.url);
    }
    this.videoElementCache.clear();
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

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    for (const { track } of allRenderableTracks) {
      if (track.type === "video" || track.type === "image") {
        const clips = this.getClipsAtTime(track, time);
        for (const clip of clips) {
          const clipInfo = this.createClipRenderInfo(clip, time);
          const mediaItem = mediaLibrary.items.find(
            (m) => m.id === clipInfo.mediaId,
          );
          if (!mediaItem?.blob) continue;

          let bitmap: ImageBitmap | null = null;

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
                } else {
                  bitmap = await createImageBitmap(mediaItem.blob);
                }
              } else {
                bitmap = await createImageBitmap(mediaItem.blob);
              }
            } catch (error) {
              console.warn(
                `Failed to create ImageBitmap for image ${mediaItem.id}:`,
                error,
              );
            }
          } else {
            bitmap = await this.decodeFrameWithMediaBunny(
              mediaItem.blob,
              clipInfo.sourceTime,
              settings.width,
              settings.height,
              clipInfo.mediaId,
            );
            if (!bitmap) {
              bitmap = await this.decodeFrameWithVideoElement(
                mediaItem.id,
                mediaItem.blob,
                clipInfo.sourceTime,
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
            if (clip.effects && clip.effects.length > 0) {
              try {
                if (!this.effectsEngine) {
                  this.effectsEngine = new VideoEffectsEngine({
                    width,
                    height,
                    useGPU: true,
                    preferWebGPU: false,
                  });
                  const initPromise = this.effectsEngine.initialize();
                  const timeoutPromise = new Promise<boolean>((_, reject) =>
                    setTimeout(() => reject(new Error("Effects init timeout")), 5000)
                  );
                  await Promise.race([initPromise, timeoutPromise]);
                }
                const effectsResult = await this.effectsEngine.applyEffects(
                  bitmap,
                  clip.effects,
                );
                processedBitmap = effectsResult.image;
              } catch (error) {
                console.warn(
                  `Failed to apply effects to clip ${clip.id}:`,
                  error,
                );
                this.effectsEngine = null;
              }
            }

            this.drawFrameToContext(
              ctx,
              processedBitmap,
              scaledTransform,
              finalTransform.opacity,
              width,
              height,
            );

            if (processedBitmap !== bitmap) {
              processedBitmap.close();
            }
            bitmap.close();
          }
        }
      } else if (track.type === "graphics") {
        const trackShapeClips = activeShapeClips.filter(
          (sc) => sc.trackId === track.id,
        );
        for (const shapeClip of trackShapeClips) {
          await this.renderShapeClipToCanvasCtx(
            ctx,
            shapeClip,
            time,
            width,
            height,
          );
        }

        const trackSVGClips = activeSVGClips.filter(
          (sc) => sc.trackId === track.id,
        );
        for (const svgClip of trackSVGClips) {
          await this.renderSVGClipToCanvasCtx(
            ctx,
            svgClip,
            time,
            width,
            height,
          );
        }

        const trackStickerClips = activeStickerClips.filter(
          (sc) => sc.trackId === track.id,
        );
        for (const stickerClip of trackStickerClips) {
          await this.renderStickerClipToCanvasCtx(
            ctx,
            stickerClip,
            time,
            width,
            height,
          );
        }
      } else if (track.type === "text") {
        const trackTextClips = activeTextClips.filter(
          (tc) => tc.trackId === track.id,
        );
        for (const textClip of trackTextClips) {
          this.renderTextClipToCanvasCtx(ctx, textClip, time, width, height);
        }
      }
    }

    this.renderParticlesToContext(ctx, time, width, height);

    for (const subtitle of activeSubtitles) {
      this.renderSubtitleToCanvasCtx(ctx, subtitle, width, height);
    }

    const imageBitmap = await createImageBitmap(canvas);

    if (this.compositeBuffer) {
      const frameNumber = Math.floor(time * 30);
      this.compositeBuffer.writeCompositedFrame(
        await createImageBitmap(imageBitmap),
        time,
        frameNumber,
      );
    }

    return {
      image: imageBitmap,
      timestamp: time,
      width,
      height,
    };
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
      const drawX = -frame.width * transform.anchor.x;
      const drawY = -frame.height * transform.anchor.y;
      ctx.drawImage(frame, drawX, drawY);
    }

    ctx.restore();
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

  private renderTextClipToCanvasCtx(
    ctx: OffscreenCanvasRenderingContext2D,
    textClip: TextClip,
    time: number,
    width: number,
    height: number,
  ): void {
    const clipLocalTime = time - textClip.startTime;
    const result = titleEngine.renderText(
      textClip,
      width,
      height,
      clipLocalTime,
    );

    ctx.drawImage(result.canvas, 0, 0);
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

    if (result.canvas instanceof OffscreenCanvas) {
      ctx.drawImage(result.canvas, 0, 0);
    } else {
      ctx.drawImage(result.canvas as HTMLCanvasElement, 0, 0);
    }
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

    if (result.canvas instanceof OffscreenCanvas) {
      ctx.drawImage(result.canvas, 0, 0);
    } else {
      ctx.drawImage(result.canvas as HTMLCanvasElement, 0, 0);
    }
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

    if (result.canvas instanceof OffscreenCanvas) {
      ctx.drawImage(result.canvas, 0, 0);
    } else {
      ctx.drawImage(result.canvas as HTMLCanvasElement, 0, 0);
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

  private getAnimatedEffects(clip: Clip, localTime: number): Effect[] {
    const keyframes = clip.keyframes || [];
    const baseEffects = clip.effects || [];

    if (keyframes.length === 0) {
      return baseEffects;
    }

    const effectPropertyMap: Record<string, string> = {
      "effect.brightness": "brightness",
      "effect.contrast": "contrast",
      "effect.saturation": "saturation",
      "effect.blur": "blur",
    };

    const animatedParams: Record<string, number> = {};

    for (const [keyframeProp, paramName] of Object.entries(effectPropertyMap)) {
      const effectKfs = keyframeEngine.getKeyframesForProperty(
        keyframes,
        keyframeProp,
      );
      if (effectKfs.length > 0) {
        const result = keyframeEngine.getValueAtTime(effectKfs, localTime);
        if (typeof result.value === "number") {
          animatedParams[paramName] = result.value;
        }
      }
    }

    if (Object.keys(animatedParams).length === 0) {
      return baseEffects;
    }

    return baseEffects.map((effect) => {
      const updatedParams = { ...effect.params };
      for (const [paramName, value] of Object.entries(animatedParams)) {
        if (effect.type === paramName || paramName in updatedParams) {
          updatedParams[paramName] = value;
        }
      }
      return { ...effect, params: updatedParams };
    });
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
      const drawX = -frame.width * transform.anchor.x;
      const drawY = -frame.height * transform.anchor.y;
      ctx.drawImage(frame, drawX, drawY);
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
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.preloadQueue = [];
    this.initialized = false;
    this.mediabunny = null;
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
