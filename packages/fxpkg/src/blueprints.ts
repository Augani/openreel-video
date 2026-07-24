/**
 * Blueprint engine (STUDIO_PLAN §9A). Blueprints are curated effect engines
 * that generate safe graphs from semantic, creator-facing controls. Beginner
 * mode is the default; the generated graph uses only approved nodes plus hidden
 * safety nodes (TemporalSmooth, ConfidenceGate, FallbackComposite, BudgetClamp).
 */
import type { AssetKind, Graph, GraphEdge, GraphNode, ParamDecl } from "./types";

export interface Blueprint {
  id: string;
  version: string;
  kind: AssetKind;
  label: string;
  difficulty: "low" | "medium" | "high";
  /** semantic controls exposed to the creator (§9A.5) */
  controls: ParamDecl[];
  build: (values: Record<string, number | string | boolean | [number, number]>) => Graph;
}

function edge(fromNode: string, fromPort: string, toNode: string, toPort: string): GraphEdge {
  return { fromNode, fromPort, toNode, toPort };
}

function val<T>(values: Record<string, unknown>, id: string, fallback: T): T {
  return (values[id] as T) ?? fallback;
}

// ── Passthrough (Phase 0 milestone) ──────────────────────────────────────
const passthrough: Blueprint = {
  id: "passthrough.v1",
  version: "1.0.0",
  kind: "filter",
  label: "Passthrough",
  difficulty: "low",
  controls: [],
  build: () => ({
    id: "bp-passthrough",
    kind: "filter",
    abi: "1.0",
    nodelibVersion: "1.0.0",
    authoring: { mode: "blueprint", blueprintId: "passthrough.v1", blueprintVersion: "1.0.0" },
    params: [],
    nodes: [
      { id: "src", type: "Source", position: { x: 16, y: 80 } },
      { id: "out", type: "Output", position: { x: 320, y: 80 } },
    ],
    edges: [edge("src", "out", "out", "in")],
  }),
};

// ── Warm look (a simple filter blueprint, §48 Phase 2) ───────────────────
const warmLook: Blueprint = {
  id: "warm-look.v1",
  version: "1.0.0",
  kind: "filter",
  label: "Warm Look",
  difficulty: "low",
  controls: [
    { id: "warmth", type: "float", label: "Warmth", default: 0.1, min: 0, max: 1 },
    { id: "vignette", type: "float", label: "Vignette", default: 0.4, min: 0, max: 1 },
    { id: "amount", type: "float", label: "Amount", default: 0.6, min: 0, max: 1 },
  ],
  build: (v) => {
    const warmth = val(v, "warmth", 0.1);
    const vignette = val(v, "vignette", 0.4);
    return {
      id: "bp-warm-look",
      kind: "filter",
      abi: "1.0",
      nodelibVersion: "1.0.0",
      authoring: { mode: "blueprint", blueprintId: "warm-look.v1", blueprintVersion: "1.0.0" },
      params: [{ id: "amount", type: "float", label: "Amount", default: val(v, "amount", 0.6), min: 0, max: 1 }],
      nodes: [
        { id: "src", type: "Source", position: { x: 16, y: 120 } },
        { id: "sat", type: "Saturation", position: { x: 200, y: 120 }, config: { amount: warmth } },
        { id: "vig", type: "Vignette", position: { x: 400, y: 120 }, config: { softness: vignette } },
        { id: "amt", type: "Param", position: { x: 200, y: 260 }, config: { param: "amount" } },
        { id: "mul", type: "Multiply", position: { x: 600, y: 160 } },
        { id: "out", type: "Output", position: { x: 800, y: 160 } },
      ],
      edges: [
        edge("src", "out", "sat", "in"),
        edge("sat", "out", "vig", "in"),
        edge("vig", "out", "mul", "a"),
        edge("amt", "out", "mul", "b"),
        edge("mul", "out", "out", "in"),
      ],
    };
  },
};

// ── Snow around subject (§9A.1) ──────────────────────────────────────────
const snow: Blueprint = {
  id: "snow.subject.v1",
  version: "1.0.0",
  kind: "effect",
  label: "Snow Around Subject",
  difficulty: "low",
  controls: [
    { id: "amount", type: "float", label: "Amount", default: 0.6, min: 0, max: 1 },
    { id: "wind", type: "float", label: "Wind", default: 0.1, min: -1, max: 1 },
    { id: "fall_speed", type: "float", label: "Fall Speed", default: 0.5, min: 0, max: 1 },
    { id: "flake_size", type: "float", label: "Flake Size", default: 0.4, min: 0, max: 1 },
    { id: "subject_interaction", type: "enum", label: "Subject Interaction", default: "surround", values: ["none", "behind", "surround"] },
  ],
  build: (v) => {
    const interaction = String(val(v, "subject_interaction", "surround"));
    // Snow is ambient: the emitter spawns across the frame (spawn input left
    // unconnected). The subject mask is only used for the occlusion matte so
    // flakes can pass behind the subject (§9A.1).
    const nodes: GraphNode[] = [
      { id: "src", type: "Source", position: { x: 16, y: 240 } },
      { id: "emit", type: "ParticleEmitter", position: { x: 420, y: 40 }, config: { rate: 160, max: 2048 } },
      { id: "field", type: "ParticleField", position: { x: 640, y: 40 }, config: { gravity: [val(v, "wind", 0.1) * 30, val(v, "fall_speed", 0.5) * 80], turbulence: 0.2 } },
      { id: "clamp", type: "BudgetClamp", position: { x: 840, y: 40 } },
      { id: "render", type: "ParticleRenderer", position: { x: 1040, y: 40 }, config: { sprite: "snowflake.png", blend: "screen" } },
      { id: "layer", type: "Layer", position: { x: 1260, y: 120 } },
      { id: "amt", type: "Param", position: { x: 420, y: 240 }, config: { param: "amount" } },
      { id: "out", type: "Output", position: { x: 1480, y: 160 } },
    ];
    const edges: GraphEdge[] = [
      edge("emit", "state", "field", "state"),
      edge("field", "state", "clamp", "state"),
      edge("clamp", "out", "render", "state"),
      edge("src", "out", "layer", "mid"),
      edge("render", "tex", "layer", "front"),
      edge("amt", "out", "layer", "amount"),
      edge("layer", "out", "out", "in"),
    ];
    if (interaction !== "none") {
      // occlusion matte: snow behind the subject is hidden by a cutout (§9A.1)
      nodes.push({ id: "mask", type: "SubjectMask", position: { x: 16, y: 40 } });
      nodes.push({ id: "smooth", type: "TemporalSmooth", position: { x: 200, y: 40 } });
      nodes.push({ id: "cut", type: "Cutout", position: { x: 420, y: 360 } });
      edges.push(edge("src", "out", "mask", "src"));
      edges.push(edge("mask", "mask", "smooth", "in"));
      edges.push(edge("src", "out", "cut", "src"));
      edges.push(edge("smooth", "out", "cut", "mask"));
      edges.push(edge("render", "tex", "layer", "back"));
    }
    return {
      id: "bp-snow",
      kind: "effect",
      abi: "1.0",
      nodelibVersion: "1.0.0",
      authoring: { mode: "blueprint", blueprintId: "snow.subject.v1", blueprintVersion: "1.0.0" },
      params: [
        { id: "amount", type: "float", label: "Amount", default: val(v, "amount", 0.6), min: 0, max: 1 },
        { id: "wind", type: "float", label: "Wind", default: val(v, "wind", 0.1), min: -1, max: 1 },
        { id: "subject_interaction", type: "enum", label: "Subject Interaction", default: interaction, values: ["none", "behind", "surround"] },
      ],
      nodes,
      edges,
    };
  },
};

// ── Fire Aura (§9A.4 high difficulty, Appendix C reference effect) ────────
const fireAura: Blueprint = {
  id: "fire-aura.v1",
  version: "1.0.0",
  kind: "effect",
  label: "Fire Aura",
  difficulty: "high",
  controls: [
    { id: "intensity", type: "float", label: "Intensity", default: 0.7, min: 0, max: 1 },
    { id: "color", type: "color", label: "Flame Color", default: "#FF7700" },
    { id: "subject_interaction", type: "enum", label: "Subject Interaction", default: "surround", values: ["behind", "surround"] },
  ],
  build: (v) => ({
    id: "bp-fire-aura",
    kind: "effect",
    abi: "1.0",
    nodelibVersion: "1.0.0",
    authoring: { mode: "blueprint", blueprintId: "fire-aura.v1", blueprintVersion: "1.0.0" },
    params: [
      { id: "intensity", type: "float", label: "Intensity", default: val(v, "intensity", 0.7), min: 0, max: 1 },
      { id: "color", type: "color", label: "Flame Color", default: String(val(v, "color", "#FF7700")) },
    ],
    nodes: [
      { id: "src", type: "Source", position: { x: 16, y: 240 } },
      { id: "mask", type: "SubjectMask", position: { x: 16, y: 40 } },
      { id: "smooth", type: "TemporalSmooth", position: { x: 200, y: 40 } },
      { id: "gate", type: "ConfidenceGate", position: { x: 360, y: 40 } },
      { id: "edge", type: "MaskEdgeEmitter", position: { x: 520, y: 40 }, config: { width: 3, density: 200 } },
      { id: "emit", type: "ParticleEmitter", position: { x: 700, y: 40 }, config: { rate: 200, lifetime: 1.2, velocity: [0, -200], max: 2048 } },
      { id: "field", type: "ParticleField", position: { x: 920, y: 40 }, config: { gravity: [0, -50], turbulence: 0.35, wind: [8, -2] } },
      { id: "clamp", type: "BudgetClamp", position: { x: 1120, y: 40 } },
      { id: "render", type: "ParticleRenderer", position: { x: 1300, y: 40 }, config: { sprite: "fire.png", blend: "additive" } },
      { id: "cut", type: "Cutout", position: { x: 520, y: 360 } },
      { id: "layer", type: "Layer", position: { x: 1520, y: 160 } },
      { id: "fallback", type: "FallbackComposite", position: { x: 1720, y: 160 } },
      { id: "amt", type: "Param", position: { x: 700, y: 240 }, config: { param: "intensity" } },
      { id: "out", type: "Output", position: { x: 1920, y: 200 } },
    ],
    edges: [
      edge("src", "out", "mask", "src"),
      edge("mask", "mask", "smooth", "in"),
      edge("smooth", "out", "gate", "in"),
      edge("gate", "out", "edge", "mask"),
      edge("edge", "pts", "emit", "spawn"),
      edge("emit", "state", "field", "state"),
      edge("field", "state", "clamp", "state"),
      edge("clamp", "out", "render", "state"),
      edge("src", "out", "cut", "src"),
      edge("gate", "out", "cut", "mask"),
      edge("render", "tex", "layer", "back"),
      edge("src", "out", "layer", "mid"),
      edge("render", "tex", "layer", "front"),
      edge("amt", "out", "layer", "amount"),
      edge("layer", "out", "fallback", "primary"),
      edge("src", "out", "fallback", "fallback"),
      edge("fallback", "out", "out", "in"),
    ],
  }),
};

// ── Three of Me / Clone (§9A.4, Appendix D) — multiply a body in a video ──
const cloneThree: Blueprint = {
  id: "clone.three.v1",
  version: "1.0.0",
  kind: "effect",
  label: "Three of Me",
  difficulty: "medium",
  controls: [
    { id: "spacing", type: "float", label: "Spacing", default: 0.3, min: 0.1, max: 0.45 },
    { id: "background_blur", type: "float", label: "Background Blur", default: 0.6, min: 0, max: 1 },
  ],
  build: (v) => {
    const spacing = val(v, "spacing", 0.3);
    return {
      id: "bp-clone-three",
      kind: "effect",
      abi: "1.0",
      nodelibVersion: "1.0.0",
      authoring: { mode: "blueprint", blueprintId: "clone.three.v1", blueprintVersion: "1.0.0" },
      params: [
        { id: "spacing", type: "float", label: "Spacing", default: spacing, min: 0.1, max: 0.45 },
        { id: "background_blur", type: "float", label: "Background Blur", default: val(v, "background_blur", 0.6), min: 0, max: 1 },
      ],
      nodes: [
        { id: "src", type: "Source", position: { x: 16, y: 220 } },
        { id: "mask", type: "SubjectMask", position: { x: 16, y: 40 } },
        { id: "smooth", type: "TemporalSmooth", position: { x: 200, y: 40 } },
        { id: "cut", type: "Cutout", position: { x: 380, y: 120 } },
        { id: "tl", type: "Transform", position: { x: 580, y: 20 }, config: { x: -spacing, y: 0 } },
        { id: "tc", type: "Transform", position: { x: 580, y: 140 }, config: { x: 0, y: 0 } },
        { id: "tr", type: "Transform", position: { x: 580, y: 260 }, config: { x: spacing, y: 0 } },
        { id: "blur", type: "GaussianBlur", position: { x: 380, y: 360 }, config: { radius: 24 } },
        { id: "b1", type: "Blend", position: { x: 820, y: 120 } },
        { id: "b2", type: "Blend", position: { x: 1000, y: 160 } },
        { id: "b3", type: "Blend", position: { x: 1180, y: 200 } },
        { id: "out", type: "Output", position: { x: 1380, y: 220 } },
      ],
      edges: [
        edge("src", "out", "mask", "src"),
        edge("mask", "mask", "smooth", "in"),
        edge("src", "out", "cut", "src"),
        edge("smooth", "out", "cut", "mask"),
        edge("cut", "out", "tl", "in"),
        edge("cut", "out", "tc", "in"),
        edge("cut", "out", "tr", "in"),
        edge("src", "out", "blur", "in"),
        edge("blur", "out", "b1", "a"),
        edge("tl", "out", "b1", "b"),
        edge("b1", "out", "b2", "a"),
        edge("tc", "out", "b2", "b"),
        edge("b2", "out", "b3", "a"),
        edge("tr", "out", "b3", "b"),
        edge("b3", "out", "out", "in"),
      ],
    };
  },
};

// ── Mirror World (subject reflected) ─────────────────────────────────────
const mirror: Blueprint = {
  id: "mirror.world.v1",
  version: "1.0.0",
  kind: "effect",
  label: "Mirror World",
  difficulty: "low",
  controls: [{ id: "opacity", type: "float", label: "Reflection", default: 0.8, min: 0, max: 1 }],
  build: (v) => ({
    id: "bp-mirror",
    kind: "effect",
    abi: "1.0",
    nodelibVersion: "1.0.0",
    authoring: { mode: "blueprint", blueprintId: "mirror.world.v1", blueprintVersion: "1.0.0" },
    params: [{ id: "opacity", type: "float", label: "Reflection", default: val(v, "opacity", 0.8), min: 0, max: 1 }],
    nodes: [
      { id: "src", type: "Source", position: { x: 16, y: 200 } },
      { id: "mask", type: "SubjectMask", position: { x: 16, y: 40 } },
      { id: "smooth", type: "TemporalSmooth", position: { x: 200, y: 40 } },
      { id: "cut", type: "Cutout", position: { x: 380, y: 80 } },
      { id: "mir", type: "Mirror", position: { x: 580, y: 80 }, config: { axis: "x" } },
      { id: "layer", type: "Layer", position: { x: 800, y: 160 } },
      { id: "out", type: "Output", position: { x: 1020, y: 200 } },
    ],
    edges: [
      edge("src", "out", "mask", "src"),
      edge("mask", "mask", "smooth", "in"),
      edge("src", "out", "cut", "src"),
      edge("smooth", "out", "cut", "mask"),
      edge("cut", "out", "mir", "in"),
      edge("src", "out", "layer", "mid"),
      edge("mir", "out", "layer", "front"),
      edge("layer", "out", "out", "in"),
    ],
  }),
};

// ── Ghost Trail (temporal, ABI 1.1) ──────────────────────────────────────
const ghostTrail: Blueprint = {
  id: "ghost-trail.v1",
  version: "1.0.0",
  kind: "effect",
  label: "Ghost Trail",
  difficulty: "medium",
  controls: [{ id: "fade", type: "float", label: "Fade", default: 0.85, min: 0.5, max: 0.98 }],
  build: (v) => ({
    id: "bp-ghost-trail",
    kind: "effect",
    abi: "1.1",
    nodelibVersion: "1.1.0",
    authoring: { mode: "blueprint", blueprintId: "ghost-trail.v1", blueprintVersion: "1.0.0" },
    params: [{ id: "fade", type: "float", label: "Fade", default: val(v, "fade", 0.85), min: 0.5, max: 0.98 }],
    nodes: [
      { id: "src", type: "Source", position: { x: 16, y: 160 } },
      { id: "trail", type: "Trail", position: { x: 260, y: 40 }, config: { fade: val(v, "fade", 0.85) } },
      { id: "layer", type: "Layer", position: { x: 520, y: 120 } },
      { id: "out", type: "Output", position: { x: 760, y: 160 } },
    ],
    edges: [
      edge("src", "out", "trail", "in"),
      edge("trail", "out", "layer", "back"),
      edge("src", "out", "layer", "mid"),
      edge("layer", "out", "out", "in"),
    ],
  }),
};

// ── Sparkles on the subject (pose-driven particles) ──────────────────────
const sparkles: Blueprint = {
  id: "sparkles.subject.v1",
  version: "1.0.0",
  kind: "effect",
  label: "Sparkles",
  difficulty: "low",
  controls: [{ id: "amount", type: "float", label: "Amount", default: 0.6, min: 0, max: 1 }],
  build: (v) => ({
    id: "bp-sparkles",
    kind: "effect",
    abi: "1.0",
    nodelibVersion: "1.0.0",
    authoring: { mode: "blueprint", blueprintId: "sparkles.subject.v1", blueprintVersion: "1.0.0" },
    params: [{ id: "amount", type: "float", label: "Amount", default: val(v, "amount", 0.6), min: 0, max: 1 }],
    nodes: [
      { id: "src", type: "Source", position: { x: 16, y: 220 } },
      { id: "pose", type: "PoseAllLandmarks", position: { x: 16, y: 40 } },
      { id: "emitL", type: "LandmarkEmitter", position: { x: 220, y: 40 } },
      { id: "emit", type: "ParticleEmitter", position: { x: 420, y: 40 }, config: { rate: 80, max: 1024 } },
      { id: "field", type: "ParticleField", position: { x: 640, y: 40 }, config: { turbulence: 0.1 } },
      { id: "clamp", type: "BudgetClamp", position: { x: 840, y: 40 } },
      { id: "render", type: "ParticleRenderer", position: { x: 1040, y: 40 }, config: { sprite: "sparkle.png", blend: "additive" } },
      { id: "layer", type: "Layer", position: { x: 1260, y: 140 } },
      { id: "amt", type: "Param", position: { x: 420, y: 240 }, config: { param: "amount" } },
      { id: "out", type: "Output", position: { x: 1480, y: 180 } },
    ],
    edges: [
      edge("pose", "buf", "emitL", "buf"),
      edge("emitL", "pts", "emit", "spawn"),
      edge("emit", "state", "field", "state"),
      edge("field", "state", "clamp", "state"),
      edge("clamp", "out", "render", "state"),
      edge("src", "out", "layer", "mid"),
      edge("render", "tex", "layer", "front"),
      edge("amt", "out", "layer", "amount"),
      edge("layer", "out", "out", "in"),
    ],
  }),
};

export const BLUEPRINTS: Record<string, Blueprint> = {
  [passthrough.id]: passthrough,
  [warmLook.id]: warmLook,
  [snow.id]: snow,
  [cloneThree.id]: cloneThree,
  [mirror.id]: mirror,
  [ghostTrail.id]: ghostTrail,
  [sparkles.id]: sparkles,
  [fireAura.id]: fireAura,
};

export function getBlueprint(id: string): Blueprint | undefined {
  return BLUEPRINTS[id];
}

export function listBlueprints(): Blueprint[] {
  return Object.values(BLUEPRINTS);
}
