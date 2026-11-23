/**
 * Frame Blending: out = (1 - t) * a + t * b, per channel, rounded once.
 * The one definition both the preview and the export use (and the tests check against).
 */
export interface RGBAFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

export function blendRGBA(a: RGBAFrame, b: RGBAFrame, t: number, out?: Uint8ClampedArray): Uint8ClampedArray {
  if (a.width !== b.width || a.height !== b.height) throw new Error("Frame Blending needs frames of the same size");
  const n = a.width * a.height * 4;
  const result = out ?? new Uint8ClampedArray(n);
  const w = Math.min(1, Math.max(0, t));
  const wa = 1 - w;
  const da = a.data;
  const db = b.data;
  for (let i = 0; i < n; i++) result[i] = Math.round(da[i] * wa + db[i] * w);
  return result;
}
