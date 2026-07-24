import { describe, expect, it } from "vitest";
import {
  MOTION_SHADER_LIBRARY,
  getMotionShaderDef,
  defaultMotionShaderParams,
  getMotionShaderFillDefs,
  getMotionShaderEffectDefs,
  getMotionShaderTextDefs,
} from "./index";

describe("motion shader library", () => {
  it("has the expanded effect shader library with valid params", () => {
    const ids = MOTION_SHADER_LIBRARY.filter((d) => d.category === "effect").map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "dither",
        "gradient-map",
        "pixelate",
        "halftone",
        "vhs",
        "posterize",
        "duotone",
        "prism",
        "fisheye",
        "wave-warp",
        "scanlines",
        "edge-glow",
      ]),
    );
    expect(ids.length).toBeGreaterThanOrEqual(12);
    for (const def of MOTION_SHADER_LIBRARY) {
      expect(def.glsl.length).toBeGreaterThan(0);
      expect(new Set(def.params.map((p) => p.name)).size).toBe(def.params.length);
      for (const p of def.params) {
        if (p.type === "color") {
          expect(typeof p.default).toBe("string");
          continue;
        }
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
    expect(new Set(MOTION_SHADER_LIBRARY.map((d) => d.id)).size).toBe(MOTION_SHADER_LIBRARY.length);
  });
  it("builds default params from a def", () => {
    const dither = getMotionShaderDef("dither")!;
    expect(defaultMotionShaderParams(dither)).toEqual({ levels: 4, scale: 1 });
  });
  it("has the three v1 fill shaders, disjoint from effects", () => {
    const fillIds = getMotionShaderFillDefs().map((d) => d.id);
    expect(fillIds).toEqual(expect.arrayContaining(["liquid-metal", "watercolor", "gradient-noise"]));
    for (const d of getMotionShaderFillDefs()) expect(d.category).toBe("fill");
    const effectIds = new Set(getMotionShaderEffectDefs().map((d) => d.id));
    expect(fillIds.some((id) => effectIds.has(id))).toBe(false);
    expect(new Set(MOTION_SHADER_LIBRARY.map((d) => d.id)).size).toBe(MOTION_SHADER_LIBRARY.length);
  });
  it("has the four v1 text shaders, disjoint from fills+effects", () => {
    const textIds = getMotionShaderTextDefs().map((d) => d.id);
    expect(textIds).toEqual(
      expect.arrayContaining(["glyph-dissolve", "glyph-glow-wave", "chromatic-cascade", "scanline-materialize"]),
    );
    for (const d of getMotionShaderTextDefs()) {
      expect(d.category).toBe("text");
      expect(d.glsl).toContain("u_progress");
      expect(d.glsl).toContain("#version 300 es");
    }
    const others = new Set([...getMotionShaderFillDefs(), ...getMotionShaderEffectDefs()].map((d) => d.id));
    expect(textIds.some((id) => others.has(id))).toBe(false);
    expect(new Set(MOTION_SHADER_LIBRARY.map((d) => d.id)).size).toBe(MOTION_SHADER_LIBRARY.length);
  });
});
