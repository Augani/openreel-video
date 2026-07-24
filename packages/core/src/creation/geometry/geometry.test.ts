import { describe, it, expect } from "vitest";
import { IDENTITY_TRANSFORM } from "../schema/common";
import type { CreationAssetRecipe, CreationScene } from "../schema/types";
import {
  bakeCreationAsset,
  bakeCreationSceneMesh,
  bakeRecipeMesh,
  buildBox,
  buildCylinder,
  buildIcosahedron,
  buildPlane,
  buildRoundedBox,
  buildSphere,
  buildTube,
  computeMeshStats,
  displaceMesh,
  extrudeProfile,
  generateBoxUvs,
  isMeshValid,
  mergeMeshes,
  meshToGlb,
  meshToGltf,
  optimizeMesh,
  recomputeNormals,
  revolveProfile,
  sliceMeshByPlane,
  subdivideMesh,
  sweepProfileAlongPath,
  transformMesh,
  weldVertices,
} from "./index";

function makeAsset(
  kind: string,
  geometry: Record<string, number> = {},
): CreationAssetRecipe {
  return {
    id: "asset-test",
    name: "Test asset",
    kind: "prop",
    seed: "asset-test-seed",
    parameters: { motionObjectKind: kind },
    nodes: [
      {
        id: "node-primitive",
        type: "primitive",
        name: "Primitive",
        inputs: [],
        parameters: { kind, ...geometry },
      },
    ],
    materials: [
      { id: "mat-test", name: "Mat", model: "pbr", baseColor: "#3b82f6" },
    ],
    dependencies: [],
    caches: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

describe("geometry kernel primitives", () => {
  it("builds a box with 24 vertices, 12 triangles, and correct bounds", () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const stats = computeMeshStats(mesh);
    expect(stats.vertexCount).toBe(24);
    expect(stats.triangleCount).toBe(12);
    expect(stats.bounds.min).toEqual({ x: -1, y: -1, z: -1 });
    expect(stats.bounds.max).toEqual({ x: 1, y: 1, z: 1 });
    expect(isMeshValid(mesh)).toBe(true);
  });

  it("builds a flat plane on the XZ plane", () => {
    const mesh = buildPlane({ width: 4, depth: 2 });
    const stats = computeMeshStats(mesh);
    expect(stats.vertexCount).toBe(4);
    expect(stats.triangleCount).toBe(2);
    expect(stats.bounds.min.y).toBe(0);
    expect(stats.bounds.max.y).toBe(0);
    expect(stats.bounds.max.x).toBe(2);
    expect(isMeshValid(mesh)).toBe(true);
  });

  it("builds a sphere whose vertices lie on the radius", () => {
    const radius = 1.5;
    const mesh = buildSphere({ radius, widthSegments: 16, heightSegments: 12 });
    expect(computeMeshStats(mesh).vertexCount).toBe(17 * 13);
    for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
      const magnitude = Math.hypot(
        mesh.positions[i]!,
        mesh.positions[i + 1]!,
        mesh.positions[i + 2]!,
      );
      expect(magnitude).toBeCloseTo(radius, 4);
    }
    expect(isMeshValid(mesh)).toBe(true);
  });

  it("builds a beveled rounded box with chamfered edges and corners", () => {
    const mesh = buildRoundedBox({ width: 2, height: 2, depth: 2, radius: 0.2 });
    const stats = computeMeshStats(mesh);
    expect(stats.vertexCount).toBe(96);
    expect(stats.triangleCount).toBe(44);
    expect(stats.bounds.min).toEqual({ x: -1, y: -1, z: -1 });
    expect(stats.bounds.max).toEqual({ x: 1, y: 1, z: 1 });
    expect(isMeshValid(mesh)).toBe(true);
  });

  it("builds a watertight icosahedron", () => {
    const mesh = buildIcosahedron(1);
    const stats = computeMeshStats(mesh);
    expect(stats.triangleCount).toBe(20);
    expect(isMeshValid(mesh)).toBe(true);
  });

  it("builds a cylinder with valid caps and bounds", () => {
    const mesh = buildCylinder({ radiusTop: 0.5, radiusBottom: 0.5, height: 2, radialSegments: 12 });
    const stats = computeMeshStats(mesh);
    expect(stats.bounds.min.y).toBeCloseTo(-1, 5);
    expect(stats.bounds.max.y).toBeCloseTo(1, 5);
    expect(isMeshValid(mesh)).toBe(true);
  });
});

describe("geometry kernel bake", () => {
  it("bakes a box recipe into a ready preview-mesh cache with stats", () => {
    const baked = bakeCreationAsset(makeAsset("box", { size: 2 }), { now: 1000 });
    expect(baked.stats.vertexCount).toBe(24);
    expect(baked.placeholder).toBe(false);
    const cache = baked.asset.caches.find((candidate) => candidate.kind === "preview-mesh");
    expect(cache?.status).toBe("ready");
    expect(cache?.generatedAt).toBe(1000);
    expect(cache?.bounds?.max).toEqual({ x: 1, y: 1, z: 1 });
    expect(baked.asset.parameters.bakedMesh).toMatchObject({
      kind: "box",
      vertexCount: 24,
      triangleCount: 12,
      placeholder: false,
    });
  });

  it("marks unsupported kinds (model/text3d) as a dirty placeholder cache", () => {
    const baked = bakeCreationAsset(makeAsset("model"), { now: 2000 });
    expect(baked.placeholder).toBe(true);
    const cache = baked.asset.caches.find((candidate) => candidate.kind === "preview-mesh");
    expect(cache?.status).toBe("dirty");
    expect(cache?.error).toContain("model");
  });

  it("produces a higher-resolution mesh for final quality", () => {
    const preview = bakeRecipeMesh(makeAsset("sphere", { size: 2 }), { quality: "preview" });
    const final = bakeRecipeMesh(makeAsset("sphere", { size: 2 }), { quality: "final" });
    expect(final.stats.vertexCount).toBeGreaterThan(preview.stats.vertexCount);
  });

  it("bakes an extruded profile recipe node", () => {
    const asset: CreationAssetRecipe = {
      id: "asset-profile",
      name: "Profile",
      kind: "prop",
      seed: "profile-seed",
      parameters: {},
      nodes: [
        {
          id: "node-profile",
          type: "primitive",
          name: "Profile",
          inputs: [],
          parameters: {
            kind: "extrude",
            extrudeDepth: 1,
            profile: [
              { x: -1, y: -1 },
              { x: 1, y: -1 },
              { x: 1, y: 1 },
              { x: -1, y: 1 },
            ],
          },
        },
      ],
      materials: [{ id: "mat", name: "Mat", model: "pbr", baseColor: "#fff" }],
      dependencies: [],
      caches: [],
      createdAt: 0,
      modifiedAt: 0,
    };
    const baked = bakeRecipeMesh(asset);
    expect(baked.kind).toBe("extrude");
    expect(baked.placeholder).toBe(false);
    expect(baked.stats.vertexCount).toBe(24);
  });
});

describe("geometry kernel transform and merge", () => {
  it("applies scale and translation to a mesh", () => {
    const mesh = transformMesh(buildBox({ width: 1, height: 1, depth: 1 }), {
      position: { x: 5, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });
    const stats = computeMeshStats(mesh);
    expect(stats.bounds.min).toEqual({ x: 4, y: -1, z: -1 });
    expect(stats.bounds.max).toEqual({ x: 6, y: 1, z: 1 });
  });

  it("rotates a mesh 90 degrees about Y", () => {
    const mesh = transformMesh(buildBox({ width: 2, height: 1, depth: 0.5 }), {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    const stats = computeMeshStats(mesh);
    expect(stats.bounds.max.x).toBeCloseTo(0.25, 5);
    expect(stats.bounds.max.z).toBeCloseTo(1, 5);
  });

  it("merges meshes and offsets indices", () => {
    const a = buildBox({ width: 1, height: 1, depth: 1 });
    const b = buildBox({ width: 1, height: 1, depth: 1 });
    const merged = mergeMeshes([a, b]);
    const stats = computeMeshStats(merged);
    expect(stats.vertexCount).toBe(48);
    expect(stats.triangleCount).toBe(24);
    expect(isMeshValid(merged)).toBe(true);
  });
});

describe("geometry kernel scene bake", () => {
  function sceneAsset(
    id: string,
    kind: string,
    size: number,
    baseColor = "#ffffff",
  ): CreationAssetRecipe {
    return {
      id,
      name: id,
      kind: "prop",
      seed: `${id}-seed`,
      parameters: {},
      nodes: [
        {
          id: `${id}-node`,
          type: "primitive",
          name: "Primitive",
          inputs: [],
          parameters: { kind, size },
        },
      ],
      materials: [{ id: `${id}-mat`, name: "Mat", model: "pbr", baseColor }],
      dependencies: [],
      caches: [],
      createdAt: 0,
      modifiedAt: 0,
    };
  }

  it("bakes a whole scene into one merged mesh with per-object stats", () => {
    const assets = [
      sceneAsset("asset-a", "box", 1, "#ff0000"),
      sceneAsset("asset-b", "box", 1, "#00ff00"),
    ];
    const scene: CreationScene = {
      id: "scene",
      name: "Scene",
      duration: 4,
      frameRate: 30,
      objects: [
        {
          id: "obj-a",
          name: "A",
          assetId: "asset-a",
          transform: { ...IDENTITY_TRANSFORM, position: { x: -2, y: 0, z: 0 } },
          visible: true,
          selectable: true,
          tags: [],
        },
        {
          id: "obj-b",
          name: "B",
          assetId: "asset-b",
          transform: { ...IDENTITY_TRANSFORM, position: { x: 2, y: 0, z: 0 } },
          visible: true,
          selectable: true,
          tags: [],
        },
        {
          id: "obj-missing",
          name: "Missing",
          assetId: "asset-none",
          transform: IDENTITY_TRANSFORM,
          visible: true,
          selectable: true,
          tags: [],
        },
      ],
      cameras: [],
      lights: [],
      animations: [],
      environment: { kind: "studio" },
      renderBindings: [],
      createdAt: 0,
      modifiedAt: 0,
    };
    const result = bakeCreationSceneMesh(scene, assets);
    expect(result.objects).toHaveLength(2);
    expect(result.missingAssetObjectIds).toEqual(["obj-missing"]);
    expect(result.stats.vertexCount).toBe(48);
    expect(result.stats.bounds.min.x).toBeCloseTo(-2.5, 5);
    expect(result.stats.bounds.max.x).toBeCloseTo(2.5, 5);
    expect(result.mesh.colors?.length).toBe(result.mesh.positions.length);
    expect(result.mesh.colors?.[0]).toBeCloseTo(1, 5);
    expect(result.mesh.colors?.[1]).toBeCloseTo(0, 5);
    expect(result.mesh.colors?.[24 * 3]).toBeCloseTo(0, 5);
    expect(result.mesh.colors?.[24 * 3 + 1]).toBeCloseTo(1, 5);
    expect(isMeshValid(result.mesh)).toBe(true);
  });
});

describe("geometry kernel optimize", () => {
  it("welds a box to 8 vertices with smooth normals", () => {
    const result = optimizeMesh(buildBox({ width: 2, height: 2, depth: 2 }), {
      smoothNormals: true,
    });
    expect(result.beforeVertexCount).toBe(24);
    expect(result.afterVertexCount).toBe(8);
    expect(isMeshValid(result.mesh)).toBe(true);
    for (let i = 0; i + 2 < result.mesh.normals.length; i += 3) {
      const magnitude = Math.hypot(
        result.mesh.normals[i]!,
        result.mesh.normals[i + 1]!,
        result.mesh.normals[i + 2]!,
      );
      expect(magnitude).toBeCloseTo(1, 4);
    }
  });

  it("preserves hard edges when welding losslessly", () => {
    const welded = weldVertices(buildBox({ width: 1, height: 1, depth: 1 }));
    expect(welded.positions.length / 3).toBe(24);
    expect(isMeshValid(welded)).toBe(true);
  });

  it("recomputes unit-length vertex normals", () => {
    const mesh = recomputeNormals(buildBox({ width: 1, height: 1, depth: 1 }));
    for (let i = 0; i + 2 < mesh.normals.length; i += 3) {
      const magnitude = Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!);
      expect(magnitude).toBeCloseTo(1, 4);
    }
  });
});

describe("geometry kernel profiles", () => {
  it("extrudes a square profile into a closed solid", () => {
    const mesh = extrudeProfile({
      profile: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
      depth: 1,
    });
    const stats = computeMeshStats(mesh);
    expect(stats.vertexCount).toBe(24);
    expect(stats.triangleCount).toBe(12);
    expect(stats.bounds.min).toEqual({ x: -1, y: -1, z: -0.5 });
    expect(stats.bounds.max).toEqual({ x: 1, y: 1, z: 0.5 });
    expect(isMeshValid(mesh)).toBe(true);
  });

  it("revolves a profile around the Y axis", () => {
    const mesh = revolveProfile({
      profile: [
        { x: 1, y: -1 },
        { x: 1, y: 1 },
      ],
      segments: 12,
      arcDegrees: 360,
    });
    const stats = computeMeshStats(mesh);
    expect(stats.vertexCount).toBe(24);
    expect(stats.bounds.max.x).toBeCloseTo(1, 5);
    expect(stats.bounds.min.y).toBeCloseTo(-1, 5);
    expect(isMeshValid(mesh)).toBe(true);
  });
});

describe("geometry kernel UV generation", () => {
  it("assigns triplanar box UVs within the unit range", () => {
    const mesh = generateBoxUvs(buildBox({ width: 2, height: 2, depth: 2 }), {});
    expect(mesh.uvs.length).toBe((mesh.positions.length / 3) * 2);
    for (let i = 0; i < mesh.uvs.length; i += 1) {
      const value = mesh.uvs[i]!;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("geometry kernel subdivision", () => {
  it("quadruples triangle count per subdivision iteration", () => {
    const box = buildBox({ width: 1, height: 1, depth: 1 });
    const baseTriangles = computeMeshStats(box).triangleCount;
    const once = subdivideMesh(box, 1);
    const twice = subdivideMesh(box, 2);
    expect(computeMeshStats(once).triangleCount).toBe(baseTriangles * 4);
    expect(computeMeshStats(twice).triangleCount).toBe(baseTriangles * 16);
    expect(isMeshValid(once)).toBe(true);
    expect(isMeshValid(twice)).toBe(true);
  });
});

describe("geometry kernel displacement + node composition", () => {
  const minExtent = (stats: ReturnType<typeof computeMeshStats>): number =>
    Math.min(
      stats.bounds.max.x - stats.bounds.min.x,
      stats.bounds.max.y - stats.bounds.min.y,
      stats.bounds.max.z - stats.bounds.min.z,
    );

  it("displaceMesh pushes a flat plane into 3D relief along its normals", () => {
    const plane = subdivideMesh(buildPlane({ width: 2, depth: 2 }), 3);
    expect(minExtent(computeMeshStats(plane))).toBeLessThan(1e-6);
    const displaced = displaceMesh(plane, {
      pattern: "fbm",
      amplitude: 0.4,
      scale: 3,
      seed: 7,
    });
    expect(minExtent(computeMeshStats(displaced))).toBeGreaterThan(0.05);
    expect(isMeshValid(displaced)).toBe(true);
    expect(displaced.positions.length).toBe(plane.positions.length);
  });

  it("bakeRecipeMesh composes a deform node into real displaced geometry", () => {
    const asset: CreationAssetRecipe = {
      id: "asset-terrain",
      name: "Terrain",
      kind: "environment",
      seed: "terrain-seed",
      parameters: { motionObjectKind: "plane" },
      nodes: [
        {
          id: "n-prim",
          type: "primitive",
          name: "Plane",
          inputs: [],
          parameters: { kind: "plane", size: 4 },
        },
        {
          id: "n-deform",
          type: "deform",
          name: "Terrain",
          inputs: [],
          parameters: {
            pattern: "fbm",
            amplitude: 0.6,
            scale: 5,
            seed: 3,
            subdivisions: 4,
          },
        },
      ],
      materials: [],
      dependencies: [],
      caches: [],
      createdAt: 0,
      modifiedAt: 0,
    };
    const flat = bakeRecipeMesh({ ...asset, nodes: [asset.nodes[0]] });
    const terrain = bakeRecipeMesh(asset);
    expect(terrain.stats.vertexCount).toBeGreaterThan(flat.stats.vertexCount);
    expect(terrain.placeholder).toBe(false);
    expect(isMeshValid(terrain.mesh)).toBe(true);
    expect(minExtent(flat.stats)).toBeLessThan(1e-6);
    expect(minExtent(terrain.stats)).toBeGreaterThan(0.05);
  });

  it("bounds deform subdivision by a triangle budget so dense base meshes do not explode", () => {
    const asset: CreationAssetRecipe = {
      id: "asset-dense",
      name: "Dense",
      kind: "environment",
      seed: "dense-seed",
      parameters: { motionObjectKind: "sphere" },
      nodes: [
        {
          id: "n-prim",
          type: "primitive",
          name: "Sphere",
          inputs: [],
          parameters: { kind: "sphere", size: 2 },
        },
        {
          id: "n-deform",
          type: "deform",
          name: "Bumps",
          inputs: [],
          parameters: { kind: "terrain", amplitude: 0.2 },
        },
      ],
      materials: [],
      dependencies: [],
      caches: [],
      createdAt: 0,
      modifiedAt: 0,
    };
    const base = bakeRecipeMesh({ ...asset, nodes: [asset.nodes[0]] }, { quality: "final" });
    const baked = bakeRecipeMesh(asset, { quality: "final" });
    expect(base.stats.triangleCount).toBeGreaterThan(1500);
    expect(baked.placeholder).toBe(false);
    expect(isMeshValid(baked.mesh)).toBe(true);
    expect(baked.stats.triangleCount).toBe(base.stats.triangleCount);
    expect(baked.stats.triangleCount).toBeLessThan(base.stats.triangleCount * 16);
  });

  it("adaptively subdivides a sparse base for relief without an explicit subdivision count", () => {
    const asset: CreationAssetRecipe = {
      id: "asset-sparse",
      name: "Sparse",
      kind: "environment",
      seed: "sparse-seed",
      parameters: { motionObjectKind: "plane" },
      nodes: [
        {
          id: "n-prim",
          type: "primitive",
          name: "Plane",
          inputs: [],
          parameters: { kind: "plane", size: 4 },
        },
        {
          id: "n-deform",
          type: "deform",
          name: "Terrain",
          inputs: [],
          parameters: { kind: "terrain", amplitude: 0.5 },
        },
      ],
      materials: [],
      dependencies: [],
      caches: [],
      createdAt: 0,
      modifiedAt: 0,
    };
    const baked = bakeRecipeMesh(asset);
    expect(baked.placeholder).toBe(false);
    expect(isMeshValid(baked.mesh)).toBe(true);
    expect(baked.stats.triangleCount).toBeGreaterThan(100);
    expect(baked.stats.triangleCount).toBeLessThanOrEqual(6000);
    expect(minExtent(baked.stats)).toBeGreaterThan(0.02);
  });
});

describe("geometry kernel sweep", () => {
  it("builds a tube along a straight path", () => {
    const mesh = buildTube({
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      radius: 0.5,
      radialSegments: 8,
    });
    const stats = computeMeshStats(mesh);
    expect(stats.vertexCount).toBe(3 * 9);
    expect(stats.triangleCount).toBe(2 * 8 * 2);
    expect(stats.bounds.max.y).toBeCloseTo(4, 5);
    expect(isMeshValid(mesh)).toBe(true);
  });

  it("sweeps a closed profile along a path", () => {
    const mesh = sweepProfileAlongPath({
      profile: [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: 0.5, y: 0.5 },
        { x: -0.5, y: 0.5 },
      ],
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 3 },
      ],
      closedProfile: true,
    });
    expect(isMeshValid(mesh)).toBe(true);
    expect(computeMeshStats(mesh).triangleCount).toBe(1 * 4 * 2);
  });
});

describe("geometry kernel plane slice", () => {
  it("clips a box to the positive half-space", () => {
    const sliced = sliceMeshByPlane(buildBox({ width: 2, height: 2, depth: 2 }), {
      normal: { x: 0, y: 1, z: 0 },
      offset: 0,
    });
    expect(isMeshValid(sliced)).toBe(true);
    const stats = computeMeshStats(sliced);
    expect(stats.bounds.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(stats.bounds.max.y).toBeCloseTo(1, 5);
  });

  it("drops geometry fully outside the plane", () => {
    const sliced = sliceMeshByPlane(buildBox({ width: 2, height: 2, depth: 2 }), {
      normal: { x: 0, y: 1, z: 0 },
      offset: 5,
    });
    expect(sliced.positions.length).toBe(0);
  });
});

describe("geometry kernel GLB export", () => {
  it("packs a valid binary glTF container", () => {
    const glb = meshToGlb(buildBox({ width: 1, height: 1, depth: 1 }), { name: "Cube" });
    expect(glb).toBeInstanceOf(Uint8Array);
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
    const jsonLength = view.getUint32(12, true);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);
    const jsonBytes = glb.subarray(20, 20 + jsonLength);
    const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as {
      buffers: Array<{ byteLength: number; uri?: string }>;
    };
    expect(json.buffers[0]?.uri).toBeUndefined();
    expect(json.buffers[0]?.byteLength).toBeGreaterThan(0);
  });
});

describe("geometry kernel glTF export", () => {
  it("exports a valid, serializable glTF 2.0 document", () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const gltf = meshToGltf(mesh, { name: "Cube", baseColor: "#3b82f6" });
    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.accessors).toHaveLength(4);
    expect(gltf.bufferViews).toHaveLength(4);
    expect(gltf.buffers[0]?.uri.startsWith("data:application/octet-stream;base64,")).toBe(true);
    const positionAccessor = gltf.accessors[0] as { min: number[]; max: number[]; count: number };
    expect(positionAccessor.count).toBe(24);
    expect(positionAccessor.min).toEqual([-0.5, -0.5, -0.5]);
    expect(positionAccessor.max).toEqual([0.5, 0.5, 0.5]);
    expect(() => JSON.parse(JSON.stringify(gltf))).not.toThrow();
  });
});

describe("geometry kernel SDF / boolean bake", () => {
  function sdfAsset(nodes: CreationAssetRecipe["nodes"]): CreationAssetRecipe {
    return {
      id: "asset-sdf",
      name: "Carved",
      kind: "prop",
      seed: "sdf-seed",
      parameters: {},
      nodes,
      materials: [],
      dependencies: [],
      caches: [],
      createdAt: 0,
      modifiedAt: 0,
    };
  }

  it("bakes an asset whose geometry is a boolean subtract into a real carved mesh", () => {
    const asset = sdfAsset([
      { id: "body", type: "sdf", name: "Body", inputs: [], parameters: { shape: "box", half: { x: 1, y: 1, z: 1 } } },
      { id: "hole", type: "sdf", name: "Hole", inputs: [], parameters: { shape: "sphere", radius: 0.6 } },
      { id: "cut", type: "boolean", name: "Cut", inputs: ["body", "hole"], parameters: { operation: "subtract" } },
    ]);
    const baked = bakeRecipeMesh(asset);
    expect(baked.placeholder).toBe(false);
    expect(baked.kind).toBe("sdf");
    expect(isMeshValid(baked.mesh)).toBe(true);
    expect(baked.stats.triangleCount).toBeGreaterThan(0);
    const extentX = baked.stats.bounds.max.x - baked.stats.bounds.min.x;
    expect(extentX).toBeLessThanOrEqual(2.05);
    expect(extentX).toBeGreaterThan(1.5);
    expect(baked.stats.vertexCount).toBeLessThan(baked.stats.triangleCount * 2);
  });

  it("falls back to the primitive when a subtract fully encloses the body (no empty mesh)", () => {
    const asset = sdfAsset([
      { id: "body", type: "sdf", name: "Body", inputs: [], parameters: { shape: "box", half: { x: 0.5, y: 0.5, z: 0.5 } } },
      { id: "hole", type: "sdf", name: "Hole", inputs: [], parameters: { shape: "sphere", radius: 5 } },
      { id: "cut", type: "boolean", name: "Cut", inputs: ["body", "hole"], parameters: { operation: "subtract" } },
    ]);
    const baked = bakeRecipeMesh(asset);
    expect(baked.placeholder).toBe(false);
    expect(baked.stats.triangleCount).toBeGreaterThan(0);
    expect(isMeshValid(baked.mesh)).toBe(true);
  });

  it("bakes a smooth-union metaball blob spanning both operands", () => {
    const asset = sdfAsset([
      { id: "a", type: "sdf", name: "A", inputs: [], parameters: { shape: "sphere", radius: 0.6, offset: { x: -0.6, y: 0, z: 0 } } },
      { id: "b", type: "sdf", name: "B", inputs: [], parameters: { shape: "sphere", radius: 0.6, offset: { x: 0.6, y: 0, z: 0 } } },
      { id: "blob", type: "boolean", name: "Blob", inputs: ["a", "b"], parameters: { operation: "smooth-union", smoothing: 0.3 } },
    ]);
    const baked = bakeRecipeMesh(asset);
    expect(baked.placeholder).toBe(false);
    expect(isMeshValid(baked.mesh)).toBe(true);
    expect(baked.stats.bounds.min.x).toBeLessThan(-1);
    expect(baked.stats.bounds.max.x).toBeGreaterThan(1);
  });
});

describe("geometry kernel array modifier", () => {
  function arrayAsset(arrayParams: Record<string, number>): CreationAssetRecipe {
    return {
      id: "asset-array",
      name: "Array",
      kind: "prop",
      seed: "array-seed",
      parameters: { motionObjectKind: "box" },
      nodes: [
        { id: "prim", type: "primitive", name: "Box", inputs: [], parameters: { kind: "box", size: 1 } },
        { id: "arr", type: "array", name: "Array", inputs: ["prim"], parameters: arrayParams },
      ],
      materials: [],
      dependencies: [],
      caches: [],
      createdAt: 0,
      modifiedAt: 0,
    };
  }

  it("repeats the base mesh into an offset row of copies", () => {
    const base = bakeRecipeMesh({
      ...arrayAsset({ count: 1 }),
      nodes: [
        { id: "prim", type: "primitive", name: "Box", inputs: [], parameters: { kind: "box", size: 1 } },
      ],
    });
    const arrayed = bakeRecipeMesh(arrayAsset({ count: 4, offsetX: 1.5 }));
    expect(arrayed.stats.vertexCount).toBe(base.stats.vertexCount * 4);
    expect(isMeshValid(arrayed.mesh)).toBe(true);
    const baseWidth = base.stats.bounds.max.x - base.stats.bounds.min.x;
    const arrayedWidth = arrayed.stats.bounds.max.x - arrayed.stats.bounds.min.x;
    expect(arrayedWidth).toBeCloseTo(baseWidth + 1.5 * 3, 4);
  });

  it("bounds the array by a triangle budget", () => {
    const arrayed = bakeRecipeMesh(arrayAsset({ count: 64, offsetX: 0.2 }));
    expect(arrayed.stats.triangleCount).toBeLessThanOrEqual(12000);
    expect(isMeshValid(arrayed.mesh)).toBe(true);
  });
});
