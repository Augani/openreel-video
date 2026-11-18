/**
 * Sequence pixel aspect ratio (PAR) helpers shared by every renderer that draws titles, shapes, SVG, stickers
 * and captions. Overlays are laid out in display space (stored width x PAR by stored height, so a circle is
 * authored as a circle) and then squeezed horizontally back into stored pixels, exactly like video clips.
 */

export const MIN_SEQUENCE_PAR = 0.25;
export const MAX_SEQUENCE_PAR = 4;

/** Valid sequence PAR, or 1 (square) when unset or out of range. */
export function normalizeSequencePar(par: number | undefined | null): number {
  return typeof par === "number" && Number.isFinite(par) && par >= MIN_SEQUENCE_PAR && par <= MAX_SEQUENCE_PAR ? par : 1;
}

/** Width, in display pixels, of a stored frame `storedWidth` wide. */
export function displayLayoutWidth(storedWidth: number, par: number): number {
  return par === 1 ? storedWidth : Math.max(1, Math.round(storedWidth * par));
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createStoredCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Sequence pixel aspect needs a canvas (OffscreenCanvas or document) to squeeze overlays");
}

/**
 * Squeeze a display-space overlay canvas into a stored-pixel canvas. Returns `source` untouched for square pixels.
 * For a non-square PAR it never returns the unsqueezed source: without any canvas implementation it throws
 * instead of silently skipping the transform.
 */
export function squeezeOverlayToStored(
  source: OffscreenCanvas | HTMLCanvasElement,
  storedWidth: number,
  storedHeight: number,
  par: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (par === 1) return source;
  const squeezed = createStoredCanvas(storedWidth, storedHeight);
  const ctx = squeezed.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("Sequence pixel aspect could not create a 2D context to squeeze an overlay");
  ctx.drawImage(source, 0, 0, storedWidth, storedHeight);
  return squeezed;
}

/**
 * Run `draw` against a context laid out in display space: the context is squeezed by 1/PAR and `draw` receives the
 * display width to lay out in. For square pixels it simply calls `draw` with the stored width.
 */
export function withDisplaySpace(
  ctx: Ctx2D,
  storedWidth: number,
  par: number,
  draw: (layoutWidth: number) => void,
): void {
  if (par === 1) {
    draw(storedWidth);
    return;
  }
  const layoutWidth = displayLayoutWidth(storedWidth, par);
  ctx.save();
  ctx.scale(storedWidth / layoutWidth, 1);
  try {
    draw(layoutWidth);
  } finally {
    ctx.restore();
  }
}

/**
 * Snapshot of a stored-pixel canvas resampled into display space (stored width x PAR by stored height), for running
 * blur-like effects (blur, glow, shadow, sharpen, motion blur ...) whose radii are measured in image pixels: run on
 * stored pixels they are anisotropic once the frame is shown, run on this bitmap they are isotropic where it is looked
 * at. Draw the processed bitmap back with `drawImage(processed, 0, 0, storedWidth, storedHeight)`, which squeezes it.
 * For square pixels this is a plain snapshot of the region. The caller owns (and closes) the bitmap.
 */
export function snapshotInDisplaySpace(
  source: ImageBitmapSource,
  storedWidth: number,
  storedHeight: number,
  par: number,
): Promise<ImageBitmap> {
  if (par === 1) return createImageBitmap(source, 0, 0, storedWidth, storedHeight);
  return createImageBitmap(source, 0, 0, storedWidth, storedHeight, {
    resizeWidth: displayLayoutWidth(storedWidth, par),
    resizeHeight: storedHeight,
    resizeQuality: "high",
  });
}

/** Size of the frame as displayed (what the Program monitor shows): stored width x PAR by stored height. */
export function displayFrameSize(storedWidth: number, storedHeight: number, par: number): { width: number; height: number } {
  return { width: displayLayoutWidth(storedWidth, normalizeSequencePar(par)), height: storedHeight };
}
