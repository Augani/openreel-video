import {
  createMeshBuilder,
  finalizeMesh,
  pushTriangle,
  pushVertex,
  type Mesh,
} from "./mesh";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function subdivideOnce(mesh: Mesh): Mesh {
  const builder = createMeshBuilder();
  const midpointCache = new Map<string, number>();
  const vertexCount = mesh.positions.length / 3;

  const copyVertex = (index: number): number =>
    pushVertex(
      builder,
      [
        mesh.positions[index * 3] ?? 0,
        mesh.positions[index * 3 + 1] ?? 0,
        mesh.positions[index * 3 + 2] ?? 0,
      ],
      [
        mesh.normals[index * 3] ?? 0,
        mesh.normals[index * 3 + 1] ?? 0,
        mesh.normals[index * 3 + 2] ?? 0,
      ],
      [mesh.uvs[index * 2] ?? 0, mesh.uvs[index * 2 + 1] ?? 0],
    );

  const baseIds = new Array<number>(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) {
    baseIds[i] = copyVertex(i);
  }

  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const nx = lerp(mesh.normals[a * 3] ?? 0, mesh.normals[b * 3] ?? 0, 0.5);
    const ny = lerp(mesh.normals[a * 3 + 1] ?? 0, mesh.normals[b * 3 + 1] ?? 0, 0.5);
    const nz = lerp(mesh.normals[a * 3 + 2] ?? 0, mesh.normals[b * 3 + 2] ?? 0, 0.5);
    const len = Math.hypot(nx, ny, nz) || 1;
    const id = pushVertex(
      builder,
      [
        lerp(mesh.positions[a * 3] ?? 0, mesh.positions[b * 3] ?? 0, 0.5),
        lerp(mesh.positions[a * 3 + 1] ?? 0, mesh.positions[b * 3 + 1] ?? 0, 0.5),
        lerp(mesh.positions[a * 3 + 2] ?? 0, mesh.positions[b * 3 + 2] ?? 0, 0.5),
      ],
      [nx / len, ny / len, nz / len],
      [
        lerp(mesh.uvs[a * 2] ?? 0, mesh.uvs[b * 2] ?? 0, 0.5),
        lerp(mesh.uvs[a * 2 + 1] ?? 0, mesh.uvs[b * 2 + 1] ?? 0, 0.5),
      ],
    );
    midpointCache.set(key, id);
    return id;
  };

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] ?? 0;
    const b = mesh.indices[t + 1] ?? 0;
    const c = mesh.indices[t + 2] ?? 0;
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    pushTriangle(builder, baseIds[a]!, ab, ca);
    pushTriangle(builder, ab, baseIds[b]!, bc);
    pushTriangle(builder, ca, bc, baseIds[c]!);
    pushTriangle(builder, ab, bc, ca);
  }

  return finalizeMesh(builder);
}

export function subdivideMesh(mesh: Mesh, iterations = 1): Mesh {
  let result = mesh;
  const count = Math.max(0, Math.min(4, Math.floor(iterations)));
  for (let i = 0; i < count; i += 1) {
    result = subdivideOnce(result);
  }
  return result;
}
