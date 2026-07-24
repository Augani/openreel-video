import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { MotionComposition, MotionLayer } from "@openreel/core";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { resetFrameCacheState } from "../frame-cache-state";
import { MotionTimeline } from "./MotionTimeline";

function layerWithScaleKeyframe(): MotionLayer {
  return {
    id: "layer-scale",
    type: "shape",
    name: "Accent Bar",
    startTime: 0,
    duration: 2,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [
      {
        id: "kf-scale",
        property: "transform.scale.x",
        time: 0.5,
        value: 1,
        easing: "linear",
      },
    ],
    shapeType: "rectangle",
    width: 320,
    height: 180,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#0f766e", width: 0, opacity: 0 },
      cornerRadius: 12,
    },
  } as unknown as MotionLayer;
}

function composition(): MotionComposition {
  return {
    id: "comp-marker",
    name: "Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 2,
    backgroundColor: "transparent",
    layers: [layerWithScaleKeyframe()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  } as MotionComposition;
}

async function seed(comp: MotionComposition): Promise<void> {
  useProjectStore.setState({ project: createEmptyProject("Marker") });
  useProjectStore.getState().actionExecutor.getHistory().clear();
  await useProjectStore.getState().upsertMotionComposition(comp);
}

describe("MotionTimeline keyframe markers", () => {
  beforeEach(() => {
    resetFrameCacheState();
  });

  afterEach(() => {
    cleanup();
    resetFrameCacheState();
  });

  it("renders keyframe markers as icons, not as visible property-name text", async () => {
    const comp = composition();
    await seed(comp);

    const { container } = render(<MotionTimeline composition={comp} />);

    let markers: HTMLElement[] = [];
    await waitFor(() => {
      markers = Array.from(
        container.querySelectorAll<HTMLElement>("button.rotate-45"),
      );
      expect(markers.length).toBeGreaterThan(0);
    });

    for (const marker of markers) {
      expect(marker.getAttribute("aria-label")).toBeTruthy();
      expect((marker.textContent ?? "").trim()).toBe("");
    }
  });
});
