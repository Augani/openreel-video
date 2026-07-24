import { describe, it, expect } from "vitest";
import { buildBox, buildPlane, mergeMeshes, transformMesh } from "../geometry";
import { renderMeshToImage, renderMeshToPng } from "./raster";
import { rayTraceMeshToImage } from "./raytrace";
import { CREATION_WGSL, isWebGpuRenderAvailable, renderMeshAuto } from "./webgpu";

const camera = {
  position: { x: 2.5, y: 2, z: 3.5 },
  target: { x: 0, y: 0, z: 0 },
  fov: 45,
};

describe("cpu rasterizer", () => {
  function withVertexColor(mesh: ReturnType<typeof buildBox>, color: readonly [number, number, number]) {
    const vertexCount = mesh.positions.length / 3;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i += 1) {
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];
    }
    return { ...mesh, colors };
  }

  it("renders a non-blank image of a box", () => {
    const image = renderMeshToImage(buildBox({ width: 2, height: 2, depth: 2 }), {
      width: 64,
      height: 64,
      camera,
      baseColor: "#3b82f6",
      background: "#0f172a",
    });
    expect(image.width).toBe(64);
    expect(image.coveredPixels).toBeGreaterThan(0);
    const centerIndex = (32 * 64 + 32) * 4;
    expect(image.rgba[centerIndex + 2]).toBeGreaterThan(image.rgba[centerIndex]!);
  });

  it("uses per-vertex material colors when present", () => {
    const image = renderMeshToImage(
      withVertexColor(buildBox({ width: 2, height: 2, depth: 2 }), [0, 1, 0]),
      {
        width: 64,
        height: 64,
        camera,
        baseColor: "#ef4444",
        background: "#0f172a",
      },
    );
    const centerIndex = (32 * 64 + 32) * 4;
    expect(image.rgba[centerIndex + 1]).toBeGreaterThan(image.rgba[centerIndex]!);
    expect(image.rgba[centerIndex + 1]).toBeGreaterThan(image.rgba[centerIndex + 2]!);
  });

  it("leaves an empty scene as pure background", () => {
    const empty = { positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) };
    const image = renderMeshToImage(empty, {
      width: 16,
      height: 16,
      camera,
      background: "#0f172a",
    });
    expect(image.coveredPixels).toBe(0);
    expect(image.rgba[0]).toBe(0x0f);
    expect(image.rgba[1]).toBe(0x17);
    expect(image.rgba[2]).toBe(0x2a);
  });

  it("encodes a rendered frame to a PNG data URI", () => {
    const png = renderMeshToPng(buildBox({ width: 1, height: 1, depth: 1 }), {
      width: 32,
      height: 32,
      camera,
    });
    expect(png.dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(png.coveredPixels).toBeGreaterThan(0);
  });
});

describe("webgpu renderer", () => {
  it("ships valid WGSL with vertex and fragment entry points", () => {
    expect(CREATION_WGSL).toContain("@vertex");
    expect(CREATION_WGSL).toContain("fn vs_main");
    expect(CREATION_WGSL).toContain("@fragment");
    expect(CREATION_WGSL).toContain("fn fs_main");
  });

  it("reports WebGPU unavailable and falls back to the CPU rasterizer headlessly", async () => {
    expect(isWebGpuRenderAvailable()).toBe(false);
    const result = await renderMeshAuto(buildBox({ width: 2, height: 2, depth: 2 }), {
      width: 48,
      height: 48,
      camera,
      baseColor: "#3b82f6",
    });
    expect(result.backend).toBe("cpu");
    expect(result.coveredPixels).toBeGreaterThan(0);
  });
});

describe("cpu ray tracer", () => {
  const ground = buildPlane({ width: 8, depth: 8 });
  const box = transformMesh(buildBox({ width: 1.2, height: 1.2, depth: 1.2 }), {
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const scene = mergeMeshes([ground, box]);
  const rayCamera = { position: { x: 3.5, y: 4, z: 4 }, target: { x: 0, y: 0.6, z: 0 }, fov: 45 };
  const overheadLight = { direction: { x: 0.15, y: 1, z: 0.1 } };

  it("casts a hard shadow from the box onto the ground", () => {
    const image = rayTraceMeshToImage(scene, {
      width: 64,
      height: 64,
      camera: rayCamera,
      light: overheadLight,
      shadows: true,
    });
    expect(image.coveredPixels).toBeGreaterThan(0);
    expect(image.shadowedPixels).toBeGreaterThan(0);
    expect(image.coveredPixels).toBeGreaterThan(image.shadowedPixels);
  });

  it("produces no shadow pixels when shadows are disabled", () => {
    const image = rayTraceMeshToImage(scene, {
      width: 48,
      height: 48,
      camera: rayCamera,
      light: overheadLight,
      shadows: false,
    });
    expect(image.shadowedPixels).toBe(0);
    expect(image.coveredPixels).toBeGreaterThan(0);
  });

  it("shades ray hits with per-vertex material colors", () => {
    const vertexCount = box.positions.length / 3;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i += 1) {
      colors[i * 3] = 0;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 0;
    }
    const image = rayTraceMeshToImage({ ...box, colors }, {
      width: 48,
      height: 48,
      camera: rayCamera,
      light: overheadLight,
      baseColor: "#ef4444",
      shadows: false,
    });
    const centerIndex = (24 * 48 + 24) * 4;
    expect(image.rgba[centerIndex + 1]).toBeGreaterThan(image.rgba[centerIndex]!);
    expect(image.rgba[centerIndex + 1]).toBeGreaterThan(image.rgba[centerIndex + 2]!);
  });
});
