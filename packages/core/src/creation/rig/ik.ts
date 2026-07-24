import { clamp, type Vec3 } from "../schema/common";

export interface TwoBoneIkInput {
  readonly root: Vec3;
  readonly target: Vec3;
  readonly upperLength: number;
  readonly lowerLength: number;
  readonly poleHint?: Vec3;
}

export interface TwoBoneIkResult {
  readonly elbow: Vec3;
  readonly reachable: boolean;
  readonly distance: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3, fallback: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-9) return fallback;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult {
  const upper = Math.max(1e-4, input.upperLength);
  const lower = Math.max(1e-4, input.lowerLength);
  const toTarget = sub(input.target, input.root);
  const distance = length(toTarget);
  const minReach = Math.abs(upper - lower);
  const maxReach = upper + lower;
  const reachable = distance >= minReach - 1e-6 && distance <= maxReach + 1e-6;
  const clampedDistance = clamp(distance, minReach + 1e-6, maxReach - 1e-6);
  const direction = normalize(toTarget, { x: 0, y: -1, z: 0 });

  const cosAngle = clamp(
    (upper * upper + clampedDistance * clampedDistance - lower * lower) /
      (2 * upper * clampedDistance),
    -1,
    1,
  );
  const sinAngle = Math.sqrt(Math.max(0, 1 - cosAngle * cosAngle));

  const poleHint = input.poleHint ?? { x: 0, y: 0, z: 1 };
  let bend = sub(poleHint, scale(direction, dot(poleHint, direction)));
  if (length(bend) < 1e-6) {
    const alt = Math.abs(direction.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    bend = sub(alt, scale(direction, dot(alt, direction)));
  }
  const bendDir = normalize(bend, { x: 0, y: 1, z: 0 });

  const elbow = add(
    input.root,
    add(scale(direction, upper * cosAngle), scale(bendDir, upper * sinAngle)),
  );
  return { elbow, reachable, distance };
}
