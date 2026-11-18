import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Effect } from "../types/timeline";
import { VideoEffectsEngine } from "./video-effects-engine";
import { toRuntimeVideoEffectParams } from "./effect-parameter-units";

type PixelSource = { width: number; height: number; pixels: Uint8ClampedArray };

// A tiny in-memory Canvas2D surface lets both public rendering entry points run
// the actual pixel algorithms without requiring a GPU in the Node test runner.
class PixelCanvas implements PixelSource {
  pixels: Uint8ClampedArray;
  reads = 0;
  writes = 0;
  constructor(public width: number, public height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      canvas: this,
      save() {}, restore() {}, setTransform() {},
      clearRect: () => this.pixels.fill(0),
      drawImage: (source: PixelSource) => { this.pixels = new Uint8ClampedArray(source.pixels); },
      getImageData: () => {
        this.reads++;
        return { data: new Uint8ClampedArray(this.pixels), width: this.width, height: this.height };
      },
      putImageData: (image: { data: Uint8ClampedArray }) => {
        this.writes++;
        this.pixels = new Uint8ClampedArray(image.data);
      },
    };
  }
}

const source = { width: 2, height: 1, pixels: new Uint8ClampedArray([128, 128, 128, 137, 64, 64, 64, 255]) };
const effect = (type: string, amount?: number) => ({ id: "effect", type, enabled: true, params: amount === undefined ? {} : { amount } }) as Effect;

describe("neutral pixel effects", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", PixelCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async (image: PixelSource) => ({ ...image, pixels: new Uint8ClampedArray(image.pixels) })));
    vi.spyOn(Math, "random").mockReturnValue(0.99);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(["grain", "vignette", "sharpen"])("copies the original frame without readback or writes for zero %s", async (type) => {
    const engine = new VideoEffectsEngine({ width: 2, height: 1, useGPU: false });
    for (const amount of [0, undefined, Number.NaN]) {
      const canvas = await engine.applyEffectsToCanvas(source as unknown as ImageBitmap, [effect(type, amount)]) as unknown as PixelCanvas;
      expect(canvas.pixels).toEqual(source.pixels);
      expect(canvas.reads).toBe(0);
      expect(canvas.writes).toBe(0);
    }
    expect(Math.random).not.toHaveBeenCalled();
  });

  it("produces the same visible grain and preserved alpha through canvas preview and bitmap export", async () => {
    const engine = new VideoEffectsEngine({ width: 2, height: 1, useGPU: false });
    const canvas = await engine.applyEffectsToCanvas(source as unknown as ImageBitmap, [effect("grain", 18)]) as unknown as PixelCanvas;
    const preview = new Uint8ClampedArray(canvas.pixels);
    const exported = await engine.applyEffects(source as unknown as ImageBitmap, [effect("grain", 18)]);
    expect(preview).toEqual(new Uint8ClampedArray([132, 132, 132, 137, 68, 68, 68, 255]));
    expect((exported.image as unknown as PixelSource).pixels).toEqual(preview);
    expect(source.pixels).toEqual(new Uint8ClampedArray([128, 128, 128, 137, 64, 64, 64, 255]));
  });

  it.each(["vignette", "sharpen", "grain"])("renders a normalized %s amount at its advertised strength", async type => {
    const width = type === "sharpen" ? 3 : 2;
    const height = width;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([16, 16, 16, 137], i);
    if (type === "sharpen") pixels.set([32, 32, 32, 137], 16);
    const frame = { width, height, pixels };
    const engine = new VideoEffectsEngine({ width, height, useGPU: false });
    const params = toRuntimeVideoEffectParams(type, { amount: type === "grain" ? 0.18 : 0.5 });
    const canvas = await engine.applyEffectsToCanvas(frame as unknown as ImageBitmap, [{ id: "effect", type, enabled: true, params }]) as unknown as PixelCanvas;
    const target = type === "sharpen" ? 16 : 0;
    expect([...canvas.pixels.slice(target, target + 4)]).toEqual(type === "sharpen" ? [64, 64, 64, 137] : type === "grain" ? [20, 20, 20, 137] : [8, 8, 8, 137]);
    if (type === "vignette") expect([...canvas.pixels.slice(12, 16)]).toEqual([16, 16, 16, 137]);
  });
});
