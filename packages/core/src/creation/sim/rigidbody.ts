import type { Vec3 } from "../schema/common";

export interface RigidBody {
  position: Vec3;
  velocity: Vec3;
  readonly radius: number;
  readonly restitution: number;
  readonly mass: number;
  resting: boolean;
}

export interface RigidWorldOptions {
  readonly dt?: number;
  readonly gravity?: number;
  readonly groundY?: number;
  readonly friction?: number;
  readonly collideEachOther?: boolean;
  readonly sleepThreshold?: number;
}

export function makeRigidBody(options: {
  readonly position: Vec3;
  readonly velocity?: Vec3;
  readonly radius?: number;
  readonly restitution?: number;
  readonly mass?: number;
}): RigidBody {
  return {
    position: options.position,
    velocity: options.velocity ?? { x: 0, y: 0, z: 0 },
    radius: Math.max(1e-3, options.radius ?? 0.5),
    restitution: Math.max(0, Math.min(0.99, options.restitution ?? 0.4)),
    mass: Math.max(1e-3, options.mass ?? 1),
    resting: false,
  };
}

function cloneBody(body: RigidBody): RigidBody {
  return {
    position: { ...body.position },
    velocity: { ...body.velocity },
    radius: body.radius,
    restitution: body.restitution,
    mass: body.mass,
    resting: body.resting,
  };
}

function resolvePairCollision(a: RigidBody, b: RigidBody): boolean {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dz = b.position.z - a.position.z;
  const distance = Math.hypot(dx, dy, dz);
  const minDistance = a.radius + b.radius;
  if (distance >= minDistance) return false;
  const coincident = distance < 1e-9;
  const nx = coincident ? 1 : dx / distance;
  const ny = coincident ? 0 : dy / distance;
  const nz = coincident ? 0 : dz / distance;
  const penetration = minDistance - distance;
  const totalMass = a.mass + b.mass;
  const aShare = b.mass / totalMass;
  const bShare = a.mass / totalMass;
  a.position = {
    x: a.position.x - nx * penetration * aShare,
    y: a.position.y - ny * penetration * aShare,
    z: a.position.z - nz * penetration * aShare,
  };
  b.position = {
    x: b.position.x + nx * penetration * bShare,
    y: b.position.y + ny * penetration * bShare,
    z: b.position.z + nz * penetration * bShare,
  };
  const relativeVelocity =
    (b.velocity.x - a.velocity.x) * nx +
    (b.velocity.y - a.velocity.y) * ny +
    (b.velocity.z - a.velocity.z) * nz;
  if (relativeVelocity >= 0) return true;
  const restitution = Math.min(a.restitution, b.restitution);
  const impulse = (-(1 + restitution) * relativeVelocity) / totalMass;
  a.velocity = {
    x: a.velocity.x - impulse * b.mass * nx,
    y: a.velocity.y - impulse * b.mass * ny,
    z: a.velocity.z - impulse * b.mass * nz,
  };
  b.velocity = {
    x: b.velocity.x + impulse * a.mass * nx,
    y: b.velocity.y + impulse * a.mass * ny,
    z: b.velocity.z + impulse * a.mass * nz,
  };
  return true;
}

export function stepRigidBodies(
  bodies: readonly RigidBody[],
  options: RigidWorldOptions = {},
): RigidBody[] {
  const dt = options.dt ?? 1 / 120;
  const gravity = options.gravity ?? 9.8;
  const groundY = options.groundY ?? 0;
  const friction = Math.max(0, Math.min(1, options.friction ?? 0.2));
  const sleepThreshold = options.sleepThreshold ?? 0.04;
  const next = bodies.map(cloneBody);

  for (const body of next) {
    if (body.resting) continue;
    body.velocity = {
      x: body.velocity.x,
      y: body.velocity.y - gravity * dt,
      z: body.velocity.z,
    };
    body.position = {
      x: body.position.x + body.velocity.x * dt,
      y: body.position.y + body.velocity.y * dt,
      z: body.position.z + body.velocity.z * dt,
    };
    const floor = groundY + body.radius;
    if (body.position.y <= floor) {
      body.position = { ...body.position, y: floor };
      if (body.velocity.y < 0) {
        body.velocity = {
          x: body.velocity.x * (1 - friction),
          y: -body.velocity.y * body.restitution,
          z: body.velocity.z * (1 - friction),
        };
      }
      const speed = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
      if (speed < sleepThreshold) {
        body.velocity = { x: 0, y: 0, z: 0 };
        body.resting = true;
      }
    }
  }

  if (options.collideEachOther) {
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        if (resolvePairCollision(next[i]!, next[j]!)) {
          next[i]!.resting = false;
          next[j]!.resting = false;
        }
      }
    }
  }

  return next;
}

export interface RigidSimulateOptions extends RigidWorldOptions {
  readonly steps: number;
}

export function simulateRigidBodies(
  bodies: readonly RigidBody[],
  options: RigidSimulateOptions,
): RigidBody[] {
  let current = bodies.map(cloneBody);
  const steps = Math.max(1, Math.floor(options.steps));
  for (let step = 0; step < steps; step += 1) {
    current = stepRigidBodies(current, options);
  }
  return current;
}

export interface RigidBakeResult {
  readonly times: readonly number[];
  readonly positionsByBody: ReadonlyArray<readonly Vec3[]>;
}

export function bakeRigidBodyTracks(
  bodies: readonly RigidBody[],
  options: RigidSimulateOptions & { readonly fps?: number },
): RigidBakeResult {
  const dt = options.dt ?? 1 / 120;
  const fps = Math.max(1, Math.floor(options.fps ?? 30));
  const steps = Math.max(1, Math.floor(options.steps));
  const sampleEvery = Math.max(1, Math.round(1 / fps / dt));
  const times: number[] = [];
  const positionsByBody: Vec3[][] = bodies.map(() => []);
  let current = bodies.map(cloneBody);

  const record = (step: number): void => {
    times.push(step * dt);
    current.forEach((body, index) => {
      positionsByBody[index]!.push({ ...body.position });
    });
  };

  record(0);
  for (let step = 1; step <= steps; step += 1) {
    current = stepRigidBodies(current, options);
    if (step % sampleEvery === 0 || step === steps) {
      record(step);
    }
  }

  return { times, positionsByBody };
}
