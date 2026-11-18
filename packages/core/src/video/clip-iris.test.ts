import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Keyframe } from "../types/timeline";
import { normalizeLegacyIrisKeyframes, IRIS_SHAPES } from "./clip-iris";
import { VideoEffectsEngine } from "./video-effects-engine";

type PixelFrame = { width: number; height: number; pixels: Uint8ClampedArray };
type Point = [number, number];
const canvases: RasterCanvas[] = [];
/** A generic even-odd Canvas2D raster surface, independent of any iris preset. */
class RasterCanvas implements PixelFrame {
  pixels: Uint8ClampedArray;
  context: ReturnType<RasterCanvas["makeContext"]>;
  constructor(public width: number, public height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.context = this.makeContext(); canvases.push(this);
  }
  getContext() { return this.context; }
  makeContext() {
    let paths: ((x: number, y: number) => boolean)[] = [];
    let contour: Point[] = [];
    let clip: ((x: number, y: number) => boolean) | null = null;
    const stack: (null | ((x: number, y: number) => boolean))[] = [];
    const polygon = () => {
      const points = [...contour]; contour = [];
      if (points.length < 3) return;
      paths.push((x, y) => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i], b = points[j];
          if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
      });
    };
    return {
      canvas: this, filter: "none",
      save: () => stack.push(clip), restore: () => { clip = stack.pop() ?? null; }, setTransform() {},
      beginPath: () => { paths = []; contour = []; },
      rect: (x: number, y: number, w: number, h: number) => paths.push((px, py) => px >= x && px < x + w && py >= y && py < y + h),
      moveTo: (x: number, y: number) => { polygon(); contour = [[x, y]]; },
      lineTo: (x: number, y: number) => contour.push([x, y]), closePath: polygon,
      arc: (x: number, y: number, radius: number) => { contour = []; paths.push((px, py) => Math.hypot(px - x, py - y) <= radius); },
      clip: (rule: string) => { expect(rule).toBe("evenodd"); polygon(); const shapes = [...paths]; clip = (x, y) => shapes.filter(shape => shape(x, y)).length % 2 === 1; },
      clearRect: (x: number, y: number, w: number, h: number) => {
        for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
          if (!clip || clip(px + 0.5, py + 0.5)) this.pixels.fill(0, (py * this.width + px) * 4, (py * this.width + px) * 4 + 4);
        }
      },
      drawImage: (frame: PixelFrame) => { this.pixels = new Uint8ClampedArray(frame.pixels); },
      getImageData: vi.fn(() => { throw new Error("Vector reveals must not read back pixels"); }),
      putImageData: vi.fn(() => { throw new Error("Vector reveals must not rewrite color data"); }),
    };
  }
}
function legacy(shape: string, side = "entry"): Keyframe[] {
  const entry = side === "entry";
  return ["x", "y"].flatMap((axis, index) => [
    { id: `kf-${side}-iris-${shape}-scale-${index}`, property: `scale.${axis}`, time: entry ? 0 : 3.5, value: entry ? 0 : axis === "x" ? -2 : 0.5, easing: "linear" as const },
    { id: `kf-${side}-iris-${shape}-scale-${index + 2}`, property: `scale.${axis}`, time: entry ? 0.5 : 4, value: entry ? axis === "x" ? -2 : 0.5 : 0, easing: "linear" as const },
  ]).concat([
    { id: `kf-${side}-iris-${shape}-opacity-0`, property: "opacity", time: entry ? 0 : 3.5, value: entry ? 0.5 : 0.7, easing: "linear" },
    { id: `kf-${side}-iris-${shape}-opacity-1`, property: "opacity", time: entry ? 0.5 : 4, value: entry ? 0.7 : 0.5, easing: "linear" },
  ]);
}

describe("saved iris animation migration", () => {
  it.each(IRIS_SHAPES)("upgrades %s from zoom/fade to reveal while preserving manual keys and negative/nonuniform base scale", shape => {
    const manual: Keyframe = { id: "manual", property: "rotation", time: 2, value: 17, easing: "linear" };
    const before = [manual, ...legacy(shape), ...legacy(shape, "exit")];
    const snapshot = structuredClone(before);
    const next = normalizeLegacyIrisKeyframes(before);
    expect(next[0]).toBe(manual);
    expect(next.slice(1).map(key => [key.time, key.property, key.value])).toEqual([
      [0, `effect.iris-${shape}`, 0], [0.5, `effect.iris-${shape}`, 1], [3.5, `effect.iris-${shape}`, 1], [4, `effect.iris-${shape}`, 0],
    ]);
    expect(before).toEqual(snapshot);
    expect(normalizeLegacyIrisKeyframes(next)).toBe(next);
  });
  it("retains ordinary keyframes by identity and recognizes the old unnamed circle pattern", () => {
    const ordinary = [{ id: "manual", property: "scale.x", time: 0, value: 0, easing: "linear" as const }];
    expect(normalizeLegacyIrisKeyframes(ordinary)).toBe(ordinary);
    const unnamed = legacy("circle").map(key => ({ ...key, id: key.id.replace("iris-circle-", "") }));
    expect(normalizeLegacyIrisKeyframes(unnamed).map(key => key.property)).toEqual(["effect.iris-circle", "effect.iris-circle"]);
  });
});

describe("shared iris mask pixels", () => {
  const source: PixelFrame = { width: 200, height: 100, pixels: new Uint8ClampedArray(200 * 100 * 4) };
  const pixel = (frame: PixelFrame, x: number, y: number) => [...frame.pixels.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4)];
  beforeEach(() => {
    canvases.length = 0;
    for (let i = 0; i < source.pixels.length; i += 4) source.pixels.set([80, 120, 200, 137], i);
    vi.stubGlobal("OffscreenCanvas", RasterCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async (frame: PixelFrame) => ({ width: frame.width, height: frame.height, pixels: new Uint8ClampedArray(frame.pixels), close: vi.fn() })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const effect = (irisShape: string, progress: number, centerX = 0.5, centerY = 0.5) => ({ id: "iris", type: "mask" as const, enabled: true, params: { irisShape, progress, centerX, centerY } });

  it.each(IRIS_SHAPES)("keeps %s closed at zero, restores every source pixel at one, and matches bitmap export", async shape => {
    const engine = new VideoEffectsEngine({ width: 200, height: 100, useGPU: false });
    const closed = await engine.applyEffectsToCanvas(source as unknown as ImageBitmap, [effect(shape, 0)]) as unknown as PixelFrame;
    expect(closed.pixels.every(value => value === 0)).toBe(true);
    const full = await engine.applyEffects(source as unknown as ImageBitmap, [effect(shape, 1)]);
    expect((full.image as unknown as PixelFrame).pixels).toEqual(source.pixels);
    const preview = await engine.applyEffectsToCanvas(source as unknown as ImageBitmap, [effect(shape, 0.3)]) as unknown as PixelFrame;
    const pixels = new Uint8ClampedArray(preview.pixels);
    const exported = await engine.applyEffects(source as unknown as ImageBitmap, [effect(shape, 0.3)]);
    expect((exported.image as unknown as PixelFrame).pixels).toEqual(pixels);
  });
  it("centers an overlay reveal at its actual position and keeps circles circular on a wide canvas", async () => {
    const engine = new VideoEffectsEngine({ width: 200, height: 100, useGPU: false });
    const frame = await engine.applyEffectsToCanvas(source as unknown as ImageBitmap, [effect("circle", 0.12, 0.25, 0.75)]) as unknown as PixelFrame;
    expect(pixel(frame, 50, 75)[3]).toBe(137);
    expect(pixel(frame, 100, 50)[3]).toBe(0);
    const columns: number[] = [], rows: number[] = [];
    for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) if (pixel(frame, x, y)[3]) { columns.push(x); rows.push(y); }
    expect(Math.max(...columns) - Math.min(...columns)).toBe(Math.max(...rows) - Math.min(...rows));
  });
});
