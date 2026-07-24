import type { TransitionType, TransitionParams } from "../types/effects";
import type { Transition, Clip, Track, TransitionEdge } from "../types/timeline";

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
  private pixelScratch: OffscreenCanvas | null = null;
  private pixelScratchCtx: OffscreenCanvasRenderingContext2D | null = null;

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
      case "circleReveal":
        await this.renderCircleReveal(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.center as { x: number; y: number }) || {
            x: 0.5,
            y: 0.5,
          },
        );
        break;
      case "blur":
        await this.renderBlur(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.intensity as number) ?? 1,
        );
        break;
      case "whipPan":
        await this.renderWhipPan(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.direction as string) || "left",
          (transition.params.blurIntensity as number) ?? 1,
        );
        break;
      case "radialWipe":
        await this.renderRadialWipe(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.startAngle as number) ?? -90,
          (transition.params.clockwise as boolean) ?? true,
        );
        break;
      case "pixelate":
        await this.renderPixelate(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.maxPixelSize as number) || 48,
        );
        break;
      case "glitch":
        await this.renderGlitch(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.intensity as number) || 0.08,
          (transition.params.slices as number) || 12,
        );
        break;
      case "blinds":
        await this.renderBlinds(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.count as number) || 8,
          (transition.params.direction as string) || "vertical",
        );
        break;
      case "diamondReveal":
        await this.renderDiamondReveal(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.center as { x: number; y: number }) || {
            x: 0.5,
            y: 0.5,
          },
        );
        break;
      case "spin":
        await this.renderSpin(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.rotations as number) ?? 1,
        );
        break;
      case "flip":
        await this.renderFlip(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.axis as string) || "horizontal",
        );
        break;
      case "splitReveal":
        await this.renderSplitReveal(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.orientation as string) || "horizontal",
        );
        break;
      case "flash":
        await this.renderFlash(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.intensity as number) ?? 1,
        );
        break;
      case "filmBurn":
        await this.renderFilmBurn(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.intensity as number) ?? 1,
          (transition.params.warmth as number) ?? 0.75,
        );
        break;
      case "mosaic":
        await this.renderMosaic(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.tiles as number) ?? 8,
          (transition.params.randomness as number) ?? 0.85,
        );
        break;
      case "ripple":
        await this.renderRipple(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.amplitude as number) ?? 0.04,
          (transition.params.waves as number) ?? 3,
        );
        break;
      case "pageTurn":
        await this.renderPageTurn(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.direction as string) || "left",
          (transition.params.shadow as number) ?? 0.55,
        );
        break;
      case "colorSplit":
        await this.renderColorSplit(
          outgoing,
          incoming,
          easedProgress,
          (transition.params.maxOffset as number) ?? 18,
          (transition.params.angle as number) ?? 0,
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
    softness: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;

    // Outgoing is the base; the incoming frame is revealed inside a region
    // that grows from nothing (progress 0 → outgoing fully visible) to the
    // whole canvas (progress 1 → incoming fully visible). Each direction is the
    // edge the incoming frame wipes in from.
    ctx.drawImage(outgoing, 0, 0, w, h);
    const feather = Math.max(0, Math.min(1, softness));
    if (
      feather > 0 &&
      direction !== "diagonal" &&
      progress > 0 &&
      progress < 1
    ) {
      this.drawFeatheredWipe(incoming, progress, direction, feather);
      return;
    }
    if (progress >= 1) {
      ctx.drawImage(incoming, 0, 0, w, h);
      return;
    }
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

  private drawFeatheredWipe(
    incoming: CanvasImageSource,
    progress: number,
    direction: string,
    softness: number,
  ): void {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    const horizontal = direction === "left" || direction === "right";
    const length = horizontal ? w : h;
    const edge =
      direction === "right" || direction === "down"
        ? length * (1 - progress)
        : length * progress;
    const featherSize = Math.max(1, length * softness * 0.25);
    const slices = 20;

    const drawRegion = (
      start: number,
      end: number,
      alpha: number,
    ): void => {
      const clampedStart = Math.max(0, Math.min(length, start));
      const clampedEnd = Math.max(0, Math.min(length, end));
      if (clampedEnd <= clampedStart || alpha <= 0) return;
      ctx.save();
      ctx.beginPath();
      if (horizontal) {
        ctx.rect(clampedStart, 0, clampedEnd - clampedStart, h);
      } else {
        ctx.rect(0, clampedStart, w, clampedEnd - clampedStart);
      }
      ctx.clip();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.drawImage(incoming, 0, 0, w, h);
      ctx.restore();
    };

    if (direction === "left" || direction === "up") {
      const featherStart = Math.max(0, edge - featherSize);
      drawRegion(0, featherStart, 1);
      for (let index = 0; index < slices; index += 1) {
        const start = featherStart + (edge - featherStart) * (index / slices);
        const end = featherStart + (edge - featherStart) * ((index + 1) / slices);
        drawRegion(start, end, 1 - (index + 0.5) / slices);
      }
      return;
    }

    const featherEnd = Math.min(length, edge + featherSize);
    for (let index = 0; index < slices; index += 1) {
      const start = edge + (featherEnd - edge) * (index / slices);
      const end = edge + (featherEnd - edge) * ((index + 1) / slices);
      drawRegion(start, end, (index + 0.5) / slices);
    }
    drawRegion(featherEnd, length, 1);
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

  private async renderCircleReveal(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    center: { x: number; y: number },
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    const cx = w * Math.max(0, Math.min(1, center.x));
    const cy = h * Math.max(0, Math.min(1, center.y));
    const maxRadius = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(w - cx, cy),
      Math.hypot(cx, h - cy),
      Math.hypot(w - cx, h - cy),
    );
    ctx.arc(cx, cy, maxRadius * progress, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.restore();
  }

  private async renderBlur(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    intensity: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    const maxBlur = Math.max(w, h) * 0.04 * Math.max(0, Math.min(2, intensity));
    const blurAmount = Math.sin(progress * Math.PI) * maxBlur;
    ctx.clearRect(0, 0, w, h);
    ctx.filter = `blur(${blurAmount}px)`;
    ctx.globalAlpha = 1 - progress;
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.globalAlpha = progress;
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }

  private async renderWhipPan(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    direction: string,
    blurIntensity: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    const horizontal = direction === "left" || direction === "right";
    const sign = direction === "right" || direction === "down" ? 1 : -1;
    const span = horizontal ? w : h;
    const outOffset = sign * span * progress;
    const inOffset = sign * span * (progress - 1);
    const blurAmount =
      Math.sin(progress * Math.PI) *
      (span * 0.06) *
      Math.max(0, Math.min(2, blurIntensity));

    ctx.clearRect(0, 0, w, h);
    ctx.filter = `blur(${blurAmount}px)`;
    if (horizontal) {
      ctx.drawImage(outgoing, outOffset, 0, w, h);
      ctx.drawImage(incoming, inOffset, 0, w, h);
    } else {
      ctx.drawImage(outgoing, 0, outOffset, w, h);
      ctx.drawImage(incoming, 0, inOffset, w, h);
    }
    ctx.filter = "none";
  }

  private async renderRadialWipe(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    startAngle: number,
    clockwise: boolean,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.hypot(w, h);
    const start = (startAngle * Math.PI) / 180;
    const direction = clockwise ? 1 : -1;
    ctx.moveTo(cx, cy);
    ctx.arc(
      cx,
      cy,
      radius,
      start,
      start + direction * Math.PI * 2 * progress,
      !clockwise,
    );
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.restore();
  }

  private async renderPixelate(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    maxPixelSize: number,
  ): Promise<void> {
    if (typeof OffscreenCanvas === "undefined") {
      await this.renderCrossfade(outgoing, incoming, progress);
      return;
    }
    const pixelSize = Math.max(
      1,
      Math.round(1 + Math.sin(progress * Math.PI) * Math.max(1, maxPixelSize)),
    );
    const smallWidth = Math.max(1, Math.ceil(this.width / pixelSize));
    const smallHeight = Math.max(1, Math.ceil(this.height / pixelSize));
    if (!this.pixelScratch) {
      this.pixelScratch = new OffscreenCanvas(smallWidth, smallHeight);
      this.pixelScratchCtx = this.pixelScratch.getContext("2d");
    } else {
      this.pixelScratch.width = smallWidth;
      this.pixelScratch.height = smallHeight;
      this.pixelScratchCtx = this.pixelScratch.getContext("2d");
    }
    const pixelCtx = this.pixelScratchCtx;
    if (!pixelCtx) {
      await this.renderCrossfade(outgoing, incoming, progress);
      return;
    }
    pixelCtx.clearRect(0, 0, smallWidth, smallHeight);
    pixelCtx.globalAlpha = 1 - progress;
    pixelCtx.drawImage(outgoing, 0, 0, smallWidth, smallHeight);
    pixelCtx.globalAlpha = progress;
    pixelCtx.drawImage(incoming, 0, 0, smallWidth, smallHeight);
    pixelCtx.globalAlpha = 1;

    const ctx = this.getContext();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pixelScratch, 0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true;
  }

  private async renderGlitch(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    intensity: number,
    slices: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    await this.renderCrossfade(outgoing, incoming, progress);
    const strength = Math.sin(progress * Math.PI) * Math.max(0, intensity) * w;
    const sliceCount = Math.max(4, Math.min(40, Math.round(slices)));
    ctx.globalAlpha = Math.min(0.8, 0.25 + Math.sin(progress * Math.PI) * 0.45);
    for (let index = 0; index < sliceCount; index += 1) {
      const y = Math.floor((index / sliceCount) * h);
      const nextY = Math.ceil(((index + 1) / sliceCount) * h);
      const sliceHeight = Math.max(1, nextY - y);
      const wave = Math.sin(index * 12.9898 + progress * 31.7);
      const offset = wave * strength;
      const source = (index + Math.floor(progress * 10)) % 2 === 0
        ? outgoing
        : incoming;
      ctx.drawImage(source, 0, y, w, sliceHeight, offset, y, w, sliceHeight);
    }
    ctx.globalAlpha = 1;
  }

  private async renderBlinds(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    count: number,
    direction: string,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    const blindCount = Math.max(2, Math.min(32, Math.round(count)));
    const horizontal = direction === "horizontal";
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    if (horizontal) {
      const strip = h / blindCount;
      for (let index = 0; index < blindCount; index += 1) {
        ctx.rect(0, index * strip, w, strip * progress);
      }
    } else {
      const strip = w / blindCount;
      for (let index = 0; index < blindCount; index += 1) {
        ctx.rect(index * strip, 0, strip * progress, h);
      }
    }
    ctx.clip();
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.restore();
  }

  private async renderDiamondReveal(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    center: { x: number; y: number },
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    const cx = w * Math.max(0, Math.min(1, center.x));
    const cy = h * Math.max(0, Math.min(1, center.y));
    const radius =
      Math.max(cx + cy, w - cx + cy, cx + h - cy, w - cx + h - cy) *
      progress;
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx + radius, cy);
    ctx.lineTo(cx, cy + radius);
    ctx.lineTo(cx - radius, cy);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.restore();
  }

  private async renderSpin(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    rotations: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const cx = this.width / 2;
    const cy = this.height / 2;
    const turn = Math.PI * 2 * rotations;
    const draw = (
      source: CanvasImageSource,
      alpha: number,
      scale: number,
      rotation: number,
    ) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      ctx.drawImage(source, 0, 0, this.width, this.height);
      ctx.restore();
    };
    draw(outgoing, 1 - progress, Math.max(0.05, 1 - progress * 0.75), turn * progress);
    draw(
      incoming,
      progress,
      0.25 + progress * 0.75,
      turn * (progress - 1),
    );
  }

  private async renderFlip(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    axis: string,
  ): Promise<void> {
    const ctx = this.getContext();
    const horizontal = axis !== "vertical";
    const firstHalf = progress < 0.5;
    const phase = firstHalf ? 1 - progress * 2 : (progress - 0.5) * 2;
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(horizontal ? Math.max(0.001, phase) : 1, horizontal ? 1 : Math.max(0.001, phase));
    ctx.translate(-this.width / 2, -this.height / 2);
    ctx.drawImage(firstHalf ? outgoing : incoming, 0, 0, this.width, this.height);
    ctx.restore();
  }

  private async renderSplitReveal(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    orientation: string,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    if (orientation === "vertical") {
      const halfHeight = (h * progress) / 2;
      ctx.rect(0, h / 2 - halfHeight, w, halfHeight);
      ctx.rect(0, h / 2, w, halfHeight);
    } else {
      const halfWidth = (w * progress) / 2;
      ctx.rect(w / 2 - halfWidth, 0, halfWidth, h);
      ctx.rect(w / 2, 0, halfWidth, h);
    }
    ctx.clip();
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.restore();
  }

  private async renderFlash(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    intensity: number,
  ): Promise<void> {
    await this.renderCrossfade(outgoing, incoming, progress);
    const ctx = this.getContext();
    ctx.save();
    ctx.fillStyle = "white";
    ctx.globalAlpha = Math.min(1, Math.max(0, intensity) * Math.sin(progress * Math.PI));
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  private async renderFilmBurn(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    intensity: number,
    warmth: number,
  ): Promise<void> {
    await this.renderCrossfade(outgoing, incoming, progress);
    const ctx = this.getContext();
    const peak = Math.sin(progress * Math.PI);
    const clampedIntensity = Math.max(0, Math.min(2, intensity));
    const clampedWarmth = Math.max(0, Math.min(1, warmth));
    const burnRed = Math.round(70 + clampedWarmth * 185);
    const burnGreen = Math.round(180 - clampedWarmth * 105);
    const burnBlue = Math.round(255 - clampedWarmth * 240);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgb(${burnRed}, ${burnGreen}, ${burnBlue})`;
    ctx.globalAlpha = Math.min(1, peak * clampedIntensity * 0.9);
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = "white";
    ctx.globalAlpha = Math.min(0.8, peak * peak * clampedIntensity * 0.55);
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  private async renderMosaic(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    tiles: number,
    randomness: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    ctx.drawImage(outgoing, 0, 0, w, h);
    if (progress <= 0) return;
    if (progress >= 1) {
      ctx.drawImage(incoming, 0, 0, w, h);
      return;
    }

    const columns = Math.max(2, Math.min(24, Math.round(tiles)));
    const rows = Math.max(2, Math.round(columns * (h / w)));
    const tileWidth = w / columns;
    const tileHeight = h / rows;
    const randomMix = Math.max(0, Math.min(1, randomness));

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const order =
          (row * columns + column) / Math.max(1, rows * columns - 1);
        const random = Math.abs(
          Math.sin((column + 1) * 12.9898 + (row + 1) * 78.233) * 43758.5453,
        ) % 1;
        const threshold = order * (1 - randomMix) + random * randomMix;
        if (progress < threshold) continue;
        const x = column * tileWidth;
        const y = row * tileHeight;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, Math.ceil(tileWidth) + 1, Math.ceil(tileHeight) + 1);
        ctx.clip();
        ctx.drawImage(incoming, 0, 0, w, h);
        ctx.restore();
      }
    }
  }

  private async renderRipple(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    amplitude: number,
    waves: number,
  ): Promise<void> {
    if (progress <= 0) {
      this.getContext().drawImage(outgoing, 0, 0, this.width, this.height);
      return;
    }
    if (progress >= 1) {
      this.getContext().drawImage(incoming, 0, 0, this.width, this.height);
      return;
    }

    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    const slices = 32;
    const sliceHeight = h / slices;
    const displacement = Math.max(0, Math.min(0.2, amplitude)) * w;
    const waveCount = Math.max(0.5, Math.min(12, waves));
    ctx.clearRect(0, 0, w, h);
    for (let index = 0; index < slices; index += 1) {
      const y = index * sliceHeight;
      const phase = (index / slices) * Math.PI * 2 * waveCount;
      const offset =
        Math.sin(phase + progress * Math.PI * 2) *
        displacement *
        Math.sin(progress * Math.PI);
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(
        outgoing,
        0,
        y,
        w,
        sliceHeight + 1,
        offset,
        y,
        w,
        sliceHeight + 1,
      );
      ctx.globalAlpha = progress;
      ctx.drawImage(
        incoming,
        0,
        y,
        w,
        sliceHeight + 1,
        -offset,
        y,
        w,
        sliceHeight + 1,
      );
    }
    ctx.globalAlpha = 1;
  }

  private async renderPageTurn(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    direction: string,
    shadow: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    if (progress <= 0) {
      ctx.drawImage(outgoing, 0, 0, w, h);
      return;
    }
    if (progress >= 1) {
      ctx.drawImage(incoming, 0, 0, w, h);
      return;
    }
    const remaining = Math.max(0.001, 1 - progress);
    const turnLeft = direction !== "right";
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.save();
    if (turnLeft) {
      ctx.scale(remaining, 1);
    } else {
      ctx.translate(w, 0);
      ctx.scale(remaining, 1);
      ctx.translate(-w, 0);
    }
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.restore();

    const foldX = turnLeft ? w * remaining : w * progress;
    const shadowWidth = Math.max(2, w * 0.035);
    ctx.save();
    ctx.fillStyle = "black";
    ctx.globalAlpha =
      Math.max(0, Math.min(1, shadow)) *
      Math.sin(progress * Math.PI) *
      0.65;
    ctx.fillRect(
      turnLeft ? foldX - shadowWidth : foldX,
      0,
      shadowWidth,
      h,
    );
    ctx.restore();
  }

  private async renderColorSplit(
    outgoing: CanvasImageSource,
    incoming: CanvasImageSource,
    progress: number,
    maxOffset: number,
    angle: number,
  ): Promise<void> {
    const ctx = this.getContext();
    const w = this.width;
    const h = this.height;
    const peak = Math.sin(progress * Math.PI);
    const offset = Math.max(0, Math.min(80, maxOffset)) * peak;
    const radians = (angle * Math.PI) / 180;
    const dx = Math.cos(radians) * offset;
    const dy = Math.sin(radians) * offset;

    ctx.globalAlpha = 1 - progress;
    ctx.drawImage(outgoing, 0, 0, w, h);
    ctx.globalAlpha = progress;
    ctx.drawImage(incoming, 0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = peak * 0.24;
    ctx.drawImage(outgoing, -dx, -dy, w, h);
    ctx.drawImage(incoming, dx, dy, w, h);
    ctx.restore();
    ctx.globalAlpha = 1;
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

  validateClipEdgeTransition(
    clip: Clip,
    duration: number,
  ): TransitionValidationResult {
    if (duration <= 0) {
      return {
        valid: false,
        error: "Transition duration must be positive",
      };
    }

    const maxDuration = Math.max(0, clip.duration);
    if (maxDuration <= 0) {
      return {
        valid: false,
        error: "Clip must have a positive duration",
      };
    }

    if (duration > maxDuration) {
      return {
        valid: true,
        warning: `Transition duration exceeds clip length. Maximum duration is ${maxDuration.toFixed(
          2,
        )}s`,
        maxDuration,
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

  createClipEdgeTransition(
    clip: Clip,
    edge: TransitionEdge,
    type: TransitionType,
    duration: number,
    params?: Partial<TransitionParams[typeof type]>,
  ): Transition | null {
    const validation = this.validateClipEdgeTransition(clip, duration);
    if (!validation.valid && !validation.warning) {
      return null;
    }

    const actualDuration = validation.maxDuration
      ? Math.min(duration, validation.maxDuration)
      : duration;

    const defaultParams = this.getDefaultParams(type);

    return {
      id: `transition-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      clipAId: clip.id,
      edge,
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
      case "circleReveal":
        return { center: { x: 0.5, y: 0.5 } };
      case "blur":
        return { intensity: 1 };
      case "whipPan":
        return { direction: "left", blurIntensity: 1 };
      case "radialWipe":
        return { startAngle: -90, clockwise: true };
      case "pixelate":
        return { maxPixelSize: 48 };
      case "glitch":
        return { intensity: 0.08, slices: 12 };
      case "blinds":
        return { count: 8, direction: "vertical" };
      case "diamondReveal":
        return { center: { x: 0.5, y: 0.5 } };
      case "spin":
        return { rotations: 1 };
      case "flip":
        return { axis: "horizontal" };
      case "splitReveal":
        return { orientation: "horizontal" };
      case "flash":
        return { intensity: 1 };
      case "filmBurn":
        return { intensity: 1, warmth: 0.75 };
      case "mosaic":
        return { tiles: 8, randomness: 0.85 };
      case "ripple":
        return { amplitude: 0.04, waves: 3 };
      case "pageTurn":
        return { direction: "left", shadow: 0.55 };
      case "colorSplit":
        return { maxOffset: 18, angle: 0 };
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
    const { start, end } = this.getTransitionWindow(transition, clipA);
    const duration = Math.max(0.000001, end - start);

    if (currentTime <= start) {
      return 0;
    }
    if (currentTime >= end) {
      return 1;
    }

    return (currentTime - start) / duration;
  }

  isTimeInTransition(
    transition: Transition,
    clipA: Clip,
    currentTime: number,
  ): boolean {
    const { start, end } = this.getTransitionWindow(transition, clipA);

    return currentTime >= start && currentTime <= end;
  }

  getTransitionWindow(
    transition: Transition,
    clipA: Clip,
  ): { start: number; end: number } {
    const duration = Math.max(0, transition.duration);
    const clipStart = clipA.startTime;
    const clipEnd = clipA.startTime + clipA.duration;

    if (transition.edge === "in") {
      return {
        start: clipStart,
        end: Math.min(clipEnd, clipStart + duration),
      };
    }

    if (transition.edge === "out" || !transition.clipBId) {
      return {
        start: Math.max(clipStart, clipEnd - duration),
        end: clipEnd,
      };
    }

    const start = clipEnd - duration / 2;
    return {
      start,
      end: start + duration,
    };
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
      "circleReveal",
      "blur",
      "whipPan",
      "radialWipe",
      "pixelate",
      "glitch",
      "blinds",
      "diamondReveal",
      "spin",
      "flip",
      "splitReveal",
      "flash",
      "filmBurn",
      "mosaic",
      "ripple",
      "pageTurn",
      "colorSplit",
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
    this.pixelScratch = null;
    this.pixelScratchCtx = null;
  }
}

export function createTransitionEngine(
  width: number = 1920,
  height: number = 1080,
): TransitionEngine {
  return new TransitionEngine({ width, height });
}
