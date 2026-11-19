import { describe, expect, it } from "vitest";
import { VideoEffectsEngine } from "./video-effects-engine";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_KEYFRAME_PROPERTIES,
  PRO_EFFECT_NEUTRAL_PARAMS,
  PRO_EFFECT_TYPES,
  PRO_EFFECTS_WRITING_ALPHA,
  applyDirectionalBlur,
  applyLensDistortion,
  applyMirror,
  applyMosaic,
  applyPosterize,
  applyProEffect,
  applyThreshold,
  applyUnsharpMask,
  applyVhsGlitch,
  hash01,
  isProEffectNeutral,
  isProEffectType,
  proEffectGpuUniforms,
  resolveProEffectParams,
  vhsFrameIndex,
  vhsSeedInt,
  withProEffectTime,
} from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";
import { EXTRA_PRO_EFFECT_TYPES } from "./pro-effects-extra";
import { TEMPORAL_PRO_EFFECT_TYPES, isTemporalEffectType } from "./temporal-effects";

function makeImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = (x * 37 + y * 11) % 256;
      data[o + 1] = (x * 5 + y * 53) % 256;
      data[o + 2] = (x * 91 + y * 7) % 256;
      data[o + 3] = 255;
    }
  }
  return data;
}

const W = 16;
const H = 12;

describe("pro effects registration", () => {
  it("has defaults, neutral params and a shader for every pro effect", () => {
    for (const type of PRO_EFFECT_TYPES) {
      expect(PRO_EFFECT_DEFAULTS[type]).toBeDefined();
      expect(PRO_EFFECT_NEUTRAL_PARAMS[type]).toBeDefined();
      expect(PRO_EFFECT_SHADER_DEFS[type].glsl).toContain("#version 300 es");
      expect(isProEffectType(type)).toBe(true);
    }
    expect(isProEffectType("blur")).toBe(false);
  });

  it("registers every pro effect with the engine", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false });
    for (const type of PRO_EFFECT_TYPES) {
      expect(engine.isFilterSupported(type)).toBe(true);
      expect(engine.getAvailableFilters()).toContain(type);
    }
  });

  it("covers the requested effects", () => {
    expect([...PRO_EFFECT_TYPES].sort()).toEqual(
      [
        "mosaic",
        "posterize",
        "mirror",
        "lens-distortion",
        "directional-blur",
        "find-edges",
        "emboss",
        "exposure",
        "threshold",
        "halftone",
        "vhs-glitch",
        "unsharp-mask",
        "gaussian-blur",
        "crop",
        "vibrance",
        "skew",
        "hsl-secondary",
        ...EXTRA_PRO_EFFECT_TYPES,
        ...TEMPORAL_PRO_EFFECT_TYPES,
      ].sort(),
    );
  });

  it("exposes keyframe properties only for numeric, keyframable params", () => {
    const ids = PRO_EFFECT_KEYFRAME_PROPERTIES.map((p) => p.id);
    expect(ids).toContain("effect.mosaic.size");
    expect(ids).toContain("effect.lens-distortion.amount");
    expect(ids).toContain("effect.exposure.exposure");
    expect(ids).not.toContain("effect.vhs-glitch.seed");
    expect(ids).not.toContain("effect.mirror.mode");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pro effects neutral-parameter identity", () => {
  for (const type of PRO_EFFECT_TYPES) {
    it(`${type} is identity with neutral params and reports neutral`, () => {
      const original = makeImage(W, H);
      const data = new Uint8ClampedArray(original);
      expect(applyProEffect(type, { ...PRO_EFFECT_NEUTRAL_PARAMS[type] }, data, W, H)).toBe(true);
      expect(Array.from(data)).toEqual(Array.from(original));
      expect(isProEffectNeutral(type, PRO_EFFECT_NEUTRAL_PARAMS[type])).toBe(true);
      // Empty params resolve to neutral, so a keyframe-only effect is inert.
      expect(isProEffectNeutral(type, {})).toBe(true);
    });

    // Temporal effects choose frames, not pixels: their pixel pass is the identity (temporal-effects.test.ts).
    it.skipIf(isTemporalEffectType(type))(`${type} changes the image with its default params and is not neutral`, () => {
      const original = makeImage(W, H);
      const data = new Uint8ClampedArray(original);
      applyProEffect(type, { ...PRO_EFFECT_DEFAULTS[type] }, data, W, H);
      expect(Array.from(data)).not.toEqual(Array.from(original));
      expect(isProEffectNeutral(type, PRO_EFFECT_DEFAULTS[type])).toBe(false);
    });

    it.skipIf(PRO_EFFECTS_WRITING_ALPHA.includes(type))(`${type} never mutates alpha for opaque input`, () => {
      const data = makeImage(W, H);
      applyProEffect(type, { ...PRO_EFFECT_DEFAULTS[type] }, data, W, H);
      for (let o = 3; o < data.length; o += 4) expect(data[o]).toBe(255);
    });
  }

  it("returns false for non-pro effect types", () => {
    expect(applyProEffect("blur", {}, new Uint8ClampedArray(4), 1, 1)).toBe(false);
  });

  it("falls back to neutral for missing, NaN and invalid values", () => {
    const resolved = resolveProEffectParams("mirror", { mode: "diagonal", center: Number.NaN });
    expect(resolved).toEqual({ mode: "none", center: 50 });
  });
});

describe("pro effects behaviour", () => {
  it("mosaic produces uniform blocks", () => {
    const data = makeImage(8, 8);
    applyMosaic(data, 8, 8, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(data[(y * 8 + x) * 4]).toBe(data[0]);
      }
    }
  });

  it("posterize limits distinct channel values", () => {
    const data = makeImage(32, 32);
    applyPosterize(data, 4);
    const values = new Set<number>();
    for (let o = 0; o < data.length; o += 4) values.add(data[o]);
    expect(values.size).toBeLessThanOrEqual(4);
  });

  it("threshold outputs only black or white at full mix", () => {
    const data = makeImage(W, H);
    applyThreshold(data, 128, 100);
    for (let o = 0; o < data.length; o += 4) {
      expect([0, 255]).toContain(data[o]);
    }
  });

  it("exposure +1 stop doubles linear light", () => {
    const data = new Uint8ClampedArray([64, 64, 64, 255]);
    applyProEffect("exposure", { exposure: 1, offset: 0, gamma: 1 }, data, 1, 1);
    // sRGB 64 -> 0.0513 linear -> 0.1026 -> sRGB ~ 89
    expect(data[0]).toBeGreaterThanOrEqual(88);
    expect(data[0]).toBeLessThanOrEqual(90);
  });

  it("horizontal mirror makes the right half a reflection of the left", () => {
    const data = makeImage(8, 2);
    const original = new Uint8ClampedArray(data);
    applyMirror(data, 8, 2, "horizontal", 50);
    for (let x = 0; x < 4; x++) {
      expect(data[x * 4]).toBe(original[x * 4]);
      expect(data[(7 - x) * 4]).toBe(original[x * 4]);
    }
  });

  it("quad mirror is symmetric on both axes", () => {
    const data = makeImage(8, 8);
    applyMirror(data, 8, 8, "quad", 50);
    expect(data[(7 * 8 + 7) * 4]).toBe(data[0]);
    expect(data[(0 * 8 + 7) * 4]).toBe(data[0]);
    expect(data[(7 * 8 + 0) * 4]).toBe(data[0]);
  });

  it("lens distortion keeps the centre pixel and alters edges", () => {
    const data = makeImage(33, 33);
    const original = new Uint8ClampedArray(data);
    applyLensDistortion(data, 33, 33, 60, 100, true);
    const c = (16 * 33 + 16) * 4;
    expect(data[c]).toBe(original[c]);
    expect(Array.from(data)).not.toEqual(Array.from(original));
  });

  it("lens compensation solves the edge-fill equation for barrel distortion", () => {
    const k = 0.8;
    const { s } = proEffectGpuUniforms("lens-distortion", { amount: 80, zoom: 100, compensate: true }, 33);
    expect(s * (1 + k * s * s)).toBeCloseTo(1, 6);
    const off = proEffectGpuUniforms("lens-distortion", { amount: 80, zoom: 200, compensate: false }, 33);
    expect(off.s).toBeCloseTo(0.5, 9);
  });

  it("directional blur leaves a flat image unchanged and smooths an edge", () => {
    const flat = new Uint8ClampedArray(8 * 8 * 4).fill(90);
    const flatCopy = new Uint8ClampedArray(flat);
    applyDirectionalBlur(flat, 8, 8, 0, 6);
    expect(Array.from(flat)).toEqual(Array.from(flatCopy));

    const edge = new Uint8ClampedArray(8 * 1 * 4);
    for (let x = 0; x < 8; x++) {
      edge[x * 4] = x < 4 ? 0 : 255;
      edge[x * 4 + 3] = 255;
    }
    applyDirectionalBlur(edge, 8, 1, 0, 4);
    expect(edge[3 * 4]).toBeGreaterThan(0);
    expect(edge[4 * 4]).toBeLessThan(255);
  });

  it("find edges is white on flat areas and dark on an edge", () => {
    const w = 8;
    const data = new Uint8ClampedArray(w * 3 * 4);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = x < 4 ? 0 : 255;
        data[o + 3] = 255;
      }
    }
    applyProEffect("find-edges", { amount: 100, invert: false }, data, w, 3);
    expect(data[(1 * w + 0) * 4]).toBe(255);
    expect(data[(1 * w + 3) * 4]).toBeLessThan(10);
  });

  it("unsharp mask increases local contrast across an edge", () => {
    const w = 12;
    const data = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? 80 : 160;
      data[x * 4] = data[x * 4 + 1] = data[x * 4 + 2] = v;
      data[x * 4 + 3] = 255;
    }
    applyUnsharpMask(data, w, 1, 200, 2, 0);
    expect(data[(w / 2 - 1) * 4]).toBeLessThan(80);
    expect(data[(w / 2) * 4]).toBeGreaterThan(160);
  });
});

describe("VHS / glitch determinism", () => {
  const params = { ...PRO_EFFECT_DEFAULTS["vhs-glitch"], time: 1.25, seed: 7 };

  it("hash01 is pure, in range and float32-exact", () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
    for (let i = 0; i < 100; i++) {
      const h = hash01(i, i * 3, 9);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(Math.fround(h)).toBe(h);
    }
  });

  it("same seed and time render identical frames", () => {
    const a = makeImage(W, H);
    const b = makeImage(W, H);
    applyProEffect("vhs-glitch", params, a, W, H);
    applyProEffect("vhs-glitch", params, b, W, H);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("a different time or seed changes the frame", () => {
    const base = makeImage(W, H);
    const a = new Uint8ClampedArray(base);
    const b = new Uint8ClampedArray(base);
    const c = new Uint8ClampedArray(base);
    applyVhsGlitch(a, W, H, 35, 4, 6, 10, 1.25, 7);
    applyVhsGlitch(b, W, H, 35, 4, 6, 10, 3.5, 7);
    applyVhsGlitch(c, W, H, 35, 4, 6, 10, 1.25, 8);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("holds a frame for its 1/24 s window and survives float drift", () => {
    expect(vhsFrameIndex(29 / 24)).toBe(29);
    expect(vhsFrameIndex(0.05)).toBe(1);
    expect(vhsFrameIndex(-3)).toBe(0);
    expect(vhsSeedInt(-1)).toBe(16777215);
    const render = (time: number): number[] => {
      const data = makeImage(W, H);
      applyVhsGlitch(data, W, H, 35, 4, 6, 10, time, 7);
      return Array.from(data);
    };
    expect(render(1.0 + 0.5 / 24)).toEqual(render(1.0));
    expect(render(1.0 + 1 / 24)).not.toEqual(render(1.0));
  });

  it("adds clip-local time to the stored offset without mutating inputs", () => {
    const effect = { id: "v", type: "vhs-glitch", enabled: true, params: { ...params, time: 1 } };
    const out = withProEffectTime([effect], 2.5);
    expect(out[0].params.time).toBe(3.5);
    expect(effect.params.time).toBe(1);
    const other = [{ id: "b", type: "blur", enabled: true, params: {} }];
    expect(withProEffectTime(other, 2)).toBe(other);
  });
});

describe("GLSL shaders match the shared uniform mapping", () => {
  for (const type of PRO_EFFECT_TYPES) {
    it(`${type} declares exactly the uniforms the CPU side supplies`, () => {
      const def = PRO_EFFECT_SHADER_DEFS[type];
      const supplied = Object.keys(proEffectGpuUniforms(type, PRO_EFFECT_DEFAULTS[type], 100)).sort();
      expect(def.params.map((p) => p.name).sort()).toEqual(supplied);
      for (const name of supplied) {
        expect(def.glsl).toMatch(new RegExp(`uniform float u_${name};`));
      }
      expect(def.category).toBe("effect");
      expect(def.glsl).toContain("fragColor");
    });
  }

  it("shares a single hash definition between the CPU and the VHS shader", () => {
    const glsl = PRO_EFFECT_SHADER_DEFS["vhs-glitch"].glsl;
    for (const k of ["374761393u", "668265263u", "2147483647u", "1274126177u", ">> 13u", ">> 16u"]) {
      expect(glsl).toContain(k);
    }
  });

  it("derives VHS frame, seed and band from the same helpers as the CPU path", () => {
    const u = proEffectGpuUniforms("vhs-glitch", { ...PRO_EFFECT_DEFAULTS["vhs-glitch"], time: 2.5, seed: 9 }, 480);
    expect(u.frame).toBe(vhsFrameIndex(2.5));
    expect(u.seed).toBe(9);
    expect(u.band).toBe(10);
  });
});

interface PixelSource {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

class PixelCanvas implements PixelSource {
  pixels: Uint8ClampedArray;
  reads = 0;
  draws = 0;
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
      drawImage: (source: PixelSource) => {
        this.draws++;
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

describe("GPU-less engine path agrees with the CPU reference", () => {
  it.each(PRO_EFFECT_TYPES)("%s: useGPU=false equals applyProEffect on default and neutral params", async (type) => {
    const original = makeImage(W, H);
    const bitmap = { width: W, height: H, pixels: original } as unknown as ImageBitmap;
    const globals = globalThis as unknown as Record<string, unknown>;
    const prior = globals.OffscreenCanvas;
    globals.OffscreenCanvas = PixelCanvas;
    try {
      for (const params of [PRO_EFFECT_DEFAULTS[type], PRO_EFFECT_NEUTRAL_PARAMS[type]]) {
        const engine = new VideoEffectsEngine({ width: W, height: H, useGPU: false });
        const canvas = (await engine.applyEffectsToCanvas(bitmap, [
          { id: "fx", type, enabled: true, params: { ...params } },
        ])) as unknown as PixelCanvas;
        const expected = new Uint8ClampedArray(original);
        applyProEffect(type, params, expected, W, H);
        expect(Array.from(canvas.pixels)).toEqual(Array.from(expected));
        if (params === PRO_EFFECT_NEUTRAL_PARAMS[type]) {
          expect(Array.from(canvas.pixels)).toEqual(Array.from(original));
          expect(canvas.reads).toBe(0);
        }
      }
    } finally {
      globals.OffscreenCanvas = prior;
    }
  });
});
