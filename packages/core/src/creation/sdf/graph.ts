import type {
  CreationParameters,
  CreationParameterValue,
  CreationRecipeNode,
} from "../schema/types";
import type { Vec3 } from "../schema/common";
import type { Mesh } from "../geometry";
import {
  boxSdf,
  intersectSdf,
  smoothUnionSdf,
  sphereSdf,
  subtractSdf,
  translateSdf,
  unionSdf,
  type Sdf,
} from "./sdf";
import { marchingTetrahedra, type SdfBounds } from "./marching";

export interface BoundedSdf {
  readonly sdf: Sdf;
  readonly min: Vec3;
  readonly max: Vec3;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function readString(value: CreationParameterValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(params: CreationParameters, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readVec3(value: CreationParameterValue | undefined, fallback: Vec3): Vec3 {
  if (Array.isArray(value)) {
    const [x, y, z] = value;
    return {
      x: typeof x === "number" ? x : fallback.x,
      y: typeof y === "number" ? y : fallback.y,
      z: typeof z === "number" ? z : fallback.z,
    };
  }
  if (value && typeof value === "object") {
    const record = value as { readonly [key: string]: CreationParameterValue };
    return {
      x: typeof record.x === "number" ? record.x : fallback.x,
      y: typeof record.y === "number" ? record.y : fallback.y,
      z: typeof record.z === "number" ? record.z : fallback.z,
    };
  }
  return fallback;
}

function primitiveBounded(node: CreationRecipeNode): BoundedSdf {
  const params = node.parameters;
  const shape = readString(params.shape) ?? readString(params.kind) ?? "sphere";
  const offset = readVec3(params.offset ?? params.position ?? params.center, ZERO);
  if (shape === "box" || shape === "cube") {
    const uniform = readNumber(params, "size");
    const halfFallback =
      uniform !== undefined
        ? { x: uniform / 2, y: uniform / 2, z: uniform / 2 }
        : { x: 0.5, y: 0.5, z: 0.5 };
    const halfValue = params.half;
    const half =
      typeof halfValue === "number"
        ? { x: halfValue, y: halfValue, z: halfValue }
        : readVec3(halfValue, halfFallback);
    return {
      sdf: translateSdf(boxSdf(half), offset),
      min: { x: offset.x - half.x, y: offset.y - half.y, z: offset.z - half.z },
      max: { x: offset.x + half.x, y: offset.y + half.y, z: offset.z + half.z },
    };
  }
  const radius = Math.max(1e-3, readNumber(params, "radius") ?? (readNumber(params, "size") ?? 1) / 2);
  return {
    sdf: translateSdf(sphereSdf(radius), offset),
    min: { x: offset.x - radius, y: offset.y - radius, z: offset.z - radius },
    max: { x: offset.x + radius, y: offset.y + radius, z: offset.z + radius },
  };
}

function unionBounds(a: BoundedSdf, b: BoundedSdf): Pick<BoundedSdf, "min" | "max"> {
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  };
}

function intersectBounds(a: BoundedSdf, b: BoundedSdf): Pick<BoundedSdf, "min" | "max"> {
  const min = { x: Math.max(a.min.x, b.min.x), y: Math.max(a.min.y, b.min.y), z: Math.max(a.min.z, b.min.z) };
  const max = { x: Math.min(a.max.x, b.max.x), y: Math.min(a.max.y, b.max.y), z: Math.min(a.max.z, b.max.z) };
  if (min.x >= max.x || min.y >= max.y || min.z >= max.z) {
    return { min: a.min, max: a.max };
  }
  return { min, max };
}

function combine(operation: string, smoothing: number, operands: readonly BoundedSdf[]): BoundedSdf {
  let accumulator = operands[0]!;
  for (let index = 1; index < operands.length; index += 1) {
    const operand = operands[index]!;
    switch (operation) {
      case "subtract":
      case "difference":
        accumulator = {
          sdf: subtractSdf(accumulator.sdf, operand.sdf),
          min: accumulator.min,
          max: accumulator.max,
        };
        break;
      case "intersect":
      case "intersection":
        accumulator = {
          sdf: intersectSdf(accumulator.sdf, operand.sdf),
          ...intersectBounds(accumulator, operand),
        };
        break;
      case "smooth-union":
      case "smoothunion":
      case "blend": {
        const bounds = unionBounds(accumulator, operand);
        const pad = Math.max(0, smoothing);
        accumulator = {
          sdf: smoothUnionSdf(accumulator.sdf, operand.sdf, smoothing),
          min: { x: bounds.min.x - pad, y: bounds.min.y - pad, z: bounds.min.z - pad },
          max: { x: bounds.max.x + pad, y: bounds.max.y + pad, z: bounds.max.z + pad },
        };
        break;
      }
      default:
        accumulator = { sdf: unionSdf(accumulator.sdf, operand.sdf), ...unionBounds(accumulator, operand) };
        break;
    }
  }
  return accumulator;
}

function resolveNode(
  node: CreationRecipeNode,
  byId: ReadonlyMap<string, CreationRecipeNode>,
  visiting: Set<string>,
): BoundedSdf | null {
  if (visiting.has(node.id)) return null;
  if (node.type === "sdf") return primitiveBounded(node);
  if (node.type === "boolean") {
    visiting.add(node.id);
    const operands: BoundedSdf[] = [];
    for (const inputId of node.inputs) {
      const input = byId.get(inputId);
      if (!input) continue;
      const resolved = resolveNode(input, byId, visiting);
      if (resolved) operands.push(resolved);
    }
    visiting.delete(node.id);
    if (operands.length === 0) return null;
    if (operands.length === 1) return operands[0]!;
    const operation =
      readString(node.parameters.operation) ?? readString(node.parameters.op) ?? "union";
    const smoothing =
      readNumber(node.parameters, "smoothing") ?? readNumber(node.parameters, "blend") ?? 0.3;
    return combine(operation, smoothing, operands);
  }
  return null;
}

export function buildSdfGraph(nodes: readonly CreationRecipeNode[]): BoundedSdf | null {
  const sdfNodes = nodes.filter((node) => node.type === "sdf" || node.type === "boolean");
  if (sdfNodes.length === 0) return null;
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const referenced = new Set<string>();
  for (const node of sdfNodes) {
    for (const inputId of node.inputs) referenced.add(inputId);
  }
  const roots = sdfNodes.filter((node) => !referenced.has(node.id));
  const root =
    roots.find((node) => node.type === "boolean") ??
    roots[0] ??
    sdfNodes[sdfNodes.length - 1]!;
  return resolveNode(root, byId, new Set());
}

export function bakeSdfGraph(
  nodes: readonly CreationRecipeNode[],
  resolution: number,
): Mesh | null {
  const graph = buildSdfGraph(nodes);
  if (!graph) return null;
  const padX = Math.max(0.1, (graph.max.x - graph.min.x) * 0.1);
  const padY = Math.max(0.1, (graph.max.y - graph.min.y) * 0.1);
  const padZ = Math.max(0.1, (graph.max.z - graph.min.z) * 0.1);
  const bounds: SdfBounds = {
    min: { x: graph.min.x - padX, y: graph.min.y - padY, z: graph.min.z - padZ },
    max: { x: graph.max.x + padX, y: graph.max.y + padY, z: graph.max.z + padZ },
  };
  return marchingTetrahedra(graph.sdf, bounds, Math.max(2, Math.floor(resolution)));
}
