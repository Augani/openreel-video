import type { Point, Rectangle } from "./motion-tracking-engine";
import { refineSubpixel } from "./motion-frame-tracker";

/** Largest side, in samples, of the reference template. Keeps every search cheap. */
const TEMPLATE_SAMPLES = 24;

/** Summed-area table of a gray image; box means are O(1). */
export interface IntegralImage {
  width: number;
  height: number;
  sums: Float64Array;
}

export function buildIntegral(gray: Float32Array, width: number, height: number): IntegralImage {
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  return { width, height, sums };
}

function boxMean(image: IntegralImage, x0: number, y0: number, x1: number, y1: number): number {
  const stride = image.width + 1;
  const ax = Math.max(0, Math.min(image.width, Math.floor(x0))), bx = Math.max(ax + 1, Math.min(image.width, Math.ceil(x1)));
  const ay = Math.max(0, Math.min(image.height, Math.floor(y0))), by = Math.max(ay + 1, Math.min(image.height, Math.ceil(y1)));
  const area = (Math.min(image.width, bx) - ax) * (Math.min(image.height, by) - ay);
  if (area <= 0) return 0;
  const { sums } = image;
  return (sums[by * stride + bx] - sums[ay * stride + bx] - sums[by * stride + ax] + sums[ay * stride + ax]) / area;
}

/** Zero-mean, unit-length samples of a (cols x rows) grid centred on (cx, cy), each sample a `factor` px box. */
function samplePatch(image: IntegralImage, cx: number, cy: number, cols: number, rows: number, factor: number, out: Float32Array): boolean {
  const left = cx - cols * factor / 2, top = cy - rows * factor / 2;
  if (left < -factor || top < -factor || left + cols * factor > image.width + factor || top + rows * factor > image.height + factor) return false;
  let sum = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const value = boxMean(image, left + c * factor, top + r * factor, left + (c + 1) * factor, top + (r + 1) * factor);
    out[r * cols + c] = value; sum += value;
  }
  const mean = sum / out.length;
  let energy = 0;
  for (let i = 0; i < out.length; i++) { out[i] -= mean; energy += out[i] * out[i]; }
  if (energy / out.length < 16) return false; // flat: no identifiable position
  const norm = Math.sqrt(energy);
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return true;
}

export interface ReferenceTemplate {
  cols: number;
  rows: number;
  /** Source pixels covered by one template sample at the scale the template was captured at. */
  factor: number;
  samples: Float32Array;
}

/** Capture the appearance of `region` (analysis pixels) as a fixed-size reference. Null when the region is flat. */
export function captureTemplate(image: IntegralImage, region: Rectangle): ReferenceTemplate | null {
  const longest = Math.max(region.width, region.height);
  const factor = Math.max(1, longest / TEMPLATE_SAMPLES);
  const cols = Math.max(4, Math.round(region.width / factor)), rows = Math.max(4, Math.round(region.height / factor));
  const samples = new Float32Array(cols * rows);
  if (!samplePatch(image, region.x + region.width / 2, region.y + region.height / 2, cols, rows, factor, samples)) return null;
  return { cols, rows, factor, samples };
}

export interface TemplateMatch {
  position: Point;
  score: number;
  /** Size ratio of the match relative to the captured template (1 = same size). */
  ratio: number;
}

function score(template: ReferenceTemplate, image: IntegralImage, x: number, y: number, factor: number, scratch: Float32Array): number {
  if (!samplePatch(image, x, y, template.cols, template.rows, factor, scratch)) return -1;
  let dot = 0;
  for (let i = 0; i < scratch.length; i++) dot += scratch[i] * template.samples[i];
  return dot;
}

export interface TemplateSearchOptions {
  center: Point;
  radius: number;
  /** Size ratios to try (multiples of `baseRatio`). Multi-scale search for zoom or approach. */
  scales?: number[];
  baseRatio?: number;
  /** Force a candidate stride in pixels (default: about one template sample). 1 = exhaustive, for fine corrections. */
  step?: number;
}

/**
 * Coarse-to-fine normalized cross-correlation of the reference template inside a window around `center`.
 * The coarse pass strides by half a template sample, the fine pass walks one pixel around the best coarse hit.
 */
export function searchTemplate(template: ReferenceTemplate, image: IntegralImage, options: TemplateSearchOptions): TemplateMatch | null {
  const scratch = new Float32Array(template.samples.length);
  const base = options.baseRatio ?? 1;
  let best: TemplateMatch | null = null;
  for (const multiplier of options.scales ?? [1]) {
    const ratio = base * multiplier, factor = template.factor * ratio;
    const step = options.step ?? Math.max(1, Math.round(factor));
    let bestHere: { x: number; y: number; score: number } | null = null;
    for (let y = options.center.y - options.radius; y <= options.center.y + options.radius; y += step) {
      for (let x = options.center.x - options.radius; x <= options.center.x + options.radius; x += step) {
        const value = score(template, image, x, y, factor, scratch);
        if (!bestHere || value > bestHere.score) bestHere = { x, y, score: value };
      }
    }
    if (!bestHere) continue;
    const coarse = bestHere;
    if (step > 1) {
      for (let y = coarse.y - step; y <= coarse.y + step; y++) for (let x = coarse.x - step; x <= coarse.x + step; x++) {
        const value = score(template, image, x, y, factor, scratch);
        if (value > bestHere.score) bestHere = { x, y, score: value };
      }
    }
    if (bestHere.score > (best?.score ?? -2)) {
      const peak = bestHere;
      // Sub-pixel peak: the template is sampled on a box grid, so neighbouring integer scores bracket the true position.
      const fine = refineSubpixel(peak.score, (dx, dy) => score(template, image, peak.x + dx, peak.y + dy, factor, scratch));
      best = { position: { x: peak.x + fine.x, y: peak.y + fine.y }, score: peak.score, ratio };
    }
  }
  return best && best.score > -1 ? best : null;
}
