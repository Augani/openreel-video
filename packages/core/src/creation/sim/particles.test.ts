import { describe, it, expect } from "vitest";
import { aliveCount, simulateParticles, spawnParticles, stepParticles } from "./particles";

describe("particle simulation", () => {
  it("spawns a deterministic particle set from a seed", () => {
    const a = spawnParticles({ count: 20, seed: "fixed", speed: 4 });
    const b = spawnParticles({ count: 20, seed: "fixed", speed: 4 });
    expect(a).toHaveLength(20);
    expect(a[0]!.velocity).toEqual(b[0]!.velocity);
    expect(a.every((particle) => particle.alive)).toBe(true);
  });

  it("integrates gravity so particles rise then fall", () => {
    const particles = spawnParticles({
      count: 8,
      seed: "g",
      origin: { x: 0, y: 0, z: 0 },
      speed: 5,
      spread: 0,
      lifetime: 10,
    });
    const after = simulateParticles(particles, { steps: 240, dt: 1 / 60, gravity: 9.8 });
    expect(after[0]!.position.y).toBeLessThan(0);
  });

  it("retires particles past their lifetime", () => {
    const particles = spawnParticles({ count: 30, seed: "life", lifetime: 1 });
    const after = simulateParticles(particles, { steps: 200, dt: 1 / 60, gravity: 2 });
    expect(aliveCount(after)).toBe(0);
  });

  it("applies wind drift along Z in a single step", () => {
    const particles = spawnParticles({ count: 4, seed: "w", speed: 0, spread: 0 });
    const after = stepParticles(particles, { dt: 1 / 60, gravity: 0, wind: { x: 0, y: 0, z: 12 } });
    expect(after[0]!.position.z).toBeGreaterThan(0);
  });
});
