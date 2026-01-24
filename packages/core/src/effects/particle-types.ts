export type ParticleEffectType =
  | "dissolve"
  | "explode"
  | "implode"
  | "confetti"
  | "dust"
  | "sparkle"
  | "disintegrate"
  | "pixelate"
  | "shatter"
  | "morph";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface ParticleConfig {
  particleCount: number;
  speed: number;
  speedVariance: number;
  gravity: number;
  wind: Vector3;
  turbulence: number;
  colors: string[];
  size: { min: number; max: number };
  opacity: { start: number; end: number };
  lifetime: { min: number; max: number };
  emissionRate: number;
  emissionShape: "point" | "line" | "circle" | "rectangle" | "sphere";
  emissionRadius: number;
  rotationSpeed: number;
  fadeIn: number;
  fadeOut: number;
  blendMode: "normal" | "add" | "multiply" | "screen";
}

export interface ParticleEffect {
  id: string;
  clipId: string;
  type: ParticleEffectType;
  startTime: number;
  duration: number;
  config: ParticleConfig;
  enabled: boolean;
}

export interface Particle {
  id: string;
  position: Vector3;
  velocity: Vector3;
  acceleration: Vector3;
  color: string;
  size: number;
  opacity: number;
  rotation: number;
  rotationSpeed: number;
  lifetime: number;
  age: number;
  active: boolean;
}

export interface EmitterState {
  effectId: string;
  particles: Particle[];
  elapsedTime: number;
  emissionAccumulator: number;
  active: boolean;
}

export const DEFAULT_PARTICLE_CONFIG: ParticleConfig = {
  particleCount: 100,
  speed: 100,
  speedVariance: 50,
  gravity: 200,
  wind: { x: 0, y: 0, z: 0 },
  turbulence: 10,
  colors: ["#ffffff"],
  size: { min: 2, max: 8 },
  opacity: { start: 1, end: 0 },
  lifetime: { min: 0.5, max: 2 },
  emissionRate: 50,
  emissionShape: "point",
  emissionRadius: 10,
  rotationSpeed: 0,
  fadeIn: 0.1,
  fadeOut: 0.3,
  blendMode: "add",
};
