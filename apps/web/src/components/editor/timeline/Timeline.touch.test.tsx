import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, TextClip, Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { ClipComponent } from "./ClipComponent";
import { TextClipComponent } from "./TextClipComponent";
import { TimeRuler } from "./TimeRuler";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options);
    this.pointerId = options.pointerId ?? 1;
    this.pointerType = options.pointerType ?? "touch";
  }
}
const transform = {
  position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0,
  anchor: { x: .5, y: .5 }, opacity: 1,
};
const clip: Clip = { id: "video", mediaId: "media", trackId: "track", startTime: 0,
  duration: 10, inPoint: 0, outPoint: 10, effects: [], audioEffects: [],
  keyframes: [], volume: 1, transform };
const track: Track = { id: "track", name: "Video", type: "video", clips: [clip], transitions: [],
  locked: false, hidden: false, muted: false, solo: false };
const noop = () => undefined;
const heights = new Map([[track.id, 64]]);
const viewport = { current: null as HTMLDivElement | null };
const props = { clip, track, allTracks: [track], pixelsPerSecond: 50, scrollX: 0,
  viewportWidth: 1000, isSelected: true, trackHeights: heights, timelineRef: viewport,
  onSelect: vi.fn(), onMoveClip: vi.fn(), onSnapIndicator: noop };

describe("touch timeline editing", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  function flushFrame() {
    act(() => {
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach((callback) => callback(performance.now()));
    });
  }
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    frames.clear(); nextFrame = 0; props.onSelect.mockClear(); props.onMoveClip.mockClear();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback); return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 500));
    const project = createEmptyProject("Touch editing");
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: [track] } } });
    useTimelineStore.setState({ trackHeight: 64, trackHeights: {}, playheadPosition: 0 });
    useUIStore.setState({ selectedItems: [], snapSettings: { ...useUIStore.getState().snapSettings, enabled: false } });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("leaves clip-body swipes to native scrolling and selects with a tap", () => {
    const view = render(<div><ClipComponent {...props} isSelected={false} /></div>);
    const body = view.getByRole("button", { name: /Select clip media/ });
    const down = new TestPointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 50 });
    fireEvent(body, down);
    expect(down.defaultPrevented).toBe(false);
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 200 });
    // Mobile compatibility mouse events must not turn scrolling into a drag.
    fireEvent.mouseDown(body, { clientX: 50, button: 0 });
    fireEvent.mouseMove(window, { clientX: 200 });
    flushFrame();
    expect(props.onMoveClip).not.toHaveBeenCalled();
    fireEvent.click(body);
    expect(props.onSelect).toHaveBeenCalledWith(clip.id, false);
  });

  it("moves through the selected grip, ignores other fingers and stops after release", async () => {
    const view = render(<div ref={(element) => { viewport.current = element; }}><ClipComponent {...props} /></div>);
    const grip = view.getByRole("button", { name: "Move media" });
    fireEvent.pointerDown(grip, { pointerId: 8, pointerType: "touch", button: 0, clientX: 0, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 9, pointerType: "touch", clientX: 200, clientY: 20 });
    expect(props.onMoveClip).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { pointerId: 8, pointerType: "touch", clientX: 10, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 8, pointerType: "touch", clientX: 100, clientY: 20 });
    flushFrame();
    expect(props.onMoveClip).toHaveBeenCalledWith(clip.id, 2, undefined);
    await act(async () => { fireEvent.pointerUp(window, { pointerId: 8, pointerType: "touch" }); });
    const count = props.onMoveClip.mock.calls.length;
    fireEvent.pointerMove(window, { pointerId: 8, pointerType: "touch", clientX: 300 });
    flushFrame();
    expect(props.onMoveClip).toHaveBeenCalledTimes(count);
    expect(frames.size).toBe(0);
  });

  it("trims using touch edges and finishes on pointer cancellation", async () => {
    const trim = vi.fn();
    const view = render(<div><ClipComponent {...props} onTrimClip={trim} /></div>);
    fireEvent.pointerDown(view.getByLabelText("Trim end of media"), {
      pointerId: 4, pointerType: "touch", button: 0, clientX: 500,
    });
    fireEvent.pointerMove(window, { pointerId: 4, pointerType: "touch", clientX: 450 });
    expect(trim).toHaveBeenLastCalledWith(clip.id, "right", 9);
    await act(async () => { fireEvent.pointerCancel(window, { pointerId: 4, pointerType: "touch" }); });
    fireEvent.pointerMove(window, { pointerId: 4, pointerType: "touch", clientX: 400 });
    expect(trim).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe("");
  });

  it("discards a queued move and final track transfer when the operating system cancels the gesture", async () => {
    const view = render(<div><ClipComponent {...props} /></div>);
    const grip = view.getByRole("button", { name: "Move media" });
    fireEvent.pointerDown(grip, { pointerId: 5, pointerType: "touch", button: 0, clientX: 0, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 5, pointerType: "touch", clientX: 10, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 5, pointerType: "touch", clientX: 100, clientY: 20 });
    await act(async () => { fireEvent.pointerCancel(window, { pointerId: 5, pointerType: "touch" }); });
    flushFrame();
    fireEvent.pointerUp(window, { pointerId: 5, pointerType: "touch" });
    expect(props.onMoveClip).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("releases pointer capture and editing cursor when an active trim unmounts", () => {
    const trim = vi.fn();
    const view = render(<div><ClipComponent {...props} onTrimClip={trim} /></div>);
    const handle = view.getByLabelText("Trim end of media");
    const capture = vi.fn(); const release = vi.fn();
    Object.assign(handle, { setPointerCapture: capture, releasePointerCapture: release });
    fireEvent.pointerDown(handle, { pointerId: 6, pointerType: "touch", button: 0, clientX: 500 });
    expect(capture).toHaveBeenCalledWith(6);
    expect(document.body.style.cursor).toBe("ew-resize");
    view.unmount();
    expect(release).toHaveBeenCalledWith(6);
    expect(document.body.style.cursor).toBe("");
    fireEvent.pointerMove(window, { pointerId: 6, pointerType: "touch", clientX: 400 });
    expect(trim).not.toHaveBeenCalled();
  });

  it("selects captions with a body tap while locked tracks refuse touch timing edits", () => {
    const caption: TextClip = { id: "caption", trackId: track.id, text: "Hello", startTime: 0, duration: 5,
      transform, keyframes: [], style: { fontFamily: "Inter", fontSize: 48, fontWeight: "bold",
        fontStyle: "normal", color: "#fff", textAlign: "center", verticalAlign: "middle", lineHeight: 1.2, letterSpacing: 0 } };
    const select = vi.fn(); const trim = vi.fn();
    const view = render(<div><TextClipComponent textClip={caption} pixelsPerSecond={50} isSelected
      onSelect={select} onTrim={trim} onMoveClip={props.onMoveClip} allTracks={[{ ...track, locked: true }]}
      trackHeights={heights} timelineRef={viewport} /></div>);
    const body = view.getByRole("button", { name: /Select text clip Hello/ });
    fireEvent.pointerDown(body, { pointerType: "touch", pointerId: 3 }); fireEvent.click(body);
    expect(select).toHaveBeenCalledWith(caption.id, false);
    expect(view.queryByRole("button", { name: "Move Hello" })).toBeNull();
    fireEvent.pointerDown(view.getByLabelText("Trim end"), { pointerType: "touch", pointerId: 3, clientX: 250 });
    fireEvent.pointerMove(window, { pointerType: "touch", pointerId: 3, clientX: 200 });
    expect(trim).not.toHaveBeenCalled();
  });

  it("scrubs the ruler with a finger and closes the scrub exactly once on cancellation", async () => {
    const seek = vi.fn(); const start = vi.fn(); const end = vi.fn();
    const view = render(<div><div><TimeRuler duration={20} pixelsPerSecond={50} scrollX={0}
      viewportWidth={1000} onSeek={seek} onScrubStart={start} onScrubEnd={end} /></div></div>);
    const ruler = view.container.querySelector("[data-timeline-ruler]")!;
    fireEvent.pointerDown(ruler, { pointerType: "touch", pointerId: 7, button: 0, clientX: 100 });
    expect(seek).toHaveBeenLastCalledWith(2); expect(start).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(window, { pointerType: "touch", pointerId: 8, clientX: 400 });
    flushFrame(); expect(seek).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(window, { pointerType: "touch", pointerId: 7, clientX: 200 });
    flushFrame(); expect(seek).toHaveBeenLastCalledWith(4);
    await act(async () => { fireEvent.pointerCancel(window, { pointerType: "touch", pointerId: 7 }); });
    fireEvent.pointerUp(window, { pointerType: "touch", pointerId: 7 });
    expect(end).toHaveBeenCalledTimes(1);
  });
});
