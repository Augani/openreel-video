import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  getMotionBlurSamplePlanAtTime,
  getMotionBlurSampleTimes,
  normalizeMotionBlurSettings,
} from "./motion-blur";

const makeLayer = (motionBlur = false): MotionLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Panel",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  motionBlur,
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

const makeComposition = (
  motionBlur: MotionComposition["motionBlur"],
): MotionComposition => ({
  id: "motion-1",
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
  motionBlur,
  createdAt: 0,
  modifiedAt: 0,
});

describe("motion blur", () => {
  it("normalizes shutter settings into safe render ranges", () => {
    expect(
      normalizeMotionBlurSettings({
        enabled: true,
        shutterAngle: 900,
        shutterPhase: -720,
        samples: 99,
      }),
    ).toEqual({
      enabled: true,
      shutterAngle: 720,
      shutterPhase: -360,
      samples: 32,
    });
  });

  it("generates deterministic sample times from shutter angle and phase", () => {
    expect(
      getMotionBlurSampleTimes(1, 30, {
        enabled: true,
        shutterAngle: 180,
        shutterPhase: -90,
        samples: 3,
      }).map((time) => Number(time.toFixed(6))),
    ).toEqual([0.991667, 1, 1.008333]);
  });

  it("only enables layer sampling when composition and layer are enabled", () => {
    const composition = makeComposition({
      enabled: true,
      shutterAngle: 180,
      shutterPhase: -90,
      samples: 4,
    });

    expect(
      getMotionBlurSamplePlanAtTime(composition, makeLayer(false), 2),
    ).toMatchObject({ enabled: false, sampleTimes: [2], weight: 1 });
    expect(
      getMotionBlurSamplePlanAtTime(composition, makeLayer(true), 2),
    ).toMatchObject({ enabled: true, weight: 0.25 });
  });
});
