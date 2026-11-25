import type { ObjectMaskLook, RasterPoint, RGBAFrame } from "./types";

/** Binary / soft raster helpers shared by the segmenter, the tracker and the tests. All masks are `width * height`. */

export function maskArea(mask: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0) n++;
  return n;
}

export function maskIoU(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0;
    const y = b[i] > 0;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union === 0 ? 1 : inter / union;
}

export function maskBounds(mask: Uint8Array, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function maskCentroid(mask: Uint8Array, width: number, height: number): RasterPoint | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        sx += x + 0.5;
        sy += y + 0.5;
        n++;
      }
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/** Chamfer-free exact-enough Euclidean distance to the nearest `target` pixel (two pass, 3-4 weights are too coarse). */
function distanceTransform(target: (i: number) => boolean, width: number, height: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = target(i) ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - width] + a);
        if (x > 0) v = Math.min(v, d[i - width - 1] + b);
        if (x < width - 1) v = Math.min(v, d[i - width + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let v = d[i];
      if (x < width - 1) v = Math.min(v, d[i + 1] + a);
      if (y < height - 1) {
        v = Math.min(v, d[i + width] + a);
        if (x < width - 1) v = Math.min(v, d[i + width + 1] + b);
        if (x > 0) v = Math.min(v, d[i + width - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Grow (radius > 0) or shrink (radius < 0) a binary mask by `radius` pixels. */
export function growMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  if (radius === 0) {
    out.set(mask);
    return out;
  }
  if (radius > 0) {
    const d = distanceTransform((i) => mask[i] > 0, width, height);
    for (let i = 0; i < out.length; i++) out[i] = d[i] <= radius ? 1 : 0;
  } else {
    const d = distanceTransform((i) => mask[i] === 0, width, height);
    for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] > -radius ? 1 : 0;
  }
  return out;
}

/** Largest 4-connected component only. */
export function largestComponent(mask: Uint8Array, width: number, height: number, prefer?: (i: number) => boolean): Uint8Array {
  const label = new Int32Array(mask.length);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let next = 1;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    let size = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0 && mask[i - 1] && !label[i - 1]) (label[i - 1] = next), stack.push(i - 1);
      if (x < width - 1 && mask[i + 1] && !label[i + 1]) (label[i + 1] = next), stack.push(i + 1);
      if (y > 0 && mask[i - width] && !label[i - width]) (label[i - width] = next), stack.push(i - width);
      if (y < height - 1 && mask[i + width] && !label[i + width]) (label[i + width] = next), stack.push(i + width);
    }
    sizes.push(size);
    next++;
  }
  let best = 0;
  if (prefer) {
    // The component holding a preferred pixel (the click) wins over a bigger stray one.
    const counts = new Map<number, number>();
    for (let i = 0; i < mask.length; i++) if (label[i] && prefer(i)) counts.set(label[i], (counts.get(label[i]) ?? 0) + 1);
    let most = 0;
    for (const [l, c] of counts) if (c > most) (most = c), (best = l);
  }
  if (!best) for (let l = 1; l < sizes.length; l++) if (sizes[l] > (sizes[best] ?? 0)) best = l;
  const out = new Uint8Array(mask.length);
  if (best) for (let i = 0; i < mask.length; i++) if (label[i] === best) out[i] = 1;
  return out;
}

/** Fill every background region that does not touch the frame edge. */
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (i: number): void => {
    if (!mask[i] && !outside[i]) (outside[i] = 1), stack.push(i);
  };
  for (let x = 0; x < width; x++) (push(x), push((height - 1) * width + x));
  for (let y = 0; y < height; y++) (push(y * width), push(y * width + width - 1));
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] || !outside[i] ? 1 : 0;
  return out;
}

/** Morphological open then close with a `radius` disc: removes specks and one-pixel bridges, seals pin holes. */
export function smoothMask(mask: Uint8Array, width: number, height: number, radius = 1): Uint8Array {
  const opened = growMask(growMask(mask, width, height, -radius), width, height, radius);
  return growMask(growMask(opened, width, height, radius), width, height, -radius);
}

/** Separable box blur applied `passes` times (three passes approximate a Gaussian) on a Float32 raster. */
export function boxBlur(src: Float32Array, width: number, height: number, radius: number, passes = 3): Float32Array {
  const a: Float32Array = Float32Array.from(src);
  if (radius < 0.5) return a;
  const r = Math.max(1, Math.round(radius / Math.sqrt(passes)));
  const b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      let acc = 0;
      const row = y * width;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(width - 1, Math.max(0, x))];
      for (let x = 0; x < width; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(width - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(height - 1, Math.max(0, y)) * width + x];
      for (let y = 0; y < height; y++) {
        a[y * width + x] = acc / (2 * r + 1);
        acc += b[Math.min(height - 1, y + r + 1) * width + x] - b[Math.max(0, y - r) * width + x];
      }
    }
  }
  return a;
}

/**
 * The matte an object mask produces with the project's mask controls: expansion (grow / shrink), feathering
 * (soft edge), invert and opacity. This is the CPU reference of what the mask engine renders for the same
 * parameters, used for the on-screen preview of a fresh segmentation and by the tests.
 */
export function applyMaskLook(mask: Uint8Array, width: number, height: number, look: ObjectMaskLook): Float32Array {
  let base = mask;
  if (look.expansion !== 0) base = growMask(base, width, height, Math.round(look.expansion));
  let alpha: Float32Array = Float32Array.from(base, (v) => (v > 0 ? 1 : 0));
  if (look.feathering > 0) alpha = boxBlur(alpha, width, height, look.feathering);
  const opacity = Math.max(0, Math.min(1, look.opacity));
  for (let i = 0; i < alpha.length; i++) {
    const v = look.inverted ? 1 - alpha[i] : alpha[i];
    alpha[i] = v * opacity;
  }
  return alpha;
}

/** Nearest-neighbour resize of a binary mask. */
export function resizeMask(mask: Uint8Array, fromW: number, fromH: number, toW: number, toH: number): Uint8Array {
  if (fromW === toW && fromH === toH) return mask;
  const out = new Uint8Array(toW * toH);
  for (let y = 0; y < toH; y++) {
    const sy = Math.min(fromH - 1, Math.floor(((y + 0.5) * fromH) / toH));
    for (let x = 0; x < toW; x++) out[y * toW + x] = mask[sy * fromW + Math.min(fromW - 1, Math.floor(((x + 0.5) * fromW) / toW))];
  }
  return out;
}

/** Box-average downscale so the long side is at most `maxDim` (returns the input when it already fits). */
export function downscaleRgba(frame: RGBAFrame, maxDim: number): RGBAFrame {
  const longSide = Math.max(frame.width, frame.height);
  if (longSide <= maxDim) return frame;
  const scale = maxDim / longSide;
  const w = Math.max(1, Math.round(frame.width * scale));
  const h = Math.max(1, Math.round(frame.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * frame.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * frame.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * frame.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * frame.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * frame.width + xx) * 4;
          r += frame.data[i];
          g += frame.data[i + 1];
          b += frame.data[i + 2];
          a += frame.data[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}
