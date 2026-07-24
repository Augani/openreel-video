import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { deserializeProject, serializeProject } from "./serialization";

function projectWithBakedMesh(): Project {
  return {
    id: "p1",
    name: "Mesh Project",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], duration: 0 },
    motionCompositions: [
      {
        id: "comp1",
        layers: [
          {
            id: "layer1",
            type: "scene3d",
            objects: [
              {
                id: "obj1",
                name: "Terrain",
                object: {
                  kind: "plane",
                  size: 2,
                  mesh: {
                    positions: [0, 0, 0, 1, 0, 0, 1, 0, 1],
                    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
                    uvs: [0, 0, 1, 0, 1, 1],
                    indices: [0, 1, 2],
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project;
}

describe("serializeProject baked-mesh round-trip", () => {
  it("preserves the baked mesh so relief survives a reload", () => {
    const roundTripped = deserializeProject(serializeProject(projectWithBakedMesh()));
    const layer = roundTripped.motionCompositions?.[0]?.layers[0] as unknown as {
      objects: Array<{
        object: { kind: string; size: number; mesh?: { positions: number[]; indices: number[] } };
      }>;
    };
    const object = layer.objects[0].object;
    expect(object.kind).toBe("plane");
    expect(object.size).toBe(2);
    expect(object.mesh?.positions.length).toBe(9);
    expect(object.mesh?.indices).toEqual([0, 1, 2]);
  });
});
