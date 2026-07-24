import { degToRad, type Vec3 } from "../schema/common";

export type Mat4 = readonly number[];

export function identityMat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[row * 4 + col] =
        a[row * 4]! * b[col]! +
        a[row * 4 + 1]! * b[col + 4]! +
        a[row * 4 + 2]! * b[col + 8]! +
        a[row * 4 + 3]! * b[col + 12]!;
    }
  }
  return out;
}

export function composeTRS(translation: Vec3, rotationDegrees: Vec3, scale: Vec3): Mat4 {
  const rx = degToRad(rotationDegrees.x);
  const ry = degToRad(rotationDegrees.y);
  const rz = degToRad(rotationDegrees.z);
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;
  return [
    r00 * scale.x,
    r01 * scale.y,
    r02 * scale.z,
    translation.x,
    r10 * scale.x,
    r11 * scale.y,
    r12 * scale.z,
    translation.y,
    r20 * scale.x,
    r21 * scale.y,
    r22 * scale.z,
    translation.z,
    0,
    0,
    0,
    1,
  ];
}

export function transformPoint(m: Mat4, point: Vec3): Vec3 {
  return {
    x: m[0]! * point.x + m[1]! * point.y + m[2]! * point.z + m[3]!,
    y: m[4]! * point.x + m[5]! * point.y + m[6]! * point.z + m[7]!,
    z: m[8]! * point.x + m[9]! * point.y + m[10]! * point.z + m[11]!,
  };
}

export function transformDirection(m: Mat4, dir: Vec3): Vec3 {
  return {
    x: m[0]! * dir.x + m[1]! * dir.y + m[2]! * dir.z,
    y: m[4]! * dir.x + m[5]! * dir.y + m[6]! * dir.z,
    z: m[8]! * dir.x + m[9]! * dir.y + m[10]! * dir.z,
  };
}

export function invertMat4(m: Mat4): Mat4 {
  const inv = new Array<number>(16);
  inv[0] =
    m[5]! * m[10]! * m[15]! -
    m[5]! * m[11]! * m[14]! -
    m[9]! * m[6]! * m[15]! +
    m[9]! * m[7]! * m[14]! +
    m[13]! * m[6]! * m[11]! -
    m[13]! * m[7]! * m[10]!;
  inv[4] =
    -m[4]! * m[10]! * m[15]! +
    m[4]! * m[11]! * m[14]! +
    m[8]! * m[6]! * m[15]! -
    m[8]! * m[7]! * m[14]! -
    m[12]! * m[6]! * m[11]! +
    m[12]! * m[7]! * m[10]!;
  inv[8] =
    m[4]! * m[9]! * m[15]! -
    m[4]! * m[11]! * m[13]! -
    m[8]! * m[5]! * m[15]! +
    m[8]! * m[7]! * m[13]! +
    m[12]! * m[5]! * m[11]! -
    m[12]! * m[7]! * m[9]!;
  inv[12] =
    -m[4]! * m[9]! * m[14]! +
    m[4]! * m[10]! * m[13]! +
    m[8]! * m[5]! * m[14]! -
    m[8]! * m[6]! * m[13]! -
    m[12]! * m[5]! * m[10]! +
    m[12]! * m[6]! * m[9]!;
  inv[1] =
    -m[1]! * m[10]! * m[15]! +
    m[1]! * m[11]! * m[14]! +
    m[9]! * m[2]! * m[15]! -
    m[9]! * m[3]! * m[14]! -
    m[13]! * m[2]! * m[11]! +
    m[13]! * m[3]! * m[10]!;
  inv[5] =
    m[0]! * m[10]! * m[15]! -
    m[0]! * m[11]! * m[14]! -
    m[8]! * m[2]! * m[15]! +
    m[8]! * m[3]! * m[14]! +
    m[12]! * m[2]! * m[11]! -
    m[12]! * m[3]! * m[10]!;
  inv[9] =
    -m[0]! * m[9]! * m[15]! +
    m[0]! * m[11]! * m[13]! +
    m[8]! * m[1]! * m[15]! -
    m[8]! * m[3]! * m[13]! -
    m[12]! * m[1]! * m[11]! +
    m[12]! * m[3]! * m[9]!;
  inv[13] =
    m[0]! * m[9]! * m[14]! -
    m[0]! * m[10]! * m[13]! -
    m[8]! * m[1]! * m[14]! +
    m[8]! * m[2]! * m[13]! +
    m[12]! * m[1]! * m[10]! -
    m[12]! * m[2]! * m[9]!;
  inv[2] =
    m[1]! * m[6]! * m[15]! -
    m[1]! * m[7]! * m[14]! -
    m[5]! * m[2]! * m[15]! +
    m[5]! * m[3]! * m[14]! +
    m[13]! * m[2]! * m[7]! -
    m[13]! * m[3]! * m[6]!;
  inv[6] =
    -m[0]! * m[6]! * m[15]! +
    m[0]! * m[7]! * m[14]! +
    m[4]! * m[2]! * m[15]! -
    m[4]! * m[3]! * m[14]! -
    m[12]! * m[2]! * m[7]! +
    m[12]! * m[3]! * m[6]!;
  inv[10] =
    m[0]! * m[5]! * m[15]! -
    m[0]! * m[7]! * m[13]! -
    m[4]! * m[1]! * m[15]! +
    m[4]! * m[3]! * m[13]! +
    m[12]! * m[1]! * m[7]! -
    m[12]! * m[3]! * m[5]!;
  inv[14] =
    -m[0]! * m[5]! * m[14]! +
    m[0]! * m[6]! * m[13]! +
    m[4]! * m[1]! * m[14]! -
    m[4]! * m[2]! * m[13]! -
    m[12]! * m[1]! * m[6]! +
    m[12]! * m[2]! * m[5]!;
  inv[3] =
    -m[1]! * m[6]! * m[11]! +
    m[1]! * m[7]! * m[10]! +
    m[5]! * m[2]! * m[11]! -
    m[5]! * m[3]! * m[10]! -
    m[9]! * m[2]! * m[7]! +
    m[9]! * m[3]! * m[6]!;
  inv[7] =
    m[0]! * m[6]! * m[11]! -
    m[0]! * m[7]! * m[10]! -
    m[4]! * m[2]! * m[11]! +
    m[4]! * m[3]! * m[10]! +
    m[8]! * m[2]! * m[7]! -
    m[8]! * m[3]! * m[6]!;
  inv[11] =
    -m[0]! * m[5]! * m[11]! +
    m[0]! * m[7]! * m[9]! +
    m[4]! * m[1]! * m[11]! -
    m[4]! * m[3]! * m[9]! -
    m[8]! * m[1]! * m[7]! +
    m[8]! * m[3]! * m[5]!;
  inv[15] =
    m[0]! * m[5]! * m[10]! -
    m[0]! * m[6]! * m[9]! -
    m[4]! * m[1]! * m[10]! +
    m[4]! * m[2]! * m[9]! +
    m[8]! * m[1]! * m[6]! -
    m[8]! * m[2]! * m[5]!;

  let det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!;
  if (Math.abs(det) < 1e-12) return identityMat4();
  det = 1 / det;
  return inv.map((value) => value * det);
}
