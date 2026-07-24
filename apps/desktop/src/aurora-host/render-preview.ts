import { loadCreationBackend } from "../../../../packages/creation-bindings/src/index";
import {
  bakeCreationSceneMesh,
  encodeBase64,
  encodePng,
  evaluateCreationSceneAtTime,
  validateCreationState,
  type CreationAssetRecipe,
  type CreationLight,
  type CreationScene,
  type CreationValidationIssue,
} from "../../../../packages/core/src/creation/index";
import type {
  AuroraRenderPreviewArgs,
  AuroraRenderPreviewResult,
} from "../shared/ipc-contract";
import { renderMeshWithNativeAuroraRenderer } from "./native-renderer";

export interface AuroraRenderedFrame {
  readonly backend: "native" | "cpu";
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly coveredPixels: number;
  readonly shadowedPixels: number;
  readonly renderMs: number;
}

type Rgb8 = readonly [number, number, number];

function parseHexColor(value: string | undefined, fallback: Rgb8): Rgb8 {
  if (!value || value === "transparent") return fallback;
  const normalized = value.trim().replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : fallback;
}

function fillBackground(width: number, height: number, background: Rgb8): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    rgba[offset] = background[0];
    rgba[offset + 1] = background[1];
    rgba[offset + 2] = background[2];
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function resolveActiveCamera(scene: CreationScene) {
  return (
    scene.cameras.find((candidate) => candidate.id === scene.activeCameraId) ??
    scene.cameras[0] ?? {
      position: { x: 3, y: 2.4, z: 4.5 },
      target: { x: 0, y: 0, z: 0 },
      fov: 40,
    }
  );
}

function lightDirection(light: CreationLight): { x: number; y: number; z: number } {
  if (light.position && light.target) {
    return {
      x: light.target.x - light.position.x,
      y: light.target.y - light.position.y,
      z: light.target.z - light.position.z,
    };
  }
  if (light.target) return light.target;
  if (light.position) {
    return {
      x: -light.position.x,
      y: -light.position.y,
      z: -light.position.z,
    };
  }
  return { x: 0.4, y: 0.9, z: 0.5 };
}

function resolveLight(scene: CreationScene) {
  const candidate =
    scene.lights.find((light) => light.kind === "directional") ??
    scene.lights.find((light) => light.kind === "spot") ??
    scene.lights.find((light) => light.kind === "area") ??
    scene.lights.find((light) => light.kind === "point");
  if (!candidate) {
    return {
      direction: { x: 0.4, y: 0.9, z: 0.5 },
      ambient: 0.22,
      intensity: 0.88,
    };
  }
  return {
    direction: lightDirection(candidate),
    ambient: candidate.kind === "ambient" ? Math.max(0.2, candidate.intensity) : 0.2,
    intensity: Math.max(0.2, candidate.intensity),
  };
}

function resolveBaseColor(scene: CreationScene, assets: readonly CreationAssetRecipe[]): string | undefined {
  const firstObject = scene.objects.find((candidate) => candidate.visible);
  if (!firstObject) return undefined;
  const asset = assets.find((candidate) => candidate.id === firstObject.assetId);
  const material =
    asset?.materials.find((candidate) => candidate.id === firstObject.materialId) ??
    asset?.materials[0];
  return material?.baseColor;
}

function renderBlankFrame(
  args: AuroraRenderPreviewArgs,
  backend: "native" | "cpu",
  backgroundHex: string,
  renderMs: number,
): AuroraRenderedFrame {
  const background = parseHexColor(backgroundHex, [15, 23, 42]);
  const rgba = fillBackground(args.width, args.height, background);
  return {
    backend,
    rgba,
    width: args.width,
    height: args.height,
    coveredPixels: 0,
    shadowedPixels: 0,
    renderMs,
  };
}

export async function renderAuroraFrame(
  args: AuroraRenderPreviewArgs,
): Promise<AuroraRenderedFrame> {
  const issues = validateCreationState({
    version: "0.1.0",
    assets: [...args.assets],
    scenes: [args.scene],
    activeSceneId: args.scene.id,
    operationHistory: [],
  });
  const blocking = issues.filter((issue: CreationValidationIssue) => issue.severity === "error");
  if (blocking.length > 0) {
    throw new Error(blocking.map((issue: CreationValidationIssue) => issue.message).join("; "));
  }

  const renderStart = performance.now();
  const scene =
    args.timeSeconds === undefined
      ? args.scene
      : evaluateCreationSceneAtTime(args.scene, args.timeSeconds);
  const background = args.background ?? scene.environment.backgroundColor ?? "#0f172a";
  const baked = bakeCreationSceneMesh(scene, args.assets, {
    quality: args.quality ?? "preview",
  });

  if (baked.mesh.indices.length < 3 || baked.mesh.positions.length < 9) {
    const fallbackBackend = loadCreationBackend({ autoNative: true });
    return renderBlankFrame(
      args,
      fallbackBackend.renderKind,
      background,
      performance.now() - renderStart,
    );
  }

  const activeCamera = resolveActiveCamera(scene);
  const renderOptions = {
    width: args.width,
    height: args.height,
    camera: {
      position: activeCamera.position,
      target: activeCamera.target,
      fov: activeCamera.fov,
    },
    light: resolveLight(scene),
    baseColor: resolveBaseColor(scene, args.assets),
    background,
    shadows: true,
  } as const;
  const nativeFrame = await renderMeshWithNativeAuroraRenderer(
    baked.mesh,
    renderOptions,
  ).catch((error) => {
    console.warn(
      "[Aurora] native renderer executable failed, falling back to in-process backend",
      error,
    );
    return null;
  });
  if (nativeFrame) {
    return {
      ...nativeFrame,
      renderMs: performance.now() - renderStart,
    };
  }
  const backend = loadCreationBackend({ autoNative: true });
  const image = backend.renderMesh(baked.mesh, renderOptions);
  return {
    backend: backend.renderKind,
    rgba: image.rgba,
    width: image.width,
    height: image.height,
    coveredPixels: image.coveredPixels,
    shadowedPixels: image.shadowedPixels,
    renderMs: performance.now() - renderStart,
  };
}

export async function renderAuroraPreview(
  args: AuroraRenderPreviewArgs,
): Promise<AuroraRenderPreviewResult> {
  const frame = await renderAuroraFrame(args);
  const png = encodePng(frame.rgba, frame.width, frame.height);
  const pngBase64 = encodeBase64(png);
  return {
    backend: frame.backend,
    pngBase64,
    dataUri: `data:image/png;base64,${pngBase64}`,
    width: frame.width,
    height: frame.height,
    coveredPixels: frame.coveredPixels,
    shadowedPixels: frame.shadowedPixels,
    renderMs: frame.renderMs,
  };
}
