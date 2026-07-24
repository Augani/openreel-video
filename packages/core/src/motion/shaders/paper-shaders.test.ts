import { describe, expect, it } from "vitest";
import {
  PAPER_SHADER_DEFS,
  PAPER_VERTEX_SHADER,
  PAPER_SMOKE_EXCLUSIONS,
} from "./paper-shaders";
import {
  MOTION_SHADER_LIBRARY,
  getMotionShaderFillDefs,
  getMotionShaderEffectDefs,
  getMotionShaderDef,
  defaultMotionShaderParams,
} from "./index";
import {
  MotionShaderRenderer,
  parseShaderColor,
  type MotionShaderCanvas,
} from "../motion-shader-renderer";
import type { MotionShaderDef } from "./types";

const webgl2 = MotionShaderRenderer.isSupported();

function requireDef(id: string): MotionShaderDef {
  const def = getMotionShaderDef(id);
  if (!def) throw new Error(`shader def missing: ${id}`);
  return def;
}

function requireCanvas(
  canvas: MotionShaderCanvas | null,
  label: string,
): MotionShaderCanvas {
  if (!canvas) throw new Error(`expected rendered canvas: ${label}`);
  return canvas;
}

function readPixels(canvas: MotionShaderCanvas): Uint8ClampedArray {
  const copy = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = copy.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function isConstant(data: Uint8ClampedArray): boolean {
  for (let i = 4; i < data.length; i += 4) {
    if (
      data[i] !== data[0] ||
      data[i + 1] !== data[1] ||
      data[i + 2] !== data[2] ||
      data[i + 3] !== data[3]
    ) {
      return false;
    }
  }
  return true;
}

function pixelsDiffer(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

describe("paper shader defs", () => {
  it("registers a non-empty catalog with paper- ids in the Paper collection", () => {
    expect(PAPER_SHADER_DEFS.length).toBeGreaterThanOrEqual(20);
    for (const def of PAPER_SHADER_DEFS) {
      expect(def.id.startsWith("paper-")).toBe(true);
      expect(def.collection).toBe("Paper");
      expect(def.origin).toBe("builtin");
    }
  });

  it("has unique ids that do not collide with the builtin liquid-metal", () => {
    const ids = PAPER_SHADER_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("liquid-metal");
    expect(ids).toContain("paper-liquid-metal");
    const libIds = MOTION_SHADER_LIBRARY.map((d) => d.id);
    expect(new Set(libIds).size).toBe(libIds.length);
  });

  it("wires the shared Paper vertex shader on every def", () => {
    expect(PAPER_VERTEX_SHADER).toContain("#version 300 es");
    for (const def of PAPER_SHADER_DEFS) {
      expect(def.vertexShader).toBe(PAPER_VERTEX_SHADER);
    }
  });

  it("gives every param a finite default inside [min, max]", () => {
    for (const def of PAPER_SHADER_DEFS) {
      expect(def.params.length).toBeGreaterThanOrEqual(2);
      const names = def.params.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
      for (const p of def.params) {
        expect(Number.isFinite(p.min)).toBe(true);
        expect(Number.isFinite(p.max)).toBe(true);
        expect(p.min).toBeLessThanOrEqual(p.max);
        if (p.type === "color") {
          expect(typeof p.default).toBe("string");
          expect(String(p.default)).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
          continue;
        }
        expect(Number.isFinite(p.default)).toBe(true);
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("seeds color params with genuine multi-hue hex defaults, not grayscale", () => {
    const colorParams = PAPER_SHADER_DEFS.flatMap((def) =>
      def.params.filter((p) => p.type === "color"),
    );
    expect(colorParams.length).toBeGreaterThan(0);
    for (const p of colorParams) {
      expect(typeof p.default).toBe("string");
    }
    const meshGradient = requireDef("paper-mesh-gradient");
    const chromatic = meshGradient.params.filter((p) => p.type === "color");
    const channelSpreads = chromatic.map((p) => {
      const [r, g, b] = parseShaderColor(String(p.default));
      return Math.max(r, g, b) - Math.min(r, g, b);
    });
    expect(channelSpreads.some((spread) => spread > 0.05)).toBe(true);
  });

  it("materializes color hex strings through defaultMotionShaderParams", () => {
    const def = requireDef("paper-neuro-noise");
    const params = defaultMotionShaderParams(def);
    for (const p of def.params) {
      if (p.type !== "color") continue;
      expect(typeof params[p.name]).toBe("string");
      expect(String(params[p.name])).toMatch(/^#/);
    }
  });

  it("labels the sizing zoom param 'Zoom' on voronoi and simplex-noise", () => {
    for (const id of ["paper-voronoi", "paper-simplex-noise"]) {
      const def = requireDef(id);
      const scale = def.params.find((p) => p.name === "scale");
      expect(scale?.label).toBe("Zoom");
    }
  });

  it("keeps fills free of any input sampler and effects bound to their image sampler", () => {
    for (const def of PAPER_SHADER_DEFS) {
      if (def.category === "fill") {
        expect(def.inputUniform).toBeUndefined();
        expect(def.glsl.includes("u_image")).toBe(false);
      } else {
        expect(def.category).toBe("effect");
        expect(def.inputUniform).toBeDefined();
        expect(def.glsl.includes(def.inputUniform ?? "")).toBe(true);
      }
    }
  });

  it("declares a colorArray uniform for every multi-color def and matches its GLSL", () => {
    for (const def of PAPER_SHADER_DEFS) {
      if (!def.colorArrayParams) continue;
      expect(def.glsl.includes(`${def.colorArrayParams.uniform}[`)).toBe(true);
      expect(def.glsl.includes(def.colorArrayParams.countUniform)).toBe(true);
      const colorParams = def.params.filter((p) => /^color\d+$/.test(p.name));
      expect(colorParams.length).toBeGreaterThanOrEqual(2);
      expect(colorParams.length).toBeLessThanOrEqual(def.colorArrayParams.max);
    }
  });

  it("references its noise sampler in GLSL wherever needsNoiseTexture is set", () => {
    for (const def of PAPER_SHADER_DEFS) {
      if (!def.needsNoiseTexture) continue;
      expect(def.glsl.includes(def.needsNoiseTexture)).toBe(true);
    }
  });

  it("flows into the motion shader library and the fill/effect aggregators", () => {
    const libIds = new Set(MOTION_SHADER_LIBRARY.map((d) => d.id));
    for (const def of PAPER_SHADER_DEFS) {
      expect(libIds.has(def.id)).toBe(true);
      expect(getMotionShaderDef(def.id)).toBe(def);
    }
    const fillIds = new Set(getMotionShaderFillDefs().map((d) => d.id));
    const effectIds = new Set(getMotionShaderEffectDefs().map((d) => d.id));
    for (const def of PAPER_SHADER_DEFS) {
      if (def.category === "fill") expect(fillIds.has(def.id)).toBe(true);
      else expect(effectIds.has(def.id)).toBe(true);
    }
  });

  it("excludes no def that is also present (smoke-exclusion list stays consistent)", () => {
    const ids = new Set(PAPER_SHADER_DEFS.map((d) => d.id));
    for (const excluded of PAPER_SMOKE_EXCLUSIONS) {
      expect(ids.has(excluded)).toBe(false);
    }
  });
});

describe.skipIf(!webgl2)("paper shader defs render", () => {
  it("compiles every def via validateFragmentSource", () => {
    const r = new MotionShaderRenderer();
    for (const def of PAPER_SHADER_DEFS) {
      const result = r.validateFragmentSource(def.glsl);
      expect(result.ok, `${def.id}: ${result.ok ? "" : result.error}`).toBe(true);
    }
    r.dispose();
  });

  it("renders non-constant output for a static fill (dot-grid)", () => {
    const def = requireDef("paper-dot-grid");
    const r = new MotionShaderRenderer();
    const params = Object.fromEntries(def.params.map((p) => [p.name, p.default]));
    const out = r.render(def, { width: 16, height: 16, time: 0, params });
    expect(isConstant(readPixels(requireCanvas(out, def.id)))).toBe(false);
    r.dispose();
  });

  it("animates: t=0 vs t=1 differ for animated fills", () => {
    const r = new MotionShaderRenderer();
    for (const id of ["paper-mesh-gradient", "paper-smoke-ring", "paper-spiral"]) {
      const def = requireDef(id);
      const params = Object.fromEntries(def.params.map((p) => [p.name, p.default]));
      const a = r.render(def, { width: 16, height: 16, time: 0, params });
      const b = r.render(def, { width: 16, height: 16, time: 1, params });
      expect(
        pixelsDiffer(readPixels(requireCanvas(a, id)), readPixels(requireCanvas(b, id))),
        id,
      ).toBe(true);
    }
    r.dispose();
  });

  it("binds every declared vec4 color uniform in every def", () => {
    const AUTO = new Set(["u_resolution", "u_time", "u_progress", "u_pixelRatio", "u_imageAspectRatio"]);
    for (const def of PAPER_SHADER_DEFS) {
      const declared = [...def.glsl.matchAll(/uniform\s+vec4\s+(u_[A-Za-z0-9_]+)/g)].map((m) => m[1]);
      const bound = new Set<string>();
      for (const p of def.params) bound.add(`u_${p.name}`);
      for (const key of Object.keys(def.staticUniforms ?? {})) bound.add(key);
      if (def.colorArrayParams) bound.add(def.colorArrayParams.uniform);
      const unbound = declared.filter((u) => !bound.has(u) && !AUTO.has(u));
      expect(unbound, `${def.id} has unbound vec4 color uniforms: ${unbound.join(", ")}`).toEqual([]);
    }
  });
});
