import { describe, it, expect } from "vitest";
import {
  validateGraph,
  compileFilter,
  compileTemplate,
  templateFxRefs,
  getBlueprint,
  listBlueprints,
  allowedNodes,
  paletteNodes,
  abiAtLeast,
  capsFor,
  validateManifest,
  checkSizes,
  buildPackage,
  verifyChecksums,
  sha256Hex,
  topoSort,
  type Graph,
  type TemplateSource,
} from "./index";

const warmVignette: Graph = {
  id: "warm-vignette",
  kind: "filter",
  abi: "1.0",
  nodelibVersion: "1.0.0",
  params: [{ id: "amount", type: "float", label: "Amount", default: 0.6, min: 0, max: 1 }],
  nodes: [
    { id: "src", type: "Source" },
    { id: "sat", type: "Saturation", config: { amount: 0.1 } },
    { id: "vig", type: "Vignette", config: { softness: 0.4 } },
    { id: "amt", type: "Param", config: { param: "amount" } },
    { id: "mul", type: "Multiply" },
    { id: "out", type: "Output" },
  ],
  edges: [
    { fromNode: "src", fromPort: "out", toNode: "sat", toPort: "in" },
    { fromNode: "sat", fromPort: "out", toNode: "vig", toPort: "in" },
    { fromNode: "vig", fromPort: "out", toNode: "mul", toPort: "a" },
    { fromNode: "amt", fromPort: "out", toNode: "mul", toPort: "b" },
    { fromNode: "mul", fromPort: "out", toNode: "out", toPort: "in" },
  ],
};

describe("sha256", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("abi", () => {
  it("backward-compat within major", () => {
    expect(abiAtLeast("1.2", "1.0")).toBe(true);
    expect(abiAtLeast("1.0", "1.2")).toBe(false);
  });
  it("gates nodes by version", () => {
    expect(allowedNodes("1.0")).not.toContain("Depth");
    expect(allowedNodes("1.2")).toContain("Depth");
    expect(allowedNodes("1.0")).toContain("SubjectMask");
  });
  it("caps grow with version", () => {
    expect(capsFor("1.0").maxHistoryDepth).toBe(0);
    expect(capsFor("1.2").maxMeshes).toBe(4);
  });
  it("palette excludes system-owned nodes", () => {
    const ids = paletteNodes("1.2").map((n) => n.id);
    expect(ids).not.toContain("TemporalSmooth");
    expect(ids).toContain("ParticleEmitter");
  });
});

describe("validator", () => {
  it("accepts the warm-vignette filter", () => {
    const r = validateGraph(warmVignette);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
  it("rejects cycles", () => {
    const cyclic: Graph = {
      ...warmVignette,
      edges: [...warmVignette.edges, { fromNode: "mul", fromPort: "out", toNode: "sat", toPort: "in" }],
    };
    const r = validateGraph(cyclic);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "cycle")).toBe(true);
  });
  it("rejects unknown nodes", () => {
    const g: Graph = { ...warmVignette, nodes: [...warmVignette.nodes, { id: "x", type: "Nope" }] };
    expect(validateGraph(g).errors.some((e) => e.code === "unknown_node")).toBe(true);
  });
  it("requires exactly one Output", () => {
    const g: Graph = { ...warmVignette, nodes: warmVignette.nodes.filter((n) => n.type !== "Output") };
    expect(validateGraph(g).errors.some((e) => e.code === "no_output")).toBe(true);
  });
  it("flags ABI-too-new nodes", () => {
    const g: Graph = {
      ...warmVignette,
      nodes: [...warmVignette.nodes, { id: "d", type: "Depth" }],
      edges: [...warmVignette.edges, { fromNode: "src", fromPort: "out", toNode: "d", toPort: "src" }],
    };
    expect(validateGraph(g).errors.some((e) => e.code === "node_abi_too_new")).toBe(true);
  });
  it("topo-sorts source before output", () => {
    const order = topoSort(warmVignette);
    expect(order.indexOf("src")).toBeLessThan(order.indexOf("out"));
  });
});

describe("filter compiler", () => {
  it("compiles warm-vignette to one compute pass with expected WGSL", () => {
    const r = compileFilter(warmVignette);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wgsl).toContain("@compute @workgroup_size(8, 8, 1)");
    expect(r.wgsl).toContain("fx_saturate");
    expect(r.wgsl).toContain("fx_vignette");
    expect(r.wgsl).toContain("textureStore(u_output");
    expect(r.wgsl).toContain("u_param_amount");
    expect(r.pipeline.passes).toHaveLength(1);
    expect(r.pipeline.params.find((p) => p.id === "amount")).toBeTruthy();
  });
  it("rejects multi-pass nodes with a structured error", () => {
    const g: Graph = {
      ...warmVignette,
      nodes: [...warmVignette.nodes, { id: "blur", type: "GaussianBlur" }],
    };
    const r = compileFilter(g);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "multipass_unsupported")).toBe(true);
  });
});

describe("template compiler", () => {
  const tpl: TemplateSource = {
    metadata: { title: "Travel Reel", duration_ms: 15000, aspect_ratio: "9:16", fps: 30 },
    slots: [
      { id: "clip1", kind: "video", min_duration_ms: 1500, max_duration_ms: 3000 },
      { id: "title", kind: "text", max_chars: 40 },
      { id: "music", kind: "audio" },
    ],
    tracks: [
      { id: "v1", kind: "video", items: [{ slot: "clip1", in: 0, out: 3000, fx: [{ fx_id: "augani/warm-vignette@1.0.0", params: { amount: 0.6 } }] }] },
      { id: "t1", kind: "text", items: [{ slot: "title", in: 500, out: 2500 }] },
    ],
    soundtrack: { slot: "music", in: 0 },
  };
  it("compiles to EDL", () => {
    const r = compileTemplate(tpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.edl.schema_version).toBe("1.0.0");
    expect(r.edl.tracks).toHaveLength(2);
  });
  it("rejects overflowing items", () => {
    const bad: TemplateSource = { ...tpl, tracks: [{ id: "v1", kind: "video", items: [{ slot: "clip1", in: 0, out: 99999 }] }] };
    const r = compileTemplate(bad);
    expect(r.ok).toBe(false);
  });
  it("extracts fx refs", () => {
    expect(templateFxRefs(tpl)).toContain("augani/warm-vignette@1.0.0");
  });
});

describe("blueprints", () => {
  it("lists blueprints including fire aura", () => {
    expect(listBlueprints().map((b) => b.id)).toContain("fire-aura.v1");
  });
  it("passthrough generates a valid filter graph that compiles", () => {
    const bp = getBlueprint("passthrough.v1")!;
    const g = bp.build({});
    expect(validateGraph(g).ok).toBe(true);
    expect(compileFilter(g).ok).toBe(true);
  });
  it("warm-look blueprint generates a compilable filter", () => {
    const bp = getBlueprint("warm-look.v1")!;
    const g = bp.build({ warmth: 0.2, vignette: 0.5, amount: 0.7 });
    expect(validateGraph(g).ok).toBe(true);
    expect(compileFilter(g).ok).toBe(true);
  });
  it("every blueprint generates a valid graph", () => {
    for (const bp of listBlueprints()) {
      const g = bp.build({});
      const r = validateGraph(g);
      expect(r.ok, `${bp.id}: ${JSON.stringify(r.errors)}`).toBe(true);
      expect(g.authoring?.mode).toBe("blueprint");
    }
  });

  it("Three of Me multiplies the body via cutout + transforms", () => {
    const g = getBlueprint("clone.three.v1")!.build({});
    const transforms = g.nodes.filter((n) => n.type === "Transform");
    expect(transforms).toHaveLength(3);
    expect(g.nodes.some((n) => n.type === "Cutout")).toBe(true);
    expect(g.nodes.some((n) => n.type === "SubjectMask")).toBe(true);
  });
});

describe("manifest + package", () => {
  const baseManifest = {
    schema_version: "1.0.0",
    kind: "filter" as const,
    id: "augani/warm-vignette",
    version: "1.0.0",
    abi: "1.0" as const,
    title: "Warm Vignette",
    description: "Saturate + radial vignette",
    tags: ["color"],
    author: { handle: "augani", creator_id: "01HQX" },
    params: [{ id: "amount", type: "float" as const, label: "Amount", default: 0.6, min: 0, max: 1 }],
    requirements: {
      webgpu: true,
      detection: [],
      frame_history_depth: 0,
      max_particles: 0,
      uses_3d: false,
      max_resolution: [3840, 2160] as [number, number],
      perf_budget_ms_per_frame: 8,
      perf_budget_ms_detection: 0,
    },
    license: "MIT",
  };

  it("validates a good manifest and rejects a bad id", () => {
    expect(validateManifest({ ...baseManifest, checksums: {} }).ok).toBe(true);
    expect(validateManifest({ ...baseManifest, id: "noslash", checksums: {} }).ok).toBe(false);
  });

  it("enforces size limits", () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    const r = checkSizes({ "assets/sprites/big.png": big });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.bound.startsWith("single_asset"))).toBe(true);
  });

  it("builds a package with verifiable checksums", () => {
    const compiled = compileFilter(warmVignette);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const res = buildPackage({
      manifest: baseManifest,
      graph: warmVignette,
      artifactFiles: {
        "artifact/pipeline.json": JSON.stringify(compiled.pipeline),
        "artifact/shaders/main.wgsl": compiled.wgsl,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bundle.files["manifest.json"]).toBeTruthy();
    expect(res.bundle.manifest.checksums["source/graph.json"]).toMatch(/^sha256:/);
    const check = verifyChecksums(res.bundle.files, res.bundle.manifest);
    expect(check.ok).toBe(true);
  });
});
