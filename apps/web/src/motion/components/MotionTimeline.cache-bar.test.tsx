import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import {
  resetFrameCacheState,
  setFrameCacheState,
} from "../frame-cache-state";
import { MotionTimeline } from "./MotionTimeline";

function composition(): MotionComposition {
  return {
    id: "comp-cache",
    name: "Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 2,
    backgroundColor: "transparent",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  } as MotionComposition;
}

async function seed(comp: MotionComposition): Promise<void> {
  useProjectStore.setState({ project: createEmptyProject("Cache Bar") });
  useProjectStore.getState().actionExecutor.getHistory().clear();
  await useProjectStore.getState().upsertMotionComposition(comp);
}

describe("MotionTimeline cache bar", () => {
  beforeEach(() => {
    resetFrameCacheState();
  });

  afterEach(() => {
    cleanup();
    resetFrameCacheState();
  });

  it("renders a green cache-bar segment mapped frame->time->px", async () => {
    const comp = composition();
    await seed(comp);
    setFrameCacheState({ ranges: [{ start: 0, end: 14 }] });

    const { container } = render(<MotionTimeline composition={comp} />);

    let segments: HTMLElement[] = [];
    await waitFor(() => {
      segments = Array.from(
        container.querySelectorAll<HTMLElement>('[data-testid="cache-bar-segment"]'),
      );
      expect(segments).toHaveLength(1);
    });

    const segment = segments[0];
    expect(segment.style.left).toBe("0%");
    const width = Number.parseFloat(segment.style.width);
    expect(width).toBeCloseTo((14 / 30 / 2) * 100, 3);
  });

  it("renders no segments when ranges are empty", async () => {
    const comp = composition();
    await seed(comp);
    setFrameCacheState({ ranges: [] });

    const { container } = render(<MotionTimeline composition={comp} />);

    await waitFor(() => {
      expect(
        useProjectStore.getState().project.motionCompositions ?? [],
      ).toHaveLength(1);
    });

    const segments = container.querySelectorAll('[data-testid="cache-bar-segment"]');
    expect(segments).toHaveLength(0);
  });
});
