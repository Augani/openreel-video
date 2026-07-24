import type {
  VideoEngine,
  RenderedFrame,
  Effect,
  Transition,
  Clip,
  Track,
} from "@openreel/core";
import {
  VideoEffectsEngine,
  getVideoEffectsEngine,
  TransitionEngine,
  createTransitionEngine,
} from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";

export interface ColorAdjustments {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  shadows?: number;
  midtones?: number;
  highlights?: number;
}

export interface RenderStats {
  lastRenderTime: number;
  avgRenderTime: number;
  framesRendered: number;
  renderErrors: number;
}

export interface FrameCacheConfig {
  maxFrames: number;
  maxSizeBytes: number;
  preloadAhead: number;
  preloadBehind: number;
}

export interface CachedFrameEntry {
  frame: RenderedFrame;
  key: string;
  sizeBytes: number;
  lastAccessed: number;
}

export interface FrameCacheStats {
  entries: number;
  sizeBytes: number;
  hitRate: number;
  maxSizeBytes: number;
  hits: number;
  misses: number;
}

const DEFAULT_CACHE_CONFIG: FrameCacheConfig = {
  maxFrames: 100,
  maxSizeBytes: 500 * 1024 * 1024,
  preloadAhead: 30,
  preloadBehind: 10,
};

export class RenderBridge {
  private videoEngine: VideoEngine | null = null;
  private videoEffectsEngine: VideoEffectsEngine | null = null;
  private transitionEngine: TransitionEngine | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private initialized = false;
  private renderStats: RenderStats = {
    lastRenderTime: 0,
    avgRenderTime: 0,
    framesRendered: 0,
    renderErrors: 0,
  };
  private renderTimes: number[] = [];
  private maxRenderTimeSamples = 60;
  private pendingRender: number | null = null;
  private lastRenderedTime = -1;
  // Debounce threshold for scrubbing (~60fps)
  private readonly DEBOUNCE_THRESHOLD = 0.001;

  // Frame cache for LRU eviction
  private frameCache: Map<string, CachedFrameEntry> = new Map();
  private cacheConfig: FrameCacheConfig;
  private cacheStats = { hits: 0, misses: 0 };
  private totalCacheSizeBytes = 0;
  private isPreloading = false;
  private preloadAbortController: AbortController | null = null;

  constructor(config: Partial<FrameCacheConfig> = {}) {
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Initialize the render bridge
   * Connects to the VideoEngine from the engine store
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const engineState = useEngineStore.getState();

    if (!engineState.initialized) {
      throw new Error("EngineStore must be initialized before RenderBridge");
    }

    this.videoEngine = engineState.videoEngine;

    if (!this.videoEngine) {
      throw new Error("VideoEngine not available in EngineStore");
    }

    // Initialize VideoEffectsEngine for effect processing
    const project = useProjectStore.getState().project;
    const { width, height } = project.settings;
    this.videoEffectsEngine = getVideoEffectsEngine(width, height);

    // Initialize TransitionEngine for transition rendering
    this.transitionEngine = createTransitionEngine(width, height);

    this.initialized = true;
  }

  /**
   * Set the canvas element for rendering
   *
   * @param canvas - The HTML canvas element to render to
   */
  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    if (canvas) {
      this.ctx = canvas.getContext("2d");
    } else {
      this.ctx = null;
    }
  }

  /**
   * Get the current canvas element
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /**
   * Render a frame at the specified time
   *
   * - Renders composited frame within 100ms
   * - Composites tracks in correct layer order
   * - Applies transforms to clips
   *
   * Feature: core-ui-integration
   * Property 2: Frame Rendering Consistency
   * Property 3: Track Compositing Order
   * Property 4: Transform Application
   *
   * @param time - Time in seconds to render
   * @returns The rendered frame or null if rendering failed
   */
  async renderFrame(time: number): Promise<RenderedFrame | null> {
    if (!this.initialized || !this.videoEngine) {
      return null;
    }

    const startTime = performance.now();

    try {
      const project = useProjectStore.getState().project;

      // Render the frame using VideoEngine
      const frame = await this.videoEngine.renderFrame(
        project,
        time,
        undefined,
        undefined,
        { realtime: true },
      );

      // Draw to canvas if available
      if (this.canvas && this.ctx && frame) {
        this.drawFrameToCanvas(frame);
      }

      // Update render statistics
      const renderTime = performance.now() - startTime;
      this.updateRenderStats(renderTime);

      // Update engine store with current frame
      useEngineStore.setState({ currentFrame: frame });

      this.lastRenderedTime = time;

      return frame;
    } catch (error) {
      this.renderStats.renderErrors++;
      console.error("RenderBridge: Frame render error:", error);
      return null;
    }
  }

  /**
   * Render frame with debouncing for smooth scrubbing
   *
   * Display frames with debounced rendering for smooth performance
   *
   * @param time - Time in seconds to render
   */
  renderFrameDebounced(time: number): void {
    // Cancel any pending render
    if (this.pendingRender !== null) {
      cancelAnimationFrame(this.pendingRender);
    }

    // Skip if we just rendered this time
    if (Math.abs(time - this.lastRenderedTime) < this.DEBOUNCE_THRESHOLD) {
      return;
    }

    this.pendingRender = requestAnimationFrame(() => {
      this.pendingRender = null;
      this.renderFrame(time).catch((error) => {
        console.error("[RenderBridge] Frame render failed:", error);
      });
    });
  }

  /**
   * Render the current frame at the playhead position
   */
  async renderCurrentFrame(): Promise<RenderedFrame | null> {
    const playheadPosition = useTimelineStore.getState().playheadPosition;
    return this.renderFrame(playheadPosition);
  }

  // ============================================
  // Effect Application Methods
  // ============================================

  /**
   * Apply effects to an image in the defined order
   *
   * - 4.1: Render video effects in the preview
   * - 4.3: Apply multiple effects in the defined order
   * - 4.4: Exclude disabled effects from rendering
   *
   * **Feature: core-ui-integration, Property 14: Effect Application**
   * **Feature: core-ui-integration, Property 15: Effect Order Preservation**
   * **Feature: core-ui-integration, Property 16: Disabled Effect Exclusion**
   *
   * @param image - Source image to apply effects to
   * @param effects - Array of effects to apply in order
   * @returns Processed image with effects applied
   */
  async applyEffects(
    image: ImageBitmap,
    effects: Effect[],
  ): Promise<ImageBitmap> {
    if (!this.videoEffectsEngine) {
      // Return original image if effects engine not available
      return image;
    }

    // Filter to only enabled effects (Requirement 4.4)
    const enabledEffects = this.filterEnabledEffects(effects);

    // If no enabled effects, return original image
    if (enabledEffects.length === 0) {
      return image;
    }

    // Apply effects in order
    const result = await this.videoEffectsEngine.applyEffects(
      image,
      enabledEffects,
    );

    return result.image;
  }

  /**
   * Filter effects to only include enabled ones
   *
   * Exclude disabled effects from rendering
   *
   * **Feature: core-ui-integration, Property 16: Disabled Effect Exclusion**
   *
   * @param effects - Array of effects to filter
   * @returns Array of only enabled effects
   */
  filterEnabledEffects(effects: Effect[]): Effect[] {
    return effects.filter((effect) => effect.enabled);
  }

  /**
   * Get the order in which effects will be applied
   *
   * Apply multiple effects in the defined order
   *
   * **Feature: core-ui-integration, Property 15: Effect Order Preservation**
   *
   * @param effects - Array of effects
   * @returns Array of effect IDs in application order
   */
  getEffectApplicationOrder(effects: Effect[]): string[] {
    return this.filterEnabledEffects(effects).map((effect) => effect.id);
  }

  /**
   * Apply effects to a clip's frame
   *
   *
   * @param frame - The rendered frame to apply effects to
   * @param clipId - The clip ID to get effects from
   * @returns Frame with effects applied
   */
  async applyClipEffects(
    frame: ImageBitmap,
    clipId: string,
  ): Promise<ImageBitmap> {
    const project = useProjectStore.getState().project;

    // Find the clip in the timeline
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip && clip.effects && clip.effects.length > 0) {
        return this.applyEffects(frame, clip.effects);
      }
    }

    // No effects found, return original frame
    return frame;
  }

  /**
   * Check if effects engine is available
   */
  hasEffectsEngine(): boolean {
    return this.videoEffectsEngine !== null;
  }

  /**
   * Get the video effects engine instance
   */
  getVideoEffectsEngine(): VideoEffectsEngine | null {
    return this.videoEffectsEngine;
  }

  // ============================================
  // Transition Rendering Methods
  // ============================================

  /**
   * Find a transition at the given time on a track
   *
   * - 8.1: Render transition effect during playback when transition exists between clips
   * - 8.2: Composite both clips with transition applied when playhead is within transition
   *
   * **Feature: core-ui-integration, Property 24: Transition Compositing**
   *
   * @param track - The track to search for transitions
   * @param time - The current time position
   * @returns Transition info if time is within a transition, null otherwise
   */
  findTransitionAtTime(
    track: Track,
    time: number,
  ): {
    transition: Transition;
    clipA: Clip;
    clipB?: Clip;
    progress: number;
  } | null {
    if (!this.transitionEngine) {
      return null;
    }

    for (const transition of track.transitions) {
      // Find the clips involved in this transition
      const clipA = track.clips.find((c) => c.id === transition.clipAId);
      const clipB = transition.clipBId
        ? track.clips.find((c) => c.id === transition.clipBId)
        : undefined;

      if (!clipA || (transition.clipBId && !clipB)) {
        continue;
      }

      // Check if the current time is within this transition
      if (this.transitionEngine.isTimeInTransition(transition, clipA, time)) {
        const progress = this.transitionEngine.calculateTransitionProgress(
          transition,
          clipA,
          time,
        );
        return { transition, clipA, clipB, progress };
      }
    }

    return null;
  }

  /**
   * Render a transition between two clips
   *
   * - 8.1: Render transition effect during playback
   * - 8.2: Composite both clips with transition applied
   * - 8.3: Update preview to reflect transition parameter changes
   *
   * **Feature: core-ui-integration, Property 24: Transition Compositing**
   *
   * @param outgoingFrame - The frame from the outgoing clip (clip A)
   * @param incomingFrame - The frame from the incoming clip (clip B)
   * @param transition - The transition configuration
   * @param progress - Progress through the transition (0 to 1)
   * @returns The blended frame or null if rendering failed
   */
  async renderTransition(
    outgoingFrame: ImageBitmap,
    incomingFrame: ImageBitmap,
    transition: Transition,
    progress: number,
  ): Promise<ImageBitmap | null> {
    if (!this.transitionEngine) {
      return null;
    }

    try {
      const result = await this.transitionEngine.renderTransition(
        outgoingFrame,
        incomingFrame,
        transition,
        progress,
      );
      return result.frame;
    } catch (error) {
      console.error("RenderBridge: Transition render error:", error);
      return null;
    }
  }

  /**
   * Check if a time position is within any transition on a track
   *
   *
   * @param track - The track to check
   * @param time - The time position to check
   * @returns True if time is within a transition
   */
  isTimeInTransition(track: Track, time: number): boolean {
    return this.findTransitionAtTime(track, time) !== null;
  }

  /**
   * Get the transition engine instance
   */
  getTransitionEngine(): TransitionEngine | null {
    return this.transitionEngine;
  }

  /**
   * Check if transition engine is available
   */
  hasTransitionEngine(): boolean {
    return this.transitionEngine !== null;
  }

  /**
   * Calculate the time within a clip for transition rendering
   *
   * @param clip - The clip
   * @param time - The current timeline time
   * @returns The time within the clip's media
   */
  getClipLocalTime(clip: Clip, time: number): number {
    const clipLocalTime = time - clip.startTime;
    return clip.inPoint + clipLocalTime;
  }

  /**
   * Draw a rendered frame to the canvas
   *
   * @param frame - The rendered frame to draw
   */
  private drawFrameToCanvas(frame: RenderedFrame): void {
    if (!this.canvas || !this.ctx) return;

    const { width, height } = this.canvas;

    // Clear the canvas
    this.ctx.clearRect(0, 0, width, height);

    // Calculate scaling to fit frame in canvas while maintaining aspect ratio
    const frameAspect = frame.width / frame.height;
    const canvasAspect = width / height;

    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (frameAspect > canvasAspect) {
      // Frame is wider than canvas
      drawWidth = width;
      drawHeight = width / frameAspect;
      drawX = 0;
      drawY = (height - drawHeight) / 2;
    } else {
      // Frame is taller than canvas
      drawHeight = height;
      drawWidth = height * frameAspect;
      drawX = (width - drawWidth) / 2;
      drawY = 0;
    }

    // Draw the frame
    this.ctx.drawImage(frame.image, drawX, drawY, drawWidth, drawHeight);
  }

  /**
   * Update render statistics
   *
   * @param renderTime - Time taken to render the frame in milliseconds
   */
  private updateRenderStats(renderTime: number): void {
    this.renderStats.lastRenderTime = renderTime;
    this.renderStats.framesRendered++;

    // Keep a rolling window of render times for averaging
    this.renderTimes.push(renderTime);
    if (this.renderTimes.length > this.maxRenderTimeSamples) {
      this.renderTimes.shift();
    }

    // Calculate average
    const sum = this.renderTimes.reduce((a, b) => a + b, 0);
    this.renderStats.avgRenderTime = sum / this.renderTimes.length;
  }

  /**
   * Get render statistics
   */
  getRenderStats(): RenderStats {
    return { ...this.renderStats };
  }

  /**
   * Clear the canvas
   */
  clearCanvas(): void {
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Resize the canvas to match project settings
   */
  resizeCanvas(): void {
    if (!this.canvas) return;

    const project = useProjectStore.getState().project;
    const { width, height } = project.settings;

    // Only resize if dimensions changed
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================
  // Frame Cache Methods
  // ============================================

  /**
   * Generate a cache key for a frame
   *
   * @param time - Time in seconds
   * @param frameRate - Frame rate for rounding (default 30fps)
   * @returns Cache key string
   */
  static getCacheKey(time: number, frameRate: number = 30): string {
    // Round time to nearest frame
    const frameTime = Math.round(time * frameRate) / frameRate;
    return `frame:${frameTime.toFixed(4)}`;
  }

  /**
   * Get a frame from the cache
   *
   * Return cached frames without re-decoding
   *
   * **Feature: core-ui-integration, Property 23: Cache Hit Returns Cached Frame**
   *
   * @param key - Cache key
   * @returns Cached frame or null if not found
   */
  getCachedFrame(key: string): RenderedFrame | null {
    const entry = this.frameCache.get(key);
    if (entry) {
      // Update last accessed time for LRU
      entry.lastAccessed = Date.now();
      this.cacheStats.hits++;
      return entry.frame;
    }
    this.cacheStats.misses++;
    return null;
  }

  /**
   * Check if a frame is in the cache
   *
   * @param key - Cache key
   * @returns True if frame is cached
   */
  hasFrame(key: string): boolean {
    return this.frameCache.has(key);
  }

  /**
   * Add a frame to the cache
   *
   * Store frames and evict LRU when needed
   *
   * **Feature: core-ui-integration, Property 22: Frame Cache LRU Eviction**
   *
   * @param key - Cache key
   * @param frame - Rendered frame to cache
   */
  cacheFrame(key: string, frame: RenderedFrame): void {
    // Estimate frame size (4 bytes per pixel for RGBA)
    const sizeBytes = frame.width * frame.height * 4;

    // Evict frames if needed before adding
    this.evictIfNeeded(sizeBytes);

    // Don't cache if single frame exceeds max size
    if (sizeBytes > this.cacheConfig.maxSizeBytes) {
      console.warn(
        "RenderBridge: Frame too large to cache:",
        sizeBytes,
        "bytes",
      );
      return;
    }

    // If key already exists, remove old entry first
    if (this.frameCache.has(key)) {
      const oldEntry = this.frameCache.get(key)!;
      this.totalCacheSizeBytes -= oldEntry.sizeBytes;
    }

    this.frameCache.set(key, {
      frame,
      key,
      sizeBytes,
      lastAccessed: Date.now(),
    });

    this.totalCacheSizeBytes += sizeBytes;
  }

  /**
   * Remove a frame from the cache
   *
   * @param key - Cache key
   * @returns True if frame was removed
   */
  removeFrame(key: string): boolean {
    const entry = this.frameCache.get(key);
    if (entry) {
      // Close the ImageBitmap to free memory
      if (entry.frame.image && typeof entry.frame.image.close === "function") {
        entry.frame.image.close();
      }
      this.totalCacheSizeBytes -= entry.sizeBytes;
      return this.frameCache.delete(key);
    }
    return false;
  }

  /**
   * Evict frames if cache limits are exceeded (LRU eviction)
   *
   * Evict least recently used frames when cache exceeds size limit
   *
   * **Feature: core-ui-integration, Property 22: Frame Cache LRU Eviction**
   *
   * @param newFrameSize - Size of new frame to be added
   */
  private evictIfNeeded(newFrameSize: number): void {
    // Check frame count limit
    while (this.frameCache.size >= this.cacheConfig.maxFrames) {
      this.evictOldest();
    }

    // Check size limit
    while (
      this.totalCacheSizeBytes + newFrameSize > this.cacheConfig.maxSizeBytes &&
      this.frameCache.size > 0
    ) {
      this.evictOldest();
    }
  }

  /**
   * Evict the oldest accessed frame (LRU)
   *
   * Evict least recently used frames
   */
  private evictOldest(): void {
    let oldestKey = "";
    let oldestTime = Infinity;

    for (const [key, entry] of this.frameCache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.removeFrame(oldestKey);
    }
  }

  /**
   * Preload frames around the playhead position
   *
   * Queue preload requests and store in cache
   *
   * @param centerTime - Center time position for preloading
   * @param duration - Total duration of the timeline
   * @param frameRate - Frame rate for preloading (default 30fps)
   */
  async preloadFrames(
    centerTime: number,
    duration: number,
    frameRate: number = 30,
  ): Promise<void> {
    if (!this.initialized || !this.videoEngine) {
      return;
    }

    // Cancel any existing preload operation
    if (this.preloadAbortController) {
      this.preloadAbortController.abort();
    }
    this.preloadAbortController = new AbortController();
    const signal = this.preloadAbortController.signal;

    this.isPreloading = true;

    try {
      const frameDuration = 1 / frameRate;
      const startTime = Math.max(
        0,
        centerTime - this.cacheConfig.preloadBehind * frameDuration,
      );
      const endTime = Math.min(
        duration,
        centerTime + this.cacheConfig.preloadAhead * frameDuration,
      );

      const project = useProjectStore.getState().project;

      // Generate timestamps to preload (prioritize forward frames)
      const timestamps: number[] = [];

      // Add forward frames first (higher priority)
      for (let t = centerTime; t <= endTime; t += frameDuration) {
        const key = RenderBridge.getCacheKey(t, frameRate);
        if (!this.frameCache.has(key)) {
          timestamps.push(t);
        }
      }

      // Add backward frames
      for (
        let t = centerTime - frameDuration;
        t >= startTime;
        t -= frameDuration
      ) {
        const key = RenderBridge.getCacheKey(t, frameRate);
        if (!this.frameCache.has(key)) {
          timestamps.push(t);
        }
      }

      // Preload frames
      for (const time of timestamps) {
        if (signal.aborted) {
          break;
        }

        try {
          const frame = await this.videoEngine.renderFrame(
            project,
            time,
            undefined,
            undefined,
            { realtime: true },
          );
          if (frame && !signal.aborted) {
            const key = RenderBridge.getCacheKey(time, frameRate);
            this.cacheFrame(key, frame);
          }
        } catch (error) {
          // Continue with next frame on error
          console.warn("RenderBridge: Preload frame error:", error);
        }
      }
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * Get frames that should be preloaded around a time position
   *
   * @param currentTime - Current playhead time
   * @param duration - Total timeline duration
   * @param frameRate - Frame rate
   * @returns Object with start/end times and missing frame timestamps
   */
  getPreloadRange(
    currentTime: number,
    duration: number,
    frameRate: number = 30,
  ): { startTime: number; endTime: number; missingFrames: number[] } {
    const frameDuration = 1 / frameRate;
    const startTime = Math.max(
      0,
      currentTime - this.cacheConfig.preloadBehind * frameDuration,
    );
    const endTime = Math.min(
      duration,
      currentTime + this.cacheConfig.preloadAhead * frameDuration,
    );

    const missingFrames: number[] = [];
    for (let t = startTime; t <= endTime; t += frameDuration) {
      const key = RenderBridge.getCacheKey(t, frameRate);
      if (!this.frameCache.has(key)) {
        missingFrames.push(t);
      }
    }

    return { startTime, endTime, missingFrames };
  }

  /**
   * Cancel any ongoing preload operation
   */
  cancelPreload(): void {
    if (this.preloadAbortController) {
      this.preloadAbortController.abort();
      this.preloadAbortController = null;
    }
    this.isPreloading = false;
  }

  /**
   * Check if preloading is in progress
   */
  isPreloadingFrames(): boolean {
    return this.isPreloading;
  }

  /**
   * Clear all cached frames
   */
  clearCache(): void {
    for (const entry of this.frameCache.values()) {
      if (entry.frame.image && typeof entry.frame.image.close === "function") {
        entry.frame.image.close();
      }
    }
    this.frameCache.clear();
    this.totalCacheSizeBytes = 0;
    this.cacheStats = { hits: 0, misses: 0 };
  }

  /**
   * Get cache statistics
   *
   * @returns Frame cache statistics
   */
  getCacheStats(): FrameCacheStats {
    const totalRequests = this.cacheStats.hits + this.cacheStats.misses;
    return {
      entries: this.frameCache.size,
      sizeBytes: this.totalCacheSizeBytes,
      hitRate: totalRequests > 0 ? this.cacheStats.hits / totalRequests : 0,
      maxSizeBytes: this.cacheConfig.maxSizeBytes,
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
    };
  }

  /**
   * Get the cache configuration
   */
  getCacheConfig(): FrameCacheConfig {
    return { ...this.cacheConfig };
  }

  /**
   * Update cache configuration
   *
   * @param config - Partial configuration to update
   */
  updateCacheConfig(config: Partial<FrameCacheConfig>): void {
    this.cacheConfig = { ...this.cacheConfig, ...config };
    // Evict if new limits are exceeded
    this.evictIfNeeded(0);
  }

  // ============================================
  // Color Grading Methods
  // ============================================

  /**
   * Apply color adjustments to an image
   *
   * Apply brightness, contrast, saturation, temperature, tint
   *
   * **Feature: core-ui-integration, Property 39: Color Adjustment Application**
   *
   * @param image - Source image to apply adjustments to
   * @param adjustments - Color adjustment parameters
   * @returns Processed image with adjustments applied
   */
  async applyColorAdjustments(
    image: ImageBitmap,
    adjustments: ColorAdjustments,
  ): Promise<ImageBitmap> {
    if (!this.videoEffectsEngine) {
      return image;
    }

    // Build effects array from adjustments
    const effects: Effect[] = [];

    // Basic adjustments
    if (adjustments.brightness !== undefined && adjustments.brightness !== 0) {
      effects.push({
        id: "color-brightness",
        type: "brightness",
        params: { value: adjustments.brightness },
        enabled: true,
      });
    }

    if (adjustments.contrast !== undefined && adjustments.contrast !== 1) {
      effects.push({
        id: "color-contrast",
        type: "contrast",
        params: { value: adjustments.contrast },
        enabled: true,
      });
    }

    if (adjustments.saturation !== undefined && adjustments.saturation !== 1) {
      effects.push({
        id: "color-saturation",
        type: "saturation",
        params: { value: adjustments.saturation },
        enabled: true,
      });
    }

    // Temperature and tint
    if (
      adjustments.temperature !== undefined &&
      adjustments.temperature !== 0
    ) {
      effects.push({
        id: "color-temperature",
        type: "temperature",
        params: { value: adjustments.temperature },
        enabled: true,
      });
    }

    if (adjustments.tint !== undefined && adjustments.tint !== 0) {
      effects.push({
        id: "color-tint",
        type: "tint",
        params: { value: adjustments.tint },
        enabled: true,
      });
    }

    // Tonal adjustments
    if (
      (adjustments.shadows !== undefined && adjustments.shadows !== 0) ||
      (adjustments.midtones !== undefined && adjustments.midtones !== 0) ||
      (adjustments.highlights !== undefined && adjustments.highlights !== 0)
    ) {
      effects.push({
        id: "color-tonal",
        type: "tonal",
        params: {
          shadows: adjustments.shadows ?? 0,
          midtones: adjustments.midtones ?? 0,
          highlights: adjustments.highlights ?? 0,
        },
        enabled: true,
      });
    }

    // If no adjustments, return original
    if (effects.length === 0) {
      return image;
    }

    // Apply effects using VideoEffectsEngine
    const result = await this.videoEffectsEngine.applyEffects(image, effects);
    return result.image;
  }

  /**
   * Check if color adjustments would modify the image
   *
   * @param adjustments - Color adjustment parameters
   * @returns True if adjustments would change the image
   */
  hasColorAdjustments(adjustments: ColorAdjustments): boolean {
    return (
      (adjustments.brightness !== undefined && adjustments.brightness !== 0) ||
      (adjustments.contrast !== undefined && adjustments.contrast !== 1) ||
      (adjustments.saturation !== undefined && adjustments.saturation !== 1) ||
      (adjustments.temperature !== undefined &&
        adjustments.temperature !== 0) ||
      (adjustments.tint !== undefined && adjustments.tint !== 0) ||
      (adjustments.shadows !== undefined && adjustments.shadows !== 0) ||
      (adjustments.midtones !== undefined && adjustments.midtones !== 0) ||
      (adjustments.highlights !== undefined && adjustments.highlights !== 0)
    );
  }

  /**
   * Get default color adjustments (no change)
   */
  getDefaultColorAdjustments(): ColorAdjustments {
    return {
      brightness: 0,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      tint: 0,
      shadows: 0,
      midtones: 0,
      highlights: 0,
    };
  }

  /**
   * Dispose of the render bridge and clean up resources
   */
  dispose(): void {
    // Cancel any pending render
    if (this.pendingRender !== null) {
      cancelAnimationFrame(this.pendingRender);
      this.pendingRender = null;
    }

    // Cancel any preload operation
    this.cancelPreload();

    // Clear frame cache
    this.clearCache();

    // Clear canvas
    this.clearCanvas();

    // Dispose transition engine
    if (this.transitionEngine) {
      this.transitionEngine.dispose();
      this.transitionEngine = null;
    }

    // Reset state
    this.canvas = null;
    this.ctx = null;
    this.videoEngine = null;
    this.videoEffectsEngine = null;
    this.initialized = false;
    this.lastRenderedTime = -1;
    this.renderTimes = [];
    this.renderStats = {
      lastRenderTime: 0,
      avgRenderTime: 0,
      framesRendered: 0,
      renderErrors: 0,
    };
  }
}

// Singleton instance
let renderBridgeInstance: RenderBridge | null = null;

/**
 * Get the shared RenderBridge instance
 */
export function getRenderBridge(): RenderBridge {
  if (!renderBridgeInstance) {
    renderBridgeInstance = new RenderBridge();
  }
  return renderBridgeInstance;
}

/**
 * Initialize the shared RenderBridge
 */
export async function initializeRenderBridge(): Promise<RenderBridge> {
  const bridge = getRenderBridge();
  await bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared RenderBridge
 */
export function disposeRenderBridge(): void {
  if (renderBridgeInstance) {
    renderBridgeInstance.dispose();
    renderBridgeInstance = null;
  }
}
