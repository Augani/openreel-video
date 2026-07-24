import { describe, expect, it } from "vitest";
import { BLEND_MODES } from "../video/types";
import {
  blendMotionColor,
  buildMotionBlendWgsl,
  compositeMotionColor,
  MOTION_GPU_BLEND_INDEX,
  motionBlendIndex,
  type MotionRgb,
} from "./motion-gpu-blend";

const gray = (value: number): MotionRgb => ({ r: value, g: value, b: value });

describe("motion gpu blend math", () => {
  it("indexes every blend mode contiguously with aliases sharing an index", () => {
    const indices = BLEND_MODES.map((mode) => MOTION_GPU_BLEND_INDEX[mode]);
    const distinct = [...new Set(indices)].sort((a, b) => a - b);
    expect(distinct[0]).toBe(0);
    distinct.forEach((value, position) => {
      expect(value).toBe(position);
    });
    expect(MOTION_GPU_BLEND_INDEX.add).toBe(MOTION_GPU_BLEND_INDEX["linear-dodge"]);
    expect(motionBlendIndex(undefined)).toBe(0);
    expect(motionBlendIndex("normal")).toBe(0);
  });

  it("adds the additive family as a clamped sum", () => {
    expect(blendMotionColor("add", gray(0.4), gray(0.3)).r).toBeCloseTo(0.7, 6);
    expect(blendMotionColor("add", gray(0.8), gray(0.5)).r).toBe(1);
    expect(blendMotionColor("linear-dodge", gray(0.4), gray(0.3)).r).toBeCloseTo(
      0.7,
      6,
    );
  });

  it("computes separable modes against known formulas", () => {
    expect(blendMotionColor("multiply", gray(0.5), gray(0.5)).r).toBeCloseTo(0.25, 6);
    expect(blendMotionColor("screen", gray(0.5), gray(0.5)).r).toBeCloseTo(0.75, 6);
    expect(blendMotionColor("darken", gray(0.2), gray(0.8)).r).toBeCloseTo(0.2, 6);
    expect(blendMotionColor("lighten", gray(0.2), gray(0.8)).r).toBeCloseTo(0.8, 6);
    expect(blendMotionColor("difference", gray(0.7), gray(0.2)).r).toBeCloseTo(0.5, 6);
    expect(blendMotionColor("exclusion", gray(0.5), gray(0.5)).r).toBeCloseTo(0.5, 6);
    expect(blendMotionColor("normal", gray(0.3), gray(0.9)).r).toBeCloseTo(0.9, 6);
  });

  it("handles dodge and burn edge cases", () => {
    expect(blendMotionColor("color-dodge", gray(0), gray(0.5)).r).toBe(0);
    expect(blendMotionColor("color-dodge", gray(0.5), gray(1)).r).toBe(1);
    expect(blendMotionColor("color-dodge", gray(0.25), gray(0.5)).r).toBeCloseTo(0.5, 6);
    expect(blendMotionColor("color-burn", gray(1), gray(0.5)).r).toBe(1);
    expect(blendMotionColor("color-burn", gray(0.5), gray(0)).r).toBe(0);
  });

  it("overlay equals hard-light with swapped operands", () => {
    const cb = 0.3;
    const cs = 0.7;
    const overlay = blendMotionColor("overlay", gray(cb), gray(cs)).r;
    const hardLight = blendMotionColor("hard-light", gray(cs), gray(cb)).r;
    expect(overlay).toBeCloseTo(hardLight, 6);
  });

  it("luminosity transfers source luma and keeps backdrop chroma", () => {
    const backdrop: MotionRgb = { r: 0.8, g: 0.2, b: 0.2 };
    const source: MotionRgb = { r: 0.5, g: 0.5, b: 0.5 };
    const result = blendMotionColor("luminosity", backdrop, source);
    const lum = (c: MotionRgb) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    expect(lum(result)).toBeCloseTo(lum(source), 5);
    expect(result.r).toBeGreaterThan(result.g);
  });

  it("color transfers backdrop luma onto source chroma", () => {
    const backdrop: MotionRgb = { r: 0.6, g: 0.6, b: 0.6 };
    const source: MotionRgb = { r: 0.9, g: 0.1, b: 0.1 };
    const result = blendMotionColor("color", backdrop, source);
    const lum = (c: MotionRgb) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    expect(lum(result)).toBeCloseTo(lum(backdrop), 5);
  });

  it("composites opaque normal source as pure source", () => {
    const out = compositeMotionColor(
      { r: 0.1, g: 0.2, b: 0.3, a: 1 },
      { r: 0.9, g: 0.8, b: 0.7, a: 1 },
      "normal",
    );
    expect(out.r).toBeCloseTo(0.9, 6);
    expect(out.g).toBeCloseTo(0.8, 6);
    expect(out.b).toBeCloseTo(0.7, 6);
    expect(out.a).toBeCloseTo(1, 6);
  });

  it("composites a fully transparent source as the untouched backdrop", () => {
    const backdrop = { r: 0.4, g: 0.5, b: 0.6, a: 0.7 };
    const out = compositeMotionColor(backdrop, { r: 1, g: 1, b: 1, a: 0 }, "multiply");
    expect(out.r).toBeCloseTo(backdrop.r, 6);
    expect(out.g).toBeCloseTo(backdrop.g, 6);
    expect(out.b).toBeCloseTo(backdrop.b, 6);
    expect(out.a).toBeCloseTo(backdrop.a, 6);
  });

  it("composites opaque multiply as the channel product", () => {
    const out = compositeMotionColor(
      { r: 0.5, g: 0.5, b: 0.5, a: 1 },
      { r: 0.5, g: 0.5, b: 0.5, a: 1 },
      "multiply",
    );
    expect(out.r).toBeCloseTo(0.25, 6);
    expect(out.a).toBeCloseTo(1, 6);
  });

  it("keeps composited channels and alpha within range", () => {
    for (const mode of BLEND_MODES) {
      const out = compositeMotionColor(
        { r: 0.9, g: 0.1, b: 0.4, a: 0.6 },
        { r: 0.2, g: 0.8, b: 0.5, a: 0.5 },
        mode,
      );
      for (const channel of [out.r, out.g, out.b, out.a]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("motion blend wgsl source", () => {
  const source = buildMotionBlendWgsl();

  it("declares the compositing entry points", () => {
    expect(source).toContain("fn motionComposite(");
    expect(source).toContain("fn motionBlend(");
    expect(source).toContain("fn motionBlendChannel(");
    expect(source).toContain("fn motionSetLum(");
    expect(source).toContain("fn motionSetSat(");
  });

  it("branches on every non-separable mode index", () => {
    for (const index of [12, 13, 14, 15]) {
      expect(source).toContain(`mode == ${index}u`);
    }
  });

  it("has balanced braces and parentheses", () => {
    const open = (source.match(/\{/g) ?? []).length;
    const close = (source.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
    const openParen = (source.match(/\(/g) ?? []).length;
    const closeParen = (source.match(/\)/g) ?? []).length;
    expect(openParen).toBe(closeParen);
  });
});
