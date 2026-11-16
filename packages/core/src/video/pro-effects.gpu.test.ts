import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Effect } from "../types/timeline";

const render = vi.fn();
const isSupported = vi.fn(() => true);

vi.mock("../motion/motion-shader-renderer", () => ({
  MotionShaderRenderer: class {
    static isSupported = (): boolean => isSupported();
    render = render;
    dispose(): void {}
  },
}));

import { VideoEffectsEngine } from "./video-effects-engine";
import { PRO_EFFECT_DEFAULTS, PRO_EFFECT_NEUTRAL_PARAMS, applyProEffect } from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";

interface Frame {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

class PixelCanvas implements Frame {
  pixels: Uint8ClampedArray;
  reads = 0;
  constructor(public width: number, public height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      canvas: this,
      save() {},
      restore() {},
      setTransform() {},
      globalCompositeOperation: "source-over",
      filter: "none",
      clearRect: () => this.pixels.fill(0),
      drawImage: (source: Frame) => {
        this.pixels = new Uint8ClampedArray(source.pixels);
      },
      getImageData: () => {
        this.reads++;
        return { data: new Uint8ClampedArray(this.pixels), width: this.width, height: this.height };
      },
      putImageData: (image: { data: Uint8ClampedArray }) => {
        this.pixels = new Uint8ClampedArray(image.data);
      },
    };
  }
}

const frame: Frame = {
  width: 2,
  height: 1,
  pixels: new Uint8ClampedArray([10, 20, 30, 255, 200, 210, 220, 255]),
};
const effect = (type: string, params: Record<string, unknown>): Effect => ({
  id: "fx",
  type,
  enabled: true,
  params,
});

async function run(engine: VideoEffectsEngine, fx: Effect): Promise<PixelCanvas> {
  return (await engine.applyEffectsToCanvas(frame as unknown as ImageBitmap, [fx])) as unknown as PixelCanvas;
}

function resetSupportCache(): void {
  (VideoEffectsEngine as unknown as { _proGpuSupported: boolean | null })._proGpuSupported = null;
}

describe("pro effects GPU path", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", PixelCanvas);
    render.mockReset();
    isSupported.mockReset();
    isSupported.mockReturnValue(true);
    resetSupportCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders non-neutral params through the effect's shader with no CPU readback", async () => {
    const gpuResult = { width: 2, height: 1, pixels: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) };
    render.mockReturnValue(gpuResult);
    const engine = new VideoEffectsEngine({ width: 2, height: 1 });
    const out = await run(engine, effect("posterize", { levels: 4 }));
    expect(render).toHaveBeenCalledTimes(1);
    const [def, input] = render.mock.calls[0];
    expect(def).toBe(PRO_EFFECT_SHADER_DEFS.posterize);
    expect(input.strict).toBe(true);
    expect(input.params).toEqual({ steps: 3 });
    expect(Array.from(out.pixels)).toEqual(Array.from(gpuResult.pixels));
    expect(out.reads).toBe(0);
  });

  it("never touches the GPU or the CPU for neutral params", async () => {
    const engine = new VideoEffectsEngine({ width: 2, height: 1 });
    const out = await run(engine, effect("mosaic", { ...PRO_EFFECT_NEUTRAL_PARAMS.mosaic }));
    expect(render).not.toHaveBeenCalled();
    expect(out.reads).toBe(0);
    expect(Array.from(out.pixels)).toEqual(Array.from(frame.pixels));
  });

  it("falls back to the CPU reference when the shader cannot render, and stops retrying that effect", async () => {
    render.mockReturnValue(null);
    const engine = new VideoEffectsEngine({ width: 2, height: 1 });
    const params = { ...PRO_EFFECT_DEFAULTS.threshold };
    const first = await run(engine, effect("threshold", params));
    const second = await run(engine, effect("threshold", params));
    const expected = new Uint8ClampedArray(frame.pixels);
    applyProEffect("threshold", params, expected, 2, 1);
    expect(Array.from(first.pixels)).toEqual(Array.from(expected));
    expect(Array.from(second.pixels)).toEqual(Array.from(expected));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("uses the CPU path when WebGL2 is unavailable or GPU is disabled", async () => {
    isSupported.mockReturnValue(false);
    const params = { ...PRO_EFFECT_DEFAULTS.emboss };
    const noWebGl = await run(new VideoEffectsEngine({ width: 2, height: 1 }), effect("emboss", params));
    resetSupportCache();
    isSupported.mockReturnValue(true);
    const gpuOff = await run(new VideoEffectsEngine({ width: 2, height: 1, useGPU: false }), effect("emboss", params));
    const expected = new Uint8ClampedArray(frame.pixels);
    applyProEffect("emboss", params, expected, 2, 1);
    expect(Array.from(noWebGl.pixels)).toEqual(Array.from(expected));
    expect(Array.from(gpuOff.pixels)).toEqual(Array.from(expected));
    expect(render).not.toHaveBeenCalled();
  });
});
