import { describe, expect, it } from "vitest";
import {
  addMotionPuppetPin,
  applyMotionPuppetPinsToPathData,
  applyMotionPuppetPinsToPoints,
  clearMotionPuppetPins,
  createMotionPuppetPin,
  removeMotionPuppetPin,
  updateMotionPuppetPin,
} from "./motion-puppet";
import { buildMotionShapePolyline } from "./motion-shape-modifiers";
import type { MotionShapeLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

const makeShapeLayer = (): MotionShapeLayer => ({
  id: "shape-1",
  type: "shape",
  name: "Path",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "path",
  width: 100,
  height: 100,
  pathData: "M 0 0 L 100 0 L 200 0",
  pathClosed: false,
  style: {
    fill: { type: "none", opacity: 0 },
    stroke: { color: "#ffffff", width: 4, opacity: 1 },
    cornerRadius: 0,
  },
});

describe("motion puppet pins", () => {
  it("creates normalized puppet pins", () => {
    const pin = createMotionPuppetPin({
      idFactory: () => "pin-1",
      name: " ",
      bindPosition: { x: Number.NaN, y: 20 },
      position: { x: 40, y: Number.POSITIVE_INFINITY },
      radius: -5,
      strength: 4,
      enabled: true,
    });

    expect(pin).toMatchObject({
      id: "pin-1",
      name: "Puppet Pin",
      bindPosition: { x: 0, y: 20 },
      position: { x: 40, y: 0 },
      radius: 1,
      strength: 2,
      enabled: true,
    });
  });

  it("adds, updates, removes, and clears pins immutably", () => {
    const layer = makeShapeLayer();
    const pin = createMotionPuppetPin({
      id: "pin-1",
      bindPosition: { x: 0, y: 0 },
    });
    const withPin = addMotionPuppetPin(layer, pin);
    const moved = updateMotionPuppetPin(withPin, "pin-1", (current) => ({
      ...current,
      position: { x: 10, y: 20 },
    }));
    const removed = removeMotionPuppetPin(moved, "pin-1");
    const cleared = clearMotionPuppetPins(moved);

    expect(layer.puppetPins).toBeUndefined();
    expect(withPin.puppetPins).toHaveLength(1);
    expect(moved.puppetPins?.[0]?.position).toEqual({ x: 10, y: 20 });
    expect(removed.puppetPins).toEqual([]);
    expect(cleared.puppetPins).toEqual([]);
  });

  it("deforms nearby points with radial falloff", () => {
    const pin = createMotionPuppetPin({
      id: "pin-1",
      bindPosition: { x: 0, y: 0 },
      position: { x: 100, y: 0 },
      radius: 100,
      strength: 1,
    });
    const points = applyMotionPuppetPinsToPoints(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 150, y: 0 },
      ],
      [pin],
    );

    expect(points[0]).toEqual({ x: 100, y: 0 });
    expect(points[1]).toEqual({ x: 75, y: 0 });
    expect(points[2]).toEqual({ x: 100, y: 0 });
    expect(points[3]).toEqual({ x: 150, y: 0 });
  });

  it("combines multiple pins without overshooting their average influence", () => {
    const points = applyMotionPuppetPinsToPoints(
      [{ x: 0, y: 0 }],
      [
        createMotionPuppetPin({
          id: "pin-1",
          bindPosition: { x: 0, y: 0 },
          position: { x: 100, y: 0 },
          radius: 100,
          strength: 1,
        }),
        createMotionPuppetPin({
          id: "pin-2",
          bindPosition: { x: 0, y: 0 },
          position: { x: 0, y: 100 },
          radius: 100,
          strength: 1,
        }),
      ],
    );

    expect(points[0]).toEqual({ x: 50, y: 50 });
  });

  it("deforms path data deterministically", () => {
    const pin = createMotionPuppetPin({
      id: "pin-1",
      bindPosition: { x: 0, y: 0 },
      position: { x: 0, y: 50 },
      radius: 100,
    });

    expect(applyMotionPuppetPinsToPathData("M 0 0 L 100 0", [pin])).toBe(
      "M 0 50 L 100 0",
    );
  });

  it("applies puppet pins to shape polylines used by the renderer", () => {
    const layer = addMotionPuppetPin(
      makeShapeLayer(),
      createMotionPuppetPin({
        id: "pin-1",
        bindPosition: { x: 0, y: 0 },
        position: { x: 0, y: 100 },
        radius: 80,
      }),
    );

    expect(buildMotionShapePolyline(layer)[0]).toEqual({ x: 0, y: 100 });
    expect(buildMotionShapePolyline(layer)[1]).toEqual({ x: 100, y: 0 });
  });
});
