import type { Mask, MaskEngine } from "@openreel/core";
import { drawFrameWithTransform } from "./canvas-renderers";
import type { ClipTransform } from "./types";

type MaskEngineSurface = Pick<MaskEngine, "applyMask" | "loadMasks">;
type FrameSource = Parameters<typeof drawFrameWithTransform>[1];

interface MaskedFrameRendererDependencies {
  createBitmap?: (source: FrameSource) => Promise<ImageBitmap>;
  createCanvas?: (width: number, height: number) => OffscreenCanvas;
  drawFrame?: typeof drawFrameWithTransform;
}

export interface DrawFrameWithMasksOptions {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  frame: FrameSource;
  transform: ClipTransform;
  canvasWidth: number;
  canvasHeight: number;
  masks: readonly Mask[];
  maskEngine: MaskEngineSurface;
  time: number;
  filter?: string;
}

/**
 * Draw a transformed clip into an isolated full-frame layer before applying
 * its masks. Keeping masks in composition space means they remain aligned
 * with animated transforms and match the export compositor.
 */
export async function drawFrameWithMasks(
  options: DrawFrameWithMasksOptions,
  dependencies: MaskedFrameRendererDependencies = {},
): Promise<void> {
  const drawFrame = dependencies.drawFrame ?? drawFrameWithTransform;
  if (options.masks.length === 0) {
    drawFrame(
      options.ctx as CanvasRenderingContext2D,
      options.frame,
      options.transform,
      options.canvasWidth,
      options.canvasHeight,
      options.filter,
    );
    return;
  }

  const createCanvas =
    dependencies.createCanvas ??
    ((width: number, height: number) => new OffscreenCanvas(width, height));
  const createBitmap = dependencies.createBitmap ?? createImageBitmap;
  const layerCanvas = createCanvas(options.canvasWidth, options.canvasHeight);
  const layerCtx = layerCanvas.getContext("2d");
  if (!layerCtx) return;

  drawFrame(
    layerCtx as unknown as CanvasRenderingContext2D,
    options.frame,
    options.transform,
    options.canvasWidth,
    options.canvasHeight,
    options.filter,
  );

  options.maskEngine.loadMasks([...options.masks]);
  let renderedLayer = await createBitmap(layerCanvas);
  try {
    for (const mask of options.masks) {
      const result = await options.maskEngine.applyMask(
        renderedLayer,
        mask,
        options.time,
      );
      renderedLayer.close();
      renderedLayer = result.image;
    }
    options.ctx.drawImage(
      renderedLayer,
      0,
      0,
      options.canvasWidth,
      options.canvasHeight,
    );
  } finally {
    renderedLayer.close();
  }
}
