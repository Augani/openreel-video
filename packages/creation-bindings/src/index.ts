import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildBox,
  computeMeshStats,
  rayTraceMeshToImage,
  type Mesh,
  type MeshStats,
  type RayTraceOptions,
  type RayTracedImage,
} from "@openreel/core/creation/index";

export type CreationBackendKind = "native" | "wasm" | "cpu";
export type CreationRenderKind = "native" | "cpu";

export type CreationRenderOptions = RayTraceOptions;
export type CreationRenderImage = RayTracedImage;

export interface CreationBackend {
  readonly kind: CreationBackendKind;
  readonly renderKind: CreationRenderKind;
  version(): string;
  bakeBox(width: number, height: number, depth: number): MeshStats;
  renderMesh(mesh: Mesh, options: CreationRenderOptions): CreationRenderImage;
}

export interface NativeCreationModule {
  orc_version(): string;
  orc_bake_box(
    width: number,
    height: number,
    depth: number,
  ): {
    vertex_count: number;
    triangle_count: number;
    bounds: { min: [number, number, number]; max: [number, number, number] };
  };
  orc_render_mesh?(
    positions: Float32Array,
    normals: Float32Array,
    colors: Float32Array | null,
    indices: Uint32Array,
    options: {
      width: number;
      height: number;
      cameraPosition: readonly [number, number, number];
      cameraTarget: readonly [number, number, number];
      cameraUp: readonly [number, number, number];
      cameraFov: number;
      lightDirection: readonly [number, number, number];
      lightAmbient: number;
      lightIntensity: number;
      baseColor: readonly [number, number, number];
      background: readonly [number, number, number];
      shadows: boolean;
    },
  ): {
    rgba: Uint8Array;
    width: number;
    height: number;
    covered_pixels: number;
    shadowed_pixels: number;
  };
}

const CPU_VERSION = "0.1.0";

export function cpuCreationBackend(): CreationBackend {
  return {
    kind: "cpu",
    renderKind: "cpu",
    version: () => CPU_VERSION,
    bakeBox: (width, height, depth) =>
      computeMeshStats(buildBox({ width, height, depth })),
    renderMesh: (mesh, options) => rayTraceMeshToImage(mesh, options),
  };
}

function hexToRgb01(
  hex: string | undefined,
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  if (!hex) return fallback;
  const normalized = hex.replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return fallback;
  return [r, g, b];
}

function toNativeRenderOptions(options: CreationRenderOptions) {
  const light = options.light ?? { direction: { x: 0.4, y: 0.9, z: 0.5 } };
  return {
    width: options.width,
    height: options.height,
    cameraPosition: [
      options.camera.position.x,
      options.camera.position.y,
      options.camera.position.z,
    ] as const,
    cameraTarget: [
      options.camera.target.x,
      options.camera.target.y,
      options.camera.target.z,
    ] as const,
    cameraUp: [
      options.camera.up?.x ?? 0,
      options.camera.up?.y ?? 1,
      options.camera.up?.z ?? 0,
    ] as const,
    cameraFov: options.camera.fov ?? 45,
    lightDirection: [
      light.direction.x,
      light.direction.y,
      light.direction.z,
    ] as const,
    lightAmbient: light.ambient ?? 0.2,
    lightIntensity: light.intensity ?? 0.9,
    baseColor: hexToRgb01(options.baseColor, [0.58, 0.64, 0.72]),
    background: hexToRgb01(options.background, [0.06, 0.09, 0.16]),
    shadows: options.shadows !== false,
  };
}

function wrapNative(module: NativeCreationModule, kind: "native" | "wasm"): CreationBackend {
  return {
    kind,
    renderKind: typeof module.orc_render_mesh === "function" ? "native" : "cpu",
    version: () => module.orc_version(),
    bakeBox: (width, height, depth) => {
      const stats = module.orc_bake_box(width, height, depth);
      return {
        vertexCount: stats.vertex_count,
        triangleCount: stats.triangle_count,
        bounds: {
          min: { x: stats.bounds.min[0], y: stats.bounds.min[1], z: stats.bounds.min[2] },
          max: { x: stats.bounds.max[0], y: stats.bounds.max[1], z: stats.bounds.max[2] },
        },
      };
    },
    renderMesh: (mesh, options) => {
      if (typeof module.orc_render_mesh !== "function") {
        return rayTraceMeshToImage(mesh, options);
      }
      const image = module.orc_render_mesh(
        mesh.positions,
        mesh.normals,
        mesh.colors ?? null,
        mesh.indices,
        toNativeRenderOptions(options),
      );
      return {
        rgba: Uint8Array.from(image.rgba),
        width: image.width,
        height: image.height,
        coveredPixels: image.covered_pixels,
        shadowedPixels: image.shadowed_pixels,
      };
    },
  };
}

function nativeAddonCandidates(): readonly string[] {
  const candidates = new Set<string>();
  const explicit = process.env.OPENREEL_CREATION_ADDON_PATH?.trim();
  if (explicit) candidates.add(path.resolve(explicit));

  let current = path.resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.add(
      path.join(
        current,
        "packages",
        "creation-bindings",
        "native",
        "build",
        "Release",
        "creation_core_addon.node",
      ),
    );
    candidates.add(
      path.join(current, "creation-bindings", "native", "build", "Release", "creation_core_addon.node"),
    );
    candidates.add(
      path.join(current, "native", "build", "Release", "creation_core_addon.node"),
    );
    candidates.add(
      path.join(current, "resources", "aurora", "creation_core_addon.node"),
    );
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return [...candidates];
}

export function loadNativeAddon(
  searchPaths: readonly string[] = nativeAddonCandidates(),
): NativeCreationModule | undefined {
  const require = createRequire(path.resolve(process.cwd(), "__openreel_creation_bindings__.cjs"));
  for (const candidate of searchPaths) {
    try {
      if (!existsSync(candidate)) continue;
      const module = require(candidate) as Partial<NativeCreationModule>;
      if (typeof module.orc_version === "function" && typeof module.orc_bake_box === "function") {
        return module as NativeCreationModule;
      }
    } catch {
      // Try the next candidate so the desktop bridge can fall back to CPU cleanly.
    }
  }
  return undefined;
}

export interface LoadCreationBackendOptions {
  readonly preferCpu?: boolean;
  readonly autoNative?: boolean;
  readonly nativeModule?: NativeCreationModule;
  readonly wasmModule?: NativeCreationModule;
}

interface NativeHostGlobal {
  __openreelCreationNative?: NativeCreationModule;
  __openreelCreationWasm?: NativeCreationModule;
}

export function loadCreationBackend(
  options: LoadCreationBackendOptions = {},
): CreationBackend {
  if (options.preferCpu) return cpuCreationBackend();
  const host = globalThis as unknown as NativeHostGlobal;
  const native = options.nativeModule ?? host.__openreelCreationNative;
  if (native) return wrapNative(native, "native");
  const wasm = options.wasmModule ?? host.__openreelCreationWasm;
  if (wasm) return wrapNative(wasm, "wasm");
  if (options.autoNative) {
    const addon = loadNativeAddon();
    if (addon) return wrapNative(addon, "native");
  }
  return cpuCreationBackend();
}
