import { describe, expect, it } from "vitest";
import {
  createMotionParticleLayer,
  getMotionParticleEmitterBounds,
  getMotionParticlesAtTime,
  normalizeMotionParticleEmitter,
} from "./motion-particles";

const composition = {
  width: 1920,
  height: 1080,
  duration: 5,
};

describe("motion particles", () => {
  it("normalizes emitter values for deterministic rendering", () => {
    expect(
      normalizeMotionParticleEmitter({
        emissionRate: 5000,
        maxParticles: 12.7,
        lifetime: -2,
        speed: Number.NaN,
        spread: 900,
        gravity: -9000,
        size: 0,
        sizeRandomness: 3,
        opacityStart: 2,
        opacityEnd: -1,
        colorStart: "#abc",
        colorEnd: "not-a-color",
        seed: 1_000_001,
        shape: "triangle" as never,
      }),
    ).toEqual({
      emissionRate: 1000,
      maxParticles: 13,
      lifetime: 0.01,
      speed: 220,
      spread: 360,
      gravity: -5000,
      size: 0.1,
      sizeRandomness: 1,
      opacityStart: 1,
      opacityEnd: 0,
      colorStart: "#aabbcc",
      colorEnd: "#14b8a6",
      seed: 1_000_000,
      shape: "circle",
    });
  });

  it("creates a centered particle layer from composition dimensions", () => {
    const layer = createMotionParticleLayer(composition, {
      id: "particles",
      duration: 3,
    });

    expect(layer).toMatchObject({
      id: "particles",
      type: "particle",
      name: "Particle Emitter",
      duration: 3,
      transform: {
        position: { x: 960, y: 540, z: 0 },
        anchor: { x: 0.5, y: 0.5 },
      },
    });
  });

  it("evaluates particles deterministically at a fixed timestamp", () => {
    const layer = createMotionParticleLayer(composition, {
      id: "particles",
      emitter: {
        emissionRate: 12,
        maxParticles: 16,
        lifetime: 1.5,
        speed: 160,
        spread: 45,
        gravity: 80,
        size: 8,
        sizeRandomness: 0.25,
        opacityStart: 1,
        opacityEnd: 0.1,
        colorStart: "#000000",
        colorEnd: "#ffffff",
        seed: 42,
        shape: "square",
      },
    });

    const first = getMotionParticlesAtTime(layer, 1.25);
    const second = getMotionParticlesAtTime(layer, 1.25);

    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(16);
    expect(first[0]).toMatchObject({
      color: expect.stringMatching(/^#[0-9a-f]{6}$/),
      opacity: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
    });
  });

  it("interpolates particle color and opacity over each particle lifetime", () => {
    const layer = createMotionParticleLayer(composition, {
      id: "particles",
      emitter: {
        emissionRate: 1,
        maxParticles: 8,
        lifetime: 2,
        speed: 0,
        spread: 0,
        gravity: 0,
        size: 10,
        sizeRandomness: 0,
        opacityStart: 1,
        opacityEnd: 0,
        colorStart: "#000000",
        colorEnd: "#ffffff",
        seed: 7,
        shape: "circle",
      },
    });

    const particle = getMotionParticlesAtTime(layer, 1).find(
      (candidate) => candidate.age === 1,
    );

    expect(particle).toMatchObject({
      color: "#808080",
      opacity: 0.5,
      progress: 0.5,
      size: 10,
    });
  });

  it("evaluates emitter parameters at each particle birth time, not the current frame", () => {
    const layer = createMotionParticleLayer(composition, {
      id: "particles",
      emitter: {
        emissionRate: 1,
        maxParticles: 8,
        lifetime: 4,
        speed: 100,
        spread: 0,
        gravity: 0,
        size: 10,
        sizeRandomness: 0,
        opacityStart: 1,
        opacityEnd: 1,
        colorStart: "#ffffff",
        colorEnd: "#ffffff",
        seed: 7,
        shape: "circle",
      },
    });

    const baseline = getMotionParticlesAtTime(layer, 2).find(
      (candidate) => candidate.age === 2,
    );
    const birthResolved = getMotionParticlesAtTime(layer, 2, (time) => ({
      ...layer.emitter,
      speed: time < 1 ? 400 : layer.emitter.speed,
    })).find((candidate) => candidate.age === 2);

    expect(baseline).toBeDefined();
    expect(birthResolved).toBeDefined();
    expect(Math.abs(birthResolved!.y)).toBeGreaterThan(Math.abs(baseline!.y));
  });

  it("returns no particles when the layer is before its local start", () => {
    const layer = createMotionParticleLayer(composition, { id: "particles" });

    expect(getMotionParticlesAtTime(layer, -0.01)).toEqual([]);
  });

  it("estimates emitter bounds from lifetime, velocity, gravity, and size", () => {
    expect(
      getMotionParticleEmitterBounds({
        speed: 100,
        lifetime: 2,
        gravity: 50,
        size: 12,
      }),
    ).toEqual({
      x: -324,
      y: -324,
      width: 648,
      height: 648,
    });
  });
});
