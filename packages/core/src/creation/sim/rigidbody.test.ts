import { describe, it, expect } from "vitest";
import {
  bakeRigidBodyTracks,
  makeRigidBody,
  simulateRigidBodies,
  stepRigidBodies,
} from "./rigidbody";

describe("rigid body simulation", () => {
  it("drops a sphere that bounces and settles on the ground", () => {
    const body = makeRigidBody({ position: { x: 0, y: 3, z: 0 }, radius: 0.5, restitution: 0.5 });
    const settled = simulateRigidBodies([body], {
      steps: 600,
      dt: 1 / 120,
      gravity: 9.8,
      groundY: 0,
    });
    expect(settled[0]!.position.y).toBeCloseTo(0.5, 2);
    expect(settled[0]!.resting).toBe(true);
    expect(Number.isFinite(settled[0]!.position.y)).toBe(true);
  });

  it("loses energy on each bounce (restitution < 1)", () => {
    let bodies = [makeRigidBody({ position: { x: 0, y: 2, z: 0 }, radius: 0.25, restitution: 0.6 })];
    let firstPeakAfterBounce = 0;
    let bounced = false;
    for (let step = 0; step < 400; step += 1) {
      const prevY = bodies[0]!.position.y;
      bodies = stepRigidBodies(bodies, { dt: 1 / 120, gravity: 9.8, groundY: 0 });
      const y = bodies[0]!.position.y;
      if (!bounced && bodies[0]!.position.y <= 0.25 + 1e-6 && prevY <= y) bounced = true;
      if (bounced) firstPeakAfterBounce = Math.max(firstPeakAfterBounce, y);
    }
    expect(firstPeakAfterBounce).toBeLessThan(2);
  });

  it("resolves sphere-sphere collisions when enabled", () => {
    const a = makeRigidBody({ position: { x: -0.3, y: 1, z: 0 }, radius: 0.5 });
    const b = makeRigidBody({ position: { x: 0.3, y: 1, z: 0 }, radius: 0.5 });
    const stepped = stepRigidBodies([a, b], {
      dt: 1 / 120,
      gravity: 0,
      collideEachOther: true,
    });
    const distance = Math.hypot(
      stepped[1]!.position.x - stepped[0]!.position.x,
      stepped[1]!.position.y - stepped[0]!.position.y,
      stepped[1]!.position.z - stepped[0]!.position.z,
    );
    expect(distance).toBeGreaterThan(0.6);
  });

  it("bakes per-frame position tracks", () => {
    const body = makeRigidBody({ position: { x: 0, y: 3, z: 0 }, radius: 0.5 });
    const baked = bakeRigidBodyTracks([body], { steps: 240, dt: 1 / 120, fps: 30 });
    expect(baked.positionsByBody).toHaveLength(1);
    expect(baked.positionsByBody[0]!.length).toBe(baked.times.length);
    expect(baked.times[0]).toBe(0);
    expect(baked.positionsByBody[0]![0]!.y).toBeCloseTo(3, 5);
    expect(baked.positionsByBody[0]![baked.positionsByBody[0]!.length - 1]!.y).toBeLessThan(3);
  });

  it("lets distant bodies sleep even with inter-body collision enabled", () => {
    const settled = simulateRigidBodies(
      [
        makeRigidBody({ position: { x: -5, y: 1, z: 0 }, radius: 0.5 }),
        makeRigidBody({ position: { x: 5, y: 1, z: 0 }, radius: 0.5 }),
      ],
      { steps: 400, dt: 1 / 120, gravity: 9.8, groundY: 0, collideEachOther: true },
    );
    expect(settled[0]!.resting).toBe(true);
    expect(settled[1]!.resting).toBe(true);
    expect(settled[0]!.position.y).toBeCloseTo(0.5, 2);
  });

  it("separates exactly-coincident bodies instead of overlapping them", () => {
    const settled = simulateRigidBodies(
      [
        makeRigidBody({ position: { x: 0, y: 2, z: 0 }, radius: 0.5 }),
        makeRigidBody({ position: { x: 0, y: 2, z: 0 }, radius: 0.5 }),
      ],
      { steps: 400, dt: 1 / 120, gravity: 9.8, groundY: 0, collideEachOther: true },
    );
    const dx = settled[0]!.position.x - settled[1]!.position.x;
    const dy = settled[0]!.position.y - settled[1]!.position.y;
    const dz = settled[0]!.position.z - settled[1]!.position.z;
    expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(0.9);
  });
});
