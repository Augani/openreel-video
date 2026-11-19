import { describe, expect, it } from "vitest";
import {
  applyUltraKey,
  isUltraKeyNeutral,
  prepareUltraKey,
  ultraKeyBaseMatte,
  ultraKeyColorFromSample,
  ultraKeyContrast,
  ultraKeyForeground,
  ultraKeyGpuUniforms,
  ULTRA_KEY_UNIFORM_NAMES,
  type UltraKeyParams,
} from "./ultra-key";
import { applyProEffect, isProEffectNeutral, PRO_EFFECT_DEFAULTS } from "./pro-effects";
import { ULTRA_KEY_GLSL } from "./ultra-key-shader";

const NEUTRAL: UltraKeyParams = {
  keyR: 0, keyG: 255, keyB: 0, transparency: 0, highlight: 0, shadow: 0, tolerance: 0,
  pedestal: 0, choke: 0, soften: 0, contrast: 0, midPoint: 50, desaturate: 0, range: 0,
  spill: 0, luma: 0, saturation: 100, hue: 0, luminance: 100, output: "composite",
};
const P = (over: Partial<UltraKeyParams> = {}): UltraKeyParams => ({ ...PRO_EFFECT_DEFAULTS["ultra-key"] as unknown as UltraKeyParams, ...over });
const prep = (over: Partial<UltraKeyParams> = {}) => prepareUltraKey(P(over), 1080);
const GREEN = [0, 255, 0] as const;
const SKIN = [224, 172, 140] as const;

function image(w: number, h: number, fill: (x: number, y: number) => readonly number[]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([...fill(x, y).slice(0, 3), fill(x, y)[3] ?? 255], (y * w + x) * 4);
  return d;
}

describe("ultra key matte generation", () => {
  it("makes the key colour fully transparent and leaves skin and blue opaque", () => {
    const u = prep();
    expect(ultraKeyBaseMatte(...GREEN, u)).toBe(0);
    expect(ultraKeyBaseMatte(...SKIN, u)).toBe(1);
    expect(ultraKeyBaseMatte(40, 60, 220, u)).toBe(1);
  });

  it("keys a darker or lighter shade of the same screen (chroma, not RGB distance)", () => {
    const u = prep({ shadow: 0, highlight: 0 });
    expect(ultraKeyBaseMatte(0, 140, 0, u)).toBe(0);
    expect(ultraKeyBaseMatte(70, 200, 70, u)).toBeLessThan(0.5);
  });

  it("tolerance and transparency are monotonic: more of either keys more", () => {
    const px: [number, number, number] = [90, 170, 90];
    const base = ultraKeyBaseMatte(...px, prep({ tolerance: 40, transparency: 40 }));
    const hiTol = ultraKeyBaseMatte(...px, prep({ tolerance: 60, transparency: 40 }));
    const hiTrans = ultraKeyBaseMatte(...px, prep({ tolerance: 40, transparency: 80 }));
    expect(base).toBe(1);
    expect(hiTol).toBeLessThan(base);
    expect(hiTrans).toBeLessThan(base);
  });

  it("a hard matte (transparency 0) is binary", () => {
    const u = prep({ transparency: 0, tolerance: 30, highlight: 0, shadow: 0 });
    for (let g = 0; g <= 255; g += 15) {
      const a = ultraKeyBaseMatte(0, g, 0, u);
      expect([0, 1]).toContain(a);
    }
  });

  it("highlight and shadow protect pixels much brighter and darker than the screen", () => {
    const bright: [number, number, number] = [150, 255, 150];
    const dark: [number, number, number] = [0, 60, 0];
    const wide = { tolerance: 100, transparency: 100 };
    expect(ultraKeyBaseMatte(...bright, prep({ ...wide, highlight: 0 }))).toBe(0);
    expect(ultraKeyBaseMatte(...bright, prep({ ...wide, highlight: 100 }))).toBeGreaterThan(0.4);
    expect(ultraKeyBaseMatte(...dark, prep({ shadow: 0 }))).toBe(0);
    expect(ultraKeyBaseMatte(...dark, prep({ shadow: 100 }))).toBeGreaterThan(0.5);
  });

  it("pedestal clips low opacity to transparent and keeps full opacity", () => {
    const px: [number, number, number] = [90, 170, 90];
    const u0 = prep({ pedestal: 0, tolerance: 70, transparency: 50 });
    const u1 = prep({ pedestal: 60, tolerance: 70, transparency: 50 });
    const a0 = ultraKeyBaseMatte(...px, u0);
    expect(a0).toBeGreaterThan(0.2);
    expect(a0).toBeLessThan(0.8);
    expect(ultraKeyBaseMatte(...px, u1)).toBe(0);
    expect(ultraKeyBaseMatte(...SKIN, u1)).toBe(1);
  });

  it("with no tolerance and no transparency nothing is keyed", () => {
    expect(ultraKeyBaseMatte(...GREEN, prep({ tolerance: 0, transparency: 0 }))).toBe(1);
  });

  it("a different key colour (blue screen) keys blue, not green", () => {
    const u = prep({ keyR: 0, keyG: 0, keyB: 255 });
    expect(ultraKeyBaseMatte(0, 0, 255, u)).toBe(0);
    expect(ultraKeyBaseMatte(0, 255, 0, u)).toBe(1);
  });
});

describe("ultra key matte contrast", () => {
  it("is identity at zero contrast and steepens around the mid point", () => {
    expect(ultraKeyContrast(0.3, prep({ contrast: 0 }))).toBe(0.3);
    const u = prep({ contrast: 100, midPoint: 50 });
    expect(ultraKeyContrast(0.5, u)).toBeCloseTo(0.5, 6);
    expect(ultraKeyContrast(0.45, u)).toBeLessThan(0.3);
    expect(ultraKeyContrast(0.55, u)).toBeGreaterThan(0.7);
    const low = prep({ contrast: 100, midPoint: 20 });
    expect(ultraKeyContrast(0.3, low)).toBeGreaterThan(0.9);
  });
});

describe("ultra key spill suppression and colour correction", () => {
  const spillPx: [number, number, number] = [200, 235, 190];
  const fg = (u: ReturnType<typeof prep>, c: readonly number[], a = 1) => {
    const out: [number, number, number] = [0, 0, 0];
    ultraKeyForeground(c[0] / 255, c[1] / 255, c[2] / 255, a, u, out);
    return out.map((v) => v * 255);
  };

  it("removes green from a spill-tinted pixel and leaves skin alone", () => {
    const u = prep({ spill: 100, range: 80 });
    const [r, g, b] = fg(u, spillPx);
    expect(g - Math.max(r, b)).toBeLessThan(spillPx[1] - Math.max(spillPx[0], spillPx[2]));
    const skin = fg(u, SKIN);
    for (let i = 0; i < 3; i++) expect(Math.abs(skin[i] - SKIN[i])).toBeLessThan(6);
  });

  it("spill 0 and desaturate 0 leave the colour exactly alone", () => {
    const u = prep({ spill: 0, desaturate: 0 });
    expect(fg(u, spillPx).map(Math.round)).toEqual([...spillPx]);
  });

  it("range limits which hues are corrected", () => {
    const wide = fg(prep({ spill: 100, range: 100 }), [150, 200, 120]);
    const none = fg(prep({ spill: 100, range: 0 }), [150, 200, 120]);
    expect(wide[1]).toBeLessThan(none[1]);
  });

  it("desaturate only acts on soft matte edges", () => {
    const u = prep({ spill: 0, desaturate: 100, range: 100 });
    const edge = fg(u, [150, 200, 120], 0.2);
    const solid = fg(u, [150, 200, 120], 1);
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(edge)).toBeLessThan(spread(solid));
  });

  it("luma restores brightness removed with the spill", () => {
    const dim = fg(prep({ spill: 100, range: 80, luma: 0 }), spillPx);
    const lit = fg(prep({ spill: 100, range: 80, luma: 100 }), spillPx);
    expect(lit[0] + lit[1] + lit[2]).toBeGreaterThan(dim[0] + dim[1] + dim[2]);
  });

  it("colour correction: saturation 0 is grey, hue rotates, luminance scales", () => {
    const grey = fg(prep({ spill: 0, desaturate: 0, saturation: 0 }), [200, 100, 50]);
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(1);
    const rotated = fg(prep({ spill: 0, desaturate: 0, hue: 120 }), [255, 0, 0]);
    expect(rotated[1]).toBeGreaterThan(rotated[0]);
    const dark = fg(prep({ spill: 0, desaturate: 0, luminance: 50 }), [200, 200, 200]);
    expect(dark[0]).toBeCloseTo(100, 0);
  });
});

describe("ultra key CPU render", () => {
  const W = 24;
  const H = 16;
  const split = image(W, H, (x) => (x < 12 ? [...GREEN] : [...SKIN]));

  it("composites: screen transparent, subject opaque and untouched colour-wise", () => {
    const d = new Uint8ClampedArray(split);
    applyUltraKey(d, W, H, P({ spill: 0, desaturate: 0 }));
    expect(d[3]).toBe(0);
    expect(Array.from(d.slice((8 * W + 20) * 4, (8 * W + 20) * 4 + 4))).toEqual([224, 172, 140, 255]);
  });

  it("alpha output is the matte as opaque grey and ignores source alpha shape", () => {
    const d = new Uint8ClampedArray(split);
    applyUltraKey(d, W, H, P({ output: "alpha" }));
    expect(Array.from(d.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(d.slice(20 * 4, 20 * 4 + 4))).toEqual([255, 255, 255, 255]);
  });

  it("colour channel output keeps full alpha and the corrected foreground", () => {
    const d = new Uint8ClampedArray(split);
    applyUltraKey(d, W, H, P({ output: "color", spill: 0, desaturate: 0 }));
    expect(Array.from(d.slice(0, 4))).toEqual([0, 255, 0, 255]);
  });

  it("source output is a pass through for the key colour picker", () => {
    const d = new Uint8ClampedArray(split);
    applyUltraKey(d, W, H, P({ output: "source" }));
    expect(Array.from(d)).toEqual(Array.from(split));
  });

  it("choke pulls the matte edge into the subject; soften feathers it", () => {
    const edgeCol = (data: Uint8ClampedArray, y = 8) => {
      const row: number[] = [];
      for (let x = 0; x < W; x++) row.push(data[(y * W + x) * 4 + 3]);
      return row;
    };
    const base = new Uint8ClampedArray(split);
    applyUltraKey(base, 24, 16, P({ spill: 0, desaturate: 0 }));
    const baseOpaque = edgeCol(base).filter((a) => a === 255).length;
    const bigSplit = image(120, 90, (x) => (x < 60 ? [...GREEN] : [...SKIN]));
    const bigBase = new Uint8ClampedArray(bigSplit);
    applyUltraKey(bigBase, 120, 90, P({ spill: 0, desaturate: 0 }));
    const choked = new Uint8ClampedArray(bigSplit);
    applyUltraKey(choked, 120, 90, P({ spill: 0, desaturate: 0, choke: 100 }));
    const row = (d: Uint8ClampedArray, w: number) => Array.from({ length: w }, (_, x) => d[(45 * w + x) * 4 + 3]);
    expect(row(choked, 120).filter((a) => a === 255).length).toBeLessThan(row(bigBase, 120).filter((a) => a === 255).length);
    const soft = new Uint8ClampedArray(bigSplit);
    applyUltraKey(soft, 120, 90, P({ spill: 0, desaturate: 0, soften: 100 }));
    const partial = row(soft, 120).filter((a) => a > 0 && a < 255).length;
    expect(partial).toBeGreaterThan(0);
    expect(row(bigBase, 120).filter((a) => a > 0 && a < 255).length).toBe(0);
    expect(baseOpaque).toBeGreaterThan(0);
  });

  it("multiplies existing alpha", () => {
    const d = image(W, H, () => [...SKIN, 128]);
    applyUltraKey(d, W, H, P());
    expect(d[3]).toBe(128);
  });

  it("neutral params are an exact no-op, defaults are not", () => {
    const d = new Uint8ClampedArray(split);
    applyProEffect("ultra-key", NEUTRAL as unknown as Record<string, unknown>, d, W, H);
    expect(Array.from(d)).toEqual(Array.from(split));
    expect(isUltraKeyNeutral(NEUTRAL)).toBe(true);
    expect(isProEffectNeutral("ultra-key", P() as unknown as Record<string, unknown>)).toBe(false);
    expect(isProEffectNeutral("ultra-key", {})).toBe(true);
    expect(isProEffectNeutral("ultra-key", NEUTRAL as unknown as Record<string, unknown>)).toBe(true);
  });

  it("is reachable through the shared pro effect dispatcher", () => {
    const d = new Uint8ClampedArray(split);
    expect(applyProEffect("ultra-key", P() as unknown as Record<string, unknown>, d, W, H)).toBe(true);
    expect(d[3]).toBe(0);
  });
});

describe("ultra key GPU contract", () => {
  it("the shader declares every uniform the mapping provides", () => {
    for (const name of ULTRA_KEY_UNIFORM_NAMES) expect(ULTRA_KEY_GLSL, name).toContain(`uniform float u_${name};`);
    expect(Object.keys(ultraKeyGpuUniforms(NEUTRAL))).toEqual(ULTRA_KEY_UNIFORM_NAMES);
  });

  it("uniforms carry the derived matte constants", () => {
    const u = ultraKeyGpuUniforms(P({ tolerance: 100, transparency: 100, choke: 50, output: "alpha" }));
    expect(u.core).toBeCloseTo(0.7, 6);
    expect(u.band).toBeCloseTo(0.45, 6);
    expect(u.chokeRadius).toBeCloseTo(5, 6);
    expect(u.output).toBe(1);
  });
});

describe("ultra key eyedropper", () => {
  it("turns a sampled colour into the key parameters", () => {
    expect(ultraKeyColorFromSample({ r: 12.4, g: 200.6, b: 300 })).toEqual({ keyR: 12, keyG: 201, keyB: 255 });
  });
});
