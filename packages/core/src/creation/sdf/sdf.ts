import type { Vec3 } from "../schema/common";

export type Sdf = (point: Vec3) => number;

export function sphereSdf(radius: number): Sdf {
  const r = Math.max(1e-4, radius);
  return (p) => Math.hypot(p.x, p.y, p.z) - r;
}

export function boxSdf(half: Vec3): Sdf {
  return (p) => {
    const dx = Math.abs(p.x) - half.x;
    const dy = Math.abs(p.y) - half.y;
    const dz = Math.abs(p.z) - half.z;
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
    const inside = Math.min(Math.max(dx, Math.max(dy, dz)), 0);
    return outside + inside;
  };
}

export function translateSdf(sdf: Sdf, offset: Vec3): Sdf {
  return (p) => sdf({ x: p.x - offset.x, y: p.y - offset.y, z: p.z - offset.z });
}

export function unionSdf(a: Sdf, b: Sdf): Sdf {
  return (p) => Math.min(a(p), b(p));
}

export function intersectSdf(a: Sdf, b: Sdf): Sdf {
  return (p) => Math.max(a(p), b(p));
}

export function subtractSdf(a: Sdf, b: Sdf): Sdf {
  return (p) => Math.max(a(p), -b(p));
}

export function smoothUnionSdf(a: Sdf, b: Sdf, smoothing: number): Sdf {
  const k = Math.max(1e-4, smoothing);
  return (p) => {
    const da = a(p);
    const db = b(p);
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (db - da)) / k));
    return db * (1 - h) + da * h - k * h * (1 - h);
  };
}
