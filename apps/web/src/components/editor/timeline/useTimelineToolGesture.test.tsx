import { useRef } from "react";
import { setExternalReadOnly } from "../../../services/project-lock";
import {
  ActionExecutor,
  TitleEngine,
  prepareTimelineToolEdit,
  type Clip,
} from "@openreel/core";
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

const select = vi.fn();
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useTimelineToolGesture(ref, 100, select);
  return (
    <div ref={ref} data-testid="lane" {...gesture}>
      <div data-timeline-item-id="clip" tabIndex={0} data-testid="clip">
        <span data-timeline-trim="left" data-testid="left" />
        Content
        <span data-timeline-trim="right" data-testid="right" />
      </div>
      <TimelineToolGhost trackId="main" pixelsPerSecond={100} />
    </div>
  );
}
function fixture() {
  const project = createEmptyProject("Tool workflow");
  const clip: Clip = {
    id: "clip",
    trackId: "main",
    mediaId: "source",
    startTime: 10,
    duration: 4,
    inPoint: 4,
    outPoint: 12,
    speed: 2,
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
  };
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
          waveformData: new Float32Array(100000),
          metadata: {
            duration: 20,
            width: 1920,
            height: 1080,
            frameRate: 30,
            codec: "h264",
            sampleRate: 48000,
            channels: 2,
            fileSize: 100,
          },
        },
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 18,
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
          clips: [clip, { ...clip, id: "tail", startTime: 14 }],
        },
      ],
    },
  };
}
function currentClip() {
  return useProjectStore.getState().project.timeline.tracks[0].clips[0];
}
function historySize() {
  return useProjectStore
    .getState()
    .actionExecutor.getHistory()
    .getUndoStackSize();
}
function mount() {
  const view = render(<Harness />);
  vi.spyOn(view.getByTestId("lane"), "getBoundingClientRect").mockReturnValue(
    new DOMRect(-200, 0, 1800, 60),
  );
  return view;
}
function begin(target: Element, clientX = 100) {
  fireEvent.mouseDown(target, { button: 0, clientX });
}
function move(clientX: number) {
  fireEvent.mouseMove(window, { clientX, buttons: 1 });
}
function end(clientX: number) {
  fireEvent.mouseUp(window, { button: 0, clientX });
}
beforeEach(() => {
  select.mockClear();
  const executor = new ActionExecutor();
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useProjectStore.setState({
    project: fixture(),
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    clipUndoStack: [],
    clipRedoStack: [],
    templateUndoStack: [],
    templateRedoStack: [],
    redoJournal: [],
  });
  useTimelineStore.setState({
    playbackLockedReason: null,
    playbackState: "paused",
  });
  useUIStore.setState({
    selectedItems: [],
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
  useEditorWorkspaceStore.setState({
    timelineTool: "slip",
    linkedSelection: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useTimelineToolPreview.getState().setGhost(null);
});

describe("owned timeline tool gestures", () => {
  it("publishes grouped shaded captions to the real title cache only at commit and restores both with Undo", async () => {
    const project = useProjectStore.getState().project;
    const titles = new TitleEngine();
    const caption = titles.createTextClip({
      id: "group-caption",
      trackId: "captions",
      startTime: 10.5,
      duration: 1,
      text: "Preserve the material",
      style: {
        shader: {
          shaderId: "paper-mesh-gradient",
          params: { color1: "#ee44aa" },
          progress: 0.37,
        },
      },
    });
    titles.loadTextClips([caption]);
    useProjectStore.setState({
      project: {
        ...project,
        textClips: [caption],
        timeline: {
          ...project.timeline,
          tracks: [
            { ...project.timeline.tracks[0], groupId: "caption-group" },
            {
              id: "captions",
              name: "Captions",
              type: "text",
              clips: [],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
              groupId: "caption-group",
            },
          ],
        },
      },
    });
    useEngineStore.setState({ titleEngine: titles });
    const original = useProjectStore.getState().project;
    const view = mount();
    begin(view.getByTestId("clip"));
    move(150);
    expect(useProjectStore.getState().project).toBe(original);
    expect(titles.getTextClip(caption.id)!.startTime).toBe(10.5);
    end(150);
    expect(historySize()).toBe(1);
    expect(useProjectStore.getState().project.textClips![0]).toMatchObject({
      startTime: 11,
      style: caption.style,
    });
    expect(titles.getTextClip(caption.id)).toMatchObject({
      startTime: 11,
      style: caption.style,
    });
    await act(async () => {
      expect((await useProjectStore.getState().undo()).success).toBe(true);
    });
    expect(titles.getTextClip(caption.id)).toEqual(caption);
    expect(useProjectStore.getState().project.textClips![0]).toEqual(caption);
    await act(async () => {
      expect((await useProjectStore.getState().redo()).success).toBe(true);
    });
    expect(titles.getTextClip(caption.id)).toMatchObject({
      startTime: 11,
      style: caption.style,
    });
  });
  it("previews without copying the project and commits a same-turn burst as one reversible source edit", async () => {
    const view = mount(),
      original = useProjectStore.getState().project;
    const waveform = original.mediaLibrary.items[0].waveformData!;
    Object.assign(waveform, {
      toJSON() {
        throw new Error("Waveform must not be serialized");
      },
    });
    begin(view.getByTestId("clip"));
    for (let x = 101; x <= 200; x++) move(x);
    expect(useProjectStore.getState().project).toBe(original);
    expect(historySize()).toBe(0);
    end(200);
    expect(currentClip()).toMatchObject({
      startTime: 10,
      duration: 4,
      inPoint: 2,
      outPoint: 10,
    });
    expect(historySize()).toBe(1);
    expect(useProjectStore.getState().project.mediaLibrary).toBe(
      original.mediaLibrary,
    );
    expect(select).toHaveBeenCalledOnce();
    await act(async () => {
      expect((await useProjectStore.getState().undo()).success).toBe(true);
    });
    expect(currentClip()).toEqual(original.timeline.tracks[0].clips[0]);
    await act(async () => {
      expect((await useProjectStore.getState().redo()).success).toBe(true);
    });
    expect(currentClip().inPoint).toBe(2);
  });
  it.each(["left", "right"])(
    "ripple trims the %s edge with scrolled lane coordinates",
    (edge) => {
      useEditorWorkspaceStore.setState({ timelineTool: "ripple" });
      const view = mount();
      begin(view.getByTestId(edge));
      move(200);
      end(200);
      expect(currentClip()).toMatchObject(
        edge === "left"
          ? { startTime: 10, duration: 3, inPoint: 6, outPoint: 12 }
          : { startTime: 10, duration: 5, inPoint: 4, outPoint: 14 },
      );
      expect(
        useProjectStore.getState().project.timeline.tracks[0].clips[1]
          .startTime,
      ).toBe(edge === "left" ? 13 : 15);
      expect(historySize()).toBe(1);
    },
  );
  it.each([
    "Escape",
    "blur",
    "unmount",
    "mode",
    "project",
    "same-id",
    "export",
  ])("discards a gesture cancelled by %s", (reason) => {
    const view = mount();
    begin(view.getByTestId("clip"));
    move(150);
    if (reason === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    if (reason === "blur") fireEvent.blur(window);
    if (reason === "unmount") view.unmount();
    if (reason === "mode")
      act(() => useEditorWorkspaceStore.setState({ timelineTool: "select" }));
    if (reason === "project" || reason === "same-id")
      act(() =>
        useProjectStore.setState({
          project: {
            ...fixture(),
            id:
              reason === "project"
                ? "replacement"
                : useProjectStore.getState().project.id,
          },
        }),
      );
    if (reason === "export")
      useUIStore.setState({
        exportState: {
          ...useUIStore.getState().exportState,
          isExporting: true,
        },
      });
    end(200);
    expect(currentClip()).toMatchObject({
      inPoint: 4,
      outPoint: 12,
      duration: 4,
    });
    expect(historySize()).toBe(0);
    expect(useTimelineToolPreview.getState().ghost).toBeNull();
  });
  it("does not select an obsolete item when the project changes before the first move", () => {
    const view = mount();
    begin(view.getByTestId("clip"));
    useProjectStore.setState({ project: fixture() });
    move(200);
    end(200);
    expect(select).not.toHaveBeenCalled();
    expect(historySize()).toBe(0);
  });
  it("retains focused item DOM during preview frames and cleans the ghost on cancellation", async () => {
    const view = mount(),
      item = view.getByTestId("clip");
    item.focus();
    begin(item);
    move(200);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(
      view.container.querySelector(".workspace-timeline-tool-ghost"),
    ).not.toBeNull();
    expect(view.getByTestId("clip")).toBe(item);
    expect(document.activeElement).toBe(item);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      view.container.querySelector(".workspace-timeline-tool-ghost"),
    ).toBeNull();
    expect(historySize()).toBe(0);
  });
  it("uses one-frame, ten-frame and alternate-edge keyboard edits", () => {
    const view = mount(),
      item = view.getByTestId("clip");
    fireEvent.keyDown(item, { key: "ArrowRight" });
    expect(currentClip().inPoint).toBeCloseTo(4 - 2 / 30);
    fireEvent.keyDown(item, { key: "ArrowLeft", shiftKey: true });
    expect(currentClip().inPoint).toBeCloseTo(4 + 18 / 30);
    act(() => useEditorWorkspaceStore.setState({ timelineTool: "ripple" }));
    fireEvent.keyDown(item, { key: "ArrowRight", altKey: true });
    expect(currentClip().duration).toBeCloseTo(4 - 1 / 30);
    expect(historySize()).toBe(3);
  });
  it("Alt+Arrow on a focused item matches the global nudge: playhead edge, 1 or 5 frames", () => {
    const view = mount(),
      item = view.getByTestId("clip");
    act(() => useEditorWorkspaceStore.setState({ timelineTool: "ripple" }));
    const before = currentClip().duration;
    act(() => useTimelineStore.setState({ playheadPosition: 1000 }));
    fireEvent.keyDown(item, { key: "ArrowRight", altKey: true });
    expect(currentClip().duration).toBeCloseTo(before + 1 / 30);
    fireEvent.keyDown(item, { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(currentClip().duration).toBeCloseTo(before + 1 / 30 - 5 / 30);
  });
  it("blocks direct commits while locked and preserves state and history for stale plans", () => {
    const project = useProjectStore.getState().project;
    const plan = prepareTimelineToolEdit(project, {
      itemId: "clip",
      mode: "slip",
    }).plan(1);
    useTimelineStore.setState({ playbackLockedReason: "Exporting" });
    expect(
      useProjectStore.getState().commitTimelineToolEdit(plan).success,
    ).toBe(false);
    useTimelineStore.setState({ playbackLockedReason: null });
    const changed = fixture();
    changed.timeline.tracks[0].clips[0] = { ...currentClip(), volume: 0.5 };
    useProjectStore.setState({ project: changed });
    expect(
      useProjectStore.getState().commitTimelineToolEdit(plan).success,
    ).toBe(false);
    expect(useProjectStore.getState().project).toBe(changed);
    expect(historySize()).toBe(0);
  });
  it("refuses direct commits on a read-only project (a view-only collaboration invite)", () => {
    const project = useProjectStore.getState().project;
    const plan = prepareTimelineToolEdit(project, {
      itemId: "clip",
      mode: "slip",
    }).plan(1);
    setExternalReadOnly("You joined as a viewer: this shared project is view-only.");
    try {
      const result = useProjectStore.getState().commitTimelineToolEdit(plan);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("READ_ONLY");
    } finally {
      setExternalReadOnly(null);
    }
    expect(useProjectStore.getState().project).toBe(project);
    expect(historySize()).toBe(0);
  });
  it("does not add history when synchronizing a derived cache fails", () => {
    const project = useProjectStore.getState().project,
      titles = new TitleEngine();
    useEngineStore.setState({ titleEngine: titles });
    const load = vi
      .spyOn(titles, "loadTextClips")
      .mockImplementationOnce(() => {
        throw new Error("Cache failure");
      });
    const plan = prepareTimelineToolEdit(project, {
      itemId: "clip",
      mode: "slip",
    }).plan(1);
    expect(
      useProjectStore.getState().commitTimelineToolEdit(plan).success,
    ).toBe(false);
    expect(useProjectStore.getState().project).toBe(project);
    expect(historySize()).toBe(0);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("ignores foreign touch pointers and commits only the owned pointer", () => {
    class TouchPointer extends MouseEvent {
      pointerId: number;
      pointerType = "touch";
      constructor(type: string, options: globalThis.PointerEventInit = {}) {
        super(type, options);
        this.pointerId = options.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", TouchPointer);
    const view = mount(),
      lane = view.getByTestId("lane");
    Object.assign(lane, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    fireEvent.pointerDown(view.getByTestId("clip"), {
      pointerId: 7,
      button: 0,
      clientX: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 500 });
    fireEvent.pointerCancel(window, { pointerId: 8 });
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 500 });
    expect(historySize()).toBe(0);
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 200 });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 200 });
    expect(currentClip().inPoint).toBe(2);
    expect(historySize()).toBe(1);
    expect(lane.releasePointerCapture).toHaveBeenCalledWith(7);
  });
  it("treats owned pointer cancellation as a discarded preview", () => {
    class TouchPointer extends MouseEvent {
      pointerId = 7;
      pointerType = "touch";
    }
    vi.stubGlobal("PointerEvent", TouchPointer);
    const view = mount();
    fireEvent.pointerDown(view.getByTestId("clip"), {
      button: 0,
      clientX: 100,
    });
    fireEvent.pointerMove(window, { clientX: 200 });
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window, { clientX: 200 });
    expect(currentClip().inPoint).toBe(4);
    expect(historySize()).toBe(0);
  });
});
