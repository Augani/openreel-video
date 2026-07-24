import type {
  CreationAssetRecipe,
  CreationCacheRef,
  CreationParameters,
  CreationParameterValue,
  CreationRecipeNode,
} from "../schema/types";
import { computeMeshStats, type Mesh, type MeshStats } from "./mesh";
import { displaceMesh } from "./deform";
import {
  buildBox,
  buildCone,
  buildCylinder,
  buildIcosahedron,
  buildPlane,
  buildRoundedBox,
  buildSphere,
  buildTorus,
} from "./primitives";
import { weldVertices } from "./optimize";
import { mergeMeshes, transformMesh } from "./transform";
import { extrudeProfile, revolveProfile, type Vec2Point } from "./profiles";
import { subdivideMesh } from "./subdivide";
import { generateBoxUvs } from "./uv";
import { buildTube, sweepProfileAlongPath } from "./sweep";
import { bakeSdfGraph } from "../sdf/graph";
import type { Vec3 } from "../schema/common";

export type BakeQuality = "preview" | "final";

export interface BakeMeshOptions {
  readonly quality?: BakeQuality;
  readonly now?: number;
  readonly generatorVersion?: string;
  readonly weld?: boolean;
  readonly smoothNormals?: boolean;
  readonly subdivisions?: number;
  readonly boxUvs?: boolean;
}

function postProcessMesh(mesh: Mesh, options: BakeMeshOptions): Mesh {
  let result = mesh;
  if (options.subdivisions && options.subdivisions > 0) {
    result = subdivideMesh(result, options.subdivisions);
  }
  if (options.weld) {
    result = weldVertices(result, { smoothNormals: options.smoothNormals });
  }
  if (options.boxUvs) {
    result = generateBoxUvs(result);
  }
  return result;
}

export interface BakedMesh {
  readonly mesh: Mesh;
  readonly stats: MeshStats;
  readonly kind: string;
  readonly placeholder: boolean;
}

export interface BakedAsset {
  readonly asset: CreationAssetRecipe;
  readonly mesh: Mesh;
  readonly stats: MeshStats;
  readonly kind: string;
  readonly placeholder: boolean;
}

const PLACEHOLDER_KINDS = new Set(["model", "text3d"]);

function readNumber(params: CreationParameters | undefined, key: string): number | undefined {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: CreationParameterValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readProfile(value: CreationParameterValue | undefined): Vec2Point[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points: Vec2Point[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as { readonly [key: string]: CreationParameterValue };
      const x = record.x;
      const y = record.y;
      if (typeof x === "number" && typeof y === "number") {
        points.push({ x, y });
      }
    }
  }
  return points.length > 0 ? points : undefined;
}

function readPath(value: CreationParameterValue | undefined): Vec3[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points: Vec3[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as { readonly [key: string]: CreationParameterValue };
      const x = record.x;
      const y = record.y;
      const z = record.z;
      if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
        points.push({ x, y, z });
      }
    }
  }
  return points.length > 0 ? points : undefined;
}

function geometryParametersForAsset(asset: CreationAssetRecipe): CreationParameters {
  const node = asset.nodes.find(
    (candidate) => candidate.type === "primitive" || candidate.type === "cache",
  );
  if (node) return node.parameters;
  return asset.parameters;
}

function geometrySegments(quality: BakeQuality): {
  readonly sphereWidth: number;
  readonly sphereHeight: number;
  readonly radial: number;
  readonly torusRadial: number;
  readonly torusTubular: number;
} {
  if (quality === "final") {
    return { sphereWidth: 48, sphereHeight: 32, radial: 48, torusRadial: 24, torusTubular: 48 };
  }
  return { sphereWidth: 24, sphereHeight: 16, radial: 24, torusRadial: 16, torusTubular: 32 };
}

export function bakeRecipeMesh(
  asset: CreationAssetRecipe,
  options: BakeMeshOptions = {},
): BakedMesh {
  const quality: BakeQuality = options.quality ?? "preview";
  const params = geometryParametersForAsset(asset);
  const kind =
    readString(params.kind) ??
    readString(asset.parameters.motionObjectKind) ??
    "box";
  const size = readNumber(params, "size") ?? 1;
  const depth = readNumber(params, "depth") ?? size;
  const aspect = readNumber(params, "aspect") ?? 1;
  const cornerRadius = readNumber(params, "cornerRadius");
  const segments = geometrySegments(quality);

  const path = readPath(params.path);
  const profile = readProfile(params.profile);
  const wantsRevolve = params.revolve === true || kind === "revolve";
  const rawSdfMesh = bakeSdfGraph(asset.nodes, quality === "final" ? 40 : 32);
  const sdfMesh =
    rawSdfMesh && rawSdfMesh.indices.length >= 3 && rawSdfMesh.positions.length >= 9
      ? weldVertices(rawSdfMesh, { smoothNormals: true })
      : null;

  let baseMesh: Mesh;
  let resolvedKind = kind;
  let placeholder = false;

  if (sdfMesh) {
    baseMesh = sdfMesh;
    resolvedKind = "sdf";
  } else if (path && path.length >= 2 && (kind === "tube" || kind === "sweep")) {
    const sweepProfile = readProfile(params.profile);
    const radialSegments = Math.max(
      3,
      Math.floor(readNumber(params, "radialSegments") ?? segments.radial),
    );
    baseMesh =
      kind === "sweep" && sweepProfile && sweepProfile.length >= 2
        ? sweepProfileAlongPath({
            profile: sweepProfile,
            path,
            closedProfile: params.closedProfile === true,
          })
        : buildTube({ path, radius: cornerRadius ?? size * 0.5, radialSegments });
  } else if (profile && (wantsRevolve ? profile.length >= 2 : profile.length >= 3)) {
    baseMesh = wantsRevolve
      ? revolveProfile({
          profile,
          segments: Math.max(3, Math.floor(readNumber(params, "segments") ?? segments.radial)),
          arcDegrees: readNumber(params, "arcDegrees") ?? 360,
        })
      : extrudeProfile({ profile, depth: readNumber(params, "extrudeDepth") ?? depth });
    resolvedKind = wantsRevolve ? "revolve" : "extrude";
  } else {
    placeholder = PLACEHOLDER_KINDS.has(kind);
    switch (kind) {
      case "sphere":
      case "soccer-ball":
        baseMesh = buildSphere({
          radius: size / 2,
          widthSegments: segments.sphereWidth,
          heightSegments: segments.sphereHeight,
        });
        break;
      case "icosahedron":
        baseMesh = buildIcosahedron(size / 2);
        break;
      case "cylinder":
        baseMesh = buildCylinder({
          radiusTop: size / 2,
          radiusBottom: size / 2,
          height: depth,
          radialSegments: segments.radial,
        });
        break;
      case "cone":
        baseMesh = buildCone(size / 2, depth, segments.radial);
        break;
      case "torus":
        baseMesh = buildTorus({
          radius: size / 2,
          tube: size / 6,
          radialSegments: segments.torusRadial,
          tubularSegments: segments.torusTubular,
        });
        break;
      case "plane":
        baseMesh = buildPlane({ width: size, depth: size * aspect });
        break;
      case "rounded-box":
      case "phone": {
        const radius = cornerRadius ?? size * 0.08;
        baseMesh =
          radius > 0
            ? buildRoundedBox({ width: size, height: size * aspect, depth, radius })
            : buildBox({ width: size, height: size * aspect, depth });
        break;
      }
      default:
        baseMesh = buildBox({ width: size, height: size * aspect, depth });
        break;
    }
  }

  const composedMesh = composeModifierNodes(baseMesh, asset.nodes);
  const finalMesh = postProcessMesh(composedMesh, options);
  return { mesh: finalMesh, stats: computeMeshStats(finalMesh), kind: resolvedKind, placeholder };
}

const DISPLACE_TRIANGLE_BUDGET = 6000;
const SUBDIVISION_CEILING = 4;
const ARRAY_COUNT_CEILING = 64;
const ARRAY_TRIANGLE_BUDGET = 12000;

const DISPLACEMENT_KIND_PATTERN: Readonly<Record<string, string>> = {
  craters: "voronoi",
  ridges: "marble",
  waves: "marble",
  terrain: "fbm",
  dunes: "fbm",
  noise: "noise",
};

function adaptiveSubdivisions(requested: number | undefined, baseTriangleCount: number): number {
  const ceiling =
    requested === undefined
      ? SUBDIVISION_CEILING
      : Math.max(0, Math.min(SUBDIVISION_CEILING, Math.floor(requested)));
  let iterations = 0;
  let triangles = Math.max(1, baseTriangleCount);
  while (iterations < ceiling && triangles * 4 <= DISPLACE_TRIANGLE_BUDGET) {
    triangles *= 4;
    iterations += 1;
  }
  return iterations;
}

function displacementPattern(params: CreationParameters): string | undefined {
  const explicit = readString(params.pattern) ?? readString(params.noise);
  if (explicit) return explicit;
  const kind = readString(params.kind);
  if (kind && DISPLACEMENT_KIND_PATTERN[kind]) return DISPLACEMENT_KIND_PATTERN[kind];
  return undefined;
}

function displacementSeed(params: CreationParameters): number | undefined {
  const numeric = readNumber(params, "seed");
  if (numeric !== undefined) return numeric;
  const raw = readString(params.seed);
  if (!raw) return undefined;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000;
}

function composeModifierNodes(
  mesh: Mesh,
  nodes: readonly CreationRecipeNode[],
): Mesh {
  let result = mesh;
  for (const node of nodes) {
    if (node.type === "subdivision") {
      const requested = Math.max(
        0,
        Math.min(
          SUBDIVISION_CEILING,
          Math.floor(
            readNumber(node.parameters, "iterations") ??
              readNumber(node.parameters, "subdivisions") ??
              1,
          ),
        ),
      );
      const iterations = adaptiveSubdivisions(requested, result.indices.length / 3);
      if (iterations > 0) result = subdivideMesh(result, iterations);
    } else if (node.type === "deform") {
      const baseTriangleCount = result.indices.length / 3;
      result = displaceMesh(result, {
        pattern: displacementPattern(node.parameters),
        amplitude:
          readNumber(node.parameters, "amplitude") ??
          readNumber(node.parameters, "strength"),
        scale:
          readNumber(node.parameters, "scale") ??
          readNumber(node.parameters, "frequency"),
        seed: displacementSeed(node.parameters),
        subdivisions: adaptiveSubdivisions(
          readNumber(node.parameters, "subdivisions"),
          baseTriangleCount,
        ),
      });
    } else if (node.type === "array") {
      result = applyArrayNode(result, node.parameters);
    }
  }
  return result;
}

function applyArrayNode(mesh: Mesh, params: CreationParameters): Mesh {
  const count = Math.max(
    1,
    Math.min(ARRAY_COUNT_CEILING, Math.floor(readNumber(params, "count") ?? 3)),
  );
  if (count <= 1) return mesh;
  const baseTriangleCount = Math.max(1, mesh.indices.length / 3);
  const effectiveCount = Math.max(
    1,
    Math.min(count, Math.floor(ARRAY_TRIANGLE_BUDGET / baseTriangleCount)),
  );
  if (effectiveCount <= 1) return mesh;

  const offset = {
    x: readNumber(params, "offsetX") ?? readNumber(params, "spacingX") ?? 0,
    y: readNumber(params, "offsetY") ?? readNumber(params, "spacingY") ?? 0,
    z: readNumber(params, "offsetZ") ?? readNumber(params, "spacingZ") ?? 0,
  };
  if (offset.x === 0 && offset.y === 0 && offset.z === 0) {
    const bounds = computeMeshStats(mesh).bounds;
    const width = bounds.max.x - bounds.min.x;
    offset.x = width > 1e-4 ? width * 1.1 : 1;
  }

  const copies: Mesh[] = [mesh];
  for (let i = 1; i < effectiveCount; i += 1) {
    copies.push(
      transformMesh(mesh, {
        position: { x: offset.x * i, y: offset.y * i, z: offset.z * i },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }),
    );
  }
  return mergeMeshes(copies);
}

export function bakeCreationAsset(
  asset: CreationAssetRecipe,
  options: BakeMeshOptions = {},
): BakedAsset {
  const now = options.now ?? Date.now();
  const quality: BakeQuality = options.quality ?? "preview";
  const generatorVersion = options.generatorVersion ?? "cpu-geometry-kernel-v1";
  const baked = bakeRecipeMesh(asset, options);
  const cacheKind = quality === "final" ? "final-mesh" : "preview-mesh";
  const cacheId = `cache-${asset.id}-${cacheKind}`;
  const cache: CreationCacheRef = {
    id: cacheId,
    kind: cacheKind,
    status: baked.placeholder ? "dirty" : "ready",
    bounds: baked.stats.bounds,
    generatedAt: now,
    generatorVersion,
    error: baked.placeholder ? `No CPU mesh generator for kind: ${baked.kind}` : undefined,
  };
  const caches = asset.caches.some((candidate) => candidate.kind === cacheKind)
    ? asset.caches.map((candidate) => (candidate.kind === cacheKind ? cache : candidate))
    : [...asset.caches, cache];

  const bakedMeshMeta: CreationParameterValue = {
    kind: baked.kind,
    quality,
    vertexCount: baked.stats.vertexCount,
    triangleCount: baked.stats.triangleCount,
    placeholder: baked.placeholder,
    generatorVersion,
    bounds: {
      min: baked.stats.bounds.min,
      max: baked.stats.bounds.max,
    },
  };

  return {
    asset: {
      ...asset,
      caches,
      parameters: { ...asset.parameters, bakedMesh: bakedMeshMeta },
      modifiedAt: now,
    },
    mesh: baked.mesh,
    stats: baked.stats,
    kind: baked.kind,
    placeholder: baked.placeholder,
  };
}
