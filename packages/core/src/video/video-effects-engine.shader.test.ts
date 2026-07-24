import { describe, expect, it } from "vitest";
import type { Effect } from "../types/timeline";
import { VideoEffectsEngine } from "./video-effects-engine";
import { getMotionShaderEffectDefs } from "../motion/shaders";
import { MotionShaderRenderer } from "../motion/motion-shader-renderer";

const webgl2 = MotionShaderRenderer.isSupported();

interface EngineInternals {
  resolveShaderEffect(effect: Effect):
    | {
        readonly def: { readonly id: string; readonly category: string };
        readonly params: Record<string, number | string>;
        readonly time: number;
      }
    | null;
}

function internals(engine: VideoEffectsEngine): EngineInternals {
  return engine as unknown as EngineInternals;
}

function shaderEffect(params: Record<string, unknown>): Effect {
  return { id: "fx-shader", type: "shader", params, enabled: true };
}

function requireEffectDef(id: string) {
  const def = getMotionShaderEffectDefs().find((d) => d.id === id);
  if (!def) throw new Error(`effect shader def missing: ${id}`);
  return def;
}

const HALFTONE_ID = "paper-halftone-dots";

describe("VideoEffectsEngine shader effect resolution", () => {
  it("resolves an effect-category shader by id with defaults for missing params", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    const resolved = internals(engine).resolveShaderEffect(
      shaderEffect({ shaderId: HALFTONE_ID }),
    );
    expect(resolved).not.toBeNull();
    expect(resolved?.def.id).toBe(HALFTONE_ID);
    expect(resolved?.def.category).toBe("effect");
    expect(resolved?.time).toBe(0);
    const def = requireEffectDef(HALFTONE_ID);
    for (const param of def.params) {
      expect(param.name in (resolved?.params ?? {})).toBe(true);
    }
  });

  it("threads a numeric time param deterministically", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    const resolved = internals(engine).resolveShaderEffect(
      shaderEffect({ shaderId: HALFTONE_ID, time: 2.5 }),
    );
    expect(resolved?.time).toBe(2.5);
  });

  it("passes through supplied numeric and color params, ignoring unknown names", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    const resolved = internals(engine).resolveShaderEffect(
      shaderEffect({
        shaderId: HALFTONE_ID,
        size: 0.9,
        colorFront: "#ff0000",
        bogus: 123,
      }),
    );
    expect(resolved?.params.size).toBe(0.9);
    expect(resolved?.params.colorFront).toBe("#ff0000");
    expect("bogus" in (resolved?.params ?? {})).toBe(false);
  });

  it("returns null for non-shader effect types", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    const resolved = internals(engine).resolveShaderEffect({
      id: "fx",
      type: "brightness",
      params: { value: 0.2 },
      enabled: true,
    });
    expect(resolved).toBeNull();
  });

  it("returns null when shaderId is missing", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    expect(internals(engine).resolveShaderEffect(shaderEffect({}))).toBeNull();
  });

  it("returns null for an unknown shaderId", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    expect(
      internals(engine).resolveShaderEffect(
        shaderEffect({ shaderId: "paper-does-not-exist" }),
      ),
    ).toBeNull();
  });

  it("returns null for a fill-category shaderId (effects only)", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    expect(
      internals(engine).resolveShaderEffect(
        shaderEffect({ shaderId: "paper-mesh-gradient" }),
      ),
    ).toBeNull();
  });
});

describe.skipIf(!webgl2)("VideoEffectsEngine shader effect render", () => {
  async function solidFrame(
    width: number,
    height: number,
    rgba: readonly [number, number, number, number],
  ): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`;
    ctx.fillRect(0, 0, width, height);
    return createImageBitmap(canvas);
  }

  async function pixelsOf(image: ImageBitmap): Promise<Uint8ClampedArray> {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height).data;
  }

  function differs(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return true;
    }
    return false;
  }

  it("transforms a solid-color frame through a shader effect", async () => {
    const engine = new VideoEffectsEngine({ width: 16, height: 16, useGPU: false });
    const frame = await solidFrame(16, 16, [128, 128, 128, 255]);
    const before = await pixelsOf(frame);
    const result = await engine.applyEffects(await createImageBitmap(frame), [
      shaderEffect({ shaderId: HALFTONE_ID, size: 0.6, contrast: 0.9 }),
    ]);
    const after = await pixelsOf(result.image);
    expect(differs(before, after)).toBe(true);
  });

  it("preserves a transparent overlay's source alpha matte", async () => {
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "white";
    ctx.fillRect(4, 4, 8, 8);
    const engine = new VideoEffectsEngine({ width: 16, height: 16, useGPU: false });

    const result = await engine.applyEffects(await createImageBitmap(canvas), [
      shaderEffect({ shaderId: HALFTONE_ID, size: 0.6, contrast: 0.9 }),
    ]);
    const pixels = await pixelsOf(result.image);
    const alphaAt = (x: number, y: number) => pixels[(y * 16 + x) * 4 + 3];

    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(15, 15)).toBe(0);
    expect(alphaAt(8, 8)).toBeGreaterThan(0);
  });

  it("no-ops on an unknown shaderId, returning the input unchanged", async () => {
    const engine = new VideoEffectsEngine({ width: 16, height: 16, useGPU: false });
    const frame = await solidFrame(16, 16, [40, 90, 200, 255]);
    const before = await pixelsOf(await createImageBitmap(frame));
    const result = await engine.applyEffects(await createImageBitmap(frame), [
      shaderEffect({ shaderId: "paper-nope" }),
    ]);
    const after = await pixelsOf(result.image);
    expect(differs(before, after)).toBe(false);
  });

  it("no-ops on a fill-category shaderId", async () => {
    const engine = new VideoEffectsEngine({ width: 16, height: 16, useGPU: false });
    const frame = await solidFrame(16, 16, [40, 90, 200, 255]);
    const before = await pixelsOf(await createImageBitmap(frame));
    const result = await engine.applyEffects(await createImageBitmap(frame), [
      shaderEffect({ shaderId: "paper-mesh-gradient" }),
    ]);
    const after = await pixelsOf(result.image);
    expect(differs(before, after)).toBe(false);
  });

  it("is deterministic for the same time param", async () => {
    const engine = new VideoEffectsEngine({ width: 16, height: 16, useGPU: false });
    const build = async (): Promise<Uint8ClampedArray> => {
      const frame = await solidFrame(16, 16, [128, 128, 128, 255]);
      const result = await engine.applyEffects(frame, [
        shaderEffect({ shaderId: HALFTONE_ID, time: 1.25, size: 0.6 }),
      ]);
      return pixelsOf(result.image);
    };
    const a = await build();
    const b = await build();
    expect(differs(a, b)).toBe(false);
  });
});
