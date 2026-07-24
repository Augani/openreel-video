import { describe, it, expect } from "vitest";
import { buildBox } from "@openreel/core/creation/index";
import {
  cpuCreationBackend,
  loadCreationBackend,
  loadNativeAddon,
  type NativeCreationModule,
} from "./index";
import { instantiateCreationWasm, loadWasmBackend } from "./wasm";

describe("creation bindings", () => {
  it("falls back to the CPU backend when no native module is present", () => {
    const backend = loadCreationBackend();
    expect(backend.kind).toBe("cpu");
    expect(backend.renderKind).toBe("cpu");
    const stats = backend.bakeBox(2, 2, 2);
    expect(stats.vertexCount).toBe(24);
    expect(stats.triangleCount).toBe(12);
    expect(stats.bounds.max).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("routes to an injected native module and matches the CPU reference", () => {
    const fakeNative: NativeCreationModule = {
      orc_version: () => "0.1.0",
      orc_bake_box: (width, height, depth) => ({
        vertex_count: 24,
        triangle_count: 12,
        bounds: {
          min: [-width / 2, -height / 2, -depth / 2],
          max: [width / 2, height / 2, depth / 2],
        },
      }),
      orc_render_mesh: (_positions, _normals, _colors, _indices, options) => ({
        rgba: Uint8Array.from({ length: options.width * options.height * 4 }, () => 0),
        width: options.width,
        height: options.height,
        covered_pixels: 12,
        shadowed_pixels: 3,
      }),
    };
    const backend = loadCreationBackend({ nativeModule: fakeNative });
    expect(backend.kind).toBe("native");
    expect(backend.renderKind).toBe("native");
    const native = backend.bakeBox(2, 2, 2);
    const cpu = cpuCreationBackend().bakeBox(2, 2, 2);
    expect(native.vertexCount).toBe(cpu.vertexCount);
    expect(native.triangleCount).toBe(cpu.triangleCount);
    expect(native.bounds).toEqual(cpu.bounds);
  });

  it("loads the compiled native addon (when built) and matches the CPU reference", () => {
    const addon = loadNativeAddon();
    if (!addon) {
      expect(addon).toBeUndefined();
      return;
    }
    expect(addon.orc_version()).toBe("0.1.0");
    const backend = loadCreationBackend({ autoNative: true });
    expect(backend.kind).toBe("native");
    const native = backend.bakeBox(2, 2, 2);
    const cpu = cpuCreationBackend().bakeBox(2, 2, 2);
    expect(native.vertexCount).toBe(cpu.vertexCount);
    expect(native.triangleCount).toBe(cpu.triangleCount);
    expect(native.bounds).toEqual(cpu.bounds);
  });

  it("instantiates and runs the WASM proof-of-concept module", async () => {
    const wasm = await instantiateCreationWasm();
    expect(wasm.box_vertex_count()).toBe(24);

    const backend = await loadWasmBackend();
    expect(backend?.kind).toBe("wasm");
    const stats = backend?.bakeBox(2, 2, 2);
    const cpu = cpuCreationBackend().bakeBox(2, 2, 2);
    expect(stats?.vertexCount).toBe(cpu.vertexCount);
    expect(stats?.bounds).toEqual(cpu.bounds);
  });

  it("honors preferCpu even when a native module is injected", () => {
    const backend = loadCreationBackend({
      preferCpu: true,
      nativeModule: {
        orc_version: () => "x",
        orc_bake_box: () => ({ vertex_count: 0, triangle_count: 0, bounds: { min: [0, 0, 0], max: [0, 0, 0] } }),
      },
    });
    expect(backend.kind).toBe("cpu");
  });

  it("renders meshes through the CPU fallback ray tracer", () => {
    const backend = cpuCreationBackend();
    const image = backend.renderMesh(buildBox({ width: 1, height: 1, depth: 1 }), {
      width: 32,
      height: 32,
      camera: {
        position: { x: 2.5, y: 2, z: 3.5 },
        target: { x: 0, y: 0, z: 0 },
        fov: 45,
      },
      background: "#0f172a",
    });
    expect(image.width).toBe(32);
    expect(image.coveredPixels).toBeGreaterThan(0);
  });
});
