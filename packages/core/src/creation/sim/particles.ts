import { createRng, type Vec3 } from "../schema/common";

export interface Particle {
  position: Vec3;
  velocity: Vec3;
  age: number;
  readonly life: number;
  alive: boolean;
}

export interface ParticleEmitterOptions {
  readonly count: number;
  readonly seed?: string | number;
  readonly origin?: Vec3;
  readonly speed?: number;
  readonly speedJitter?: number;
  readonly spread?: number;
  readonly gravity?: number;
  readonly drag?: number;
  readonly lifetime?: number;
  readonly wind?: Vec3;
}

export function spawnParticles(options: ParticleEmitterOptions): Particle[] {
  const count = Math.max(0, Math.min(4096, Math.floor(options.count)));
  const rng = createRng(options.seed ?? "openreel-particles");
  const origin = options.origin ?? { x: 0, y: 0, z: 0 };
  const speed = options.speed ?? 3;
  const speedJitter = Math.max(0, options.speedJitter ?? 0.3);
  const spread = Math.max(0, Math.min(Math.PI, options.spread ?? 0.6));
  const lifetime = Math.max(0.1, options.lifetime ?? 2);
  const particles: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const theta = rng.range(0, Math.PI * 2);
    const phi = rng.range(0, spread);
    const dir = {
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi),
      z: Math.sin(phi) * Math.sin(theta),
    };
    const magnitude = speed * (1 + rng.range(-speedJitter, speedJitter));
    particles.push({
      position: { ...origin },
      velocity: { x: dir.x * magnitude, y: dir.y * magnitude, z: dir.z * magnitude },
      age: 0,
      life: lifetime * rng.range(0.7, 1.3),
      alive: true,
    });
  }
  return particles;
}

export interface ParticleStepOptions {
  readonly dt?: number;
  readonly gravity?: number;
  readonly drag?: number;
  readonly wind?: Vec3;
}

export function stepParticles(
  particles: readonly Particle[],
  options: ParticleStepOptions = {},
): Particle[] {
  const dt = options.dt ?? 1 / 60;
  const gravity = options.gravity ?? 9.8;
  const drag = Math.max(0, Math.min(1, options.drag ?? 0.02));
  const wind = options.wind ?? { x: 0, y: 0, z: 0 };
  return particles.map((particle) => {
    if (!particle.alive) return { ...particle, position: { ...particle.position } };
    const velocity = {
      x: (particle.velocity.x + wind.x * dt) * (1 - drag),
      y: (particle.velocity.y - gravity * dt + wind.y * dt) * (1 - drag),
      z: (particle.velocity.z + wind.z * dt) * (1 - drag),
    };
    const position = {
      x: particle.position.x + velocity.x * dt,
      y: particle.position.y + velocity.y * dt,
      z: particle.position.z + velocity.z * dt,
    };
    const age = particle.age + dt;
    return { position, velocity, age, life: particle.life, alive: age < particle.life };
  });
}

export interface ParticleSimulateOptions extends ParticleStepOptions {
  readonly steps: number;
}

export function simulateParticles(
  particles: readonly Particle[],
  options: ParticleSimulateOptions,
): Particle[] {
  let current = particles.map((particle) => ({ ...particle, position: { ...particle.position }, velocity: { ...particle.velocity } }));
  const steps = Math.max(1, Math.floor(options.steps));
  for (let step = 0; step < steps; step += 1) {
    current = stepParticles(current, options);
  }
  return current;
}

export function aliveCount(particles: readonly Particle[]): number {
  return particles.reduce((total, particle) => total + (particle.alive ? 1 : 0), 0);
}
