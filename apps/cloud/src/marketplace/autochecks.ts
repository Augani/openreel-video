import {
  validateGraph,
  compileFilter,
  compileTemplate,
  buildPackage,
  checkSizes,
  type Graph,
  type AssetKind,
  type AssetRequirements,
  type DetectionCapability,
  type TemplateSource,
  type Manifest,
} from "@openreel/fxpkg";

export interface AutoCheckResult {
  ok: boolean;
  steps: Array<{ name: string; status: "pass" | "fail" | "skipped"; detail?: unknown }>;
}

const DETECTION_NODES: Record<string, DetectionCapability> = {
  SubjectMask: "subject_mask",
  SubjectMaskInverted: "subject_mask",
  MaskEdgeEmitter: "subject_mask",
  PoseLandmark: "pose",
  PoseAllLandmarks: "pose",
  LandmarkEmitter: "pose",
  FaceLandmark: "face",
  FaceBlendshape: "face",
  Depth: "depth",
};

/** Derive declared requirements from the graph (used to fill the manifest, §7). */
export function deriveRequirements(graph: Graph): AssetRequirements {
  const detection = new Set<DetectionCapability>();
  let maxParticles = 0;
  let uses3d = false;
  let history = 0;
  for (const node of graph.nodes) {
    const cap = DETECTION_NODES[node.type];
    if (cap) detection.add(cap);
    if (node.type === "ParticleEmitter") {
      const max = typeof node.config?.max === "number" ? (node.config.max as number) : 2048;
      maxParticles += max;
    }
    if (node.type === "Mesh3D") uses3d = true;
    if (node.type === "FrameHistory" || node.type === "MaskHistory" || node.type === "Trail") history = Math.max(history, 16);
  }
  return {
    webgpu: true,
    detection: [...detection],
    frame_history_depth: history,
    max_particles: maxParticles,
    uses_3d: uses3d,
    max_resolution: [3840, 2160],
    perf_budget_ms_per_frame: graph.kind === "effect" ? 16 : 8,
    perf_budget_ms_detection: detection.size > 0 ? 8 : 0,
  };
}

/** Auto-checks common to all kinds + kind-specific compile (STUDIO_PLAN §38). */
export function runAutoChecks(
  graph: Graph,
  kind: AssetKind,
  template?: TemplateSource,
): AutoCheckResult {
  const steps: AutoCheckResult["steps"] = [];

  if (kind === "template") {
    if (!template) {
      steps.push({ name: "template_source", status: "fail", detail: "missing template source" });
      return { ok: false, steps };
    }
    const compiled = compileTemplate(template);
    steps.push({ name: "template_compile", status: compiled.ok ? "pass" : "fail", detail: compiled.ok ? undefined : compiled.errors });
    return { ok: compiled.ok, steps };
  }

  const validation = validateGraph(graph);
  steps.push({ name: "graph_validate", status: validation.ok ? "pass" : "fail", detail: validation.ok ? undefined : validation.errors });
  if (!validation.ok) return { ok: false, steps };

  if (kind === "filter") {
    const compiled = compileFilter(graph);
    steps.push({ name: "wgsl_compile", status: compiled.ok ? "pass" : "fail", detail: compiled.ok ? undefined : compiled.errors });
    if (!compiled.ok) return { ok: false, steps };
    const sizes = checkSizes({ "artifact/shaders/main.wgsl": compiled.wgsl });
    steps.push({ name: "size_limits", status: sizes.ok ? "pass" : "fail", detail: sizes.ok ? undefined : sizes.violations });
    return { ok: sizes.ok, steps };
  }

  // effects: validation passed; particle/codegen runtime lives in packages/core.
  steps.push({ name: "effect_graph", status: "pass" });
  return { ok: true, steps };
}

export interface ArtifactBuild {
  ok: boolean;
  files?: Record<string, string | Uint8Array>;
  manifest?: Manifest;
  errors?: unknown;
}

/** Compile + assemble the .fxpkg file map for storage (STUDIO_PLAN §6, §37.2). */
export function buildArtifact(graph: Graph, manifestBase: Omit<Manifest, "checksums" | "requirements">): ArtifactBuild {
  const requirements = deriveRequirements(graph);
  const artifactFiles: Record<string, string> = {};

  if (graph.kind === "filter") {
    const compiled = compileFilter(graph);
    if (!compiled.ok) return { ok: false, errors: compiled.errors };
    artifactFiles["artifact/pipeline.json"] = JSON.stringify(compiled.pipeline);
    artifactFiles["artifact/shaders/main.wgsl"] = compiled.wgsl;
  } else if (graph.kind === "effect") {
    // effect pipeline.json is emitted by the core runtime mapper; store the graph
    artifactFiles["artifact/pipeline.json"] = JSON.stringify({ abi: graph.abi, kind: "effect", nodes: graph.nodes.length });
  }

  const res = buildPackage({
    manifest: { ...manifestBase, requirements },
    graph,
    artifactFiles,
  });
  if (!res.ok) return { ok: false, errors: res.errors };
  return { ok: true, files: res.bundle.files, manifest: res.bundle.manifest };
}
