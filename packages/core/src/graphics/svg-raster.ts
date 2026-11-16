/**
 * One SVG rasterisation plan shared by the editor preview (apps/web canvas-renderers)
 * and the export compositor (graphics-engine). Both used to rasterise the SVG
 * independently - different padding, different raster scale quantisation - and then
 * drew the bitmap through the clip transform, so thin strokes landed on different
 * sub-pixels and 4-11% of lit pixels differed between preview and export.
 *
 * The plan: rasterise the SVG at (about) its on-screen size, with a transparent
 * margin so strokes at the viewBox edge are never clipped and the bitmap's edge never
 * bleeds into the picture, then draw the padded bitmap centred on the clip origin.
 */

/** Transparent margin (raster pixels) around the rasterised SVG. */
export const SVG_RASTER_PAD = 16;

/**
 * Raster scale for a clip scale. Quantised so an animated scale re-uses a handful of
 * rasters instead of one per frame, but fine enough that the bitmap is never drawn
 * much smaller than it was rasterised (bilinear down-scaling by more than ~1.3x
 * aliases thin strokes). Never below 1/8 so a tiny clip is still rasterised sanely.
 */
export function svgRasterBucket(maxAbsScale: number): number {
  const scale = Number.isFinite(maxAbsScale) && maxAbsScale > 0 ? maxAbsScale : 1;
  return Math.max(0.125, Math.ceil(scale * 8) / 8);
}

export interface SvgRasterPlan {
  readonly bucket: number;
  /** Raster size of the SVG itself (without margin). */
  readonly renderWidth: number;
  readonly renderHeight: number;
  /** Bitmap size including the margin on every side. */
  readonly paddedWidth: number;
  readonly paddedHeight: number;
  /** Size the SVG occupies in canvas pixels before the clip scale (bitmap size / bucket). */
  readonly drawWidth: number;
  readonly drawHeight: number;
  /** Margin in canvas pixels before the clip scale. */
  readonly padDraw: number;
}

export function planSvgRaster(
  viewBox: { readonly width: number; readonly height: number } | undefined,
  canvasWidth: number,
  canvasHeight: number,
  scaleX: number,
  scaleY: number,
): SvgRasterPlan {
  const vbW = viewBox?.width || 200;
  const vbH = viewBox?.height || 200;
  const aspect = vbW / vbH;
  const bucket = svgRasterBucket(Math.max(Math.abs(scaleX), Math.abs(scaleY)));
  let renderWidth: number;
  let renderHeight: number;
  if (aspect > 1) {
    renderWidth = Math.max(1, Math.ceil(canvasWidth * bucket));
    renderHeight = Math.max(1, Math.ceil(renderWidth / aspect));
  } else {
    renderHeight = Math.max(1, Math.ceil(canvasHeight * bucket));
    renderWidth = Math.max(1, Math.ceil(renderHeight * aspect));
  }
  return {
    bucket,
    renderWidth,
    renderHeight,
    paddedWidth: renderWidth + SVG_RASTER_PAD * 2,
    paddedHeight: renderHeight + SVG_RASTER_PAD * 2,
    drawWidth: renderWidth / bucket,
    drawHeight: renderHeight / bucket,
    padDraw: SVG_RASTER_PAD / bucket,
  };
}

/**
 * The SVG source sized to the padded raster: width/height are the padded bitmap and
 * the viewBox grows by the margin so the artwork stays exactly where it was.
 */
export function padSvgForRaster(
  svgContent: string,
  plan: Pick<SvgRasterPlan, "renderWidth" | "renderHeight" | "paddedWidth" | "paddedHeight">,
  viewBox?: { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number },
): string {
  const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return svgContent;
  const vbMinX = viewBox?.minX ?? 0;
  const vbMinY = viewBox?.minY ?? 0;
  const vbWidth = viewBox?.width ?? plan.renderWidth;
  const vbHeight = viewBox?.height ?? plan.renderHeight;
  const padX = (SVG_RASTER_PAD / plan.renderWidth) * vbWidth;
  const padY = (SVG_RASTER_PAD / plan.renderHeight) * vbHeight;
  svgEl.setAttribute("width", String(plan.paddedWidth));
  svgEl.setAttribute("height", String(plan.paddedHeight));
  svgEl.setAttribute("viewBox", `${vbMinX - padX} ${vbMinY - padY} ${vbWidth + padX * 2} ${vbHeight + padY * 2}`);
  svgEl.setAttribute("overflow", "visible");
  return new XMLSerializer().serializeToString(svgEl);
}
