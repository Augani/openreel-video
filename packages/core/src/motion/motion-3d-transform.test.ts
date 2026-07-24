import { describe, expect, it } from "vitest";
import type { MotionLayer } from "./types";
import {
  DEFAULT_MOTION_TRANSFORM,
} from "./types";
import {
  getMotionCanvas3DProjection,
  hasMotion3DRotation,
  hasMotion3DTransform,
  motionLayerMayUse3D,
  projectMotion3DPlanePoint,
  projectMotion3DPosition,
} from "./motion-3d-transform";

const makeLayer = (): MotionLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Panel",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 100,
  style: {
    fill: { type: "solid", color: "#ffffff", opacity: 1 },
    stroke: { color: "#ffffff", width: 0, opacity: 0 },
    cornerRadius: 0,
  },
});

describe("motion 3D transform helpers", () => {
  it("projects z depth and X/Y rotation into deterministic canvas scales", () => {
    const projection = getMotionCanvas3DProjection({
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: 0, y: 0, z: 500 },
      rotation3d: { x: 60, y: 45 },
      perspective: 1000,
    });

    expect(projection.depthScale).toBeCloseTo(2, 5);
    expect(projection.rotationXScale).toBeCloseTo(0.5, 5);
    expect(projection.rotationYScale).toBeCloseTo(Math.SQRT1_2, 5);
    expect(projection.scaleX).toBeCloseTo(Math.SQRT2, 5);
    expect(projection.scaleY).toBeCloseTo(1, 5);
  });

  it("applies perspective parallax to position by depth and leaves z=0 unchanged", () => {
    const center = { x: 960, y: 540 };
    const flat = projectMotion3DPosition({ x: 1200, y: 700, z: 0 }, 1000, center);
    expect(flat).toEqual({ x: 1200, y: 700 });

    const near = projectMotion3DPosition({ x: 1200, y: 700, z: 500 }, 1000, center);
    expect(near.x).toBeCloseTo(960 + (1200 - 960) * 2, 5);
    expect(near.y).toBeCloseTo(540 + (700 - 540) * 2, 5);
  });

  it("projects a rotated plane corner to a perspective-foreshortened position", () => {
    const flatTransform = {
      ...DEFAULT_MOTION_TRANSFORM,
      rotation3d: { x: 0, y: 0 },
      perspective: 1000,
    };
    expect(hasMotion3DRotation(flatTransform)).toBe(false);
    expect(projectMotion3DPlanePoint(100, 50, flatTransform)).toEqual({
      x: 100,
      y: 50,
    });

    const rotated = {
      ...DEFAULT_MOTION_TRANSFORM,
      rotation3d: { x: 0, y: 45 },
      perspective: 1000,
    };
    expect(hasMotion3DRotation(rotated)).toBe(true);
    const left = projectMotion3DPlanePoint(-100, 0, rotated);
    const right = projectMotion3DPlanePoint(100, 0, rotated);
    // The edge rotating toward the viewer projects wider than the receding edge.
    expect(Math.abs(right.x)).toBeGreaterThan(Math.abs(left.x));
  });

  it("detects static and animated 3D transform usage", () => {
    const flatLayer = makeLayer();
    const staticLayer: MotionLayer = {
      ...flatLayer,
      transform: {
        ...flatLayer.transform,
        rotation3d: { x: 0, y: 35 },
      },
    };
    const animatedLayer: MotionLayer = {
      ...flatLayer,
      keyframes: [
        {
          id: "depth",
          time: 1,
          property: "transform.position.z",
          value: 120,
          easing: "ease",
        },
      ],
    };

    expect(hasMotion3DTransform(flatLayer.transform)).toBe(false);
    expect(motionLayerMayUse3D(flatLayer)).toBe(false);
    expect(motionLayerMayUse3D(staticLayer)).toBe(true);
    expect(motionLayerMayUse3D(animatedLayer)).toBe(true);
  });
});
