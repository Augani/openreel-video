import { ActionExecutor } from "@openreel/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { TimelineRange, TimelineRangeActions } from "./TimelineRange";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, options: globalThis.PointerEventInit = {}) {
    super(type, options);
    this.pointerId = options.pointerId ?? 1;
  }
}
function openRangeControls() {
  if (!screen.queryByRole("button", { name: "Mark In point" })) {
    fireEvent.click(
      screen.getByRole("button", { name: "Preview range controls" }),
    );
  }
}
function startDrag(out: HTMLElement, clientX = 200) {
  const root = out.closest<HTMLElement>('[data-slot="slider"]')!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    new DOMRect(-200, 0, 500, 26),
  );
  Object.assign(out, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  });
  fireEvent.pointerDown(out, { button: 0, pointerId: 7, clientX });
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  useTimelineStore.setState({
    loopStart: 0,
    loopEnd: 0,
    loopEnabled: false,
    playbackLockedReason: null,
    playheadPosition: 2,
  });
  useUIStore.setState({
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useTimelineStore.getState().clearLoopRange();
});
describe("visible preview ranges", () => {
  it("marks, nudges and clears an In/Out range without modifying clips", () => {
    render(
      <>
        <TimelineRangeActions duration={10} frameRate={24} />
        <TimelineRange duration={10} frameRate={24} pixelsPerSecond={50} />
      </>,
    );
    openRangeControls();
    fireEvent.click(screen.getByRole("button", { name: "Mark In point" }));
    expect(useTimelineStore.getState().loopStart).toBe(2);
    const out = screen.getByRole("slider", { name: "Range Out point" });
    act(() => out.focus());
    fireEvent.keyDown(out, { key: "ArrowLeft", shiftKey: true });
    expect(useTimelineStore.getState().loopEnd).toBeCloseTo(10 - 10 / 24);
    openRangeControls();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear preview range" }),
    );
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(useTimelineStore.getState().loopEnabled).toBe(false);
  });
  it("clamps handles to one frame apart and blocks edits during export", () => {
    useTimelineStore.getState().setLoopRange(2, 3);
    const view = render(
      <TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />,
    );
    act(() => screen.getByRole("slider", { name: "Range In point" }).focus());
    fireEvent.keyDown(screen.getByRole("slider", { name: "Range In point" }), {
      key: "End",
    });
    expect(useTimelineStore.getState().loopStart).toBeCloseTo(3 - 1 / 30);
    act(() =>
      useUIStore.setState({
        exportState: {
          ...useUIStore.getState().exportState,
          isExporting: true,
        },
      }),
    );
    view.rerender(
      <TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />,
    );
    const out = screen.getByRole("slider", { name: "Range Out point" });
    expect(out).toHaveAttribute("aria-disabled", "true");
    const before = useTimelineStore.getState().loopEnd;
    fireEvent.keyDown(out, { key: "ArrowRight" });
    expect(useTimelineStore.getState().loopEnd).toBe(before);
  });
  it("moves a captured handle in scrolled coordinates and restores a cancelled edit", () => {
    useTimelineStore.getState().setLoopRange(2, 8);
    render(<TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />);
    const out = screen.getByRole("slider", { name: "Range Out point" });
    startDrag(out);
    fireEvent.pointerMove(out, { pointerId: 7, clientX: 150 });
    expect(useTimelineStore.getState().loopEnd).toBeCloseTo(7);
    fireEvent.pointerCancel(out, { pointerId: 7 });
    expect(useTimelineStore.getState().loopEnd).toBe(8);
  });

  it.each([false, true])(
    "cannot restore a cancelled old gesture into a replacement project (same ID: %s)",
    (sameId) => {
      useTimelineStore.getState().setLoopRange(2, 8);
      render(
        <TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />,
      );
      const out = screen.getByRole("slider", { name: "Range Out point" });
      startDrag(out);
      fireEvent.pointerMove(out, { pointerId: 7, clientX: 150 });
      act(() => {
        useProjectStore.setState(
          sameId
            ? { actionExecutor: new ActionExecutor() }
            : { project: createEmptyProject("Replacement") },
        );
        useTimelineStore.getState().setLoopRange(3, 6);
      });
      fireEvent.pointerMove(out, { pointerId: 7, clientX: 100 });
      fireEvent.pointerCancel(out, { pointerId: 7 });
      expect(useTimelineStore.getState().loopStart).toBe(3);
      expect(useTimelineStore.getState().loopEnd).toBe(6);
    },
  );

  it("does not overwrite a newer range edit when the earlier pointer is cancelled", () => {
    useTimelineStore.getState().setLoopRange(2, 8);
    render(<TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />);
    const out = screen.getByRole("slider", { name: "Range Out point" });
    startDrag(out);
    fireEvent.pointerMove(out, { pointerId: 7, clientX: 150 });
    act(() => useTimelineStore.getState().setLoopRange(1, 5));
    fireEvent.pointerMove(out, { pointerId: 7, clientX: 125 });
    expect(useTimelineStore.getState().loopEnd).toBe(5);
    fireEvent.pointerCancel(out, { pointerId: 7 });
    expect(useTimelineStore.getState().loopStart).toBe(1);
    expect(useTimelineStore.getState().loopEnd).toBe(5);
  });

  it("keeps fractional-frame nudges and one-frame projects finite", () => {
    const frame = 1 / 29.97;
    useTimelineStore.getState().setLoopRange(frame * 3, frame * 20);
    const view = render(
      <TimelineRange
        duration={frame * 30}
        frameRate={29.97}
        pixelsPerSecond={50}
      />,
    );
    const out = screen.getByRole("slider", { name: "Range Out point" });
    act(() => out.focus());
    fireEvent.keyDown(out, { key: "ArrowLeft", shiftKey: true });
    expect(useTimelineStore.getState().loopEnd).toBeCloseTo(frame * 10);
    act(() => useTimelineStore.getState().setLoopRange(0, 0.02));
    view.rerender(
      <TimelineRange duration={0.02} frameRate={30} pixelsPerSecond={50} />,
    );
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    for (const handle of screen.getAllByRole("slider"))
      expect(handle).toHaveAttribute("aria-disabled", "true");
    expect(view.container.innerHTML).not.toContain("NaN");
  });

  it("keeps an export's frozen range intact when an in-flight pointer is cancelled", () => {
    useTimelineStore.getState().setLoopRange(2, 8);
    render(<TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />);
    const out = screen.getByRole("slider", { name: "Range Out point" });
    startDrag(out);
    fireEvent.pointerMove(out, { pointerId: 7, clientX: 150 });
    act(() =>
      useUIStore.setState({
        exportState: {
          ...useUIStore.getState().exportState,
          isExporting: true,
        },
      }),
    );
    fireEvent.pointerMove(out, { pointerId: 7, clientX: 100 });
    fireEvent.pointerCancel(out, { pointerId: 7 });
    expect(useTimelineStore.getState().loopStart).toBe(2);
    expect(useTimelineStore.getState().loopEnd).toBeCloseTo(7);
  });
  it("preserves the grab offset instead of jumping when a grip is dragged off-center", () => {
    useTimelineStore.getState().setLoopRange(2, 8);
    render(<TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />);
    const out = screen.getByRole("slider", { name: "Range Out point" });
    // Grab an off-center position within the 24px hit target.
    // A 50px move must add one second regardless of where it was grabbed.
    startDrag(out, 192.8);
    fireEvent.pointerMove(out, { pointerId: 7, clientX: 242.8 });
    expect(useTimelineStore.getState().loopStart).toBe(2);
    expect(useTimelineStore.getState().loopEnd).toBeCloseTo(9);
  });
});
