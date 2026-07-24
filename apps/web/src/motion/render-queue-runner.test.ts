import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotionComposition } from "@openreel/core";
import type { Project } from "@openreel/core/types/project";

const { exportMock } = vi.hoisted(() => ({
  exportMock: vi.fn(),
}));

vi.mock("./export-motion-frame", () => ({
  exportMotionCompositionScene: exportMock,
}));

import {
  isRenderQueueRunning,
  runMotionRenderQueue,
} from "./render-queue-runner";
import { useMotionStore } from "./stores/motion-store";

function makeComposition(): MotionComposition {
  return {
    id: "comp-run",
    name: "Run Scene",
    width: 640,
    height: 360,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  } as unknown as MotionComposition;
}

function makeProject(): Project {
  return { id: "project-run" } as unknown as Project;
}

function seedQueuedItem(composition: MotionComposition): string {
  return useMotionStore.getState().addRenderQueueItem({
    compositionId: composition.id,
    name: composition.name,
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    duration: composition.duration,
    format: "mp4",
  });
}

describe("runMotionRenderQueue re-entrancy guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMotionStore.setState({ renderQueue: [], exportActive: false });
  });

  afterEach(() => {
    useMotionStore.setState({ renderQueue: [], exportActive: false });
  });

  it("processes each item exactly once when two runs are started concurrently", async () => {
    const composition = makeComposition();
    seedQueuedItem(composition);
    const deps = { project: makeProject(), compositions: [composition] };

    let releaseExport: (() => void) | null = null;
    exportMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseExport = () =>
            resolve({
              filename: "run-scene.mp4",
              width: composition.width,
              height: composition.height,
              duration: composition.duration,
              framesRendered: 120,
            });
        }),
    );

    useMotionStore.setState({ isPlaying: true });
    const first = runMotionRenderQueue(deps);
    const second = runMotionRenderQueue(deps);

    expect(isRenderQueueRunning()).toBe(true);
    expect(useMotionStore.getState().exportActive).toBe(true);
    expect(useMotionStore.getState().isPlaying).toBe(false);
    useMotionStore.getState().play();
    useMotionStore.getState().togglePlayback();
    expect(useMotionStore.getState().isPlaying).toBe(false);

    const secondResult = await second;
    expect(secondResult.alreadyRunning).toBe(true);
    expect(secondResult.outcomes).toHaveLength(0);

    if (releaseExport === null) throw new Error("export never invoked");
    (releaseExport as () => void)();

    const firstResult = await first;
    expect(firstResult.alreadyRunning).toBe(false);
    expect(firstResult.outcomes).toHaveLength(1);
    expect(exportMock).toHaveBeenCalledTimes(1);
    expect(isRenderQueueRunning()).toBe(false);
    expect(useMotionStore.getState().exportActive).toBe(false);
  });

  it("clears the guard after a run completes so a later run can proceed", async () => {
    const composition = makeComposition();
    seedQueuedItem(composition);
    const deps = { project: makeProject(), compositions: [composition] };
    exportMock.mockResolvedValue({
      filename: "run-scene.mp4",
      width: composition.width,
      height: composition.height,
      duration: composition.duration,
      framesRendered: 120,
    });

    const firstRun = await runMotionRenderQueue(deps);
    expect(firstRun.alreadyRunning).toBe(false);
    expect(isRenderQueueRunning()).toBe(false);

    seedQueuedItem(composition);
    const secondRun = await runMotionRenderQueue(deps);
    expect(secondRun.alreadyRunning).toBe(false);
    expect(secondRun.outcomes).toHaveLength(1);
  });

  it("threads the actually-encoded format from the export result into the outcome", async () => {
    const composition = makeComposition();
    useMotionStore.getState().addRenderQueueItem({
      compositionId: composition.id,
      name: composition.name,
      width: composition.width,
      height: composition.height,
      frameRate: composition.frameRate,
      duration: composition.duration,
      format: "webm-alpha",
    });
    const deps = { project: makeProject(), compositions: [composition] };
    exportMock.mockResolvedValue({
      filename: "run-scene.mp4",
      width: composition.width,
      height: composition.height,
      duration: composition.duration,
      framesRendered: 120,
      encodedFormat: "mp4",
      normalizedToH264: true,
    });

    const result = await runMotionRenderQueue(deps);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].encodedFormat).toBe("mp4");
    expect(result.outcomes[0].filename?.endsWith(".mp4")).toBe(true);
  });

  it("falls back to the requested format when the export omits encodedFormat", async () => {
    const composition = makeComposition();
    seedQueuedItem(composition);
    const deps = { project: makeProject(), compositions: [composition] };
    exportMock.mockResolvedValue({
      filename: "run-scene.mp4",
      width: composition.width,
      height: composition.height,
      duration: composition.duration,
      framesRendered: 120,
    });

    const result = await runMotionRenderQueue(deps);
    expect(result.outcomes[0].encodedFormat).toBe("mp4");
  });

  it("clears the guard when an export throws", async () => {
    const composition = makeComposition();
    seedQueuedItem(composition);
    const deps = { project: makeProject(), compositions: [composition] };
    exportMock.mockRejectedValue(new Error("boom"));

    const result = await runMotionRenderQueue(deps);
    expect(result.alreadyRunning).toBe(false);
    expect(result.outcomes[0]?.status).toBe("failed");
    expect(isRenderQueueRunning()).toBe(false);
  });
});
