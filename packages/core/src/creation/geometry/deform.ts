import type { Mesh } from "./mesh";
import { recomputeNormals } from "./optimize";
import { subdivideMesh } from "./subdivide";
import { proceduralField } from "../texture/procedural";

export interface DisplaceMeshOptions {
  readonly pattern?: string;
  readonly amplitude?: number;
  readonly scale?: number;
  readonly seed?: number;
  readonly subdivisions?: number;
}

export function displaceMesh(mesh: Mesh, options: DisplaceMeshOptions = {}): Mesh {
  const subdivisions = Math.max(0, Math.min(6, Math.floor(options.subdivisions ?? 0)));
  const working = subdivisions > 0 ? subdivideMesh(mesh, subdivisions) : mesh;
  const pattern = options.pattern ?? "fbm";
  const amplitude = Number.isFinite(options.amplitude) ? (options.amplitude as number) : 0.15;
  const scale = options.scale && options.scale > 0 ? options.scale : 4;
  const seed = Number.isFinite(options.seed) ? (options.seed as number) : 1;

  const positions = Float32Array.from(working.positions);
  const normals = working.normals;
  const uvs = working.uvs;
  const vertexCount = positions.length / 3;
  const hasUvs = uvs.length >= vertexCount * 2;

  for (let i = 0; i < vertexCount; i += 1) {
    const u = hasUvs ? uvs[i * 2] : positions[i * 3];
    const v = hasUvs ? uvs[i * 2 + 1] : positions[i * 3 + 2];
    const field = proceduralField(pattern, u, v, scale, seed);
    const offset = (field - 0.5) * 2 * amplitude;
    positions[i * 3] += normals[i * 3] * offset;
    positions[i * 3 + 1] += normals[i * 3 + 1] * offset;
    positions[i * 3 + 2] += normals[i * 3 + 2] * offset;
  }

  return recomputeNormals({
    positions,
    normals: working.normals,
    uvs: working.uvs,
    indices: working.indices,
    colors: working.colors,
  });
}
