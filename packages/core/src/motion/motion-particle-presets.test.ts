import { describe, expect, it } from "vitest";
import {
  MOTION_PARTICLE_PRESETS,
  applyMotionParticlePreset,
  getMotionParticlePreset,
  scaleMotionParticleEmitter,
} from "./motion-particle-presets";
import {
  createMotionParticleLayer,
  getMotionParticlesAtTime,
} from "./motion-particles";

const composition = {
  width: 1920,
  height: 1080,
  duration: 5,
};

describe("motion particle presets", () => {
  it("ships deterministic artist presets", () => {
    expect(MOTION_PARTICLE_PRESETS.map((preset) => preset.id)).toEqual([
      "sparks",
      "confetti",
      "snow",
      "dust",
      "ui-burst",
    ]);

    for (const preset of MOTION_PARTICLE_PRESETS) {
      expect(getMotionParticlePreset(preset.id)).toBe(preset);
      expect(preset.emitter.emissionRate).toBeGreaterThan(0);
      expect(preset.emitter.maxParticles).toBeGreaterThan(0);
      expect(preset.emitter.colorStart).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.emitter.colorEnd).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("applies presets to particle layers without mutating the source layer", () => {
    const layer = createMotionParticleLayer(composition, {
      id: "particles",
      name: "",
    });
    const updated = applyMotionParticlePreset(layer, "confetti");

    expect(updated).not.toBe(layer);
    expect(updated.name).toBe("Confetti");
    expect(updated.emitter.shape).toBe("square");
    expect(layer.emitter.shape).toBe("circle");
  });

  it("scales preset intensity while keeping normalized emitter bounds", () => {
    const preset = getMotionParticlePreset("sparks");
    expect(preset).toBeDefined();
    if (!preset) return;

    const low = scaleMotionParticleEmitter(preset.emitter, 0.25);
    const high = scaleMotionParticleEmitter(preset.emitter, 2);

    expect(high.emissionRate).toBeGreaterThan(low.emissionRate);
    expect(high.maxParticles).toBeGreaterThan(low.maxParticles);
    expect(high.speed).toBeGreaterThan(low.speed);
    expect(high.emissionRate).toBeLessThanOrEqual(1000);
    expect(high.maxParticles).toBeLessThanOrEqual(5000);
  });

  it("produces visible particles from every preset", () => {
    for (const preset of MOTION_PARTICLE_PRESETS) {
      const layer = applyMotionParticlePreset(
        createMotionParticleLayer(composition, { id: preset.id }),
        preset.id,
      );

      expect(getMotionParticlesAtTime(layer, 1).length).toBeGreaterThan(0);
    }
  });
});
