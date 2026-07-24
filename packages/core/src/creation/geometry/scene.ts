import type { CreationAssetRecipe, CreationScene } from "../schema/types";
import { bakeRecipeMesh, type BakeQuality } from "./bake";
import { computeMeshStats, type Mesh, type MeshStats } from "./mesh";
import { mergeMeshes, transformMesh } from "./transform";

export interface SceneBakeObjectStat {
  readonly objectId: string;
  readonly assetId: string;
  readonly kind: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly placeholder: boolean;
}

export interface SceneBakeResult {
  readonly mesh: Mesh;
  readonly stats: MeshStats;
  readonly objects: readonly SceneBakeObjectStat[];
  readonly missingAssetObjectIds: readonly string[];
}

export interface SceneBakeOptions {
  readonly quality?: BakeQuality;
  readonly includeHidden?: boolean;
}

type Rgb01 = readonly [number, number, number];

function hexToRgb01(hex: string | undefined, fallback: Rgb01): Rgb01 {
  if (!hex) return fallback;
  const normalized = hex.replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback;
  return [r / 255, g / 255, b / 255];
}

function meshWithVertexColor(mesh: Mesh, color: Rgb01): Mesh {
  const vertexCount = mesh.positions.length / 3;
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) {
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
  }
  return { ...mesh, colors };
}

export function bakeCreationSceneMesh(
  scene: CreationScene,
  assets: readonly CreationAssetRecipe[],
  options: SceneBakeOptions = {},
): SceneBakeResult {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const transformedMeshes: Mesh[] = [];
  const objectStats: SceneBakeObjectStat[] = [];
  const missingAssetObjectIds: string[] = [];

  for (const object of scene.objects) {
    if (!object.visible && !options.includeHidden) continue;
    const asset = assetById.get(object.assetId);
    if (!asset) {
      missingAssetObjectIds.push(object.id);
      continue;
    }
    const baked = bakeRecipeMesh(asset, { quality: options.quality });
    const transformed = transformMesh(baked.mesh, object.transform);
    const material =
      asset.materials.find((candidate) => candidate.id === object.materialId) ??
      asset.materials[0];
    transformedMeshes.push(
      meshWithVertexColor(transformed, hexToRgb01(material?.baseColor, [0.58, 0.64, 0.72])),
    );
    objectStats.push({
      objectId: object.id,
      assetId: asset.id,
      kind: baked.kind,
      vertexCount: baked.stats.vertexCount,
      triangleCount: baked.stats.triangleCount,
      placeholder: baked.placeholder,
    });
  }

  const mesh = mergeMeshes(transformedMeshes);
  return {
    mesh,
    stats: computeMeshStats(mesh),
    objects: objectStats,
    missingAssetObjectIds,
  };
}
