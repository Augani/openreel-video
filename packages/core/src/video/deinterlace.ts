import type { DeinterlaceMode, FieldOrder, FrameConform } from "../media/interpretation";

/** The pixel surface the filters work on (ImageData-compatible). */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Index (0 = first in time) of the field a bob keeps: the source's first field is the sequence's first field only when the orders match. */
export function bobFieldIndex(source: FieldOrder, sequence: FieldOrder | undefined): 0 | 1 {
  if (source === "progressive" || !sequence || sequence === "progressive") return 0;
  return source === sequence ? 0 : 1;
}

/** Row parity (0 = even rows = upper field) of the field that comes `index`-th in time for the given order. */
function fieldParity(order: FieldOrder, index: 0 | 1): 0 | 1 {
  const firstParity = order === "lower" ? 1 : 0;
  return (index === 0 ? firstParity : 1 - firstParity) as 0 | 1;
}

/**
 * Deinterlace a frame in place of a new buffer. Progressive order or mode "none" return the input untouched.
 * - blend: every row becomes the mean of itself and its neighbour in the other field (no combing, half the vertical detail).
 * - bob: keeps one field (see `fieldIndex`: 0 = first in time) and rebuilds the other rows by averaging the kept rows around them.
 */
export function deinterlaceImage(
  image: RasterImage,
  order: FieldOrder,
  mode: DeinterlaceMode,
  fieldIndex: 0 | 1 = 0,
): RasterImage {
  if (order === "progressive" || mode === "none" || image.height < 2) return image;
  const { width, height, data } = image;
  const stride = width * 4;
  const out = new Uint8ClampedArray(data.length);
  const rowAt = (y: number): number => Math.min(height - 1, Math.max(0, y)) * stride;

  if (mode === "blend") {
    for (let y = 0; y < height; y++) {
      const a = y * stride;
      // Pair a row with the row below; the last row pairs with the one above.
      const b = rowAt(y + 1 < height ? y + 1 : y - 1);
      for (let x = 0; x < stride; x++) out[a + x] = (data[a + x] + data[b + x] + 1) >> 1;
    }
    return { width, height, data: out };
  }

  const keep = fieldParity(order, fieldIndex);
  for (let y = 0; y < height; y++) {
    const a = y * stride;
    if ((y & 1) === keep) {
      out.set(data.subarray(a, a + stride), a);
      continue;
    }
    // Neighbours of the opposite parity are the kept field's rows; at an edge only one exists.
    const up = y - 1 >= 0 ? rowAt(y - 1) : -1;
    const down = y + 1 < height ? rowAt(y + 1) : -1;
    for (let x = 0; x < stride; x++) {
      out[a + x] = up >= 0 && down >= 0 ? (data[up + x] + data[down + x] + 1) >> 1 : data[(up >= 0 ? up : down) + x];
    }
  }
  return { width, height, data: out };
}

/**
 * A new bitmap with the footage's field order and pixel aspect applied: deinterlaced at the stored resolution, then
 * stretched horizontally to the display width. Returns the input untouched when nothing applies or no 2D canvas exists.
 * The caller keeps ownership of `frame`; a returned different bitmap is the caller's to close.
 */
export async function conformBitmap(
  frame: ImageBitmap,
  conform: FrameConform,
  sequenceFieldOrder?: FieldOrder,
): Promise<ImageBitmap> {
  if (typeof OffscreenCanvas === "undefined") return frame;
  let source: ImageBitmap | OffscreenCanvas = frame;
  if (conform.deinterlace !== "none" && conform.fieldOrder !== "progressive") {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return frame;
    ctx.drawImage(frame, 0, 0);
    const pixels = ctx.getImageData(0, 0, frame.width, frame.height);
    const result = deinterlaceImage(pixels, conform.fieldOrder, conform.deinterlace, bobFieldIndex(conform.fieldOrder, sequenceFieldOrder));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(result.data), frame.width, frame.height), 0, 0);
    source = canvas;
  }
  const displayWidth =
    Math.abs(conform.pixelAspect - 1) < 1e-9 ? frame.width : Math.max(2, Math.round((frame.width * conform.pixelAspect) / 2) * 2);
  if (displayWidth !== frame.width) {
    const canvas = new OffscreenCanvas(displayWidth, frame.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return frame;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, displayWidth, frame.height);
    source = canvas;
  }
  if (source === frame) return frame;
  return createImageBitmap(source);
}
