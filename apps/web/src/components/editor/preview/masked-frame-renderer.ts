import { splitMasksByTarget, type Mask, type MaskEngine } from "@openreel/core";
import { drawFrameWithTransform } from "./canvas-renderers";
import type { ClipTransform } from "./types";

type MaskEngineSurface = Pick<MaskEngine, "applyMasks" | "loadMasks"> & Partial<Pick<MaskEngine, "composeEffectMasks">>;
type FrameSource = Parameters<typeof drawFrameWithTransform>[1];

interface MaskedFrameRendererDependencies {
  createBitmap?: (source: FrameSource) => Promise<ImageBitmap>;
  createCanvas?: (width: number, height: number) => OffscreenCanvas;
  drawFrame?: typeof drawFrameWithTransform;
}

interface DrawFrameWithMasksOptions {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  frame: FrameSource;
  transform: ClipTransform;
  canvasWidth: number;
  canvasHeight: number;
  masks: readonly Mask[];
  maskEngine: MaskEngineSurface;
  time: number;
  filter?: string;
  /** The frame before effects and grade; effect masks show it where their matte is clear. */
  baseFrame?: FrameSource;
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
  const { visibility, effects } = splitMasksByTarget(options.masks);
  const compose = options.maskEngine.composeEffectMasks?.bind(options.maskEngine);
  const baseFrame = options.baseFrame;
  const scoped = effects.length > 0 && baseFrame !== undefined && compose !== undefined;
  if (visibility.length === 0 && !scoped) {
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

  let renderedLayer = await createBitmap(layerCanvas);
  try {
    if (scoped) {
      // Effects only inside (or outside, when inverted) the matte: cross-fade the processed and raw pictures.
      const baseCanvas = createCanvas(options.canvasWidth, options.canvasHeight);
      const baseCtx = baseCanvas.getContext("2d");
      if (baseCtx) {
        drawFrame(
          baseCtx as unknown as CanvasRenderingContext2D,
          baseFrame,
          options.transform,
          options.canvasWidth,
          options.canvasHeight,
        );
        options.maskEngine.loadMasks([...effects]);
        const mixed = await compose(renderedLayer, baseCanvas, effects, options.time);
        renderedLayer.close();
        renderedLayer = mixed;
      }
    }
    if (visibility.length > 0) {
      options.maskEngine.loadMasks([...visibility]);
      const result = await options.maskEngine.applyMasks(
        renderedLayer,
        visibility,
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
