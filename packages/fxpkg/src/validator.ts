/**
 * Graph validator (STUDIO_PLAN §11.1 step 1). Runs in three places — browser
 * preview, studio backend at submit, and CI — from one schema and node
 * registry. Never trusts client output; the backend re-validates from source.
 */
import type { Graph, PortType } from "./types";
import { getNode } from "./nodelib";
import { abiAtLeast, capsFor } from "./abi";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  message: string;
  severity: Severity;
  nodeId?: string;
  edge?: { fromNode: string; fromPort: string; toNode: string; toPort: string };
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function typesCompatible(a: PortType, b: PortType): boolean {
  if (a === b) return true;
  if (a === "any" || b === "any") return true;
  // numeric widening is not implicit; textures/masks/depth are distinct.
  return false;
}

export function validateGraph(graph: Graph): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const push = (i: ValidationIssue) => (i.severity === "error" ? errors : warnings).push(i);

  const byId = new Map(graph.nodes.map((nd) => [nd.id, nd]));

  // unique node ids
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      push({ code: "duplicate_node_id", message: `Duplicate node id "${node.id}"`, severity: "error", nodeId: node.id });
    }
    seen.add(node.id);
  }

  // node existence + ABI gating
  for (const node of graph.nodes) {
    const spec = getNode(node.type);
    if (!spec) {
      push({ code: "unknown_node", message: `Unknown node type "${node.type}"`, severity: "error", nodeId: node.id });
      continue;
    }
    if (!abiAtLeast(graph.abi, spec.minAbi)) {
      push({
        code: "node_abi_too_new",
        message: `Node "${node.type}" requires ABI ${spec.minAbi}, graph declares ${graph.abi}`,
        severity: "error",
        nodeId: node.id,
      });
    }
  }

  // exactly one Output node (filters/effects/templates all terminate in Output)
  const outputs = graph.nodes.filter((nd) => nd.type === "Output");
  if (outputs.length === 0) {
    push({ code: "no_output", message: "Graph must contain exactly one Output node", severity: "error" });
  } else if (outputs.length > 1) {
    push({ code: "multiple_outputs", message: `Graph has ${outputs.length} Output nodes; expected exactly one`, severity: "error" });
  }

  // edge endpoint + type validation
  for (const edge of graph.edges) {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    if (!from || !to) {
      push({ code: "dangling_edge", message: `Edge references missing node`, severity: "error", edge });
      continue;
    }
    const fromSpec = getNode(from.type);
    const toSpec = getNode(to.type);
    if (!fromSpec || !toSpec) continue;
    const outPort = fromSpec.outputs.find((p) => p.id === edge.fromPort);
    const inPort = toSpec.inputs.find((p) => p.id === edge.toPort);
    if (!outPort) {
      push({ code: "unknown_output_port", message: `Node "${from.type}" has no output port "${edge.fromPort}"`, severity: "error", edge });
      continue;
    }
    if (!inPort) {
      push({ code: "unknown_input_port", message: `Node "${to.type}" has no input port "${edge.toPort}"`, severity: "error", edge });
      continue;
    }
    if (!typesCompatible(outPort.type, inPort.type)) {
      push({
        code: "type_mismatch",
        message: `Type mismatch: ${from.type}.${edge.fromPort} (${outPort.type}) → ${to.type}.${edge.toPort} (${inPort.type})`,
        severity: "error",
        edge,
      });
    }
  }

  // acyclic (DAG) check
  if (hasCycle(graph)) {
    push({ code: "cycle", message: "Graph contains a cycle; it must be a DAG", severity: "error" });
  }

  // resource caps
  const caps = capsFor(graph.abi);
  const particleSystems = graph.nodes.filter((nd) => nd.type === "ParticleEmitter");
  if (particleSystems.length > caps.maxParticleSystems) {
    push({
      code: "too_many_particle_systems",
      message: `${particleSystems.length} particle systems exceeds cap of ${caps.maxParticleSystems}`,
      severity: "error",
    });
  }
  let totalParticles = 0;
  for (const node of particleSystems) {
    const max = typeof node.config?.max === "number" ? (node.config.max as number) : caps.maxParticles;
    if (max > caps.maxParticles) {
      push({ code: "particle_cap", message: `ParticleEmitter max ${max} exceeds per-system cap ${caps.maxParticles}`, severity: "error", nodeId: node.id });
    }
    totalParticles += Math.min(max, caps.maxParticles);
  }
  if (totalParticles > caps.maxTotalParticles) {
    push({ code: "total_particle_cap", message: `Total particles ${totalParticles} exceeds cap ${caps.maxTotalParticles}`, severity: "error" });
  }

  const meshes = graph.nodes.filter((nd) => nd.type === "Mesh3D");
  if (meshes.length > caps.maxMeshes) {
    push({ code: "mesh_cap", message: `${meshes.length} meshes exceeds cap ${caps.maxMeshes}`, severity: "error" });
  }

  // disconnected Output input
  for (const out of outputs) {
    const fed = graph.edges.some((e) => e.toNode === out.id && e.toPort === "in");
    if (!fed) {
      push({ code: "output_unconnected", message: "Output node has no input connection", severity: "error", nodeId: out.id });
    }
  }

  // params used by Param nodes must be declared
  const declaredParams = new Set(graph.params.map((p) => p.id));
  for (const node of graph.nodes) {
    if (node.type === "Param") {
      const pid = node.config?.param;
      if (typeof pid === "string" && !declaredParams.has(pid)) {
        push({ code: "undeclared_param", message: `Param node references undeclared param "${pid}"`, severity: "error", nodeId: node.id });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function hasCycle(graph: Graph): boolean {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    if (adj.has(edge.fromNode)) adj.get(edge.fromNode)!.push(edge.toNode);
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0=unseen,1=in-stack,2=done
  const visit = (id: string): boolean => {
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) return true;
      if (s === 0 && visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const node of graph.nodes) {
    if ((state.get(node.id) ?? 0) === 0 && visit(node.id)) return true;
  }
  return false;
}

/** Topological order of node ids (assumes the graph is a DAG). */
export function topoSort(graph: Graph): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    indeg.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!adj.has(edge.fromNode) || !indeg.has(edge.toNode)) continue;
    adj.get(edge.fromNode)!.push(edge.toNode);
    indeg.set(edge.toNode, (indeg.get(edge.toNode) ?? 0) + 1);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return order;
}
