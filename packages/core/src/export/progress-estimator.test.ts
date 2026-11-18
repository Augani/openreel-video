import { describe, expect, it } from "vitest";
import { ProgressEstimator, formatEta } from "./progress-estimator";

function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("ProgressEstimator", () => {
  it("withholds the ETA until there is enough signal", () => {
    const clock = fakeClock();
    const est = new ProgressEstimator(clock.now);
    est.start();
    clock.advance(500);
    expect(est.update(0.001).etaSeconds).toBeNull();
    clock.advance(3000);
    expect(est.update(0.3).etaSeconds).not.toBeNull();
  });

  it("converges on the true remaining time at a constant speed", () => {
    const clock = fakeClock();
    const est = new ProgressEstimator(clock.now);
    est.start();
    // 200 s job, progress reported every second.
    let lastEta: number | null = null;
    for (let s = 1; s <= 200; s++) {
      clock.advance(1000);
      lastEta = est.update(s / 200).etaSeconds;
      if (s === 40) expect(Math.abs(lastEta! - 160)).toBeLessThan(160 * 0.05);
      if (s === 100) expect(Math.abs(lastEta! - 100)).toBeLessThan(100 * 0.05);
    }
    expect(lastEta).toBe(0);
  });

  it("recovers after a speed change (fast copy then slow encode)", () => {
    const clock = fakeClock();
    const est = new ProgressEstimator(clock.now);
    est.start();
    // First 50% in 5 s, the other 50% at 1% per second.
    let p = 0;
    let eta: number | null = null;
    for (let s = 1; s <= 5; s++) { clock.advance(1000); p = s * 0.1; eta = est.update(p).etaSeconds; }
    const errorAt = (second: number): number => {
      const remainingTrue = 50 - (second - 5);
      return Math.abs((eta as number) - remainingTrue);
    };
    for (let s = 6; s <= 55; s++) {
      clock.advance(1000);
      p = 0.5 + (s - 5) * 0.01;
      eta = est.update(p).etaSeconds;
      if (s === 20) expect(errorAt(s)).toBeLessThan(0.35 * 35);
      if (s === 45) expect(errorAt(s)).toBeLessThan(0.15 * 10 + 1);
    }
    expect(eta).toBe(0);
  });

  it("never reports progress going backwards and counts down while stalled", () => {
    const clock = fakeClock();
    const est = new ProgressEstimator(clock.now);
    est.start();
    for (let s = 1; s <= 10; s++) { clock.advance(1000); est.update(s * 0.05); }
    expect(est.update(0.2).fraction).toBe(0.5 * 0 + 0.5);
    const first = est.update(0.5).etaSeconds!;
    clock.advance(1000);
    const stalled = est.update(0.4).etaSeconds!; // a regression is ignored
    expect(est.update(0.4).fraction).toBe(0.5);
    expect(stalled).toBeGreaterThan(0);
    expect(first).toBeGreaterThan(0);
  });

  it("counts down between reports without inventing a slowdown", () => {
    const clock = fakeClock();
    const est = new ProgressEstimator(clock.now);
    est.start();
    let eta = 0;
    for (let s = 2; s <= 20; s += 2) { clock.advance(2000); eta = est.update(s / 100).etaSeconds!; }
    clock.advance(3000);
    const ticked = est.tick().etaSeconds!;
    expect(ticked).toBeCloseTo(eta - 3, 0);
    clock.advance(1_000_000);
    expect(est.tick().etaSeconds).toBe(1); // floor while unfinished
    expect(est.tick().fraction).toBe(0.2);
  });

  it("clamps garbage input", () => {
    const clock = fakeClock();
    const est = new ProgressEstimator(clock.now);
    est.start();
    clock.advance(5000);
    expect(est.update(Number.NaN).fraction).toBe(0);
    expect(est.update(7).fraction).toBe(1);
    expect(est.update(7).etaSeconds).toBe(0);
  });
});

describe("formatEta", () => {
  it("formats unknown, seconds and minutes", () => {
    expect(formatEta(null)).toBe("estimating…");
    expect(formatEta(2)).toBe("a few seconds left");
    expect(formatEta(42)).toBe("about 40 s left");
    expect(formatEta(130)).toBe("about 2 min 10 s left");
    expect(formatEta(3700)).toBe("about 1 h 1 min left");
  });
});
