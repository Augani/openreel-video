import type { CatKey, IconName, PortType } from "./icons";

export type AssetKind = "effect" | "filter" | "template";

export interface Starter {
  id: string;
  title: string;
  desc: string;
  kind: AssetKind;
  art: string;
  perf: string;
  detection: string[];
  category: string;
}

export const STARTERS: Starter[] = [
  { id: "fire-aura", title: "Fire Around Subject", desc: "Mask-edge particle emitter, additive blend, color-ramp over lifetime.", kind: "effect", art: "fire", perf: "~9ms", detection: ["subject_mask"], category: "particles" },
  { id: "three-of-me", title: "Three of Me", desc: "Cutout subject, transform into three copies across the frame.", kind: "effect", art: "mirror", perf: "~7ms", detection: ["subject_mask"], category: "subject" },
  { id: "sparkle-face", title: "Sparkles on Face", desc: "Face landmark-driven sparkle emitter with audio-beat reactivity.", kind: "effect", art: "sparkle", perf: "~10ms", detection: ["face"], category: "particles" },
  { id: "ghost-trail", title: "Ghost Trail", desc: "Mask-masked frame history, exponential fade, screen blend.", kind: "effect", art: "trail", perf: "~8ms", detection: ["subject_mask"], category: "temporal" },
  { id: "warm-vignette", title: "Warm Vignette", desc: "Saturate + radial vignette, single-pass fused shader.", kind: "filter", art: "vignette", perf: "~3ms", detection: [], category: "color" },
  { id: "bokeh", title: "Cinematic Bokeh", desc: "Depth-driven defocus blur, soft circular highlights.", kind: "effect", art: "bokeh", perf: "~14ms", detection: ["depth"], category: "depth" },
  { id: "color-iso", title: "Color Isolation", desc: "Desaturate everything except a target hue range.", kind: "filter", art: "color-iso", perf: "~4ms", detection: [], category: "color" },
  { id: "travel-reel", title: "Travel Reel", desc: "3-clip travel template with text overlay and warm-vignette baked in.", kind: "template", art: "travel", perf: "—", detection: [], category: "social" },
  { id: "zoom-beat", title: "Zoom on Beat", desc: "Detect drum onset, pulse subject scale with smooth easing.", kind: "effect", art: "zoom", perf: "~6ms", detection: ["pose"], category: "behavior" },
  { id: "depth-fog", title: "Depth Fog", desc: "Atmospheric fog layered by depth, color and density controllable.", kind: "effect", art: "depth", perf: "~16ms", detection: ["depth"], category: "depth" },
  { id: "butterflies", title: "Floating Butterflies", desc: "3D butterflies anchored to shoulder landmarks. GLB sprite mix.", kind: "effect", art: "butterfly", perf: "~12ms", detection: ["pose"], category: "overlays" },
  { id: "aura-glow", title: "Aura Glow", desc: "Edge-feathered subject silhouette, looping color cycle.", kind: "effect", art: "aura", perf: "~5ms", detection: ["subject_mask"], category: "color" },
];

export interface PaletteItem {
  id: string;
  icon: IconName;
  doc?: string;
  used?: boolean;
}

export interface PaletteGroupData {
  cat: CatKey;
  items: PaletteItem[];
}

export const PALETTE: PaletteGroupData[] = [
  { cat: "input", items: [
    { id: "Source", icon: "video", doc: "input frame texture", used: true },
    { id: "Time", icon: "history", doc: "global time, seconds" },
    { id: "Resolution", icon: "monitor", doc: "output (w,h) px" },
    { id: "Param", icon: "sliders", doc: "user-exposed parameter" },
  ] },
  { cat: "detection", items: [
    { id: "SubjectMask", icon: "person", used: true },
    { id: "MaskEdgeEmitter", icon: "diff", used: true },
    { id: "PoseLandmark", icon: "target" },
    { id: "PoseAllLandmarks", icon: "person" },
    { id: "FaceLandmark", icon: "face" },
    { id: "FaceBlendshape", icon: "face" },
    { id: "Depth", icon: "layers" },
  ] },
  { cat: "math", items: [
    { id: "Add", icon: "plus" },
    { id: "Multiply", icon: "x" },
    { id: "Mix", icon: "function" },
    { id: "Smoothstep", icon: "waves" },
    { id: "Clamp", icon: "function" },
    { id: "Noise", icon: "waves" },
    { id: "Remap", icon: "function" },
  ] },
  { cat: "sampling", items: [
    { id: "SampleTexture", icon: "image" },
    { id: "GaussianBlur", icon: "blur" },
    { id: "BoxBlur", icon: "blur" },
    { id: "DirectionalBlur", icon: "blur" },
  ] },
  { cat: "color", items: [
    { id: "Brightness", icon: "sun" },
    { id: "Contrast", icon: "contrast" },
    { id: "Saturation", icon: "droplet" },
    { id: "HueShift", icon: "palette" },
    { id: "LUTLookup", icon: "grid" },
    { id: "Curves", icon: "activity" },
  ] },
  { cat: "spatial", items: [
    { id: "UVDistortion", icon: "bezier" },
    { id: "Pixelate", icon: "grid" },
    { id: "Sharpen", icon: "target" },
    { id: "Cutout", icon: "person" },
    { id: "Mirror", icon: "copy" },
    { id: "Duplicate", icon: "copy" },
    { id: "Transform", icon: "fit" },
  ] },
  { cat: "particles", items: [
    { id: "ParticleEmitter", icon: "sparkle", used: true },
    { id: "ParticleField", icon: "wind", used: true },
    { id: "ParticleRenderer", icon: "flame", used: true },
    { id: "LandmarkEmitter", icon: "target" },
  ] },
  { cat: "overlays", items: [
    { id: "Sprite", icon: "image" },
    { id: "SpriteAnimation", icon: "image" },
    { id: "Mesh3D", icon: "cube" },
    { id: "Anchor", icon: "target" },
    { id: "BillboardAnchor", icon: "target" },
  ] },
  { cat: "temporal", items: [
    { id: "FrameHistory", icon: "history" },
    { id: "MaskHistory", icon: "history" },
    { id: "Trail", icon: "waves" },
    { id: "MotionVector", icon: "activity" },
  ] },
  { cat: "behavior", items: [
    { id: "AudioLevel", icon: "music" },
    { id: "AudioBeat", icon: "music" },
    { id: "MotionVelocity", icon: "activity" },
    { id: "Smooth", icon: "waves" },
  ] },
  { cat: "composite", items: [
    { id: "Layer", icon: "layers", used: true },
    { id: "Blend", icon: "layers" },
    { id: "Mask", icon: "diff" },
    { id: "MixTextures", icon: "function" },
  ] },
  { cat: "output", items: [
    { id: "Output", icon: "flag", used: true },
  ] },
];

export interface NodePort {
  id: string;
  name: string;
  type: PortType;
}

export interface NodeRow {
  label: string;
  value?: string;
  muted?: boolean;
  slider?: number;
  swatch?: boolean;
}

export interface GraphNode {
  id: string;
  kind: string;
  cat: CatKey;
  x: number;
  y: number;
  w: number;
  inputs: NodePort[];
  outputs: NodePort[];
  rows?: NodeRow[];
}

export interface GraphEdge {
  from: [string, string];
  to: [string, string];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const FIRE_GRAPH: Graph = {
  nodes: [
    { id: "src", kind: "Source", cat: "input", x: 16, y: 226, w: 176,
      inputs: [], outputs: [{ id: "out", name: "rgba", type: "texture" }],
      rows: [{ label: "1920×1080 · 30fps", muted: true }] },
    { id: "mask", kind: "SubjectMask", cat: "detection", x: 16, y: 30, w: 176,
      inputs: [{ id: "src", name: "frame", type: "texture" }],
      outputs: [{ id: "mask", name: "mask", type: "mask" }],
      rows: [{ label: "model", value: "Selfie v2" }, { label: "feather", value: "0.4" }] },
    { id: "edge", kind: "MaskEdgeEmitter", cat: "detection", x: 208, y: 30, w: 184,
      inputs: [{ id: "mask", name: "mask", type: "mask" }],
      outputs: [{ id: "pts", name: "spawn", type: "vec2" }],
      rows: [{ label: "width", value: "3 px" }, { label: "density", value: "200" }] },
    { id: "emit", kind: "ParticleEmitter", cat: "particles", x: 408, y: 30, w: 208,
      inputs: [
        { id: "spawn", name: "spawn", type: "vec2" },
        { id: "rate", name: "rate", type: "float" },
      ],
      outputs: [{ id: "state", name: "state", type: "any" }],
      rows: [
        { label: "rate", value: "200/s" },
        { label: "lifetime", value: "1.2±0.3s" },
        { label: "velocity", value: "(0,-200)" },
        { label: "max", value: "2048" },
      ] },
    { id: "field", kind: "ParticleField", cat: "particles", x: 632, y: 30, w: 192,
      inputs: [{ id: "state", name: "state", type: "any" }],
      outputs: [{ id: "state", name: "state", type: "any" }],
      rows: [
        { label: "gravity", value: "(0,-50)" },
        { label: "turbulence", value: "0.35" },
        { label: "wind", value: "(8,-2)" },
      ] },
    { id: "render", kind: "ParticleRenderer", cat: "particles", x: 840, y: 30, w: 196,
      inputs: [{ id: "state", name: "state", type: "any" }],
      outputs: [{ id: "tex", name: "rgba", type: "texture" }],
      rows: [
        { label: "sprite", value: "fire.png" },
        { label: "blend", value: "additive" },
        { label: "color ramp", swatch: true },
      ] },
    { id: "param-i", kind: "Param·intensity", cat: "input", x: 208, y: 226, w: 184,
      inputs: [], outputs: [{ id: "v", name: "float", type: "float" }],
      rows: [{ label: "intensity", value: "0.70", slider: 0.7 }] },
    { id: "layer", kind: "Layer", cat: "composite", x: 1052, y: 90, w: 200,
      inputs: [
        { id: "back", name: "back particles", type: "texture" },
        { id: "vid", name: "source", type: "texture" },
        { id: "front", name: "front particles", type: "texture" },
        { id: "amount", name: "amount", type: "float" },
      ],
      outputs: [{ id: "out", name: "rgba", type: "texture" }],
      rows: [{ label: "blend", value: "screen" }] },
    { id: "output", kind: "Output", cat: "output", x: 1268, y: 150, w: 148,
      inputs: [{ id: "in", name: "rgba", type: "texture" }],
      outputs: [],
      rows: [{ label: "preview", value: "rgba8" }] },
  ],
  edges: [
    { from: ["src", "out"], to: ["mask", "src"] },
    { from: ["mask", "mask"], to: ["edge", "mask"] },
    { from: ["edge", "pts"], to: ["emit", "spawn"] },
    { from: ["emit", "state"], to: ["field", "state"] },
    { from: ["field", "state"], to: ["render", "state"] },
    { from: ["render", "tex"], to: ["layer", "back"] },
    { from: ["render", "tex"], to: ["layer", "front"] },
    { from: ["src", "out"], to: ["layer", "vid"] },
    { from: ["param-i", "v"], to: ["layer", "amount"] },
    { from: ["layer", "out"], to: ["output", "in"] },
  ],
};

export type SlotKind = "video" | "text" | "audio" | "image";

export interface TemplateSlot {
  id: string;
  kind: SlotKind;
  label: string;
  min?: number;
  max?: number;
  max_chars?: number;
}

export interface TemplateTrackItem {
  slot: string;
  in: number;
  out: number;
  fx: string | null;
}

export interface TemplateTrack {
  id: string;
  kind: SlotKind;
  items: TemplateTrackItem[];
}

export interface Template {
  meta: { title: string; duration_ms: number; aspect: string; fps: number };
  slots: TemplateSlot[];
  tracks: TemplateTrack[];
}

export const TRAVEL_TEMPLATE: Template = {
  meta: { title: "Travel Reel", duration_ms: 15000, aspect: "9:16", fps: 30 },
  slots: [
    { id: "clip1", kind: "video", min: 1500, max: 3000, label: "Establishing shot" },
    { id: "clip2", kind: "video", min: 1500, max: 3000, label: "Detail B-roll" },
    { id: "clip3", kind: "video", min: 1500, max: 9000, label: "Hero clip" },
    { id: "title", kind: "text", max_chars: 40, label: "Title overlay" },
    { id: "music", kind: "audio", label: "Soundtrack" },
  ],
  tracks: [
    { id: "v1", kind: "video", items: [
      { slot: "clip1", in: 0, out: 3000, fx: "augani/warm-vignette@1.0" },
      { slot: "clip2", in: 3000, out: 6000, fx: null },
      { slot: "clip3", in: 6000, out: 15000, fx: "augani/fire-aura@1.2" },
    ] },
    { id: "t1", kind: "text", items: [
      { slot: "title", in: 500, out: 2500, fx: null },
    ] },
    { id: "a1", kind: "audio", items: [
      { slot: "music", in: 0, out: 15000, fx: null },
    ] },
  ],
};

export interface Perf {
  gpu: number;
  detection: number;
  passes: number;
  particles: number;
  mem: number;
}

export const GRAPH_PERF: Perf = { gpu: 6.2, detection: 3.1, passes: 5, particles: 1284, mem: 47 };
