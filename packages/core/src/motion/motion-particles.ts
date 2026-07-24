import type {
  MotionComposition,
  MotionParticleEmitter,
  MotionParticleLayer,
  MotionParticleShape,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

export interface MotionParticle {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly opacity: number;
  readonly color: string;
  readonly rotation: number;
  readonly age: number;
  readonly progress: number;
}

export interface CreateMotionParticleLayerOptions {
  readonly id?: string;
  readonly name?: string;
  readonly duration?: number;
  readonly position?: { readonly x: number; readonly y: number };
  readonly emitter?: Partial<MotionParticleEmitter>;
}

export const DEFAULT_MOTION_PARTICLE_EMITTER: MotionParticleEmitter = {
  emissionRate: 48,
  maxParticles: 240,
  lifetime: 2.4,
  speed: 220,
  spread: 120,
  gravity: 120,
  size: 10,
  sizeRandomness: 0.55,
  opacityStart: 1,
  opacityEnd: 0,
  colorStart: "#ffffff",
  colorEnd: "#14b8a6",
  seed: 1337,
  shape: "circle",
};

export function createMotionParticleLayer(
  composition: Pick<MotionComposition, "width" | "height" | "duration">,
  options: CreateMotionParticleLayerOptions = {},
): MotionParticleLayer {
  return {
    id: options.id ?? createParticleId(),
    type: "particle",
    name: options.name ?? "Particle Emitter",
    startTime: 0,
    duration: options.duration ?? composition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: options.position ?? {
        x: composition.width / 2,
        y: composition.height / 2,
        z: 0,
      },
      anchor: { x: 0.5, y: 0.5 },
    },
    keyframes: [],
    emitter: normalizeMotionParticleEmitter(options.emitter),
  };
}

export function normalizeMotionParticleEmitter(
  emitter: Partial<MotionParticleEmitter> | undefined,
): MotionParticleEmitter {
  return {
    emissionRate: clamp(finite(emitter?.emissionRate, 48), 0, 1000),
    maxParticles: Math.round(clamp(finite(emitter?.maxParticles, 240), 0, 5000)),
    lifetime: clamp(finite(emitter?.lifetime, 2.4), 0.01, 60),
    speed: clamp(finite(emitter?.speed, 220), 0, 5000),
    spread: clamp(finite(emitter?.spread, 120), 0, 360),
    gravity: clamp(finite(emitter?.gravity, 120), -5000, 5000),
    size: clamp(finite(emitter?.size, 10), 0.1, 1000),
    sizeRandomness: clamp(finite(emitter?.sizeRandomness, 0.55), 0, 1),
    opacityStart: clamp01(finite(emitter?.opacityStart, 1)),
    opacityEnd: clamp01(finite(emitter?.opacityEnd, 0)),
    colorStart: normalizeColor(emitter?.colorStart, "#ffffff"),
    colorEnd: normalizeColor(emitter?.colorEnd, "#14b8a6"),
    seed: Math.round(clamp(finite(emitter?.seed, 1337), -1_000_000, 1_000_000)),
    shape: normalizeParticleShape(emitter?.shape),
  };
}

export type MotionParticleEmitterResolver = (
  time: number,
) => Partial<MotionParticleEmitter> | undefined;

export function getMotionParticlesAtTime(
  layer: MotionParticleLayer,
  localTime: number,
  resolveEmitterAtTime?: MotionParticleEmitterResolver,
): MotionParticle[] {
  const emitter = normalizeMotionParticleEmitter(layer.emitter);
  if (
    localTime < 0 ||
    emitter.emissionRate <= 0 ||
    emitter.maxParticles <= 0 ||
    (emitter.opacityStart <= 0 && emitter.opacityEnd <= 0)
  ) {
    return [];
  }

  const lastParticleIndex = Math.floor(localTime * emitter.emissionRate);
  const firstAliveIndex = Math.max(
    0,
    Math.ceil((localTime - emitter.lifetime) * emitter.emissionRate),
  );
  const firstIndex = Math.max(
    firstAliveIndex,
    lastParticleIndex - emitter.maxParticles + 1,
  );
  const particles: MotionParticle[] = [];

  for (let index = firstIndex; index <= lastParticleIndex; index += 1) {
    const birthTime = index / emitter.emissionRate;
    const age = localTime - birthTime;
    if (age < -1 / 10000 || age > emitter.lifetime) continue;

    const birthEmitter = resolveEmitterAtTime
      ? normalizeMotionParticleEmitter(resolveEmitterAtTime(birthTime))
      : emitter;

    const progress = clamp(age / birthEmitter.lifetime, 0, 1);
    const angle = getParticleAngle(birthEmitter, index);
    const speed =
      birthEmitter.speed * lerp(0.45, 1.2, randomUnit(birthEmitter.seed, index, 1));
    const drift =
      (randomUnit(birthEmitter.seed, index, 2) - 0.5) * birthEmitter.speed * 0.22;
    const size =
      birthEmitter.size *
      lerp(
        1 - birthEmitter.sizeRandomness,
        1 + birthEmitter.sizeRandomness,
        randomUnit(birthEmitter.seed, index, 3),
      );
    const opacity = lerp(birthEmitter.opacityStart, birthEmitter.opacityEnd, progress);
    const x = Math.cos(angle) * speed * age + drift * age * progress;
    const y = Math.sin(angle) * speed * age + 0.5 * birthEmitter.gravity * age * age;

    particles.push({
      x: roundParticleValue(x),
      y: roundParticleValue(y),
      size: roundParticleValue(Math.max(0.1, size)),
      opacity: clamp01(opacity),
      color: interpolateHexColor(
        birthEmitter.colorStart,
        birthEmitter.colorEnd,
        progress,
      ),
      rotation: roundParticleValue(randomUnit(birthEmitter.seed, index, 4) * 360),
      age: roundParticleValue(age),
      progress: roundParticleValue(progress),
    });
  }

  return particles;
}

export function getMotionParticleEmitterBounds(
  emitterInput: Partial<MotionParticleEmitter> | undefined,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const emitter = normalizeMotionParticleEmitter(emitterInput);
  const travel = emitter.speed * emitter.lifetime;
  const fall = Math.abs(0.5 * emitter.gravity * emitter.lifetime * emitter.lifetime);
  const radius = Math.max(emitter.size, travel + fall + emitter.size * 2);
  return {
    x: -radius,
    y: -radius,
    width: radius * 2,
    height: radius * 2,
  };
}

function getParticleAngle(emitter: MotionParticleEmitter, index: number): number {
  const spreadRadians = (emitter.spread * Math.PI) / 180;
  const centered = randomUnit(emitter.seed, index, 0) - 0.5;
  return -Math.PI / 2 + centered * spreadRadians;
}

function randomUnit(seed: number, index: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function interpolateHexColor(from: string, to: string, progress: number): string {
  const start = parseHexColor(from);
  const end = parseHexColor(to);
  const channel = (a: number, b: number) =>
    Math.round(lerp(a, b, progress)).toString(16).padStart(2, "0");
  return `#${channel(start.r, end.r)}${channel(start.g, end.g)}${channel(start.b, end.b)}`;
}

function parseHexColor(color: string): { readonly r: number; readonly g: number; readonly b: number } {
  const normalized = normalizeColor(color, "#ffffff").slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    return `#${short[1]
      .split("")
      .map((channel) => `${channel}${channel}`)
      .join("")}`.toLowerCase();
  }
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

function normalizeParticleShape(value: unknown): MotionParticleShape {
  return value === "square" ? "square" : "circle";
}

function createParticleId(): string {
  return `motion-particle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function roundParticleValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}
