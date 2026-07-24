import {
  createMeshBuilder,
  finalizeMesh,
  pushQuad,
  pushTriangle,
  pushVertex,
  type Mesh,
} from "./mesh";

export interface BoxParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface SphereParams {
  readonly radius: number;
  readonly widthSegments: number;
  readonly heightSegments: number;
}

export interface CylinderParams {
  readonly radiusTop: number;
  readonly radiusBottom: number;
  readonly height: number;
  readonly radialSegments: number;
}

export interface PlaneParams {
  readonly width: number;
  readonly depth: number;
}

export interface TorusParams {
  readonly radius: number;
  readonly tube: number;
  readonly radialSegments: number;
  readonly tubularSegments: number;
}

export function buildBox(params: BoxParams): Mesh {
  const hx = Math.max(1e-4, params.width) / 2;
  const hy = Math.max(1e-4, params.height) / 2;
  const hz = Math.max(1e-4, params.depth) / 2;
  const builder = createMeshBuilder();
  const face = (
    corners: ReadonlyArray<readonly [number, number, number]>,
    normal: readonly [number, number, number],
  ): void => {
    const a = pushVertex(builder, corners[0]!, normal, [0, 0]);
    const b = pushVertex(builder, corners[1]!, normal, [1, 0]);
    const c = pushVertex(builder, corners[2]!, normal, [1, 1]);
    const d = pushVertex(builder, corners[3]!, normal, [0, 1]);
    pushQuad(builder, a, b, c, d);
  };
  face(
    [
      [hx, -hy, hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [hx, hy, hz],
    ],
    [1, 0, 0],
  );
  face(
    [
      [-hx, -hy, -hz],
      [-hx, -hy, hz],
      [-hx, hy, hz],
      [-hx, hy, -hz],
    ],
    [-1, 0, 0],
  );
  face(
    [
      [-hx, hy, hz],
      [hx, hy, hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
    ],
    [0, 1, 0],
  );
  face(
    [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, -hy, hz],
      [-hx, -hy, hz],
    ],
    [0, -1, 0],
  );
  face(
    [
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [hx, hy, hz],
      [-hx, hy, hz],
    ],
    [0, 0, 1],
  );
  face(
    [
      [hx, -hy, -hz],
      [-hx, -hy, -hz],
      [-hx, hy, -hz],
      [hx, hy, -hz],
    ],
    [0, 0, -1],
  );
  return finalizeMesh(builder);
}

export interface RoundedBoxParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly radius: number;
}

export function buildRoundedBox(params: RoundedBoxParams): Mesh {
  const half = [
    Math.max(1e-4, params.width) / 2,
    Math.max(1e-4, params.height) / 2,
    Math.max(1e-4, params.depth) / 2,
  ] as const;
  const bevel = Math.max(
    1e-4,
    Math.min(params.radius, half[0] * 0.49, half[1] * 0.49, half[2] * 0.49),
  );
  const builder = createMeshBuilder();

  const insetCorner = (
    faceAxis: number,
    signs: readonly [number, number, number],
  ): [number, number, number] => {
    const point: [number, number, number] = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      point[axis] =
        axis === faceAxis ? signs[axis]! * half[axis]! : signs[axis]! * (half[axis]! - bevel);
    }
    return point;
  };

  const axisNormal = (axis: number, sign: number): [number, number, number] => {
    const normal: [number, number, number] = [0, 0, 0];
    normal[axis] = sign;
    return normal;
  };

  const normalize = (v: [number, number, number]): [number, number, number] => {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  };

  for (let faceAxis = 0; faceAxis < 3; faceAxis += 1) {
    const [t1, t2] = [(faceAxis + 1) % 3, (faceAxis + 2) % 3];
    for (const faceSign of [-1, 1]) {
      const normal = axisNormal(faceAxis, faceSign);
      const corner = (s1: number, s2: number): [number, number, number] => {
        const signs: [number, number, number] = [0, 0, 0];
        signs[faceAxis] = faceSign;
        signs[t1] = s1;
        signs[t2] = s2;
        return insetCorner(faceAxis, signs);
      };
      const a = pushVertex(builder, corner(-1, -1), normal, [0, 0]);
      const b = pushVertex(builder, corner(1, -1), normal, [1, 0]);
      const c = pushVertex(builder, corner(1, 1), normal, [1, 1]);
      const d = pushVertex(builder, corner(-1, 1), normal, [0, 1]);
      if (faceSign > 0) {
        pushTriangle(builder, a, b, c);
        pushTriangle(builder, a, c, d);
      } else {
        pushTriangle(builder, a, c, b);
        pushTriangle(builder, a, d, c);
      }
    }
  }

  for (let edgeAxis = 0; edgeAxis < 3; edgeAxis += 1) {
    const t1 = (edgeAxis + 1) % 3;
    const t2 = (edgeAxis + 2) % 3;
    for (const sT1 of [-1, 1]) {
      for (const sT2 of [-1, 1]) {
        const normal = normalize([
          axisNormal(t1, sT1)[0] + axisNormal(t2, sT2)[0],
          axisNormal(t1, sT1)[1] + axisNormal(t2, sT2)[1],
          axisNormal(t1, sT1)[2] + axisNormal(t2, sT2)[2],
        ]);
        const onFace = (faceAxis: number, edgeSign: number): [number, number, number] => {
          const signs: [number, number, number] = [0, 0, 0];
          signs[edgeAxis] = edgeSign;
          signs[t1] = sT1;
          signs[t2] = sT2;
          return insetCorner(faceAxis, signs);
        };
        const f1a = pushVertex(builder, onFace(t1, -1), normal, [0, 0]);
        const f1b = pushVertex(builder, onFace(t1, 1), normal, [1, 0]);
        const f2b = pushVertex(builder, onFace(t2, 1), normal, [1, 1]);
        const f2a = pushVertex(builder, onFace(t2, -1), normal, [0, 1]);
        pushTriangle(builder, f1a, f1b, f2b);
        pushTriangle(builder, f1a, f2b, f2a);
      }
    }
  }

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const signs: [number, number, number] = [sx, sy, sz];
        const normal = normalize([sx, sy, sz]);
        const cX = pushVertex(builder, insetCorner(0, signs), normal, [0, 0]);
        const cY = pushVertex(builder, insetCorner(1, signs), normal, [1, 0]);
        const cZ = pushVertex(builder, insetCorner(2, signs), normal, [0, 1]);
        pushTriangle(builder, cX, cY, cZ);
      }
    }
  }

  return finalizeMesh(builder);
}

export function buildPlane(params: PlaneParams): Mesh {
  const hx = Math.max(1e-4, params.width) / 2;
  const hz = Math.max(1e-4, params.depth) / 2;
  const builder = createMeshBuilder();
  const normal: readonly [number, number, number] = [0, 1, 0];
  const a = pushVertex(builder, [-hx, 0, hz], normal, [0, 0]);
  const b = pushVertex(builder, [hx, 0, hz], normal, [1, 0]);
  const c = pushVertex(builder, [hx, 0, -hz], normal, [1, 1]);
  const d = pushVertex(builder, [-hx, 0, -hz], normal, [0, 1]);
  pushQuad(builder, a, b, c, d);
  return finalizeMesh(builder);
}

export function buildSphere(params: SphereParams): Mesh {
  const radius = Math.max(1e-4, params.radius);
  const widthSegments = Math.max(3, Math.floor(params.widthSegments));
  const heightSegments = Math.max(2, Math.floor(params.heightSegments));
  const builder = createMeshBuilder();
  const grid: number[][] = [];
  for (let iy = 0; iy <= heightSegments; iy += 1) {
    const row: number[] = [];
    const v = iy / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let ix = 0; ix <= widthSegments; ix += 1) {
      const u = ix / widthSegments;
      const phi = u * Math.PI * 2;
      const nx = -Math.cos(phi) * sinTheta;
      const ny = cosTheta;
      const nz = Math.sin(phi) * sinTheta;
      row.push(
        pushVertex(builder, [nx * radius, ny * radius, nz * radius], [nx, ny, nz], [u, 1 - v]),
      );
    }
    grid.push(row);
  }
  for (let iy = 0; iy < heightSegments; iy += 1) {
    for (let ix = 0; ix < widthSegments; ix += 1) {
      const a = grid[iy]![ix]!;
      const b = grid[iy + 1]![ix]!;
      const c = grid[iy + 1]![ix + 1]!;
      const d = grid[iy]![ix + 1]!;
      if (iy !== 0) pushTriangle(builder, a, b, d);
      if (iy !== heightSegments - 1) pushTriangle(builder, b, c, d);
    }
  }
  return finalizeMesh(builder);
}

export function buildCylinder(params: CylinderParams): Mesh {
  const radiusTop = Math.max(0, params.radiusTop);
  const radiusBottom = Math.max(0, params.radiusBottom);
  const height = Math.max(1e-4, params.height);
  const radialSegments = Math.max(3, Math.floor(params.radialSegments));
  const builder = createMeshBuilder();
  const halfHeight = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  const topRing: number[] = [];
  const bottomRing: number[] = [];
  for (let ix = 0; ix <= radialSegments; ix += 1) {
    const u = ix / radialSegments;
    const phi = u * Math.PI * 2;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const normal: [number, number, number] = [sinPhi, slope, cosPhi];
    const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    const unit: [number, number, number] = [normal[0] / len, normal[1] / len, normal[2] / len];
    topRing.push(
      pushVertex(builder, [sinPhi * radiusTop, halfHeight, cosPhi * radiusTop], unit, [u, 1]),
    );
    bottomRing.push(
      pushVertex(builder, [sinPhi * radiusBottom, -halfHeight, cosPhi * radiusBottom], unit, [u, 0]),
    );
  }
  for (let ix = 0; ix < radialSegments; ix += 1) {
    const a = topRing[ix]!;
    const b = bottomRing[ix]!;
    const c = bottomRing[ix + 1]!;
    const d = topRing[ix + 1]!;
    if (radiusTop > 0) pushTriangle(builder, a, b, d);
    if (radiusBottom > 0) pushTriangle(builder, b, c, d);
  }
  const addCap = (radius: number, y: number, normal: [number, number, number]): void => {
    if (radius <= 0) return;
    const center = pushVertex(builder, [0, y, 0], normal, [0.5, 0.5]);
    const ring: number[] = [];
    for (let ix = 0; ix <= radialSegments; ix += 1) {
      const u = ix / radialSegments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      ring.push(
        pushVertex(builder, [sinPhi * radius, y, cosPhi * radius], normal, [
          (sinPhi + 1) / 2,
          (cosPhi + 1) / 2,
        ]),
      );
    }
    for (let ix = 0; ix < radialSegments; ix += 1) {
      if (normal[1] > 0) pushTriangle(builder, center, ring[ix + 1]!, ring[ix]!);
      else pushTriangle(builder, center, ring[ix]!, ring[ix + 1]!);
    }
  };
  addCap(radiusTop, halfHeight, [0, 1, 0]);
  addCap(radiusBottom, -halfHeight, [0, -1, 0]);
  return finalizeMesh(builder);
}

export function buildCone(radius: number, height: number, radialSegments: number): Mesh {
  return buildCylinder({
    radiusTop: 0,
    radiusBottom: Math.max(1e-4, radius),
    height,
    radialSegments,
  });
}

export function buildTorus(params: TorusParams): Mesh {
  const radius = Math.max(1e-4, params.radius);
  const tube = Math.max(1e-4, params.tube);
  const radialSegments = Math.max(3, Math.floor(params.radialSegments));
  const tubularSegments = Math.max(3, Math.floor(params.tubularSegments));
  const builder = createMeshBuilder();
  const grid: number[][] = [];
  for (let j = 0; j <= radialSegments; j += 1) {
    const row: number[] = [];
    const v = (j / radialSegments) * Math.PI * 2;
    for (let i = 0; i <= tubularSegments; i += 1) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const cx = radius * Math.cos(u);
      const cz = radius * Math.sin(u);
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = tube * Math.sin(v);
      const z = (radius + tube * Math.cos(v)) * Math.sin(u);
      const nx = x - cx;
      const nz = z - cz;
      const len = Math.hypot(nx, y, nz) || 1;
      row.push(
        pushVertex(builder, [x, y, z], [nx / len, y / len, nz / len], [
          i / tubularSegments,
          j / radialSegments,
        ]),
      );
    }
    grid.push(row);
  }
  for (let j = 0; j < radialSegments; j += 1) {
    for (let i = 0; i < tubularSegments; i += 1) {
      const a = grid[j]![i]!;
      const b = grid[j + 1]![i]!;
      const c = grid[j + 1]![i + 1]!;
      const d = grid[j]![i + 1]!;
      pushQuad(builder, a, d, c, b);
    }
  }
  return finalizeMesh(builder);
}

export function buildIcosahedron(radius: number): Mesh {
  const r = Math.max(1e-4, radius);
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: ReadonlyArray<readonly [number, number, number]> = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  const faces: ReadonlyArray<readonly [number, number, number]> = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const builder = createMeshBuilder();
  for (const face of faces) {
    const ids = face.map((vertexIndex) => {
      const raw3 = raw[vertexIndex]!;
      const len = Math.hypot(raw3[0], raw3[1], raw3[2]) || 1;
      const nx = raw3[0] / len;
      const ny = raw3[1] / len;
      const nz = raw3[2] / len;
      return pushVertex(builder, [nx * r, ny * r, nz * r], [nx, ny, nz], [
        0.5 + Math.atan2(nz, nx) / (Math.PI * 2),
        0.5 - Math.asin(ny) / Math.PI,
      ]);
    });
    pushTriangle(builder, ids[0]!, ids[1]!, ids[2]!);
  }
  return finalizeMesh(builder);
}
