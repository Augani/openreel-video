import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  clearMotionLayerTrackMatte,
  getAvailableMotionTrackMatteSources,
  getMotionTrackMatteSource,
  isInvertedMotionTrackMatte,
  isLumaMotionTrackMatte,
  setMotionLayerTrackMatte,
  toggleMotionLayerTrackMatte,
} from "./motion-track-mattes";

const makeLayer = (id: string, parentId?: string): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  parentId,
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

const makeComposition = (layers: MotionLayer[]): MotionComposition => ({
  id: "motion-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers,
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("motion track mattes", () => {
  it("sets, toggles, resolves, and clears a track matte immutably", () => {
    const fill = makeLayer("fill");
    const matte = makeLayer("matte");
    const withMatte = setMotionLayerTrackMatte(fill, {
      enabled: true,
      sourceLayerId: "matte",
      type: "alpha",
    });
    const composition = makeComposition([withMatte, matte]);
    const disabled = toggleMotionLayerTrackMatte(withMatte, false);
    const cleared = clearMotionLayerTrackMatte(withMatte);

    expect(fill.trackMatte).toBeUndefined();
    expect(getMotionTrackMatteSource(composition, withMatte)?.id).toBe("matte");
    expect(disabled.trackMatte?.enabled).toBe(false);
    expect(cleared.trackMatte).toBeUndefined();
  });

  it("excludes the layer and descendants from matte source candidates", () => {
    const composition = makeComposition([
      makeLayer("fill"),
      makeLayer("child", "fill"),
      makeLayer("matte"),
    ]);

    expect(
      getAvailableMotionTrackMatteSources(composition, "fill").map(
        (layer) => layer.id,
      ),
    ).toEqual(["matte"]);
  });

  it("classifies inverted and luma matte types", () => {
    expect(isInvertedMotionTrackMatte("alpha")).toBe(false);
    expect(isInvertedMotionTrackMatte("alpha-inverted")).toBe(true);
    expect(isLumaMotionTrackMatte("luma")).toBe(true);
    expect(isLumaMotionTrackMatte("luma-inverted")).toBe(true);
  });
});
