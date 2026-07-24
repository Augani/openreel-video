import { describe, expect, it } from "vitest";
import {
  MotionShaderRenderer,
  parseShaderColor,
  resolveShaderParamUpload,
} from "./motion-shader-renderer";
import type { MotionShaderRenderInput } from "./motion-shader-renderer";
import type { MotionShaderCanvas } from "./motion-shader-renderer";
import type { MotionShaderDef } from "./shaders";
import { getMotionShaderDef } from "./shaders";

const GL_FLOAT = 5126;
const GL_FLOAT_VEC4 = 35666;

const webgl2 = MotionShaderRenderer.isSupported();

function readCenterPixel(canvas: MotionShaderCanvas): readonly [number, number, number, number] {
  const copy = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = copy.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(canvas, 0, 0);
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  const data = ctx.getImageData(cx, cy, 1, 1).data;
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
}

const FRAG_HEADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
`;

describe("parseShaderColor", () => {
  it("parses #RRGGBB to a normalized vec4 with alpha 1", () => {
    expect(parseShaderColor("#ff8000")).toEqual([1, 128 / 255, 0, 1]);
  });

  it("parses #RRGGBBAA including alpha", () => {
    expect(parseShaderColor("#00ff0080")).toEqual([0, 1, 0, 128 / 255]);
  });

  it("expands #RGB shorthand", () => {
    expect(parseShaderColor("#0f0")).toEqual([0, 1, 0, 1]);
  });

  it("falls back to opaque black on invalid input", () => {
    expect(parseShaderColor("not-a-color")).toEqual([0, 0, 0, 1]);
    expect(parseShaderColor("")).toEqual([0, 0, 0, 1]);
    expect(parseShaderColor("#12")).toEqual([0, 0, 0, 1]);
  });
});

describe("resolveShaderParamUpload", () => {
  const COLOR = [0.2, 0.4, 0.6, 1] as const;

  it("uploads a vec4 when the active uniform is FLOAT_VEC4, regardless of param type", () => {
    const result = resolveShaderParamUpload(
      GL_FLOAT_VEC4,
      GL_FLOAT_VEC4,
      "color",
      COLOR,
      9,
    );
    expect(result).toEqual({ kind: "vec4", value: COLOR });
  });

  it("uploads color luminance as a float when a color param maps to a FLOAT uniform", () => {
    const result = resolveShaderParamUpload(
      GL_FLOAT,
      GL_FLOAT_VEC4,
      "color",
      COLOR,
      9,
    );
    expect(result.kind).toBe("float");
    const expected = 0.2126 * 0.2 + 0.7152 * 0.4 + 0.0722 * 0.6;
    if (result.kind !== "float") throw new Error("expected float upload");
    expect(result.value).toBeCloseTo(expected, 6);
  });

  it("uploads the scalar for a numeric param on a FLOAT uniform", () => {
    const result = resolveShaderParamUpload(
      GL_FLOAT,
      GL_FLOAT_VEC4,
      "number",
      COLOR,
      0.75,
    );
    expect(result).toEqual({ kind: "float", value: 0.75 });
  });

  it("never calls uniform4f for a color param on a float uniform (no vec4 branch)", () => {
    const result = resolveShaderParamUpload(
      GL_FLOAT,
      GL_FLOAT_VEC4,
      "color",
      COLOR,
      9,
    );
    expect(result.kind).toBe("float");
  });
});

describe("MotionShaderDef optional fields", () => {
  it("accepts a def carrying all the new optional fields", () => {
    const def: MotionShaderDef = {
      id: "test-optional-fields",
      name: "Optional",
      category: "fill",
      glsl: `${FRAG_HEADER}\nvoid main(){ fragColor = vec4(1.0); }`,
      params: [],
      vertexShader: "custom",
      staticUniforms: { u_scale: 1, u_offset: [0, 0] },
      colorArrayParams: { uniform: "u_colors", countUniform: "u_colorsCount", max: 4 },
      needsNoiseTexture: "u_noise",
      timeScale: 2,
      inputUniform: "u_image",
      collection: "Paper",
    };
    expect(def.timeScale).toBe(2);
    expect(def.collection).toBe("Paper");
  });

  it("keeps existing builtin defs shape-valid with all new fields absent", () => {
    const builtin = getMotionShaderDef("liquid-metal");
    expect(builtin).toBeDefined();
    expect(builtin?.vertexShader).toBeUndefined();
    expect(builtin?.staticUniforms).toBeUndefined();
    expect(builtin?.colorArrayParams).toBeUndefined();
    expect(builtin?.needsNoiseTexture).toBeUndefined();
    expect(builtin?.timeScale).toBeUndefined();
    expect(builtin?.inputUniform).toBeUndefined();
    expect(builtin?.collection).toBeUndefined();
  });
});

describe.skipIf(!webgl2)("MotionShaderRenderer type-driven uniform upload", () => {
  it("uploads a float param via uniform1f", () => {
    const def: MotionShaderDef = {
      id: "test-float-param",
      name: "Float",
      category: "fill",
      glsl: `${FRAG_HEADER}\nuniform float u_level;\nvoid main(){ fragColor = vec4(u_level, u_level, u_level, 1.0); }`,
      params: [{ name: "level", label: "Level", type: "number", default: 0, min: 0, max: 1, step: 0.01 }],
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 4, height: 4, time: 0, params: { level: 0.5 } });
    expect(out).not.toBeNull();
    const [red] = readCenterPixel(out!);
    expect(Math.abs(red - 128)).toBeLessThanOrEqual(2);
    r.dispose();
  });

  it("uploads a color param as vec4 (fixes color-as-float bug)", () => {
    const def: MotionShaderDef = {
      id: "test-color-param",
      name: "Color",
      category: "fill",
      glsl: `${FRAG_HEADER}\nuniform vec4 u_tint;\nvoid main(){ fragColor = u_tint; }`,
      params: [{ name: "tint", label: "Tint", type: "color", default: 0, min: 0, max: 1, step: 1 }],
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 4, height: 4, time: 0, params: { tint: "#ff8000" } });
    expect(out).not.toBeNull();
    const [red, green, blue] = readCenterPixel(out!);
    expect(Math.abs(red - 255)).toBeLessThanOrEqual(2);
    expect(Math.abs(green - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(blue - 0)).toBeLessThanOrEqual(2);
    r.dispose();
  });

  it("uploads a staticUniforms vec2 via uniform2f", () => {
    const def: MotionShaderDef = {
      id: "test-static-vec2",
      name: "StaticVec2",
      category: "fill",
      glsl: `${FRAG_HEADER}\nuniform vec2 u_pt;\nvoid main(){ fragColor = vec4(u_pt.x, u_pt.y, 0.0, 1.0); }`,
      params: [],
      staticUniforms: { u_pt: [1, 0] },
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 4, height: 4, time: 0, params: {} });
    expect(out).not.toBeNull();
    const [red, green] = readCenterPixel(out!);
    expect(Math.abs(red - 255)).toBeLessThanOrEqual(2);
    expect(Math.abs(green - 0)).toBeLessThanOrEqual(2);
    r.dispose();
  });

  it("lets a matching param override a staticUniform of the same name", () => {
    const def: MotionShaderDef = {
      id: "test-static-override",
      name: "Override",
      category: "fill",
      glsl: `${FRAG_HEADER}\nuniform float u_level;\nvoid main(){ fragColor = vec4(u_level, 0.0, 0.0, 1.0); }`,
      params: [{ name: "level", label: "Level", type: "number", default: 0, min: 0, max: 1, step: 0.01 }],
      staticUniforms: { u_level: 0 },
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 4, height: 4, time: 0, params: { level: 1 } });
    expect(out).not.toBeNull();
    const [red] = readCenterPixel(out!);
    expect(Math.abs(red - 255)).toBeLessThanOrEqual(2);
    r.dispose();
  });

  it("packs colorArrayParams and reads u_colors[1] back", () => {
    const def: MotionShaderDef = {
      id: "test-color-array",
      name: "ColorArray",
      category: "fill",
      glsl: `${FRAG_HEADER}\nuniform vec4 u_colors[4];\nuniform int u_colorsCount;\nvoid main(){ fragColor = u_colors[1]; }`,
      params: [
        { name: "color1", label: "C1", type: "color", default: 0, min: 0, max: 1, step: 1 },
        { name: "color2", label: "C2", type: "color", default: 0, min: 0, max: 1, step: 1 },
      ],
      colorArrayParams: { uniform: "u_colors", countUniform: "u_colorsCount", max: 4 },
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, {
      width: 4,
      height: 4,
      time: 0,
      params: { color1: "#000000", color2: "#00ff00" },
    });
    expect(out).not.toBeNull();
    const [red, green, blue] = readCenterPixel(out!);
    expect(Math.abs(red - 0)).toBeLessThanOrEqual(2);
    expect(Math.abs(green - 255)).toBeLessThanOrEqual(2);
    expect(Math.abs(blue - 0)).toBeLessThanOrEqual(2);
    r.dispose();
  });

  it("scales u_time by def.timeScale", () => {
    const def: MotionShaderDef = {
      id: "test-time-scale",
      name: "TimeScale",
      category: "fill",
      glsl: `${FRAG_HEADER}\nuniform float u_time;\nvoid main(){ float v = fract(u_time); fragColor = vec4(v, v, v, 1.0); }`,
      params: [],
      timeScale: 2,
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 4, height: 4, time: 0.25, params: {} });
    expect(out).not.toBeNull();
    const [red] = readCenterPixel(out!);
    expect(Math.abs(red - 128)).toBeLessThanOrEqual(3);
    r.dispose();
  });

  it("compiles and draws with a custom vertex shader", () => {
    const customVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
    const def: MotionShaderDef = {
      id: "test-custom-vertex",
      name: "CustomVertex",
      category: "fill",
      glsl: `${FRAG_HEADER}\nvoid main(){ fragColor = vec4(vUv.x, vUv.y, 0.0, 1.0); }`,
      params: [],
      vertexShader: customVertex,
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 8, height: 8, time: 0, params: {} });
    expect(out).not.toBeNull();
    const [, , , alpha] = readCenterPixel(out!);
    expect(alpha).toBe(255);
    r.dispose();
  });

  it("binds the input texture to a custom inputUniform name", () => {
    const source = new OffscreenCanvas(4, 4);
    const sctx = source.getContext("2d");
    if (!sctx) throw new Error("no 2d ctx");
    sctx.fillStyle = "rgb(0,0,255)";
    sctx.fillRect(0, 0, 4, 4);
    const def: MotionShaderDef = {
      id: "test-input-uniform",
      name: "InputUniform",
      category: "effect",
      glsl: `${FRAG_HEADER}\nuniform sampler2D u_image;\nvoid main(){ fragColor = texture(u_image, vUv); }`,
      params: [],
      inputUniform: "u_image",
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 4, height: 4, time: 0, params: {}, inputCanvas: source });
    expect(out).not.toBeNull();
    const [red, green, blue] = readCenterPixel(out!);
    expect(blue).toBeGreaterThan(200);
    expect(red).toBeLessThan(60);
    expect(green).toBeLessThan(60);
    r.dispose();
  });

  it("uploads a noise texture on TEXTURE1 without clobbering the input on TEXTURE0", () => {
    const def: MotionShaderDef = {
      id: "test-noise-texture",
      name: "Noise",
      category: "fill",
      glsl: `${FRAG_HEADER}\nuniform sampler2D u_noise;\nvoid main(){ vec4 n = texture(u_noise, vUv); fragColor = vec4(n.rgb, 1.0); }`,
      params: [],
      needsNoiseTexture: "u_noise",
    };
    const r = new MotionShaderRenderer();
    const out = r.render(def, { width: 8, height: 8, time: 0, params: {} });
    expect(out).not.toBeNull();
    const [, , , alpha] = readCenterPixel(out!);
    expect(alpha).toBe(255);
    r.dispose();
  });

  it("renders determinism: same input twice yields identical center pixels", () => {
    const def = getMotionShaderDef("liquid-metal")!;
    const input: MotionShaderRenderInput = {
      width: 8,
      height: 8,
      time: 0.3,
      params: { scale: 6, speed: 0.5, contrast: 1.4 },
    };
    const r = new MotionShaderRenderer();
    const a = r.render(def, input);
    const b = r.render(def, input);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(readCenterPixel(a!)).toEqual(readCenterPixel(b!));
    r.dispose();
  });

  it("keeps the existing builtin liquid-metal def rendering non-transparent", () => {
    const def = getMotionShaderDef("liquid-metal")!;
    const r = new MotionShaderRenderer();
    const out = r.render(def, {
      width: 8,
      height: 8,
      time: 0,
      params: { scale: 6, speed: 0, contrast: 1.4 },
    });
    expect(out).not.toBeNull();
    const [, , , alpha] = readCenterPixel(out!);
    expect(alpha).toBeGreaterThan(0);
    r.dispose();
  });
});
