/**
 * Draws the Echo effect: the current frame plus its time-offset echo frames,
 * combined with the chosen operator. Canvas2D composite operations do the
 * per-pixel work (hardware accelerated in browsers) and are the same on the
 * GPU and software paths; compositeEchoReference in temporal-effects.ts is the
 * pure definition they are verified against.
 *
 * One compositor owns one scratch canvas, so a VideoEngine (or preview lane)
 * must not run two composes at once; callers await each compose.
 */
import {
  echoDimsBase,
  type EchoOperator,
  type ResolvedEcho,
} from "./temporal-effects";

export interface EchoFrame {
  readonly image: CanvasImageSource;
  readonly weight: number;
}

const COMPOSITE_OPERATION: Readonly<Record<EchoOperator, GlobalCompositeOperation>> = {
  add: "lighter",
  maximum: "lighten",
  minimum: "darken",
  screen: "screen",
  "composite-back": "destination-over",
  "composite-front": "source-over",
};

export class EchoCompositor {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  private context(width: number, height: number): OffscreenCanvasRenderingContext2D {
    if (!this.canvas || !this.ctx) {
      this.canvas = new OffscreenCanvas(width, height);
      const ctx = this.canvas.getContext("2d", { willReadFrequently: false });
      if (!ctx) throw new Error("2D canvas unavailable");
      this.ctx = ctx;
    } else if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return this.ctx as OffscreenCanvasRenderingContext2D;
  }

  /**
   * Draws `base` and the echoes (already in compositing order, see planEcho)
   * onto the scratch canvas, which is returned and valid until the next call.
   * Echo images are scaled to the base's size.
   */
  draw(
    base: ImageBitmap,
    echoes: readonly EchoFrame[],
    echo: Pick<ResolvedEcho, "operator" | "startIntensity">,
  ): OffscreenCanvas {
    const { width, height } = base;
    const ctx = this.context(width, height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.globalAlpha = 1;
    // Straight RGB scale; alpha of the current frame is untouched.
    ctx.filter =
      echoDimsBase(echo.operator) && echo.startIntensity < 1
        ? `brightness(${echo.startIntensity})`
        : "none";
    ctx.drawImage(base, 0, 0, width, height);
    ctx.filter = "none";
    ctx.globalCompositeOperation = COMPOSITE_OPERATION[echo.operator];
    for (const frame of echoes) {
      ctx.globalAlpha = Math.min(1, Math.max(0, frame.weight));
      ctx.drawImage(frame.image, 0, 0, width, height);
    }
    ctx.restore();
    return this.canvas as OffscreenCanvas;
  }

  /** Same as draw, returned as a new bitmap the caller owns. */
  async compose(
    base: ImageBitmap,
    echoes: readonly EchoFrame[],
    echo: Pick<ResolvedEcho, "operator" | "startIntensity">,
  ): Promise<ImageBitmap> {
    return createImageBitmap(this.draw(base, echoes, echo));
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }
}
