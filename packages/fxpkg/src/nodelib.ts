/**
 * The Standard Node Library (STUDIO_PLAN §12). This is the product surface:
 * the set of typed operations creators (and blueprints) compose into graphs.
 *
 * Inline-fusable color/math nodes carry an `emitInline` WGSL emitter used by
 * the filter compiler (§11). Detection / particle / overlay / temporal nodes
 * are declared with their ports + caps so the validator and palette can use
 * them; their runtime is provided by packages/core and the render farm.
 */
import type { AbiVersion, PortType } from "./types";
import { abiAtLeast } from "./abi";

export type PassKind =
  | "input"
  | "inline"
  | "sampling"
  | "reduction"
  | "compute"
  | "render"
  | "composite"
  | "external"
  | "output"
  | "template";

export type NodeCategory =
  | "input"
  | "detection"
  | "math"
  | "sampling"
  | "color"
  | "spatial"
  | "composite"
  | "particles"
  | "overlays"
  | "temporal"
  | "behavior"
  | "output"
  | "template"
  | "system";

export interface PortSpec {
  id: string;
  name: string;
  type: PortType;
}

export interface InlineEmitArgs {
  /** WGSL expression for each connected input port, keyed by port id */
  inputs: Record<string, string>;
  /** node config (constants, selected options) */
  cfg: Record<string, unknown>;
}

export interface NodeSpec {
  id: string;
  category: NodeCategory;
  label: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** minimum ABI version that includes this node */
  minAbi: AbiVersion;
  passKind: PassKind;
  /** hidden from the user-facing palette (blueprint/system internals, §12) */
  systemOwned?: boolean;
  /** WGSL helper functions this node needs, appended once to the shader prelude */
  prelude?: string;
  /** emits a WGSL expression for the node's output (inline-fusable nodes only) */
  emitInline?: (args: InlineEmitArgs) => string;
}

function n(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

const PRELUDE_SATURATE = `fn fx_saturate(c: vec4<f32>, amount: f32) -> vec4<f32> {
  let l = dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
  return vec4<f32>(mix(vec3<f32>(l), c.rgb, 1.0 + amount), c.a);
}`;

const PRELUDE_VIGNETTE = `fn fx_vignette(c: vec4<f32>, uv: vec2<f32>, softness: f32) -> vec4<f32> {
  let d = distance(uv, vec2<f32>(0.5));
  let v = smoothstep(0.5, 0.5 - softness, d);
  return vec4<f32>(c.rgb * v, c.a);
}`;

const PRELUDE_HUE = `fn fx_hue(c: vec4<f32>, deg: f32) -> vec4<f32> {
  let a = radians(deg);
  let k = vec3<f32>(0.57735);
  let cosA = cos(a);
  let rot = c.rgb * cosA + cross(k, c.rgb) * sin(a) + k * dot(k, c.rgb) * (1.0 - cosA);
  return vec4<f32>(rot, c.a);
}`;

/**
 * Standard library node specifications, keyed by node id.
 * Mirrors STUDIO_PLAN §12.2–§12.4.
 */
export const NODES: Record<string, NodeSpec> = {
  // ── Inputs (§12.3) ──────────────────────────────────────────────────────
  Source: {
    id: "Source", category: "input", label: "Source", minAbi: "1.0", passKind: "input",
    inputs: [], outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: () => "fx_src",
  },
  Time: {
    id: "Time", category: "input", label: "Time", minAbi: "1.0", passKind: "input",
    inputs: [], outputs: [{ id: "out", name: "seconds", type: "float" }],
    emitInline: () => "u_time",
  },
  Resolution: {
    id: "Resolution", category: "input", label: "Resolution", minAbi: "1.0", passKind: "input",
    inputs: [], outputs: [{ id: "out", name: "wh", type: "vec2" }],
    emitInline: () => "u_resolution",
  },
  Param: {
    id: "Param", category: "input", label: "Param", minAbi: "1.0", passKind: "input",
    inputs: [], outputs: [{ id: "out", name: "value", type: "float" }],
    emitInline: ({ cfg }) => `param_${String(cfg.param ?? "p")}`,
  },
  ImageSource: {
    id: "ImageSource", category: "input", label: "Image Source", minAbi: "1.0", passKind: "input",
    inputs: [], outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: () => `vec4<f32>(0.0, 0.0, 0.0, 1.0)`,
  },
  ColorSource: {
    id: "ColorSource", category: "input", label: "Color Source", minAbi: "1.0", passKind: "input",
    inputs: [], outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ cfg }) => `vec4<f32>(vec3<f32>(${n(cfg.color, 0)}), 1.0)`,
  },

  // ── Math (§12.3) ────────────────────────────────────────────────────────
  Add: {
    id: "Add", category: "math", label: "Add", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "a", name: "a", type: "any" }, { id: "b", name: "b", type: "any" }],
    outputs: [{ id: "out", name: "out", type: "any" }],
    emitInline: ({ inputs }) => `(${inputs.a} + ${inputs.b})`,
  },
  Multiply: {
    id: "Multiply", category: "math", label: "Multiply", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "a", name: "a", type: "any" }, { id: "b", name: "b", type: "any" }],
    outputs: [{ id: "out", name: "out", type: "any" }],
    emitInline: ({ inputs }) => `(${inputs.a} * ${inputs.b})`,
  },
  Mix: {
    id: "Mix", category: "math", label: "Mix", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "a", name: "a", type: "any" }, { id: "b", name: "b", type: "any" }, { id: "t", name: "t", type: "float" }],
    outputs: [{ id: "out", name: "out", type: "any" }],
    emitInline: ({ inputs }) => `mix(${inputs.a}, ${inputs.b}, ${inputs.t})`,
  },
  Smoothstep: {
    id: "Smoothstep", category: "math", label: "Smoothstep", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "e0", name: "edge0", type: "float" }, { id: "e1", name: "edge1", type: "float" }, { id: "x", name: "x", type: "float" }],
    outputs: [{ id: "out", name: "out", type: "float" }],
    emitInline: ({ inputs }) => `smoothstep(${inputs.e0}, ${inputs.e1}, ${inputs.x})`,
  },
  Clamp: {
    id: "Clamp", category: "math", label: "Clamp", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "x", name: "x", type: "any" }],
    outputs: [{ id: "out", name: "out", type: "any" }],
    emitInline: ({ inputs }) => `clamp(${inputs.x}, vec4<f32>(0.0), vec4<f32>(1.0))`,
  },
  Noise: {
    id: "Noise", category: "math", label: "Noise", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "p", name: "p", type: "vec2" }],
    outputs: [{ id: "out", name: "out", type: "float" }],
    prelude: `fn fx_noise(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }`,
    emitInline: ({ inputs }) => `fx_noise(${inputs.p})`,
  },
  Remap: {
    id: "Remap", category: "math", label: "Remap", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "x", name: "x", type: "float" }],
    outputs: [{ id: "out", name: "out", type: "float" }],
    emitInline: ({ inputs, cfg }) =>
      `(${n(cfg.outMin, 0)} + (${inputs.x} - ${n(cfg.inMin, 0)}) * (${n(cfg.outMax, 1) - n(cfg.outMin, 0)}) / (${n(cfg.inMax, 1) - n(cfg.inMin, 0)}))`,
  },

  // ── Color (§12.3) ───────────────────────────────────────────────────────
  Brightness: {
    id: "Brightness", category: "color", label: "Brightness", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs, cfg }) => `vec4<f32>(${inputs.in}.rgb + ${n(cfg.amount, 0)}, ${inputs.in}.a)`,
  },
  Contrast: {
    id: "Contrast", category: "color", label: "Contrast", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs, cfg }) => `vec4<f32>((${inputs.in}.rgb - 0.5) * ${n(cfg.amount, 1)} + 0.5, ${inputs.in}.a)`,
  },
  Saturation: {
    id: "Saturation", category: "color", label: "Saturation", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    prelude: PRELUDE_SATURATE,
    emitInline: ({ inputs, cfg }) => `fx_saturate(${inputs.in}, ${n(cfg.amount, 0)})`,
  },
  HueShift: {
    id: "HueShift", category: "color", label: "Hue Shift", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    prelude: PRELUDE_HUE,
    emitInline: ({ inputs, cfg }) => `fx_hue(${inputs.in}, ${n(cfg.degrees, 0)})`,
  },
  Levels: {
    id: "Levels", category: "color", label: "Levels", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs, cfg }) =>
      `vec4<f32>(clamp((${inputs.in}.rgb - ${n(cfg.black, 0)}) / max(0.0001, ${n(cfg.white, 1) - n(cfg.black, 0)}), vec3<f32>(0.0), vec3<f32>(1.0)), ${inputs.in}.a)`,
  },
  Curves: {
    id: "Curves", category: "color", label: "Curves", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs, cfg }) => `vec4<f32>(pow(${inputs.in}.rgb, vec3<f32>(${n(cfg.gamma, 1)})), ${inputs.in}.a)`,
  },
  LUTLookup: {
    id: "LUTLookup", category: "color", label: "LUT Lookup", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  LUT: {
    id: "LUT", category: "color", label: "LUT", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs }) => `${inputs.in}`,
  },
  ColorIsolate: {
    id: "ColorIsolate", category: "color", label: "Color Isolation", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    prelude: PRELUDE_SATURATE,
    emitInline: ({ inputs, cfg }) =>
      `mix(fx_saturate(${inputs.in}, -1.0), ${inputs.in}, step(abs(${inputs.in}.r - ${n(cfg.hue, 0)}), ${n(cfg.range, 0.15)}))`,
  },
  ColorTint: {
    id: "ColorTint", category: "color", label: "Color Tint", minAbi: "1.0", passKind: "inline",
    inputs: [
      { id: "in", name: "rgba", type: "texture" },
      { id: "mask", name: "mask", type: "mask" },
    ],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs, cfg }) =>
      `mix(${inputs.in}, vec4<f32>(vec3<f32>(${n(cfg.color, 1)}), 1.0), ${inputs.mask}.r * ${n(cfg.strength, 0.5)})`,
  },
  Grain: {
    id: "Grain", category: "color", label: "Grain", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    prelude: `fn fx_grain(c: vec4<f32>, uv: vec2<f32>, t: f32, s: f32) -> vec4<f32> {
  let n = fract(sin(dot(uv * t, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  return vec4<f32>(c.rgb + (n - 0.5) * s, c.a);
}`,
    emitInline: ({ inputs, cfg }) => `fx_grain(${inputs.in}, fx_uv, u_time, ${n(cfg.strength, 0.1)})`,
  },

  // ── Spatial (§12.3) ─────────────────────────────────────────────────────
  Vignette: {
    id: "Vignette", category: "spatial", label: "Vignette", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    prelude: PRELUDE_VIGNETTE,
    emitInline: ({ inputs, cfg }) => `fx_vignette(${inputs.in}, fx_uv, ${n(cfg.softness, 0.4)})`,
  },
  Pixelate: {
    id: "Pixelate", category: "spatial", label: "Pixelate", minAbi: "1.0", passKind: "sampling",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  Sharpen: {
    id: "Sharpen", category: "spatial", label: "Sharpen", minAbi: "1.0", passKind: "sampling",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  Cutout: {
    id: "Cutout", category: "spatial", label: "Cutout", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "src", name: "source", type: "texture" }, { id: "mask", name: "mask", type: "mask" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  Mirror: {
    id: "Mirror", category: "spatial", label: "Mirror", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  Duplicate: {
    id: "Duplicate", category: "spatial", label: "Duplicate", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  Transform: {
    id: "Transform", category: "spatial", label: "Transform", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  UVDistortion: {
    id: "UVDistortion", category: "spatial", label: "UV Distortion", minAbi: "1.0", passKind: "sampling",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs }) => `${inputs.in}`,
  },
  LetterboxBars: {
    id: "LetterboxBars", category: "overlays", label: "Letterbox Bars", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs, cfg }) =>
      `select(${inputs.in}, vec4<f32>(vec3<f32>(${n(cfg.color, 0)}), 1.0), (fx_uv.y < ${n(cfg.height, 0.12)}) || (fx_uv.y > (1.0 - ${n(cfg.height, 0.12)})))`,
  },

  // ── Sampling (§12.3) ────────────────────────────────────────────────────
  GaussianBlur: {
    id: "GaussianBlur", category: "sampling", label: "Gaussian Blur", minAbi: "1.0", passKind: "sampling",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  BoxBlur: {
    id: "BoxBlur", category: "sampling", label: "Box Blur", minAbi: "1.0", passKind: "sampling",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  DirectionalBlur: {
    id: "DirectionalBlur", category: "sampling", label: "Directional Blur", minAbi: "1.0", passKind: "sampling",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  MaskEdge: {
    id: "MaskEdge", category: "sampling", label: "Mask Edge", minAbi: "1.0", passKind: "sampling",
    inputs: [{ id: "in", name: "mask", type: "mask" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs }) => `vec4<f32>(vec3<f32>(${inputs.in}.r), ${inputs.in}.r)`,
  },

  // ── Detection (§12.4) ───────────────────────────────────────────────────
  SubjectMask: {
    id: "SubjectMask", category: "detection", label: "Subject Mask", minAbi: "1.0", passKind: "external",
    inputs: [{ id: "src", name: "frame", type: "texture" }],
    outputs: [{ id: "mask", name: "mask", type: "mask" }],
  },
  SubjectMaskInverted: {
    id: "SubjectMaskInverted", category: "detection", label: "Subject Mask (Inverted)", minAbi: "1.0", passKind: "external",
    inputs: [{ id: "src", name: "frame", type: "texture" }],
    outputs: [{ id: "mask", name: "mask", type: "mask" }],
  },
  MaskEdgeEmitter: {
    id: "MaskEdgeEmitter", category: "detection", label: "Mask Edge Emitter", minAbi: "1.0", passKind: "external",
    inputs: [{ id: "mask", name: "mask", type: "mask" }],
    outputs: [{ id: "pts", name: "spawn", type: "vec2" }],
  },
  PoseLandmark: {
    id: "PoseLandmark", category: "detection", label: "Pose Landmark", minAbi: "1.0", passKind: "external",
    inputs: [], outputs: [{ id: "pt", name: "landmark", type: "vec3" }],
  },
  PoseAllLandmarks: {
    id: "PoseAllLandmarks", category: "detection", label: "All Pose Landmarks", minAbi: "1.0", passKind: "external",
    inputs: [], outputs: [{ id: "buf", name: "landmarks", type: "landmark_buffer" }],
  },
  FaceLandmark: {
    id: "FaceLandmark", category: "detection", label: "Face Landmark", minAbi: "1.1", passKind: "external",
    inputs: [], outputs: [{ id: "pt", name: "landmark", type: "vec3" }],
  },
  FaceBlendshape: {
    id: "FaceBlendshape", category: "detection", label: "Face Blendshape", minAbi: "1.1", passKind: "external",
    inputs: [], outputs: [{ id: "v", name: "weight", type: "float" }],
  },
  Depth: {
    id: "Depth", category: "detection", label: "Depth", minAbi: "1.2", passKind: "external",
    inputs: [{ id: "src", name: "frame", type: "texture" }],
    outputs: [{ id: "depth", name: "depth", type: "depth" }],
  },
  FaceMask: {
    id: "FaceMask", category: "detection", label: "Face Mask", minAbi: "1.0", passKind: "external",
    inputs: [{ id: "landmarks", name: "landmarks", type: "landmark_buffer" }],
    outputs: [{ id: "out", name: "mask", type: "mask" }],
  },
  FaceSkinMask: {
    id: "FaceSkinMask", category: "detection", label: "Face Skin Mask", minAbi: "1.0", passKind: "external",
    inputs: [{ id: "landmarks", name: "landmarks", type: "landmark_buffer" }],
    outputs: [{ id: "out", name: "mask", type: "mask" }],
  },
  FaceLandmarker: {
    id: "FaceLandmarker", category: "detection", label: "Face Landmarker", minAbi: "1.0", passKind: "external",
    inputs: [{ id: "src", name: "frame", type: "texture" }],
    outputs: [{ id: "buf", name: "landmarks", type: "landmark_buffer" }],
  },

  // ── Particles (§12.4, §20) ──────────────────────────────────────────────
  ParticleEmitter: {
    id: "ParticleEmitter", category: "particles", label: "Particle Emitter", minAbi: "1.0", passKind: "compute",
    inputs: [{ id: "spawn", name: "spawn", type: "vec2" }, { id: "rate", name: "rate", type: "float" }],
    outputs: [{ id: "state", name: "state", type: "particles" }],
  },
  ParticleField: {
    id: "ParticleField", category: "particles", label: "Particle Field", minAbi: "1.0", passKind: "compute",
    inputs: [{ id: "state", name: "state", type: "particles" }],
    outputs: [{ id: "state", name: "state", type: "particles" }],
  },
  ParticleRenderer: {
    id: "ParticleRenderer", category: "particles", label: "Particle Renderer", minAbi: "1.0", passKind: "render",
    inputs: [{ id: "state", name: "state", type: "particles" }],
    outputs: [{ id: "tex", name: "rgba", type: "texture" }],
  },
  LandmarkEmitter: {
    id: "LandmarkEmitter", category: "particles", label: "Landmark Emitter", minAbi: "1.0", passKind: "external",
    inputs: [{ id: "buf", name: "landmarks", type: "landmark_buffer" }],
    outputs: [{ id: "pts", name: "spawn", type: "vec2" }],
  },

  // ── Overlays (§12.4, §21) ───────────────────────────────────────────────
  Sprite: {
    id: "Sprite", category: "overlays", label: "Sprite", minAbi: "1.0", passKind: "render",
    inputs: [{ id: "anchor", name: "anchor", type: "vec2" }],
    outputs: [{ id: "tex", name: "rgba", type: "texture" }],
  },
  SpriteAnimation: {
    id: "SpriteAnimation", category: "overlays", label: "Sprite Animation", minAbi: "1.0", passKind: "render",
    inputs: [{ id: "anchor", name: "anchor", type: "vec2" }],
    outputs: [{ id: "tex", name: "rgba", type: "texture" }],
  },
  Mesh3D: {
    id: "Mesh3D", category: "overlays", label: "Mesh 3D", minAbi: "1.2", passKind: "render",
    inputs: [{ id: "anchor", name: "anchor", type: "vec3" }],
    outputs: [{ id: "tex", name: "rgba", type: "texture" }],
  },
  Anchor: {
    id: "Anchor", category: "overlays", label: "Anchor", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "pt", name: "landmark", type: "vec3" }],
    outputs: [{ id: "out", name: "anchor", type: "vec2" }],
  },
  BillboardAnchor: {
    id: "BillboardAnchor", category: "overlays", label: "Billboard Anchor", minAbi: "1.2", passKind: "inline",
    inputs: [{ id: "pt", name: "landmark", type: "vec3" }],
    outputs: [{ id: "out", name: "anchor", type: "vec3" }],
  },

  // ── Temporal (§12.4, §19) ───────────────────────────────────────────────
  FrameHistory: {
    id: "FrameHistory", category: "temporal", label: "Frame History", minAbi: "1.1", passKind: "compute",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  MaskHistory: {
    id: "MaskHistory", category: "temporal", label: "Mask History", minAbi: "1.1", passKind: "compute",
    inputs: [{ id: "in", name: "mask", type: "mask" }],
    outputs: [{ id: "out", name: "mask", type: "mask" }],
  },
  Trail: {
    id: "Trail", category: "temporal", label: "Trail", minAbi: "1.1", passKind: "compute",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  MotionVector: {
    id: "MotionVector", category: "temporal", label: "Motion Vector", minAbi: "1.1", passKind: "compute",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "motion", type: "vec2" }],
  },

  // ── Behavior drivers (§12.4) ────────────────────────────────────────────
  AudioLevel: {
    id: "AudioLevel", category: "behavior", label: "Audio Level", minAbi: "1.1", passKind: "external",
    inputs: [], outputs: [{ id: "v", name: "level", type: "float" }],
  },
  AudioBeat: {
    id: "AudioBeat", category: "behavior", label: "Audio Beat", minAbi: "1.1", passKind: "external",
    inputs: [], outputs: [{ id: "v", name: "beat", type: "float" }],
  },
  MotionVelocity: {
    id: "MotionVelocity", category: "behavior", label: "Motion Velocity", minAbi: "1.0", passKind: "external",
    inputs: [], outputs: [{ id: "v", name: "velocity", type: "float" }],
  },
  Smooth: {
    id: "Smooth", category: "behavior", label: "Smooth", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "x", name: "x", type: "float" }],
    outputs: [{ id: "out", name: "out", type: "float" }],
    emitInline: ({ inputs }) => inputs.x,
  },
  PulseModulator: {
    id: "PulseModulator", category: "behavior", label: "Pulse Modulator", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
    emitInline: ({ inputs, cfg }) =>
      `(${inputs.in} * (0.5 + 0.5 * sin(u_time * ${n(cfg.speed, 1)})))`,
  },

  // ── Composite (§12.3, §22) ──────────────────────────────────────────────
  Layer: {
    id: "Layer", category: "composite", label: "Layer", minAbi: "1.0", passKind: "composite",
    inputs: [
      { id: "back", name: "back", type: "texture" },
      { id: "mid", name: "source", type: "texture" },
      { id: "front", name: "front", type: "texture" },
      { id: "mask", name: "mask", type: "mask" },
      { id: "amount", name: "amount", type: "float" },
    ],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  Blend: {
    id: "Blend", category: "composite", label: "Blend", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "a", name: "a", type: "texture" }, { id: "b", name: "b", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  Mask: {
    id: "Mask", category: "composite", label: "Mask", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "a", name: "a", type: "mask" }, { id: "b", name: "b", type: "mask" }],
    outputs: [{ id: "out", name: "mask", type: "mask" }],
  },
  InvertMask: {
    id: "InvertMask", category: "composite", label: "Invert Mask", minAbi: "1.0", passKind: "inline",
    inputs: [{ id: "in", name: "mask", type: "mask" }],
    outputs: [{ id: "out", name: "mask", type: "mask" }],
    emitInline: ({ inputs }) =>
      `vec4<f32>(1.0 - ${inputs.in}.r, 1.0 - ${inputs.in}.r, 1.0 - ${inputs.in}.r, 1.0)`,
  },
  MixTextures: {
    id: "MixTextures", category: "composite", label: "Mix Textures", minAbi: "1.0", passKind: "composite",
    inputs: [{ id: "a", name: "a", type: "texture" }, { id: "b", name: "b", type: "texture" }, { id: "t", name: "t", type: "float" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  ZComposite: {
    id: "ZComposite", category: "composite", label: "Z-Composite", minAbi: "1.2", passKind: "composite",
    inputs: [{ id: "a", name: "a", type: "texture" }, { id: "b", name: "b", type: "texture" }, { id: "depth", name: "depth", type: "depth" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },

  // ── Output (§12.3) ──────────────────────────────────────────────────────
  Output: {
    id: "Output", category: "output", label: "Output", minAbi: "1.0", passKind: "output",
    inputs: [{ id: "in", name: "rgba", type: "texture" }],
    outputs: [],
  },

  // ── System-owned blueprint safety nodes (§9A.6) ─────────────────────────
  TemporalSmooth: {
    id: "TemporalSmooth", category: "system", label: "Temporal Smooth", minAbi: "1.0", passKind: "compute", systemOwned: true,
    inputs: [{ id: "in", name: "mask", type: "mask" }],
    outputs: [{ id: "out", name: "mask", type: "mask" }],
  },
  ConfidenceGate: {
    id: "ConfidenceGate", category: "system", label: "Confidence Gate", minAbi: "1.0", passKind: "inline", systemOwned: true,
    inputs: [{ id: "in", name: "mask", type: "mask" }],
    outputs: [{ id: "out", name: "mask", type: "mask" }],
  },
  FallbackComposite: {
    id: "FallbackComposite", category: "system", label: "Fallback Composite", minAbi: "1.0", passKind: "composite", systemOwned: true,
    inputs: [{ id: "primary", name: "primary", type: "texture" }, { id: "fallback", name: "fallback", type: "texture" }],
    outputs: [{ id: "out", name: "rgba", type: "texture" }],
  },
  BudgetClamp: {
    id: "BudgetClamp", category: "system", label: "Budget Clamp", minAbi: "1.0", passKind: "inline", systemOwned: true,
    inputs: [{ id: "state", name: "state", type: "particles" }],
    outputs: [{ id: "out", name: "state", type: "particles" }],
  },

  // ── Template nodes (§12.2) ──────────────────────────────────────────────
  VideoSlot: {
    id: "VideoSlot", category: "template", label: "Video Slot", minAbi: "1.0", passKind: "template",
    inputs: [], outputs: [{ id: "out", name: "clip", type: "texture" }],
  },
  TextSlot: {
    id: "TextSlot", category: "template", label: "Text Slot", minAbi: "1.0", passKind: "template",
    inputs: [], outputs: [{ id: "out", name: "text", type: "texture" }],
  },
  AudioSlot: {
    id: "AudioSlot", category: "template", label: "Audio Slot", minAbi: "1.0", passKind: "template",
    inputs: [], outputs: [{ id: "out", name: "audio", type: "any" }],
  },
  ImageSlot: {
    id: "ImageSlot", category: "template", label: "Image Slot", minAbi: "1.0", passKind: "template",
    inputs: [], outputs: [{ id: "out", name: "image", type: "texture" }],
  },
  ApplyFilter: {
    id: "ApplyFilter", category: "template", label: "Apply Filter", minAbi: "1.0", passKind: "template",
    inputs: [{ id: "in", name: "clip", type: "texture" }],
    outputs: [{ id: "out", name: "clip", type: "texture" }],
  },
  ApplyEffect: {
    id: "ApplyEffect", category: "template", label: "Apply Effect", minAbi: "1.0", passKind: "template",
    inputs: [{ id: "in", name: "clip", type: "texture" }],
    outputs: [{ id: "out", name: "clip", type: "texture" }],
  },
};

export function getNode(id: string): NodeSpec | undefined {
  return NODES[id];
}

/** Node ids permitted under a given ABI version. */
export function allowedNodes(abi: AbiVersion): string[] {
  return Object.values(NODES)
    .filter((spec) => abiAtLeast(abi, spec.minAbi))
    .map((spec) => spec.id);
}

/** Palette-visible nodes (excludes system-owned blueprint internals). */
export function paletteNodes(abi: AbiVersion): NodeSpec[] {
  return Object.values(NODES).filter((spec) => abiAtLeast(abi, spec.minAbi) && !spec.systemOwned);
}
