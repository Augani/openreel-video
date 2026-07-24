import type { MotionComposition } from "@openreel/core";
import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationScene,
  RenderedImage,
} from "@openreel/core/creation/index";
import {
  bakeCreationSceneMesh,
  evaluateCreationSceneAtTime,
  renderMeshToImage,
} from "@openreel/core/creation/index";

export interface CreationStagePreviewFallback {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
}

type Rgb = readonly [number, number, number];

function parseHexColor(value: string | undefined, fallback: Rgb): Rgb {
  if (!value || value === "transparent") return fallback;
  const normalized = value.trim().replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
    ? [r, g, b]
    : fallback;
}

export function resolveCreationStagePreviewFallback(
  creation: CreationProjectState | undefined,
  composition: MotionComposition,
): CreationStagePreviewFallback | null {
  if (!creation) return null;
  const hasScene3DLayer = composition.layers.some((layer) => layer.type === "scene3d");
  if (!hasScene3DLayer) return null;

  const scene = creation.scenes.find((candidate) =>
    candidate.renderBindings.some(
      (binding) =>
        binding.kind === "motion-scene3d" &&
        binding.compositionId === composition.id &&
        composition.layers.some((layer) => layer.id === binding.layerId),
    ),
  );
  if (scene) return { scene, assets: creation.assets };

  const activeScene = creation.scenes.find(
    (candidate) => candidate.id === creation.activeSceneId,
  );
  const fallbackScene =
    activeScene && activeScene.objects.length > 0
      ? activeScene
      : creation.scenes.find((candidate) => candidate.objects.length > 0);
  return fallbackScene ? { scene: fallbackScene, assets: creation.assets } : null;
}

export function renderCreationStagePreviewFallbackImage({
  fallback,
  width,
  height,
  background,
  timeSeconds,
}: {
  readonly fallback: CreationStagePreviewFallback;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly timeSeconds?: number;
}): RenderedImage | null {
  const scene =
    timeSeconds === undefined
      ? fallback.scene
      : evaluateCreationSceneAtTime(fallback.scene, timeSeconds);
  const baked = bakeCreationSceneMesh(scene, fallback.assets, {
    quality: "preview",
  });
  if (baked.objects.length === 0) return null;

  const activeCamera =
    scene.cameras.find((candidate) => candidate.id === scene.activeCameraId) ??
    scene.cameras[0];
  const firstMaterial = fallback.assets.find(
    (asset) => asset.id === scene.objects[0]?.assetId,
  )?.materials[0];

  return renderMeshToImage(baked.mesh, {
    width,
    height,
    camera: {
      position: activeCamera?.position ?? { x: 3, y: 2.4, z: 4.5 },
      target: activeCamera?.target ?? { x: 0, y: 0, z: 0 },
      fov: activeCamera?.fov ?? 40,
    },
    baseColor: firstMaterial?.baseColor ?? "#94a3b8",
    background: scene.environment.backgroundColor ?? background,
  });
}

export function previewPixelsHaveForeground({
  rgba,
  width,
  height,
  background,
}: {
  readonly rgba: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly background: string;
}): boolean {
  const transparent = background === "transparent";
  const bg = parseHexColor(background, [0, 0, 0]);
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 96));
  let foregroundSamples = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3] ?? 0;
      if (alpha < 8) continue;
      if (transparent) return true;
      const delta =
        Math.abs((rgba[i] ?? 0) - bg[0]) +
        Math.abs((rgba[i + 1] ?? 0) - bg[1]) +
        Math.abs((rgba[i + 2] ?? 0) - bg[2]);
      if (delta > 32) {
        foregroundSamples += 1;
        if (foregroundSamples >= 8) return true;
      }
    }
  }

  return false;
}
