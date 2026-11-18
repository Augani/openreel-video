import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhoneTimeline } from "./usePhoneTimeline";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";

describe("phone timeline navigation", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let viewport: { current: HTMLDivElement };
  beforeEach(() => {
    vi.useFakeTimers();
    viewport = { current: document.createElement("div") };
    useTimelineStore.setState({ pixelsPerSecond: 80, scrollX: 120, playheadPosition: 6,
      playbackState: "paused", playbackLockedReason: null, isScrubbing: false, scrubPosition: null });
    viewport.current.scrollLeft = 120;
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  });
  afterEach(() => { cleanup(); globalThis.ResizeObserver = originalResizeObserver; vi.useRealTimers(); vi.restoreAllMocks(); });
  const mount = (phone = true) => renderHook(({ phone }) => {
    const zoom = useTimelineStore(state => state.pixelsPerSecond);
    return usePhoneTimeline(phone, viewport, zoom, 390);
  }, { initialProps: { phone } });

  it("keeps independent desktop and phone zoom/scroll while centering external seeks", () => {
    const hook = mount(false);
    expect(viewport.current.scrollLeft).toBe(120);
    act(() => useTimelineStore.getState().setZoom(120));
    viewport.current.scrollLeft = 210;
    hook.rerender({ phone: true });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(24);
    expect(viewport.current.scrollLeft).toBe(144);
    act(() => useTimelineStore.getState().setZoom(48));
    act(() => useTimelineStore.getState().seekTo(10));
    expect(viewport.current.scrollLeft).toBe(480);
    hook.rerender({ phone: false });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(120);
    expect(viewport.current.scrollLeft).toBe(210);
    hook.rerender({ phone: true });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(48);
    expect(viewport.current.scrollLeft).toBe(480);
  });

  it("scrubs through inertial scroll, ends once settled and ignores playback's own scrolling", () => {
    const hook = mount();
    act(() => hook.result.current(144));
    expect(useTimelineStore.getState().isScrubbing).toBe(false);
    act(() => hook.result.current(144.5));
    expect(useTimelineStore.getState().isScrubbing).toBe(false);
    act(() => { viewport.current.scrollLeft = 240; hook.result.current(240); });
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
    expect(useTimelineStore.getState().isScrubbing).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    act(() => { viewport.current.scrollLeft = 264; hook.result.current(264); });
    act(() => vi.advanceTimersByTime(119));
    expect(useTimelineStore.getState().isScrubbing).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(useTimelineStore.getState().isScrubbing).toBe(false);
    expect(useTimelineStore.getState().playheadPosition).toBe(11);
    act(() => useTimelineStore.getState().setPlayheadPosition(12));
    expect(viewport.current.scrollLeft).toBe(288);
    act(() => hook.result.current(288));
    expect(useTimelineStore.getState().isScrubbing).toBe(false);
  });

  it("anchors two-finger zoom at the playhead and bounds its scale", () => {
    const hook = mount();
    const touches = (distance: number) => [{ clientX: 0, clientY: 20 }, { clientX: distance, clientY: 20 }];
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", { value: touches(100) });
    fireEvent(viewport.current, start);
    expect(start.defaultPrevented).toBe(true);
    fireEvent.touchMove(viewport.current, { touches: touches(200) });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(48);
    expect(viewport.current.scrollLeft).toBe(288);
    act(() => hook.result.current(400));
    expect(useTimelineStore.getState().playheadPosition).toBe(6);
    fireEvent.touchMove(viewport.current, { touches: touches(10000) });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(500);
    fireEvent.touchMove(viewport.current, { touches: touches(1) });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(10);
    fireEvent.touchCancel(viewport.current, { touches: [] });
    act(() => { viewport.current.scrollLeft = 100; hook.result.current(100); });
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
    hook.unmount();
    expect(useTimelineStore.getState().isScrubbing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not seek during export or an effect's playback lock", () => {
    const hook = mount();
    act(() => useTimelineStore.getState().lockPlayback("Rendering effect"));
    act(() => { viewport.current.scrollLeft = 240; hook.result.current(240); });
    expect(useTimelineStore.getState().playheadPosition).toBe(6);
    expect(viewport.current.scrollLeft).toBe(144);
    act(() => useTimelineStore.getState().unlockPlayback());
    act(() => useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } }));
    act(() => { viewport.current.scrollLeft = 240; hook.result.current(240); });
    expect(useTimelineStore.getState().playheadPosition).toBe(6);
    expect(viewport.current.scrollLeft).toBe(144);
  });

  it("restores the latest preview time when a retained hidden timeline is revealed", () => {
    let measure: () => void = () => {};
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) { measure = callback; }
      observe() {} unobserve() {} disconnect = disconnect;
    } as unknown as typeof ResizeObserver;
    let visible = true;
    let offset = 0;
    Object.defineProperty(viewport.current, "clientWidth", { get: () => visible ? 390 : 0 });
    Object.defineProperty(viewport.current, "scrollLeft", {
      get: () => visible ? offset : 0,
      set: (value: number) => { if (visible) offset = value; },
    });
    const hook = mount();
    expect(offset).toBe(144);
    visible = false;
    act(() => useTimelineStore.getState().seekTo(10));
    visible = true;
    expect(viewport.current.scrollLeft).toBe(144);
    act(() => measure());
    expect(viewport.current.scrollLeft).toBe(240);
    expect(useTimelineStore.getState().scrollX).toBe(240);
    hook.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each(["data-timeline-trim", "data-timeline-move"])("leaves an active %s gesture in control of its finger", (attribute) => {
    mount();
    const handle = document.createElement("div");
    handle.setAttribute(attribute, "left");
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", { value: [
      { target: handle, clientX: 0, clientY: 20 },
      { target: viewport.current, clientX: 100, clientY: 20 },
    ] });
    fireEvent(viewport.current, start);
    expect(start.defaultPrevented).toBe(false);
    fireEvent.touchMove(viewport.current, { touches: [
      { target: handle, clientX: 0, clientY: 20 },
      { target: viewport.current, clientX: 200, clientY: 20 },
    ] });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(24);
  });
});
