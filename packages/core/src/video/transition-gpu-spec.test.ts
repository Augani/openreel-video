import { describe, expect, it } from "vitest";
import { TRANSITION_TYPES } from "../types/effects";
import type { Transition } from "../types/timeline";
import { getDefaultTransitionParams } from "./transition-default-params";
import { GPU_AUX_FLOATS, GPU_TRANSITION_BODIES, pixelShaderSource } from "./transition-gpu-shaders";
import { buildGpuTransitionSpec, isGpuTransitionType, type GpuTransitionSpec } from "./transition-gpu-spec";
import { cubeSpinPlan } from "./transition-plans";
import { additiveWeights } from "./transition-extra-render";
import { writePlanVertices } from "./transition-gpu-renderer";

const W = 320;
const H = 180;
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];

const make = (type: string, params: Record<string, unknown> = {}): Transition =>
  ({ id: "t", clipAId: "a", clipBId: "b", type, duration: 1, params: { ...getDefaultTransitionParams(type as never), ...params } }) as Transition;

const plan = () => cubeSpinPlan({ width: W, height: H, progress: 0.5, direction: "left", borderWidth: 0, borderColor: "#fff" });
const build = (type: string, p: number, params: Record<string, unknown> = {}) => buildGpuTransitionSpec(make(type, params), p, W, H, plan as never);
const pixel = (spec: GpuTransitionSpec | null) => {
  if (!spec || spec.kind !== "pixel") throw new Error("expected a pixel spec");
  return spec;
};

describe("transition GPU specs", () => {
  it("covers every transition type but Morph Cut (which works on analysed pixels and stays on Canvas2D)", () => {
    expect(isGpuTransitionType("morphCut")).toBe(false);
    expect(build("morphCut", 0.5)).toBeNull();
    for (const type of TRANSITION_TYPES) {
      if (type === "morphCut") continue;
      for (const p of PROGRESS) {
        const spec = build(type, p);
        expect(spec, `${type} p=${p}`).not.toBeNull();
        if (spec!.kind === "pixel") {
          expect(Object.keys(GPU_TRANSITION_BODIES), type).toContain(spec!.shader);
          expect(spec!.v).toHaveLength(16);
          expect(spec!.v.every(Number.isFinite), `${type} p=${p} finite`).toBe(true);
          expect(spec!.aux?.length ?? 0).toBeLessThanOrEqual(GPU_AUX_FLOATS);
        } else {
          expect(spec!.plan.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every shader module defines the entry points and the shade function", () => {
    for (const shader of Object.keys(GPU_TRANSITION_BODIES) as (keyof typeof GPU_TRANSITION_BODIES)[]) {
      const source = pixelShaderSource(shader);
      expect(source, shader).toContain("fn shade(pos: vec2f) -> vec4f");
      expect(source, shader).toContain("@vertex");
      expect(source, shader).toContain("@fragment");
      const open = (source.match(/{/g) ?? []).length;
      const close = (source.match(/}/g) ?? []).length;
      expect(open, `${shader} braces balance`).toBe(close);
    }
  });

  it("uses the Canvas2D engine's parameter defaults", () => {
    expect(pixel(build("wipe", 0.5, { direction: undefined, softness: 0 })).v.slice(0, 2)).toEqual([0, 0]);
    expect(pixel(build("wipe", 0.5, { direction: "diagonal", softness: 0.4 })).v.slice(0, 2)).toEqual([4, 0.4]);
    // Push always pushes the outgoing shot out; slide only when asked to.
    const push = pixel(build("push", 0.5, { direction: "left" }));
    const slide = pixel(build("slide", 0.5, { direction: "left", pushOut: false }));
    expect(push.v.slice(0, 4)).toEqual([-W * 0.5, 0, W * 0.5, 0]);
    expect(slide.v.slice(0, 4)).toEqual([0, 0, W * 0.5, 0]);
    // A finished slide no longer draws the outgoing shot, a finished push does (the Canvas2D engine's rule).
    expect(pixel(build("slide", 1, { pushOut: false })).flag).toBe(0);
    expect(pixel(build("push", 1)).flag).toBe(1);
    expect(pixel(build("dipToWhite", 0.3, { holdDuration: 0.5 })).v.slice(0, 2)).toEqual([0.5, 1]);
    expect(pixel(build("dipToBlack", 0.3, { holdDuration: 0 })).v.slice(0, 2)).toEqual([0, 0]);
    expect(pixel(build("zoom", 0.5, { scale: 0 })).v.slice(0, 2)).toEqual([1 + (2 - 1) * 0.5, 1 / 2 + (1 - 1 / 2) * 0.5]);
  });

  it("builds the per-slice tables in double precision, exactly as the Canvas2D engine computes them", () => {
    const mosaic = pixel(build("mosaic", 0.5, { tiles: 8, randomness: 0.85 }));
    const columns = 8;
    const rows = Math.max(2, Math.round(columns * (H / W)));
    expect(mosaic.v.slice(0, 2)).toEqual([columns, rows]);
    expect(mosaic.aux).toHaveLength(columns * rows);
    for (const [row, column] of [[0, 0], [1, 3], [rows - 1, columns - 1]] as const) {
      const order = (row * columns + column) / Math.max(1, rows * columns - 1);
      const random = Math.abs(Math.sin((column + 1) * 12.9898 + (row + 1) * 78.233) * 43758.5453) % 1;
      expect(mosaic.aux![row * columns + column]).toBeCloseTo(order * 0.15 + random * 0.85, 5);
    }
    const glitch = pixel(build("glitch", 0.5, { intensity: 0.08, slices: 12 }));
    expect(glitch.v[0]).toBe(12);
    const strength = Math.sin(0.5 * Math.PI) * 0.08 * W;
    expect(glitch.aux![2]).toBeCloseTo(Math.sin(0 * 12.9898 + 0.5 * 31.7) * strength, 4);
    expect(glitch.aux![4 * 3]).toBe(Math.floor((3 / 12) * H));
    expect(glitch.aux![4 * 11 + 1]).toBe(H);
    const ripple = pixel(build("ripple", 0.25, { amplitude: 0.04, waves: 3 }));
    expect(ripple.aux).toHaveLength(32);
    expect(ripple.aux![5]).toBeCloseTo(Math.sin((5 / 32) * Math.PI * 2 * 3 + 0.25 * Math.PI * 2) * 0.04 * W * Math.sin(0.25 * Math.PI), 4);
  });

  it("derives the dissolve weights and the film burn colours from the same rules as Canvas2D", () => {
    const additive = pixel(build("additiveDissolve", 0.25));
    expect(additive.v.slice(0, 2)).toEqual([additiveWeights(0.25).outgoing, additiveWeights(0.25).incoming]);
    const cool = pixel(build("filmBurn", 0.5, { intensity: 1, warmth: 0 }));
    expect(cool.v.slice(0, 3).map((c) => Math.round(c * 255))).toEqual([70, 180, 255]);
    const warm = pixel(build("filmBurn", 0.5, { intensity: 1, warmth: 1 }));
    expect(warm.v.slice(0, 3).map((c) => Math.round(c * 255))).toEqual([255, 75, 15]);
  });

  it("mask transitions upload their coverage and skip the raster at the ends", () => {
    for (const p of [0, 1]) expect(pixel(build("checkerboard", p)).mask).toBeUndefined();
    const mid = pixel(build("randomBlocks", 0.5, { borderWidth: 4, borderColor: "#00c800" }));
    expect(mid.shader).toBe("mask");
    expect(mid.mask).toMatchObject({ width: W, height: H });
    expect(mid.mask!.rg).toHaveLength(W * H * 2);
    expect(mid.v.slice(0, 4).map((c, i) => (i < 3 ? Math.round(c * 255) : c))).toEqual([0, 200, 0, 1]);
    expect(mid.mask!.rg.some((v, i) => i % 2 === 0 && v > 0)).toBe(true);
  });

  it("geometric transitions go to the plan pass, and a plan becomes triangles", () => {
    for (const type of ["cubeSpin", "flipOver", "split", "crossZoom", "pagePeel"]) expect(build(type, 0.5)?.kind, type).toBe("plan");
    const spec = build("cubeSpin", 0.5);
    if (spec?.kind !== "plan") throw new Error("plan expected");
    const writer = { data: new Float32Array(9 * 64), count: 0, vertex() {}, reset() {} };
    let vertices = 0;
    writer.vertex = () => {
      vertices += 1;
    };
    writer.reset = () => {
      vertices = 0;
    };
    const count = writePlanVertices(spec.plan, { ...writer, get count() { return vertices; } } as never);
    // Every rect is two triangles and every fill a fan, so the vertex count is a multiple of three.
    expect(count).toBeGreaterThan(6);
    expect(count % 3).toBe(0);
  });
});
