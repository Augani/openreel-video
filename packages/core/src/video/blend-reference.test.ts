import { describe, expect, it } from "vitest";
import {
  BLEND_MODE_GROUPS,
  blendPixelBuffers,
  compositeReferencePixel,
  dissolveNoise,
  getNativeCanvasBlendOperation,
  needsCpuBlend,
  referenceBlend,
} from "./blend-reference";
import { BLEND_MODES, type BlendMode } from "./types";
import {
  MOTION_GPU_BLEND_INDEX,
  blendMotionColor,
  buildMotionBlendWgsl,
  compositeMotionColor,
  motionDissolveNoise,
} from "../motion/motion-gpu-blend";
import { getAvailableBlendModes, getBlendModeName } from "./composite-engine";

const NEW_MODES: BlendMode[] = [
  "linear-burn",
  "darker-color",
  "lighter-color",
  "linear-light",
  "vivid-light",
  "pin-light",
  "hard-mix",
  "subtract",
  "divide",
  "dissolve",
];

const rgb = (r: number, g: number, b: number) => ({ r, g, b });
const close = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => {
  expect(a.r).toBeCloseTo(b.r, 6);
  expect(a.g).toBeCloseTo(b.g, 6);
  expect(a.b).toBeCloseTo(b.b, 6);
};

describe("blend reference: fixed colour pairs", () => {
  const cb = rgb(0.8, 0.4, 0.2);
  const cs = rgb(0.5, 0.6, 0.1);

  it("linear burn = cb + cs - 1, clamped", () => {
    close(referenceBlend("linear-burn", cb, cs), rgb(0.3, 0, 0));
  });
  it("darker / lighter color pick a whole colour by luminance", () => {
    // lum(cb) = 0.24+0.236+0.022 = 0.498, lum(cs) = 0.15+0.354+0.011 = 0.515
    close(referenceBlend("darker-color", cb, cs), cb);
    close(referenceBlend("lighter-color", cb, cs), cs);
  });
  it("linear light = cb + 2cs - 1, clamped", () => {
    close(referenceBlend("linear-light", cb, cs), rgb(0.8, 0.6, 0));
  });
  it("vivid light burns below 50% and dodges above", () => {
    const out = referenceBlend("vivid-light", cb, cs);
    // r: cs=.5 -> burn(.8, 1.0) = 1 - (0.2/1) = .8 ; g: cs=.6 -> dodge(.4, .2) = .4/.8 = .5 ; b: cs=.1 -> burn(.2, .2) = 0
    close(out, rgb(0.8, 0.5, 0));
  });
  it("pin light replaces by source brightness", () => {
    // r: cs=.5 -> max(.8, 0) = .8 ; g: cs=.6 -> max(.4, .2)=.4 ; b: cs=.1 -> min(.2,.2)=.2
    close(referenceBlend("pin-light", cb, cs), rgb(0.8, 0.4, 0.2));
    close(referenceBlend("pin-light", rgb(0.9, 0.1, 0.5), rgb(0.7, 0.2, 0.3)), rgb(0.9, 0.1, 0.5));
    close(referenceBlend("pin-light", rgb(0.9, 0.7, 0.5), rgb(0.7, 0.2, 0.3)), rgb(0.9, 0.4, 0.5));
  });
  it("hard mix thresholds at cb + cs >= 1", () => {
    close(referenceBlend("hard-mix", cb, cs), rgb(1, 1, 0));
  });
  it("subtract = max(0, cb - cs)", () => {
    close(referenceBlend("subtract", cb, cs), rgb(0.3, 0, 0.1));
  });
  it("divide = cb / cs, white where cs is 0", () => {
    close(referenceBlend("divide", rgb(0.3, 0.6, 0.5), rgb(0.6, 0.3, 0)), rgb(0.5, 1, 1));
  });
  it("dissolve keeps the source colour", () => {
    close(referenceBlend("dissolve", cb, cs), cs);
  });
});

describe("dissolve", () => {
  it("is deterministic and matches the WGSL hash twin", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(dissolveNoise(x, y)).toBe(dissolveNoise(x, y));
        expect(dissolveNoise(x, y)).toBe(motionDissolveNoise(x, y));
      }
    }
    expect(dissolveNoise(3, 5)).not.toBe(dissolveNoise(5, 3));
  });
  it("covers about alpha of the pixels, fully opaque or fully absent", () => {
    const w = 64;
    const h = 64;
    const back = new Uint8ClampedArray(w * h * 4).fill(0);
    for (let i = 3; i < back.length; i += 4) back[i] = 255;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < src.length; i += 4) {
      src[i] = 255;
      src[i + 3] = 255;
    }
    blendPixelBuffers(back, src, w, h, "dissolve", 0.25);
    let on = 0;
    for (let i = 0; i < back.length; i += 4) {
      expect([0, 255]).toContain(back[i]);
      if (back[i] === 255) on++;
    }
    expect(on / (w * h)).toBeGreaterThan(0.2);
    expect(on / (w * h)).toBeLessThan(0.3);
  });
});

describe("GPU shader formulas match the reference", () => {
  const levels = [0, 0.1, 0.25, 0.5, 0.6, 0.75, 1];
  it("every new mode agrees on a colour grid", () => {
    for (const mode of NEW_MODES) {
      for (const r1 of levels) for (const g1 of levels) for (const r2 of levels) for (const g2 of levels) {
        const a = rgb(r1, g1, (r1 + g1) / 2);
        const b = rgb(r2, g2, (r2 * 3 + g2) / 4);
        close(blendMotionColor(mode, a, b), referenceBlend(mode, a, b));
      }
    }
  });
  it("composite with alpha agrees (straight alpha, opaque and translucent)", () => {
    const px = [
      [{ ...rgb(0.8, 0.4, 0.2), a: 1 }, { ...rgb(0.5, 0.6, 0.1), a: 0.6 }],
      [{ ...rgb(0.8, 0.4, 0.2), a: 0.5 }, { ...rgb(0.5, 0.6, 0.1), a: 1 }],
      [{ ...rgb(0.1, 0.9, 0.5), a: 0 }, { ...rgb(0.5, 0.6, 0.1), a: 0.4 }],
    ] as const;
    for (const mode of NEW_MODES) {
      for (const [b, s] of px) {
        const ref = compositeReferencePixel(mode, b, s, 7, 11);
        const gpu = compositeMotionColor(b, s, mode, 7, 11);
        expect(gpu.a).toBeCloseTo(ref.a, 6);
        close(gpu, ref);
      }
    }
  });
  it("the WGSL source has a branch for every new index and the dissolve hash", () => {
    const wgsl = buildMotionBlendWgsl();
    for (const mode of NEW_MODES) {
      const index = MOTION_GPU_BLEND_INDEX[mode];
      expect(wgsl, mode).toMatch(new RegExp(`mode == ${index}u`));
    }
    expect(wgsl).toContain("374761393u");
    expect(wgsl).toContain("668265263u");
    expect(wgsl).toContain("1274126177u");
  });
});

describe("CPU buffer path (preview, export, Canvas2D fallback)", () => {
  it("matches the float reference within 8 bit rounding for every new mode", () => {
    const back = [200, 100, 50, 255];
    const srcPx = [120, 160, 30, 153];
    for (const mode of NEW_MODES.filter((m) => m !== "dissolve")) {
      const buf = new Uint8ClampedArray(back);
      blendPixelBuffers(buf, new Uint8ClampedArray(srcPx), 1, 1, mode, 1);
      const ref = compositeReferencePixel(
        mode,
        { ...rgb(200 / 255, 100 / 255, 50 / 255), a: 1 },
        { ...rgb(120 / 255, 160 / 255, 30 / 255), a: 153 / 255 },
        0,
        0,
      );
      expect(Math.abs(buf[0] - ref.r * 255)).toBeLessThanOrEqual(1);
      expect(Math.abs(buf[1] - ref.g * 255)).toBeLessThanOrEqual(1);
      expect(Math.abs(buf[2] - ref.b * 255)).toBeLessThanOrEqual(1);
      expect(buf[3]).toBe(255);
    }
  });
  it("opaque source over opaque backdrop at full alpha yields B(cb, cs) exactly", () => {
    const buf = new Uint8ClampedArray([204, 102, 51, 255]);
    blendPixelBuffers(buf, new Uint8ClampedArray([128, 153, 26, 255]), 1, 1, "subtract", 1);
    expect(Array.from(buf)).toEqual([76, 0, 25, 255]);
  });
});

describe("mode registry", () => {
  it("keeps the original 18 ids first and unchanged, so saved projects load as before", () => {
    expect(BLEND_MODES.slice(0, 18)).toEqual([
      "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
      "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
      "add", "linear-dodge",
    ]);
    expect(BLEND_MODES).toHaveLength(28);
    expect(MOTION_GPU_BLEND_INDEX.multiply).toBe(1);
    expect(MOTION_GPU_BLEND_INDEX["linear-dodge"]).toBe(16);
  });
  it("native modes keep their Canvas2D op; new modes go through the CPU path", () => {
    expect(getNativeCanvasBlendOperation("multiply")).toBe("multiply");
    expect(getNativeCanvasBlendOperation("add")).toBe("lighter");
    for (const mode of NEW_MODES) {
      expect(needsCpuBlend(mode)).toBe(true);
      expect(getNativeCanvasBlendOperation(mode)).toBeNull();
    }
    expect(needsCpuBlend("overlay")).toBe(false);
  });
  it("groups list every mode exactly once and have names", () => {
    const flat = BLEND_MODE_GROUPS.flatMap((g) => g.modes);
    expect([...flat].sort()).toEqual([...BLEND_MODES].sort());
    expect(BLEND_MODE_GROUPS.map((g) => g.label)).toEqual(["Normal", "Darken", "Lighten", "Contrast", "Inversion", "Component"]);
    expect(getAvailableBlendModes()).toHaveLength(28);
    for (const mode of BLEND_MODES) expect(getBlendModeName(mode).length).toBeGreaterThan(0);
    expect(getBlendModeName("vivid-light")).toBe("Vivid Light");
  });
});
