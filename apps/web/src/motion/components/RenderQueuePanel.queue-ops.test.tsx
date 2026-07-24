import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import type { ExportMotionCompositionSceneOptions } from "../export-motion-frame";

const exportMock = vi.fn();

vi.mock("../export-motion-frame", async () => {
  const actual = await vi.importActual<
    typeof import("../export-motion-frame")
  >("../export-motion-frame");
  return {
    ...actual,
    exportMotionCompositionScene: (
      options: ExportMotionCompositionSceneOptions,
    ) => exportMock(options),
  };
});

import { RenderQueuePanel } from "./RenderQueuePanel";

const COMP_ID = "comp-queue-ops";

function composition(): MotionComposition {
  return {
    id: COMP_ID,
    name: "Queue Ops Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function seedProject(): void {
  const project = {
    ...createEmptyProject("Queue ops test"),
    motionCompositions: [composition()],
  };
  useProjectStore.setState({ hasOpenProject: true, project });
  useMotionStore.setState({ renderQueue: [] });
}

function queue() {
  return useMotionStore.getState().renderQueue;
}

describe("RenderQueuePanel queue ops", () => {
  beforeEach(() => {
    exportMock.mockReset();
    exportMock.mockResolvedValue({
      filename: "out.mp4",
      width: 1280,
      height: 720,
      duration: 4,
      framesRendered: 120,
    });
    seedProject();
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
    useMotionStore.setState({ renderQueue: [] });
  });

  it("adds a job carrying range, half resolution, and png-sequence format", () => {
    render(<RenderQueuePanel composition={composition()} embedded />);

    fireEvent.change(screen.getByRole("combobox", { name: /output format/i }), {
      target: { value: "png-sequence" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^resolution half$/i }),
    );
    fireEvent.change(screen.getByLabelText(/range start/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/range end/i), {
      target: { value: "3" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^current$/i }));

    const items = queue();
    expect(items).toHaveLength(1);
    expect(items[0].format).toBe("png-sequence");
    expect(items[0].resolutionScale).toBe(0.5);
    expect(items[0].range).toEqual({ startTime: 1, endTime: 3 });
  });

  it("rejects an invalid range where start is not before end", () => {
    render(<RenderQueuePanel composition={composition()} embedded />);

    fireEvent.change(screen.getByLabelText(/range start/i), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/range end/i), {
      target: { value: "3" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^current$/i }));

    expect(queue()).toHaveLength(0);
  });

  it("cancels a queued item immediately to canceled status", () => {
    render(<RenderQueuePanel composition={composition()} embedded />);
    act(() => {
      useMotionStore.getState().addRenderQueueItem({
        compositionId: COMP_ID,
        name: "Queue Ops Comp",
        width: 1280,
        height: 720,
        frameRate: 30,
        duration: 4,
        format: "mp4",
      });
    });

    const id = queue()[0].id;
    act(() => {
      useMotionStore.getState().cancelRenderQueueItem(id);
    });

    expect(queue()[0].status).toBe("canceled");
  });

  it("reorders items with moveRenderQueueItem", () => {
    const first = useMotionStore.getState().addRenderQueueItem({
      compositionId: COMP_ID,
      name: "A",
      width: 100,
      height: 100,
      frameRate: 30,
      duration: 1,
      format: "mp4",
    });
    const second = useMotionStore.getState().addRenderQueueItem({
      compositionId: COMP_ID,
      name: "B",
      width: 100,
      height: 100,
      frameRate: 30,
      duration: 1,
      format: "mp4",
    });

    useMotionStore.getState().moveRenderQueueItem(second, "up");
    expect(queue().map((item) => item.id)).toEqual([second, first]);

    useMotionStore.getState().moveRenderQueueItem(second, "down");
    expect(queue().map((item) => item.id)).toEqual([first, second]);

    useMotionStore.getState().moveRenderQueueItem(first, "up");
    expect(queue().map((item) => item.id)).toEqual([first, second]);
  });

  it("runQueue threads range/resolutionScale/isCanceled into the export fn", async () => {
    useMotionStore.setState({
      renderQueue: [
        {
          id: "job-run",
          compositionId: COMP_ID,
          name: "Queue Ops Comp",
          width: 1280,
          height: 720,
          frameRate: 30,
          duration: 4,
          format: "mp4",
          status: "queued",
          progress: 0,
          createdAt: 1,
          range: { startTime: 0.5, endTime: 2 },
          resolutionScale: 0.25,
        },
      ],
    });
    render(<RenderQueuePanel composition={composition()} embedded />);

    fireEvent.click(
      screen.getAllByRole("button", { name: /start render queue/i })[0],
    );

    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1));
    const options = exportMock.mock.calls[0][0] as ExportMotionCompositionSceneOptions;
    expect(options.range).toEqual({ startTime: 0.5, endTime: 2 });
    expect(options.resolutionScale).toBe(0.25);
    expect(typeof options.isCanceled).toBe("function");
  });

  it("marks a running item canceled when cancelRequested is set mid-run and continues the queue", async () => {
    let firstCancelChecker: (() => boolean) | undefined;
    exportMock.mockImplementation(
      async (options: ExportMotionCompositionSceneOptions) => {
        if (!firstCancelChecker) {
          firstCancelChecker = options.isCanceled;
          useMotionStore.getState().cancelRenderQueueItem("job-a");
          if (options.isCanceled?.()) {
            return {
              filename: "",
              width: 1280,
              height: 720,
              duration: 4,
              framesRendered: 3,
              canceled: true,
            };
          }
        }
        return {
          filename: "out.mp4",
          width: 1280,
          height: 720,
          duration: 4,
          framesRendered: 120,
        };
      },
    );

    useMotionStore.setState({
      renderQueue: [
        {
          id: "job-a",
          compositionId: COMP_ID,
          name: "Queue Ops Comp",
          width: 1280,
          height: 720,
          frameRate: 30,
          duration: 4,
          format: "mp4",
          status: "queued",
          progress: 0,
          createdAt: 1,
        },
        {
          id: "job-b",
          compositionId: COMP_ID,
          name: "Queue Ops Comp",
          width: 1280,
          height: 720,
          frameRate: 30,
          duration: 4,
          format: "mp4",
          status: "queued",
          progress: 0,
          createdAt: 2,
        },
      ],
    });
    render(<RenderQueuePanel composition={composition()} embedded />);

    fireEvent.click(
      screen.getAllByRole("button", { name: /start render queue/i })[0],
    );

    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const items = queue();
      expect(items.find((item) => item.id === "job-a")?.status).toBe(
        "canceled",
      );
      expect(items.find((item) => item.id === "job-b")?.status).toBe(
        "complete",
      );
    });
  });

  it("shows a per-row cancel control for a queued item", () => {
    useMotionStore.setState({
      renderQueue: [
        {
          id: "job-cancel-ui",
          compositionId: COMP_ID,
          name: "Cancel UI",
          width: 1280,
          height: 720,
          frameRate: 30,
          duration: 4,
          format: "mp4",
          status: "queued",
          progress: 0,
          createdAt: 1,
        },
      ],
    });
    render(<RenderQueuePanel composition={composition()} embedded />);

    const row = screen.getByText("Cancel UI").closest("div")!
      .parentElement as HTMLElement;
    expect(
      within(row).getByRole("button", { name: /cancel render job/i }),
    ).toBeInTheDocument();
  });
});
