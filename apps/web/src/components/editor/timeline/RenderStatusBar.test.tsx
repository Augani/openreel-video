import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, RenderCacheSnapshot } from "@openreel/core";

const mocks = vi.hoisted(() => ({
  project: null as unknown,
  snapshot: null as unknown,
  idle: { kind: "off" } as unknown,
  render: vi.fn(),
  cancel: vi.fn(),
  del: vi.fn(),
  loop: { loopStart: 0, loopEnd: 0 },
}));

vi.mock("../../../stores/project-store", () => ({
  useProjectStore: (selector: (state: { project: unknown }) => unknown) => selector({ project: mocks.project }),
}));
vi.mock("../../../stores/timeline-store", () => ({
  useTimelineStore: (selector: (state: typeof mocks.loop) => unknown) => selector(mocks.loop),
}));
vi.mock("../../../services/render-cache-service", () => ({
  useRenderCacheSnapshot: () => mocks.snapshot,
  useIdleRenderState: () => mocks.idle,
  renderCacheService: {
    stats: { mean: () => undefined },
    renderInToOut: (...args: unknown[]) => mocks.render(...args),
    cancelRender: () => mocks.cancel(),
    deleteRenderFiles: () => mocks.del(),
  },
}));

import { RenderCacheControls, RenderStatusBar } from "./RenderStatusBar";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };

function project(): Project {
  const clip = (id: string, start: number, effects: Array<{ id: string; type: string; params: Record<string, unknown>; enabled: boolean }>) => ({
    id,
    mediaId: "m1",
    trackId: "v1",
    startTime: start,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    effects,
    audioEffects: [],
    transform,
    volume: 1,
    keyframes: [],
  });
  return {
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "m1",
          name: "m1",
          type: "video",
          fileHandle: null,
          blob: null,
          metadata: { duration: 30, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      tracks: [
        {
          id: "v1",
          type: "video",
          name: "v1",
          clips: [
            clip("plain", 0, []),
            clip("heavy", 2, [
              { id: "1", type: "glow", params: { radius: 30 }, enabled: true },
              { id: "2", type: "gaussian-blur", params: { radius: 20 }, enabled: true },
            ]),
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      markers: [],
      duration: 4,
    },
  } as unknown as Project;
}

function snapshot(partial: Partial<RenderCacheSnapshot> = {}): RenderCacheSnapshot {
  return {
    phase: "idle",
    progress: null,
    cachedRuns: [],
    frameRate: 30,
    bytes: 0,
    budget: 1e9,
    frameCount: 0,
    codec: null,
    version: 0,
    lastSummary: null,
    maxWidth: 1920,
    restored: null,
    ...partial,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

beforeEach(() => {
  mocks.project = project();
  mocks.snapshot = snapshot();
  mocks.idle = { kind: "off" };
  mocks.render.mockReset();
  mocks.cancel.mockReset();
  mocks.del.mockReset();
  mocks.loop = { loopStart: 0, loopEnd: 0 };
});

describe("RenderStatusBar", () => {
  it("draws nothing for plain media and a red segment for the effects-heavy clip, positioned on the timeline scale", async () => {
    render(<RenderStatusBar pixelsPerSecond={100} width={400} />);
    await flush();
    const segments = screen.getAllByTestId("render-status-segment");
    expect(segments).toHaveLength(1);
    expect(segments[0].dataset.level).toBe("heavy");
    expect(segments[0].style.left).toBe("200px");
    expect(segments[0].style.width).toBe("200px");
  });

  it("turns the rendered part green and leaves the rest red", async () => {
    mocks.snapshot = snapshot({ cachedRuns: [{ start: 60, end: 89 }], frameCount: 30 });
    render(<RenderStatusBar pixelsPerSecond={100} width={400} />);
    await flush();
    const levels = screen.getAllByTestId("render-status-segment").map((el) => [el.dataset.level, el.dataset.start, el.dataset.end]);
    expect(levels).toEqual([
      ["cached", "2.000", "3.000"],
      ["heavy", "3.000", "4.000"],
    ]);
  });
});

describe("RenderStatusBar background progress", () => {
  it("draws progress over the chunk being rendered in the background and flags the bar", async () => {
    mocks.idle = { kind: "rendering", range: { start: 2, end: 3 } };
    mocks.snapshot = snapshot({ phase: "rendering", progress: { done: 15, total: 30, range: { start: 2, end: 3 } } });
    render(<RenderStatusBar pixelsPerSecond={100} width={400} />);
    await flush();
    const progress = screen.getByTestId("render-status-progress");
    expect(progress.style.left).toBe("200px");
    expect(progress.style.width).toBe("50px");
    expect(progress.dataset.idle).toBe("true");
    expect(screen.getByTestId("render-status-bar").dataset.idleRender).toBe("rendering");
  });

  it("shows no progress strip when nothing is rendering", async () => {
    render(<RenderStatusBar pixelsPerSecond={100} width={400} />);
    await flush();
    expect(screen.queryByTestId("render-status-progress")).toBeNull();
  });
});

describe("RenderCacheControls", () => {
  it("renders on click, and Delete render files is disabled with nothing cached", () => {
    render(<RenderCacheControls />);
    fireEvent.click(screen.getByRole("button", { name: "Render In to Out" }));
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Delete render files" })).toBeDisabled();
  });

  it("shows cancellable progress while rendering", () => {
    mocks.snapshot = snapshot({ phase: "rendering", progress: { done: 15, total: 60, range: { start: 0, end: 2 } }, frameCount: 15 });
    render(<RenderCacheControls />);
    expect(screen.getByRole("progressbar", { name: "Render progress" }).getAttribute("aria-valuenow")).toBe("25");
    expect(screen.queryByRole("button", { name: "Render In to Out" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel render" }));
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it("deletes render files when frames exist", () => {
    mocks.snapshot = snapshot({ frameCount: 30, bytes: 5_000_000 });
    render(<RenderCacheControls />);
    const button = screen.getByRole("button", { name: "Delete render files" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });
});
