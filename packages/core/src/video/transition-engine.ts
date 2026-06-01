import type { TransitionType, TransitionParams } from "../types/effects";
import type { Transition, Clip, Track } from "../types/timeline";

export interface TransitionRenderResult {
  frame: ImageBitmap;
  processingTime: number;
  gpuAccelerated: boolean;
}

export interface TransitionValidationResult {
  valid: boolean;
  error?: string;
  maxDuration?: number;
  warning?: string;
}

export interface TransitionEngineConfig {
  width: number;
  height: number;
  useGPU?: boolean;
}

type EasingFunction = (t: number) => number;

export class TransitionEngine {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private width: number;
  private height: number;
  private initialized = false;
  // Two reusable letterbox scratch canvases (outgoing + incoming are both live
  // during a blend, so they cannot share one). Kept as canvases — not
  // ImageBitmaps — so fitting costs zero createImageBitmap per frame.
  private scratchA: OffscreenCanvas | null = null;
  private scratchACtx: OffscreenCanvasRenderingContext2D | null = null;
  private scratchB: OffscreenCanvas | null = null;
  private scratchBCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(config: TransitionEngineConfig) {
    this.width = config.width;
    this.height = config.height;
    // Lazy initialization for environments without OffscreenCanvas (e.g., Node.js tests)
    this.initializeCanvas();
  }

  private initializeCanvas(): void {
    if (this.initialized) return;

    try {
      if (typeof OffscreenCanvas !== "undefined") {
        this.canvas = new OffscreenCanvas(this.width, this.height);
        this.ctx = this.canvas.getContext("2d");
      }
    } catch {
      // OffscreenCanvas not available (Node.js environment)
      this.canvas = null;
      this.ctx = null;
    }

    this.initialized = true;
  }

  private getContext(): OffscreenCanvasRenderingContext2D {
    if (!this.ctx) {
      throw new Error("Canvas context not available");
    }
    return this.ctx;
  }

  private sourceDimensions(source: CanvasImageSource): {
    width: number;
    height: number;
  } {
    if (
      typeof HTMLVideoElement !== "undefined" &&
      source instanceof HTMLVideoElement
    ) {
      return { width: source.videoWidth, height: source.videoHeight };
    }
    const dims = source as { width?: number; height?: number };
    return { width: dims.width ?? 0, height: dims.height ?? 0 };
  }

  // Letterbox (contain) a source frame into an engine-sized scratch canvas so
  // the per-transition geometry — which assumes inputs already fill the canvas
  // — preserves the source aspect ratio instead of stretching it. Returns the
  // original frame untouched when it is already engine-sized (e.g. the scrub
  // path pre-letterboxes). Uses a reusable scratch canvas (no createImageBitmap)
  // so it is cheap to run every frame during playback/export.
  private fitToCanvas(
    source: CanvasImageSource,
    slot: "A" | "B",
  ): CanvasImageSource {
    const { width: sourceWidth, height: sourceHeight } =
      this.sourceDimensions(source);
    if (sourceWidth === this.width && sourceHeight === this.height) {
      return source;
    }
    if (typeof OffscreenCanvas === "undefined") {
      return source;
    }
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return source;
    }

    let scratch = slot === "A" ? this.scratchA : this.scratchB;
    let scratchCtx = slot === "A" ? this.scratchACtx : this.scratchBCtx;
    if (!scratch || scratch.width !== this.width || scratch.height !== this.height) {
      scratch = new OffscreenCanvas(this.width, this.height);
      scratchCtx = scratch.getContext("2d");
      if (slot === "A") {
        this.scratchA = scratch;
        this.scratchACtx = scratchCtx;
      } else {
        this.scratchB = scratch;
        this.scratchBCtx = scratchCtx;
      }
    }
    if (!scratchCtx) {
      return source;
    }

    const sourceAspect = sourceWidth / sourceHeight;
    const canvasAspect = this.width / this.height;
    let drawWidth: number;
    let drawHeight: number;
    if (sourceAspect > canvasAspect) {
      drawWidth = this.width;
      drawHeight = this.width / sourceAspect;
    } else {
      drawHeight = this.height;
      drawWidth = this.height * sourceAspect;
    }
    const drawX = (this.width - drawWidth) / 2;
    const drawY = (this.height - drawHeight) / 2;

    scratchCtx.clearRect(0, 0, this.width, this.height);
    scratchCtx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    return scratch;
  }

  async renderTransition(
    outgoingFrame: CanvasImageSource,
    incomingFrame: CanvasImageSource,
    transition: Transition,
    progress: number,
  ): Promise<TransitionRenderResult> {
    const startTime = performance.now();
    const canvas = await this.renderTransitionToCanvas(
      outgoingFrame,
      incomingFrame,
      transition,
      progress,
    );
    const frame = await createImageBitmap(canvas);

    return {
      frame,
      processingTime: performance.now() - startTime,
      gpuAccelerated: false, // Canvas 2D is not GPU accelerated
    };
  }

  async renderTransitionToCanvas(
    outgoingFrame: CanvasImageSource,
    incomingFrame: CanvasImageSource,
    transition: Transition,
    progress: number,
  ): Promise<OffscreenCanvas> {
    if (!this.canvas || !this.ctx) {
      throw new Error(
        "Canvas not available. Rendering requires a browser environment.",
      );
    }
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const easedProgress = this.applyEasing(
      clampedProgress,
      transition.params.curve as string,
    );

    // Letterbox both inputs to the engine canvas first so a clip whose aspect
    // differs from the project (e.g. a portrait clip in a landscape project)
    // keeps its orientation through the transition instead of being stretched
    // to fill. The scrub path already passes engine-sized frames, so this is a
    // no-op there; the multitrack-preview and export paths pass native frames.
    const outgoing = this.fitToCanvas(outgoingFrame, "A");
    const incoming = this.fitToCanvas(incomingFrame, "B");

    this.ctx.clearRect(0, 0, this.width, this.height);
    switch (transition.type) {
      case "crossfade":
        await this.renderCrossfade(outgoing, incoming, easedProgress);
        break;
      case "dipToBlack":
        await this.renderDipToColor(
          outgoing,
          incoming,
          easedProgress,
          "black",
          (transition.params.holdDuration as number) || 0,
        );
        break;
      case "dipToWhite":
        await this.renderDipToColor(
          outgoing,
          incoming,
          easedProgress,
          "white",
          (transition.params.holdDuration as number) || 0,
        );
        break;
      case "wipe":
        await this.renderWipe(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.direction as string) || "left",
          (transition.params.softness as number) || 0,
        );
        break;
      case "slide":
        await this.renderSlide(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.direction as string) || "left",
          (transition.params.pushOut as boolean) || false,
        );
        break;
      case "zoom":
        await this.renderZoom(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.scale as number) || 2,
          (transition.params.center as { x: number; y: number }) || {
            x: 0.5,
            y: 0.5,
          },
        );
        break;
      case "push":
        await this.renderPush(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.direction as string) || "left",
        );
        break;
      default:
        await this.renderCrossfade(outgoing, incoming, easedProgress);
    }

    return this.canvas;
  }

  private async renderCrossfade(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
  ): Promise<void> {
    const ctx = this.getContext();
    // Draw outgoing frame with decreasing opacity
    ctx.globalAlpha = 1 - progress;
    ctx.drawImage(outgoing, 0, 0, this.width, this.height);

    // Draw incoming frame with increasing opacity
    ctx.globalAlpha = progress;
    ctx.drawImage(incoming, 0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
  }

  private async renderDipToColor(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    color: "black" | "white",
    holdDuration: number,
  ): Promise<void> {
    // Total transition: fade out -> hold -> fade in
    const totalPhases = 2 + holdDuration;
    const fadeOutEnd = 1 / totalPhases;
    const holdEnd = (1 + holdDuration) / totalPhases;

    const ctx = this.getContext();
    if (progress < fadeOutEnd) {
      // Fade out phase
      const fadeProgress = progress / fadeOutEnd;
      ctx.drawImage(outgoing, 0, 0, this.width, this.height);
      ctx.fillStyle = color;
      ctx.globalAlpha = fadeProgress;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    } else if (progress < holdEnd) {
      // Hold phase - solid color
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      // Fade in phase
      const fadeProgress = (progress - holdEnd) / (1 - holdEnd);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = fadeProgress;
      ctx.drawImage(incoming, 0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }
  }

  private async renderWipe(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    direction: string,
    _softness: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;

    // Outgoing is the base; the incoming frame is revealed inside a region
    // that grows from nothing (progress 0 → outgoing fully visible) to the
    // whole canvas (progress 1 → incoming fully visible). Each direction is the
    // edge the incoming frame wipes in from.
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    switch (direction) {
      case "right":
        ctx.rect(w * (1 - progress), 0, w * progress, h);
        break;
      case "up":
        ctx.rect(0, 0, w, h * progress);
        break;
      case "down":
        ctx.rect(0, h * (1 - progress), w, h * progress);
        break;
      case "diagonal": {
        const offset = (w + h) * progress;
        ctx.moveTo(0, 0);
        ctx.lineTo(offset, 0);
        ctx.lineTo(0, offset);
        ctx.closePath();
        break;
      }
      case "left":
      default:
        ctx.rect(0, 0, w * progress, h);
        break;
    }
    ctx.clip();
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.restore();
  }

  private async renderSlide(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    direction: string,
    pushOut: boolean,
  ): Promise<void> {
    const ctx = this.getContext();
    let outX = 0,
      outY = 0,
      inX = 0,
      inY = 0;

    switch (direction) {
      case "left":
        inX = this.width * (1 - progress);
        if (pushOut) outX = -this.width * progress;
        break;
      case "right":
        inX = -this.width * (1 - progress);
        if (pushOut) outX = this.width * progress;
        break;
      case "up":
        inY = this.height * (1 - progress);
        if (pushOut) outY = -this.height * progress;
        break;
      case "down":
        inY = -this.height * (1 - progress);
        if (pushOut) outY = this.height * progress;
        break;
    }

    // Draw outgoing frame (possibly sliding out)
    if (pushOut || progress < 1) {
      ctx.drawImage(outgoing, outX, outY, this.width, this.height);
    }

    // Draw incoming frame sliding in
    ctx.drawImage(incoming, inX, inY, this.width, this.height);
  }

  private async renderZoom(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    scale: number,
    center: { x: number; y: number },
  ): Promise<void> {
    // Outgoing frame zooms in and fades out
    const outScale = 1 + (scale - 1) * progress;
    const outAlpha = 1 - progress;

    // Incoming frame zooms from small to normal
    const inScale = 1 / scale + (1 - 1 / scale) * progress;
    const inAlpha = progress;
    const centerX = this.width * center.x;
    const centerY = this.height * center.y;

    const ctx = this.getContext();
    // Draw outgoing with zoom
    ctx.save();
    ctx.globalAlpha = outAlpha;
    ctx.translate(centerX, centerY);
    ctx.scale(outScale, outScale);
    ctx.translate(-centerX, -centerY);
    ctx.drawImage(outgoing, 0, 0, this.width, this.height);
    ctx.restore();

    // Draw incoming with zoom
    ctx.save();
    ctx.globalAlpha = inAlpha;
    ctx.translate(centerX, centerY);
    ctx.scale(inScale, inScale);
    ctx.translate(-centerX, -centerY);
    ctx.drawImage(incoming, 0, 0, this.width, this.height);
    ctx.restore();
  }

  private async renderPush(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    direction: string,
  ): Promise<void> {
    // Push is like slide but both frames always move together
    await this.renderSlide(outgoing, incoming, progress, direction, true);
  }

  private applyEasing(progress: number, curve?: string): number {
    const easingFunctions: Record<string, EasingFunction> = {
      linear: (t) => t,
      ease: (t) => t * t * (3 - 2 * t), // Smoothstep
      "ease-in": (t) => t * t,
      "ease-out": (t) => t * (2 - t),
      "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    };

    const easing = easingFunctions[curve || "linear"] || easingFunctions.linear;
    return easing(progress);
  }

  validateTransition(
    clipA: Clip,
    clipB: Clip,
    duration: number,
  ): TransitionValidationResult {
    const clipAEnd = clipA.startTime + clipA.duration;
    const gap = Math.abs(clipB.startTime - clipAEnd);

    // Allow small tolerance for floating point errors
    if (gap > 0.001) {
      return {
        valid: false,
        error: "Clips must be adjacent to add a transition",
      };
    }
    if (clipA.trackId !== clipB.trackId) {
      return {
        valid: false,
        error: "Clips must be on the same track",
      };
    }

    // For a center-on-cut transition the window extends ±duration/2 around
    // the cut, so duration cannot exceed twice either clip's visible length.
    // We can't validate source-media handles without media metadata, so we
    // bound by the visible ranges and let the decoder clamp to edge frames
    // when the transition extends past a clip's range.
    const maxDuration = Math.min(clipA.duration, clipB.duration) * 2;

    if (duration > maxDuration) {
      return {
        valid: true,
        warning: `Insufficient handle frames. Maximum transition duration is ${maxDuration.toFixed(
          2,
        )}s`,
        maxDuration,
      };
    }

    if (duration <= 0) {
      return {
        valid: false,
        error: "Transition duration must be positive",
      };
    }

    return {
      valid: true,
      maxDuration,
    };
  }

  areClipsAdjacent(clipA: Clip, clipB: Clip): boolean {
    if (clipA.trackId !== clipB.trackId) {
      return false;
    }

    const clipAEnd = clipA.startTime + clipA.duration;
    const gap = Math.abs(clipB.startTime - clipAEnd);

    // Allow small tolerance for floating point errors
    return gap < 0.001;
  }

  findAdjacentClipPairs(track: Track): Array<{ clipA: Clip; clipB: Clip }> {
    const pairs: Array<{ clipA: Clip; clipB: Clip }> = [];
    const sortedClips = [...track.clips].sort(
      (a, b) => a.startTime - b.startTime,
    );

    for (let i = 0; i < sortedClips.length - 1; i++) {
      const clipA = sortedClips[i];
      const clipB = sortedClips[i + 1];

      if (this.areClipsAdjacent(clipA, clipB)) {
        pairs.push({ clipA, clipB });
      }
    }

    return pairs;
  }

  createTransition(
    clipA: Clip,
    clipB: Clip,
    type: TransitionType,
    duration: number,
    params?: Partial<TransitionParams[typeof type]>,
  ): Transition | null {
    const validation = this.validateTransition(clipA, clipB, duration);
    if (!validation.valid && !validation.warning) {
      return null;
    }

    // Use max duration if requested duration exceeds it
    const actualDuration = validation.maxDuration
      ? Math.min(duration, validation.maxDuration)
      : duration;

    const defaultParams = this.getDefaultParams(type);

    return {
      id: `transition-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      clipAId: clipA.id,
      clipBId: clipB.id,
      type,
      duration: actualDuration,
      params: { ...defaultParams, ...params },
    };
  }

  getDefaultParams(type: TransitionType): Record<string, unknown> {
    switch (type) {
      case "crossfade":
        return { curve: "ease" };
      case "dipToBlack":
        return { holdDuration: 0.1 };
      case "dipToWhite":
        return { holdDuration: 0.1 };
      case "wipe":
        return { direction: "left", softness: 0 };
      case "slide":
        return { direction: "left", pushOut: false };
      case "zoom":
        return { scale: 2, center: { x: 0.5, y: 0.5 } };
      case "push":
        return { direction: "left" };
      default:
        return {};
    }
  }

  updateTransitionDuration(
    transition: Transition,
    clipA: Clip,
    clipB: Clip,
    newDuration: number,
  ): Transition {
    const validation = this.validateTransition(clipA, clipB, newDuration);
    const actualDuration = validation.maxDuration
      ? Math.min(newDuration, validation.maxDuration)
      : newDuration;

    return {
      ...transition,
      duration: actualDuration,
    };
  }

  removeTransition(track: Track, transitionId: string): Track {
    return {
      ...track,
      transitions: track.transitions.filter((t) => t.id !== transitionId),
    };
  }

  calculateTransitionProgress(
    transition: Transition,
    clipA: Clip,
    currentTime: number,
  ): number {
    const transitionStart =
      clipA.startTime + clipA.duration - transition.duration / 2;
    const transitionEnd = transitionStart + transition.duration;

    if (currentTime <= transitionStart) {
      return 0;
    }
    if (currentTime >= transitionEnd) {
      return 1;
    }

    return (currentTime - transitionStart) / transition.duration;
  }

  isTimeInTransition(
    transition: Transition,
    clipA: Clip,
    currentTime: number,
  ): boolean {
    const transitionStart =
      clipA.startTime + clipA.duration - transition.duration / 2;
    const transitionEnd = transitionStart + transition.duration;

    return currentTime >= transitionStart && currentTime <= transitionEnd;
  }

  getEngineDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (typeof OffscreenCanvas !== "undefined") {
      try {
        this.canvas = new OffscreenCanvas(width, height);
        this.ctx = this.canvas.getContext("2d");
      } catch {
        // Ignore errors in non-browser environments
      }
    }
  }

  getAvailableTransitionTypes(): TransitionType[] {
    return [
      "crossfade",
      "dipToBlack",
      "dipToWhite",
      "wipe",
      "slide",
      "zoom",
      "push",
    ];
  }

  dispose(): void {
    // OffscreenCanvas doesn't need explicit disposal
    // but we can clear references
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
    this.canvas = null;
    this.ctx = null;
  }
}

export function createTransitionEngine(
  width: number = 1920,
  height: number = 1080,
): TransitionEngine {
  return new TransitionEngine({ width, height });
}
