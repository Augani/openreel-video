import { describe, expect, it } from "vitest";
import { EASING_FUNCTIONS, cubicBezier } from "@openreel/core";
import type { EasingType } from "@openreel/core";
import {
  graphPointToNormalizedHandle,
  isFlatSegment,
  normalizedHandleToGraphPoint,
  sampleSegmentSpeed,
  seedBezierHandlesFromEasing,
  type GraphSegmentFrame,
} from "./graph-editor-curves";

function makeFrame(
  t0: number,
  t1: number,
  v0: number,
  v1: number,
): GraphSegmentFrame {
  const timeSpan = t1 - t0;
  const valueSpan = v1 - v0;
  const width = 300;
  const height = 150;
  return {
    t0,
    t1,
    v0,
    v1,
    toX: (time) => ((time - t0) / timeSpan) * width,
    toY: (value) => height - ((value - v0) / valueSpan) * height,
    fromX: (x) => t0 + (x / width) * timeSpan,
    fromY: (y) => v0 + ((height - y) / height) * valueSpan,
  };
}

describe("graph-editor-curves handle mapping", () => {
  const seg = makeFrame(1, 3, 100, 500);

  it("maps a normalized handle to a graph point via the panel mappers", () => {
    const point = normalizedHandleToGraphPoint({ x: 0.5, y: 0.5 }, seg);
    expect(point.x).toBeCloseTo(seg.toX(1 + 0.5 * 2), 6);
    expect(point.y).toBeCloseTo(seg.toY(100 + 0.5 * 400), 6);
  });

  it("round-trips point -> handle -> point within epsilon", () => {
    const handle = { x: 0.33, y: 0.72 };
    const point = normalizedHandleToGraphPoint(handle, seg);
    const back = graphPointToNormalizedHandle(point, seg);
    expect(back.x).toBeCloseTo(handle.x, 6);
    expect(back.y).toBeCloseTo(handle.y, 6);
    const forward = normalizedHandleToGraphPoint(back, seg);
    expect(forward.x).toBeCloseTo(point.x, 6);
    expect(forward.y).toBeCloseTo(point.y, 6);
  });

  it("clamps x to [0,1] and y to [-1,2]", () => {
    const belowPoint = normalizedHandleToGraphPoint({ x: -0.5, y: -3 }, seg);
    const belowHandle = graphPointToNormalizedHandle(belowPoint, seg);
    expect(belowHandle.x).toBe(0);
    expect(belowHandle.y).toBe(-1);
    const abovePoint = normalizedHandleToGraphPoint({ x: 5, y: 9 }, seg);
    const aboveHandle = graphPointToNormalizedHandle(abovePoint, seg);
    expect(aboveHandle.x).toBe(1);
    expect(aboveHandle.y).toBe(2);
  });
});

describe("graph-editor-curves seeding", () => {
  it("seeds linear approximately at thirds", () => {
    const handles = seedBezierHandlesFromEasing("linear");
    expect(handles.in.x).toBeCloseTo(1 / 3, 6);
    expect(handles.in.y).toBeCloseTo(1 / 3, 6);
    expect(handles.out.x).toBeCloseTo(2 / 3, 6);
    expect(handles.out.y).toBeCloseTo(2 / 3, 6);
  });

  it("seeds P1 and P2 at f(1/3) and f(2/3)", () => {
    const easing: EasingType = "ease-in-out";
    const handles = seedBezierHandlesFromEasing(easing);
    expect(handles.in.x).toBeCloseTo(1 / 3, 6);
    expect(handles.in.y).toBeCloseTo(EASING_FUNCTIONS[easing](1 / 3), 6);
    expect(handles.out.x).toBeCloseTo(2 / 3, 6);
    expect(handles.out.y).toBeCloseTo(EASING_FUNCTIONS[easing](2 / 3), 6);
  });

  it("a seeded ease-in-out curve tracks the named easing shape across samples", () => {
    const easing: EasingType = "ease-in-out";
    const handles = seedBezierHandlesFromEasing(easing);
    const seededValueAt = cubicBezier(
      handles.in.x,
      handles.in.y,
      handles.out.x,
      handles.out.y,
    );
    expect(seededValueAt(0)).toBeCloseTo(0, 6);
    expect(seededValueAt(1)).toBeCloseTo(1, 6);
    expect(seededValueAt(0.5)).toBeCloseTo(0.5, 6);
    let previous = -Infinity;
    let maxDeviation = 0;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const seeded = seededValueAt(t);
      expect(seeded).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = seeded;
      maxDeviation = Math.max(
        maxDeviation,
        Math.abs(seeded - EASING_FUNCTIONS[easing](t)),
      );
    }
    expect(maxDeviation).toBeLessThanOrEqual(0.1);
  });

  it("falls back to linear seeding for an unknown easing", () => {
    const handles = seedBezierHandlesFromEasing("bogus" as EasingType);
    expect(handles.in.y).toBeCloseTo(1 / 3, 6);
    expect(handles.out.y).toBeCloseTo(2 / 3, 6);
  });
});

describe("graph-editor-curves flat detection", () => {
  it("flags near-zero delta segments", () => {
    expect(isFlatSegment(10, 10)).toBe(true);
    expect(isFlatSegment(10, 10 + 5e-7)).toBe(true);
  });

  it("does not flag segments with delta above threshold", () => {
    expect(isFlatSegment(10, 10.001)).toBe(false);
    expect(isFlatSegment(0, 400)).toBe(false);
  });
});

describe("graph-editor-curves speed sampling", () => {
  it("returns the requested number of samples across the segment", () => {
    const samples = sampleSegmentSpeed(
      { t0: 0, t1: 2, v0: 0, v1: 400, easing: "linear" },
      16,
    );
    expect(samples).toHaveLength(16);
    expect(samples[0].time).toBeCloseTo(0, 6);
    expect(samples[samples.length - 1].time).toBeCloseTo(2, 6);
  });

  it("linear segment yields constant signed speed (v1-v0)/(t1-t0)", () => {
    const samples = sampleSegmentSpeed(
      { t0: 1, t1: 3, v0: 100, v1: 500, easing: "linear" },
      12,
    );
    for (const sample of samples) {
      expect(sample.speed).toBeCloseTo(200, 2);
    }
  });

  it("descending linear segment yields constant negative speed", () => {
    const samples = sampleSegmentSpeed(
      { t0: 0, t1: 2, v0: 400, v1: 0, easing: "linear" },
      12,
    );
    for (const sample of samples) {
      expect(sample.speed).toBeCloseTo(-200, 2);
    }
  });

  it("symmetric ease-in-out yields a symmetric speed with a mid-segment peak", () => {
    const samples = sampleSegmentSpeed(
      { t0: 0, t1: 2, v0: 0, v1: 400, easing: "ease-in-out" },
      21,
    );
    const speeds = samples.map((entry) => entry.speed);
    const peakIndex = speeds.reduce(
      (best, speed, index) => (speed > speeds[best] ? index : best),
      0,
    );
    expect(peakIndex).toBeGreaterThan(4);
    expect(peakIndex).toBeLessThan(16);
    const mid = Math.floor(samples.length / 2);
    for (let offset = 1; offset <= mid - 1; offset++) {
      expect(speeds[mid - offset]).toBeCloseTo(speeds[mid + offset], 2);
    }
    expect(speeds.every((speed) => speed >= -1e-6)).toBe(true);
  });

  it("hold easing holds value so interior samples have zero speed", () => {
    const samples = sampleSegmentSpeed(
      { t0: 0, t1: 2, v0: 0, v1: 400, easing: "hold" },
      12,
    );
    for (const sample of samples.slice(0, samples.length - 1)) {
      expect(sample.speed).toBeCloseTo(0, 6);
    }
  });

  it("evaluates a bezier segment as the engine does using bezierHandles", () => {
    const handles = seedBezierHandlesFromEasing("ease-out");
    const bezierSamples = sampleSegmentSpeed(
      {
        t0: 0,
        t1: 1,
        v0: 0,
        v1: 100,
        easing: "bezier",
        bezierHandles: handles,
      },
      16,
    );
    expect(bezierSamples[0].speed).toBeGreaterThan(
      bezierSamples[bezierSamples.length - 1].speed,
    );
  });
});
