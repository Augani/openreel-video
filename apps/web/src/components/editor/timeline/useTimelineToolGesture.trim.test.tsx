import { useRef } from "react";
import { ActionExecutor, type Clip } from "@openreel/core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEngineStore } from "../../../stores/engine-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useTimelineToolGesture } from "./useTimelineToolGesture";
import { useTimelineToolPreview } from "./timeline-tool-preview";
import { TimelineToolGhost } from "./TimelineToolGhost";

const IDS = ["a", "b", "c"];
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useTimelineToolGesture(ref, 100, () => {});
  return (
    <div ref={ref} data-testid="lane" {...gesture}>
      {IDS.map((id) => (
        <div key={id} data-timeline-item-id={id} tabIndex={0} data-testid={id}>
          <span data-timeline-trim="left" data-testid={`${id}-left`} />
          <span data-timeline-trim="right" data-testid={`${id}-right`} />
        </div>
      ))}
      <TimelineToolGhost trackId="main" pixelsPerSecond={100} />
    </div>
  );
}
const makeClip = (id: string, startTime: number, inPoint: number, outPoint: number): Clip => ({
  id,
  trackId: "main",
  mediaId: "source",
  startTime,
  duration: outPoint - inPoint,
  inPoint,
  outPoint,
  speed: 1,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
  },
});
function fixture(gap = 0) {
  const project = createEmptyProject("Trim gestures");
  return {
    ...project,
    settings: { ...project.settings, frameRate: 30 },
    mediaLibrary: {
      items: [
        {
          id: "source",
          name: "Source",
          type: "video" as const,
          fileHandle: null,
          blob: null,
          thumbnailUrl: null,
          waveformData: new Float32Array(10),
          metadata: { duration: 40, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
        },
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 12 + gap,
      tracks: [
        {
          id: "main",
          name: "Main",
          type: "video" as const,
          locked: false,
          hidden: false,
          solo: false,
          muted: false,
          transitions: [],
          clips: [makeClip("a", 0, 5, 9), makeClip("b", 4, 10, 14), makeClip("c", 8 + gap, 20, 24)],
        },
      ],
    },
  };
}
const clipById = (id: string) =>
  useProjectStore.getState().project.timeline.tracks[0].clips.find((c) => c.id === id)!;
const historySize = () =>
  useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
function setup(tool: "roll" | "slide" | "stretch", gap = 0) {
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project: fixture(gap),
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    clipUndoStack: [],
    clipRedoStack: [],
    templateUndoStack: [],
    templateRedoStack: [],
    redoJournal: [],
  });
  useEditorWorkspaceStore.setState({ timelineTool: tool, linkedSelection: false });
  const view = render(<Harness />);
  vi.spyOn(view.getByTestId("lane"), "getBoundingClientRect").mockReturnValue(
    new DOMRect(-200, 0, 1800, 60),
  );
  return view;
}
const begin = (target: Element) => fireEvent.mouseDown(target, { button: 0, clientX: 100 });
const move = (x: number) => fireEvent.mouseMove(window, { clientX: x, buttons: 1 });
const end = (x: number) => fireEvent.mouseUp(window, { button: 0, clientX: x });
const frame = () => act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });

beforeEach(() => {
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused" });
  useUIStore.setState({
    selectedItems: [],
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useTimelineToolPreview.getState().setGhost(null);
});

describe("roll, slide and stretch gestures", () => {
  it("rolls a cut as one undo step and previews both clips without touching canonical data", async () => {
    const view = setup("roll");
    const original = structuredClone(useProjectStore.getState().project.timeline.tracks[0].clips);
    begin(view.getByTestId("a-right"));
    move(200);
    await frame();
    const ghost = useTimelineToolPreview.getState().ghost;
    expect(ghost).toMatchObject({ trackId: "main", startTime: 0, duration: 5 });
    expect(ghost?.neighbor).toMatchObject({ startTime: 5, duration: 3 });
    expect(view.container.querySelectorAll(".workspace-timeline-tool-ghost")).toHaveLength(2);
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toEqual(original);
    expect(historySize()).toBe(0);
    end(200);
    expect(clipById("a")).toMatchObject({ duration: 5, outPoint: 10 });
    expect(clipById("b")).toMatchObject({ startTime: 5, duration: 3, inPoint: 11 });
    expect(historySize()).toBe(1);
    expect(useTimelineToolPreview.getState().ghost).toBeNull();
    await act(async () => {
      expect((await useProjectStore.getState().undo()).success).toBe(true);
    });
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toEqual(original);
    expect(historySize()).toBe(0);
  });
  it("rolls from the right clip's left edge too", async () => {
    const view = setup("roll");
    begin(view.getByTestId("b-left"));
    move(0);
    end(0);
    expect(clipById("a").duration).toBe(3);
    expect(clipById("b")).toMatchObject({ startTime: 3, duration: 5, inPoint: 9 });
    expect(historySize()).toBe(1);
  });
  it("slides the clip body between its neighbours in one undo step", async () => {
    const view = setup("slide");
    begin(view.getByTestId("b"));
    move(200);
    await frame();
    expect(useTimelineToolPreview.getState().ghost).toMatchObject({ startTime: 5, duration: 4 });
    // Both adjusted neighbours get a ghost with a live length readout.
    expect(useTimelineToolPreview.getState().ghost?.neighbors).toHaveLength(2);
    expect(view.container.querySelectorAll("[data-neighbor-ghost]")).toHaveLength(2);
    expect(useTimelineToolPreview.getState().ghost?.label).toMatch(/^Slide \+00:00:01:00/);
    expect(useTimelineToolPreview.getState().ghost?.neighbors?.[0].label).toBe("00:00:05:00 · 00:00:00:00");
    end(200);
    expect(clipById("a")).toMatchObject({ duration: 5, outPoint: 10 });
    expect(clipById("b")).toMatchObject({ startTime: 5, duration: 4, inPoint: 10, outPoint: 14 });
    expect(clipById("c")).toMatchObject({ startTime: 9, duration: 3, inPoint: 21 });
    expect(historySize()).toBe(1);
  });
  it("stretches a clip edge by changing speed, not source range", async () => {
    const view = setup("stretch", 3);
    begin(view.getByTestId("b-right"));
    move(200);
    await frame();
    expect(useTimelineToolPreview.getState().ghost?.label).toContain("80%");
    end(200);
    expect(clipById("b")).toMatchObject({ startTime: 4, duration: 5, inPoint: 10, outPoint: 14 });
    expect(clipById("b").speed).toBeCloseTo(4 / 5, 8);
    expect(historySize()).toBe(1);
  });
  it("does not edit from a clip body in the edge tools", async () => {
    const view = setup("stretch", 3);
    begin(view.getByTestId("b"));
    move(300);
    end(300);
    expect(historySize()).toBe(0);
    expect(clipById("b").duration).toBe(4);
  });
  it.each(["Escape", "blur"])("discards a rolled preview on %s", async (reason) => {
    const view = setup("roll");
    begin(view.getByTestId("a-right"));
    move(200);
    await frame();
    if (reason === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.blur(window);
    end(200);
    expect(clipById("a").duration).toBe(4);
    expect(historySize()).toBe(0);
    expect(useTimelineToolPreview.getState().ghost).toBeNull();
  });
  it("refuses a roll without an adjacent clip and edits nothing", async () => {
    const view = setup("roll");
    begin(view.getByTestId("c-right"));
    move(200);
    end(200);
    expect(historySize()).toBe(0);
    expect(clipById("c").duration).toBe(4);
  });
  it("refuses locked tracks", async () => {
    const view = setup("slide");
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [{ ...project.timeline.tracks[0], locked: true }],
        },
      },
    });
    begin(view.getByTestId("b"));
    move(200);
    end(200);
    expect(historySize()).toBe(0);
  });
  it("supports touch pointers like ripple and slip", async () => {
    class TouchPointer extends MouseEvent {
      pointerId = 5;
      pointerType = "touch";
    }
    vi.stubGlobal("PointerEvent", TouchPointer);
    const view = setup("roll");
    const lane = view.getByTestId("lane");
    Object.assign(lane, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    fireEvent.pointerDown(view.getByTestId("a-right"), { pointerId: 5, button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 200 });
    fireEvent.pointerUp(window, { pointerId: 5, clientX: 200 });
    expect(clipById("a").duration).toBe(5);
    expect(historySize()).toBe(1);
  });
  it("nudges with arrow keys as a single edit", async () => {
    const view = setup("slide");
    fireEvent.keyDown(view.getByTestId("b"), { key: "ArrowRight" });
    expect(clipById("b").startTime).toBeCloseTo(4 + 1 / 30, 6);
    expect(historySize()).toBe(1);
  });
});
