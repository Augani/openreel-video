import { describe, expect, it } from "vitest";
import {
  MOTION_PARTICLE_PRESETS,
  applyMotionParticlePreset,
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
