import type { Vec3 } from "../schema/common";
import {
  createMeshBuilder,
  finalizeMesh,
  pushTriangle,
  pushVertex,
  recomputeNormals,
  type Mesh,
} from "../geometry";
import type { Sdf } from "./sdf";

export interface SdfBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

const CUBE_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

const TETRAHEDRA: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];

function interp(pa: Vec3, va: number, pb: Vec3, vb: number): Vec3 {
  const denom = va - vb;
  const t = Math.abs(denom) < 1e-12 ? 0.5 : va / denom;
  return {
    x: pa.x + (pb.x - pa.x) * t,
    y: pa.y + (pb.y - pa.y) * t,
    z: pa.z + (pb.z - pa.z) * t,
  };
}

export function marchingTetrahedra(sdf: Sdf, bounds: SdfBounds, resolution: number): Mesh {
  const res = Math.max(2, Math.floor(resolution));
  const sizeX = (bounds.max.x - bounds.min.x) / res;
  const sizeY = (bounds.max.y - bounds.min.y) / res;
  const sizeZ = (bounds.max.z - bounds.min.z) / res;
  const builder = createMeshBuilder();

  const emit = (point: Vec3): number => pushVertex(builder, [point.x, point.y, point.z], [0, 1, 0], [0, 0]);

  const cornerPosition = (
    cx: number,
    cy: number,
    cz: number,
    corner: readonly [number, number, number],
  ): Vec3 => ({
    x: bounds.min.x + (cx + corner[0]) * sizeX,
    y: bounds.min.y + (cy + corner[1]) * sizeY,
    z: bounds.min.z + (cz + corner[2]) * sizeZ,
  });

  for (let cz = 0; cz < res; cz += 1) {
    for (let cy = 0; cy < res; cy += 1) {
      for (let cx = 0; cx < res; cx += 1) {
        const positions: Vec3[] = CUBE_CORNERS.map((corner) => cornerPosition(cx, cy, cz, corner));
        const values = positions.map((position) => sdf(position));

        for (const tet of TETRAHEDRA) {
          const tp = tet.map((index) => positions[index]!);
          const tv = tet.map((index) => values[index]!);
          const inside = tv.map((value) => value < 0);
          const insideCount = inside.filter(Boolean).length;
          if (insideCount === 0 || insideCount === 4) continue;

          const edge = (i: number, j: number): Vec3 => interp(tp[i]!, tv[i]!, tp[j]!, tv[j]!);

          if (insideCount === 1 || insideCount === 3) {
            const solo = inside.findIndex((value) => (insideCount === 1 ? value : !value));
            const others = [0, 1, 2, 3].filter((index) => index !== solo);
            const a = emit(edge(solo, others[0]!));
            const b = emit(edge(solo, others[1]!));
            const c = emit(edge(solo, others[2]!));
            if (insideCount === 1) pushTriangle(builder, a, b, c);
            else pushTriangle(builder, a, c, b);
          } else {
            const insideIndices = [0, 1, 2, 3].filter((index) => inside[index]);
            const outsideIndices = [0, 1, 2, 3].filter((index) => !inside[index]);
            const [a, b] = insideIndices as [number, number];
            const [c, d] = outsideIndices as [number, number];
            const p0 = emit(edge(a, c));
            const p1 = emit(edge(a, d));
            const p2 = emit(edge(b, d));
            const p3 = emit(edge(b, c));
            pushTriangle(builder, p0, p1, p2);
            pushTriangle(builder, p0, p2, p3);
          }
        }
      }
    }
  }

  return recomputeNormals(finalizeMesh(builder));
}
