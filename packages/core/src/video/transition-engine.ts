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

  async renderTransition(
    outgoingFrame: ImageBitmap,
    incomingFrame: ImageBitmap,
    transition: Transition,
    progress: number,
  ): Promise<TransitionRenderResult> {
    const startTime = performance.now();
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
    this.ctx.clearRect(0, 0, this.width, this.height);
    switch (transition.type) {
      case "crossfade":
        await this.renderCrossfade(outgoingFrame, incomingFrame, easedProgress);
        break;
      case "dipToBlack":
        await this.renderDipToColor(
          outgoingFrame,
          incomingFrame,
          easedProgress,
          "black",
          (transition.params.holdDuration as number) || 0,
        );
        break;
      case "dipToWhite":
        await this.renderDipToColor(
          outgoingFrame,
          incomingFrame,
          easedProgress,
          "white",
          (transition.params.holdDuration as number) || 0,
        );
        break;
      case "wipe":
        await this.renderWipe(
          outgoingFrame,
          incomingFrame,
          easedProgress,
          (transition.params.direction as string) || "left",
          (transition.params.softness as number) || 0,
        );
        break;
      case "slide":
        await this.renderSlide(
          outgoingFrame,
          incomingFrame,
          easedProgress,
          (transition.params.direction as string) || "left",
          (transition.params.pushOut as boolean) || false,
        );
        break;
      case "zoom":
        await this.renderZoom(
          outgoingFrame,
          incomingFrame,
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
          outgoingFrame,
          incomingFrame,
          easedProgress,
          (transition.params.direction as string) || "left",
        );
        break;
      default:
        await this.renderCrossfade(outgoingFrame, incomingFrame, easedProgress);
    }

    const frame = await createImageBitmap(this.canvas);

    return {
      frame,
      processingTime: performance.now() - startTime,
      gpuAccelerated: false, // Canvas 2D is not GPU accelerated
    };
  }

  private async renderCrossfade(
    outgoing: ImageBitmap,
    incoming: ImageBitmap,
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
    outgoing: ImageBitmap,
    incoming: ImageBitmap,
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
    outgoing: ImageBitmap,
    incoming: ImageBitmap,
    progress: number,
    direction: string,
    softness: number,
  ): Promise<void> {
    const ctx = this.getContext();
    // Draw outgoing frame as base
    ctx.drawImage(outgoing, 0, 0, this.width, this.height);
    ctx.save();

    const softPixels = softness * Math.max(this.width, this.height) * 0.1;

    switch (direction) {
      case "left":
        this.createWipeClip(
          ctx,
          progress * this.width,
          0,
          this.width,
          this.height,
        );
        break;
      case "right":
        this.createWipeClip(
          ctx,
          0,
          0,
          this.width * (1 - progress),
          this.height,
          true,
        );
        break;
      case "up":
        this.createWipeClip(
          ctx,
          0,
          progress * this.height,
          this.width,
          this.height,
        );
        break;
      case "down":
        this.createWipeClip(
          ctx,
          0,
          0,
          this.width,
          this.height * (1 - progress),
          true,
        );
        break;
      case "diagonal":
        this.createDiagonalWipeClip(ctx, progress);
        break;
      default:
        this.createWipeClip(
          ctx,
          progress * this.width,
          0,
          this.width,
          this.height,
        );
    }
    if (softness > 0 && softPixels > 0) {
      ctx.globalAlpha = 0.8; // Slight softening effect
    }

    ctx.drawImage(incoming, 0, 0, this.width, this.height);
    ctx.restore();
  }

  private createWipeClip(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    invert: boolean = false,
  ): void {
    ctx.beginPath();
    if (invert) {
      ctx.rect(width, y, this.width - width, height);
    } else {
      ctx.rect(x, y, width - x, height - y);
    }
    ctx.clip();
  }

  private createDiagonalWipeClip(
    ctx: OffscreenCanvasRenderingContext2D,
    progress: number,
  ): void {
    const offset = (this.width + this.height) * progress;
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset - this.height, this.height);
    ctx.lineTo(this.width, this.height);
    ctx.lineTo(this.width, 0);
    ctx.closePath();
    ctx.clip();
  }

  private async renderSlide(
    outgoing: ImageBitmap,
    incoming: ImageBitmap,
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
    outgoing: ImageBitmap,
    incoming: ImageBitmap,
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
    outgoing: ImageBitmap,
    incoming: ImageBitmap,
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
