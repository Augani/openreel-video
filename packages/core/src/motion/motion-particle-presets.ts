import type { MotionParticleEmitter, MotionParticleLayer } from "./types";
import { normalizeMotionParticleEmitter } from "./motion-particles";

export type MotionParticlePresetId =
  | "sparks"
  | "confetti"
  | "snow"
  | "dust"
  | "ui-burst";

export interface MotionParticlePreset {
  readonly id: MotionParticlePresetId;
  readonly name: string;
  readonly description: string;
  readonly emitter: MotionParticleEmitter;
}

export interface ApplyMotionParticlePresetOptions {
  readonly intensity?: number;
}

export const MOTION_PARTICLE_PRESETS: readonly MotionParticlePreset[] = [
  {
    id: "sparks",
    name: "Sparks",
    description: "Fast warm bursts with gravity for logo and product reveals.",
    emitter: normalizeMotionParticleEmitter({
      emissionRate: 72,
      maxParticles: 180,
      lifetime: 1.1,
      speed: 480,
      spread: 70,
      gravity: 540,
      size: 5,
      sizeRandomness: 0.65,
      opacityStart: 1,
      opacityEnd: 0,
      colorStart: "#fef3c7",
      colorEnd: "#f97316",
      seed: 2818,
      shape: "circle",
    }),
  },
  {
    id: "confetti",
    name: "Confetti",
    description: "Square celebratory pieces for promos, launches, and wins.",
    emitter: normalizeMotionParticleEmitter({
      emissionRate: 54,
      maxParticles: 260,
      lifetime: 3.2,
      speed: 260,
      spread: 150,
      gravity: 320,
      size: 13,
      sizeRandomness: 0.75,
      opacityStart: 1,
      opacityEnd: 0.15,
      colorStart: "#f43f5e",
      colorEnd: "#facc15",
      seed: 9301,
      shape: "square",
    }),
  },
  {
    id: "snow",
    name: "Snow",
    description: "Slow falling soft particles for seasonal or dreamy scenes.",
    emitter: normalizeMotionParticleEmitter({
      emissionRate: 36,
      maxParticles: 360,
      lifetime: 6,
      speed: 34,
      spread: 360,
      gravity: 36,
      size: 7,
      sizeRandomness: 0.8,
      opacityStart: 0.9,
      opacityEnd: 0.25,
      colorStart: "#ffffff",
      colorEnd: "#bfdbfe",
      seed: 4922,
      shape: "circle",
    }),
  },
  {
    id: "dust",
    name: "Dust",
    description: "Subtle atmospheric motion for depth and product polish.",
    emitter: normalizeMotionParticleEmitter({
      emissionRate: 24,
      maxParticles: 160,
      lifetime: 4.5,
      speed: 42,
      spread: 360,
      gravity: -8,
      size: 6,
      sizeRandomness: 0.9,
      opacityStart: 0.45,
      opacityEnd: 0,
      colorStart: "#f8fafc",
      colorEnd: "#94a3b8",
      seed: 6174,
      shape: "circle",
    }),
  },
  {
    id: "ui-burst",
    name: "UI Burst",
    description: "Tight energetic accent particles for clicks and app demos.",
    emitter: normalizeMotionParticleEmitter({
      emissionRate: 96,
      maxParticles: 160,
      lifetime: 0.85,
      speed: 340,
      spread: 360,
      gravity: 40,
      size: 7,
      sizeRandomness: 0.45,
      opacityStart: 1,
      opacityEnd: 0,
      colorStart: "#67e8f9",
      colorEnd: "#14b8a6",
      seed: 1447,
      shape: "circle",
    }),
  },
];

export function getMotionParticlePreset(
  id: MotionParticlePresetId,
): MotionParticlePreset | undefined {
  return MOTION_PARTICLE_PRESETS.find((preset) => preset.id === id);
}

export function applyMotionParticlePreset<T extends MotionParticleLayer>(
  layer: T,
  presetId: MotionParticlePresetId,
  options: ApplyMotionParticlePresetOptions = {},
): T {
  const preset = getMotionParticlePreset(presetId);
  if (!preset) return layer;

  return {
    ...layer,
    name:
      layer.name.trim() && layer.name !== "Particle Emitter"
        ? layer.name
        : preset.name,
    emitter: scaleMotionParticleEmitter(preset.emitter, options.intensity ?? 1),
  };
}

export function scaleMotionParticleEmitter(
  emitter: MotionParticleEmitter,
  intensity: number,
): MotionParticleEmitter {
  const normalized = normalizeMotionParticleEmitter(emitter);
  const amount = clamp(intensity, 0.25, 2);
  return normalizeMotionParticleEmitter({
    ...normalized,
    emissionRate: normalized.emissionRate * amount,
    maxParticles: normalized.maxParticles * amount,
    speed: normalized.speed * (0.75 + amount * 0.25),
    size: normalized.size * (0.85 + amount * 0.15),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 1));
}
