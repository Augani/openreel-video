/**
 * Core data contracts for the .fxpkg artifact format and node graph.
 * These types are the spine of the studio → marketplace → editor → render farm
 * pipeline (STUDIO_PLAN §6–§12).
 */

export type AssetKind = "template" | "filter" | "effect";

export type AbiVersion = "1.0" | "1.1" | "1.2";

/** Edge value types in the node graph (STUDIO_PLAN §10.3). */
export type PortType =
  | "texture"
  | "mask"
  | "depth"
  | "landmark_buffer"
  | "particles"
  | "float"
  | "int"
  | "bool"
  | "vec2"
  | "vec3"
  | "vec4"
  | "color"
  | "sampler"
  | "any";

/** User-exposed parameter value types (STUDIO_PLAN §7.2). */
export type ParamType = "float" | "int" | "bool" | "color" | "enum" | "vec2";

export interface ParamDecl {
  id: string;
  type: ParamType;
  label: string;
  default: number | boolean | string | [number, number];
  min?: number;
  max?: number;
  /** enum values, required when type === "enum" */
  values?: string[];
  /** when true, hidden from the user-facing controls (system/internal) */
  internal?: boolean;
}

export interface GraphNode {
  /** unique within the graph */
  id: string;
  /** node kind id, must exist in the declared node library version */
  type: string;
  position?: { x: number; y: number };
  /** node-local configuration (constants, selected enum values, etc.) */
  config?: Record<string, unknown>;
}

export interface GraphEdge {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

export interface Graph {
  id: string;
  kind: AssetKind;
  abi: AbiVersion;
  nodelibVersion: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  params: ParamDecl[];
  /** records the blueprint a beginner-mode graph was generated from (§9A.3) */
  authoring?: {
    mode: "blueprint" | "advanced";
    blueprintId?: string;
    blueprintVersion?: string;
  };
}

/** Resource caps enforced at compile + submission time (STUDIO_PLAN §8, §20.4). */
export interface ResourceCaps {
  maxParticles: number;
  maxParticleSystems: number;
  maxTotalParticles: number;
  maxHistoryDepth: number;
  maxMeshes: number;
  maxMeshTris: number;
  maxResolution: [number, number];
}

/** Detection capabilities a graph may request (STUDIO_PLAN §15). */
export type DetectionCapability = "subject_mask" | "pose" | "face" | "depth";

export interface AssetRequirements {
  webgpu: boolean;
  detection: DetectionCapability[];
  frame_history_depth: number;
  max_particles: number;
  uses_3d: boolean;
  max_resolution: [number, number];
  perf_budget_ms_per_frame: number;
  perf_budget_ms_detection: number;
}
