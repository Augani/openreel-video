/**
 * RGBA (sRGB code values, what the canvas holds) to planar 8-bit 4:2:0 YCbCr, BT.709 matrix, limited range.
 *
 * This is the conversion the default (non colour-managed) native export used to leave to ffmpeg
 * (`scale=out_color_matrix=bt709:out_range=tv`, see COLOR_PIPELINE_ARGS): the gamma-coded R'G'B' values go through the
 * BT.709 matrix directly. Chroma is subsampled the way swscale does it, so the file matches the one ffmpeg used to make
 * from RGBA: pairs of pixels are averaged horizontally, then an 8-tap bicubic filter (Keys, B = 0, C = 0.6, centred between
 * the two source rows of each chroma row, edge rows clamped) halves the height. The GPU converter in
 * video/gpu-frame-readback.ts runs the same arithmetic in WGSL; this CPU version is its reference in tests and the
 * fallback when the GPU path fails mid-export.
 */

function keysCubic(distance: number, b = 0, c = 0.6): number {
  const d = Math.abs(distance);
  if (d < 1) return ((12 - 9 * b - 6 * c) * d ** 3 + (-18 + 12 * b + 6 * c) * d ** 2 + (6 - 2 * b)) / 6;
  if (d < 2) return ((-b - 6 * c) * d ** 3 + (6 * b + 30 * c) * d ** 2 + (-12 * b - 48 * c) * d + (8 * b + 24 * c)) / 6;
  return 0;
}

/**
 * Weights of the vertical chroma filter for source rows 2i - 3 .. 2i + 4 (the chroma sample sits at row 2i + 0.5, the
 * kernel is stretched by the factor 2 of the downscale). Normalised to sum to 1.
 */
export const I420_CHROMA_TAPS: readonly number[] = (() => {
  const raw = Array.from({ length: 8 }, (_, k) => keysCubic((k - 3 - 0.5) / 2));
  const sum = raw.reduce((a, v) => a + v, 0);
  return raw.map((v) => v / sum);
})();

export const I420_LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

/**
 * Fixed-point (2^-15) BT.709 limited-range luma weights, the values that reproduce ffmpeg's RGBA to YUV output for
 * all but 0.15% of the samples (those differ by one code value): Y = (R*5984 + G*20128 + B*2032 + (16.5 << 15)) >> 15.
 */
export const I420_LUMA_FIXED = { r: 5984, g: 20128, b: 2032, offset: 33 << 14 } as const;

/** Bytes of one I420 frame: Y plane, then the Cb plane, then the Cr plane. */
export function i420ByteLength(width: number, height: number): number {
  return width * height + 2 * (width / 2) * (height / 2);
}

/** Limited-range 8-bit codes of one pixel from R'G'B' in 0..1 (before rounding, chroma averaging and clamping). */
function pixelCodes(r: number, g: number, b: number): { y: number; cb: number; cr: number } {
  const y = I420_LUMA.r * r + I420_LUMA.g * g + I420_LUMA.b * b;
  return {
    y: 16 + 219 * y, // float reference of the fixed-point luma used for the output plane
    cb: 128 + (224 * (b - y)) / (2 * (1 - I420_LUMA.b)),
    cr: 128 + (224 * (r - y)) / (2 * (1 - I420_LUMA.r)),
  };
}

/** `rgba` is width * height * 4 bytes; both dimensions must be even. */
export function rgbaToI420Bt709(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, target?: ArrayBuffer): ArrayBuffer {
  if (width % 2 !== 0 || height % 2 !== 0) throw new Error(`4:2:0 needs even frame dimensions, got ${width}x${height}.`);
  const out = new Uint8Array(target && target.byteLength === i420ByteLength(width, height) ? target : new ArrayBuffer(i420ByteLength(width, height)));
  const chromaWidth = width / 2;
  const chromaHeight = height / 2;
  const planeSize = width * height;
  const chromaSize = chromaWidth * chromaHeight;
  const cb = new Float32Array(planeSize);
  const cr = new Float32Array(planeSize);
  for (let p = 0, o = 0; p < planeSize; p++, o += 4) {
    const codes = pixelCodes(rgba[o] / 255, rgba[o + 1] / 255, rgba[o + 2] / 255);
    out[p] = (I420_LUMA_FIXED.r * rgba[o] + I420_LUMA_FIXED.g * rgba[o + 1] + I420_LUMA_FIXED.b * rgba[o + 2] + I420_LUMA_FIXED.offset) >> 15;
    cb[p] = codes.cb;
    cr[p] = codes.cr;
  }
  // Horizontal: the mean of each pair of pixels, kept as floats per source row.
  const cbRows = new Float32Array(chromaWidth * height);
  const crRows = new Float32Array(chromaWidth * height);
  for (let y = 0; y < height; y++) {
    for (let cx = 0; cx < chromaWidth; cx++) {
      const i0 = y * width + cx * 2;
      cbRows[y * chromaWidth + cx] = (cb[i0] + cb[i0 + 1]) / 2;
      crRows[y * chromaWidth + cx] = (cr[i0] + cr[i0 + 1]) / 2;
    }
  }
  // Vertical: the 8-tap filter, rows past either edge repeat the edge row.
  for (let cy = 0; cy < chromaHeight; cy++) {
    for (let cx = 0; cx < chromaWidth; cx++) {
      let u = 0;
      let v = 0;
      for (let k = 0; k < 8; k++) {
        const row = Math.min(height - 1, Math.max(0, cy * 2 - 3 + k));
        u += I420_CHROMA_TAPS[k] * cbRows[row * chromaWidth + cx];
        v += I420_CHROMA_TAPS[k] * crRows[row * chromaWidth + cx];
      }
      const o = cy * chromaWidth + cx;
      out[planeSize + o] = Math.max(16, Math.min(240, Math.floor(u + 0.5)));
      out[planeSize + chromaSize + o] = Math.max(16, Math.min(240, Math.floor(v + 0.5)));
    }
  }

  return out.buffer;
}
