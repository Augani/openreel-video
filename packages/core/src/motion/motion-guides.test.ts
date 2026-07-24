import { describe, expect, it } from "vitest";
import type { MotionComposition } from "./types";
import {
  addMotionCompositionGuide,
  clearMotionCompositionGuides,
  createMotionGuide,
  getMotionGuideSnapPosition,
  moveMotionCompositionGuide,
  removeMotionCompositionGuide,
  updateMotionCompositionGuide,
} from "./motion-guides";

const makeComposition = (): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

describe("motion guides", () => {
  it("creates and adds sanitized composition guides immutably", () => {
    const composition = makeComposition();
    const guide = createMotionGuide("vertical", Number.NaN, {
      id: "guide-1",
      color: "  #14b8a6  ",
    });
    const updated = addMotionCompositionGuide(composition, guide);

    expect(composition.guides).toBeUndefined();
    expect(updated.guides).toEqual([
      {
        id: "guide-1",
        orientation: "vertical",
        position: 0,
        color: "#14b8a6",
      },
    ]);
  });

  it("updates, removes, and clears guides", () => {
    const composition = addMotionCompositionGuide(
      addMotionCompositionGuide(
        makeComposition(),
        createMotionGuide("vertical", 200, { id: "guide-1" }),
      ),
      createMotionGuide("horizontal", 300, { id: "guide-2" }),
    );
    const updated = updateMotionCompositionGuide(
      composition,
      "guide-1",
      (guide) => ({
        ...guide,
        position: 420.12345,
        locked: true,
      }),
    );
    const removed = removeMotionCompositionGuide(updated, "guide-2");
    const cleared = clearMotionCompositionGuides(removed);

    expect(updated.guides?.[0]).toMatchObject({
      id: "guide-1",
      position: 420.1234,
      locked: true,
    });
    expect(removed.guides?.map((guide) => guide.id)).toEqual(["guide-1"]);
    expect(cleared.guides).toEqual([]);
  });

  it("maps guide orientation to snap axes", () => {
    expect(
      getMotionGuideSnapPosition(
        createMotionGuide("vertical", 100, { id: "v" }),
      ),
    ).toEqual({ axis: "x", position: 100 });
    expect(
      getMotionGuideSnapPosition(
        createMotionGuide("horizontal", 200, { id: "h" }),
      ),
    ).toEqual({ axis: "y", position: 200 });
  });

  it("moves guides with clamping, grid snapping, and lock protection", () => {
    const composition = addMotionCompositionGuide(
      addMotionCompositionGuide(
        makeComposition(),
        createMotionGuide("vertical", 100, { id: "guide-1" }),
      ),
      createMotionGuide("horizontal", 100, {
        id: "guide-2",
        locked: true,
      }),
    );
    const moved = moveMotionCompositionGuide(composition, "guide-1", 203, {
      snapGridSize: 40,
    });
    const blocked = moveMotionCompositionGuide(moved, "guide-2", 900);
    const included = moveMotionCompositionGuide(blocked, "guide-2", 1400, {
      includeLocked: true,
    });

    expect(moved.guides?.[0]?.position).toBe(200);
    expect(blocked.guides?.[1]?.position).toBe(100);
    expect(included.guides?.[1]?.position).toBe(1080);
  });
});
