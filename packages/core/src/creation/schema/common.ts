export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Transform3D {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

export const ZERO_VEC3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const ONE_VEC3: Vec3 = Object.freeze({ x: 1, y: 1, z: 1 });

export const IDENTITY_TRANSFORM: Transform3D = Object.freeze({
  position: ZERO_VEC3,
  rotation: ZERO_VEC3,
  scale: ONE_VEC3,
});

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function transform3d(
  position: Vec3 = ZERO_VEC3,
  rotation: Vec3 = ZERO_VEC3,
  scale: Vec3 = ONE_VEC3,
): Transform3D {
  return { position, rotation, scale };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function mulVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}

export function lengthVec3(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function distanceVec3(a: Vec3, b: Vec3): number {
  return lengthVec3(subVec3(a, b));
}

export function normalizeVec3(a: Vec3): Vec3 {
  const len = lengthVec3(a);
  if (len < 1e-9) return ZERO_VEC3;
  return scaleVec3(a, 1 / len);
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function emptyBounds(): Bounds3 {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

export function expandBounds(bounds: Bounds3, point: Vec3): Bounds3 {
  return {
    min: {
      x: Math.min(bounds.min.x, point.x),
      y: Math.min(bounds.min.y, point.y),
      z: Math.min(bounds.min.z, point.z),
    },
    max: {
      x: Math.max(bounds.max.x, point.x),
      y: Math.max(bounds.max.y, point.y),
      z: Math.max(bounds.max.z, point.z),
    },
  };
}

export function boundsCenter(bounds: Bounds3): Vec3 {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

export function boundsSize(bounds: Bounds3): Vec3 {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
}

export function isFiniteBounds(bounds: Bounds3): boolean {
  return (
    Number.isFinite(bounds.min.x) &&
    Number.isFinite(bounds.min.y) &&
    Number.isFinite(bounds.min.z) &&
    Number.isFinite(bounds.max.x) &&
    Number.isFinite(bounds.max.y) &&
    Number.isFinite(bounds.max.z)
  );
}

function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DeterministicRng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  sign(): number;
}

export function createRng(seed: string | number): DeterministicRng {
  const numericSeed =
    typeof seed === "number" ? seed >>> 0 : xmur3(seed)();
  const rand = mulberry32(numericSeed);
  return {
    next: () => rand(),
    range: (min, max) => min + rand() * (max - min),
    int: (min, max) => Math.floor(min + rand() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error("createRng.pick: empty array");
      }
      return items[Math.floor(rand() * items.length)] as T;
    },
    sign: () => (rand() < 0.5 ? -1 : 1),
  };
}

let monotonicCounter = 0;

export function creationId(prefix: string): string {
  const crypto = (
    globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  ).crypto;
  if (crypto?.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  monotonicCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${monotonicCounter.toString(36)}`;
}
