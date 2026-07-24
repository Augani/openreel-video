import {
  createMeshBuilder,
  finalizeMesh,
  pushQuad,
  pushVertex,
  type Mesh,
} from "../geometry";

export interface ClothParticle {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  pinned: boolean;
}

export interface ClothSpring {
  readonly a: number;
  readonly b: number;
  readonly rest: number;
}

export interface ClothState {
  readonly columns: number;
  readonly rows: number;
  readonly particles: ClothParticle[];
  readonly springs: readonly ClothSpring[];
}

export type ClothPin =
  | "none"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-corners"
  | "left-edge";

export interface ClothGridOptions {
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly pin?: ClothPin;
  readonly bendSprings?: boolean;
  readonly plane?: "xy" | "xz";
}

function isPinned(pin: ClothPin, col: number, row: number, columns: number, rows: number): boolean {
  switch (pin) {
    case "top":
      return row === 0;
    case "bottom":
      return row === rows - 1;
    case "left":
    case "left-edge":
      return col === 0;
    case "right":
      return col === columns - 1;
    case "top-corners":
      return row === 0 && (col === 0 || col === columns - 1);
    default:
      return false;
  }
}

function distance(a: ClothParticle, b: ClothParticle): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function createClothGrid(options: ClothGridOptions): ClothState {
  const columns = Math.max(2, Math.floor(options.columns));
  const rows = Math.max(2, Math.floor(options.rows));
  const pin = options.pin ?? "none";
  const plane = options.plane ?? "xy";
  const particles: ClothParticle[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const across = (col / (columns - 1) - 0.5) * options.width;
      const along = (0.5 - row / (rows - 1)) * options.height;
      const x = across;
      const y = plane === "xz" ? 0 : along;
      const z = plane === "xz" ? along : 0;
      particles.push({
        x,
        y,
        z,
        px: x,
        py: y,
        pz: z,
        pinned: isPinned(pin, col, row, columns, rows),
      });
    }
  }
  const index = (col: number, row: number): number => row * columns + col;
  const springs: ClothSpring[] = [];
  const addSpring = (a: number, b: number): void => {
    springs.push({ a, b, rest: distance(particles[a]!, particles[b]!) });
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const here = index(col, row);
      if (col < columns - 1) addSpring(here, index(col + 1, row));
      if (row < rows - 1) addSpring(here, index(col, row + 1));
      if (col < columns - 1 && row < rows - 1) {
        addSpring(here, index(col + 1, row + 1));
        addSpring(index(col + 1, row), index(col, row + 1));
      }
      if (options.bendSprings) {
        if (col < columns - 2) addSpring(here, index(col + 2, row));
        if (row < rows - 2) addSpring(here, index(col, row + 2));
      }
    }
  }
  return { columns, rows, particles, springs };
}

export interface ClothStepOptions {
  readonly dt?: number;
  readonly gravity?: number;
  readonly damping?: number;
  readonly iterations?: number;
  readonly wind?: { x: number; y: number; z: number };
}

export function stepCloth(state: ClothState, options: ClothStepOptions = {}): ClothState {
  const dt = options.dt ?? 1 / 60;
  const gravity = options.gravity ?? 9.8;
  const damping = Math.max(0, Math.min(1, options.damping ?? 0.02));
  const iterations = Math.max(1, Math.floor(options.iterations ?? 6));
  const wind = options.wind ?? { x: 0, y: 0, z: 0 };
  const ax = wind.x;
  const ay = -gravity + wind.y;
  const az = wind.z;
  const dt2 = dt * dt;

  const particles = state.particles.map((particle) => {
    if (particle.pinned) return { ...particle };
    const vx = (particle.x - particle.px) * (1 - damping);
    const vy = (particle.y - particle.py) * (1 - damping);
    const vz = (particle.z - particle.pz) * (1 - damping);
    return {
      x: particle.x + vx + ax * dt2,
      y: particle.y + vy + ay * dt2,
      z: particle.z + vz + az * dt2,
      px: particle.x,
      py: particle.y,
      pz: particle.z,
      pinned: false,
    };
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const spring of state.springs) {
      const a = particles[spring.a]!;
      const b = particles[spring.b]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dy, dz) || 1e-6;
      const difference = (dist - spring.rest) / dist;
      const aMovable = a.pinned ? 0 : 1;
      const bMovable = b.pinned ? 0 : 1;
      const total = aMovable + bMovable;
      if (total === 0) continue;
      const scaleA = (aMovable / total) * difference;
      const scaleB = (bMovable / total) * difference;
      a.x += dx * scaleA;
      a.y += dy * scaleA;
      a.z += dz * scaleA;
      b.x -= dx * scaleB;
      b.y -= dy * scaleB;
      b.z -= dz * scaleB;
    }
  }

  return { ...state, particles };
}

export interface ClothSimulateOptions extends ClothStepOptions {
  readonly steps: number;
}

export function simulateCloth(state: ClothState, options: ClothSimulateOptions): ClothState {
  let current = state;
  const steps = Math.max(1, Math.floor(options.steps));
  for (let step = 0; step < steps; step += 1) {
    current = stepCloth(current, options);
  }
  return current;
}

export function clothToMesh(state: ClothState): Mesh {
  const builder = createMeshBuilder();
  const { columns, rows, particles } = state;
  const ids: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const particle = particles[row * columns + col]!;
      const left = particles[row * columns + Math.max(0, col - 1)]!;
      const right = particles[row * columns + Math.min(columns - 1, col + 1)]!;
      const up = particles[Math.max(0, row - 1) * columns + col]!;
      const down = particles[Math.min(rows - 1, row + 1) * columns + col]!;
      const tx = right.x - left.x;
      const ty = right.y - left.y;
      const tz = right.z - left.z;
      const bx = down.x - up.x;
      const by = down.y - up.y;
      const bz = down.z - up.z;
      let nx = ty * bz - tz * by;
      let ny = tz * bx - tx * bz;
      let nz = tx * by - ty * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      ids.push(
        pushVertex(
          builder,
          [particle.x, particle.y, particle.z],
          [nx, ny, nz],
          [col / (columns - 1), row / (rows - 1)],
        ),
      );
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < columns - 1; col += 1) {
      const a = ids[row * columns + col]!;
      const b = ids[row * columns + col + 1]!;
      const c = ids[(row + 1) * columns + col + 1]!;
      const d = ids[(row + 1) * columns + col]!;
      pushQuad(builder, a, b, c, d);
    }
  }
  return finalizeMesh(builder);
}
