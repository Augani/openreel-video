import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { TimelineRange, TimelineRangeActions } from "./TimelineRange";
beforeEach(() => {
  useTimelineStore.setState({ loopStart: 0, loopEnd: 0, loopEnabled: false, playbackLockedReason: null, playheadPosition: 2 });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useTimelineStore.getState().clearLoopRange(); });
describe("visible preview ranges", () => {
  it("marks, nudges and clears an In/Out range without modifying clips", () => {
    render(<><TimelineRangeActions duration={10} frameRate={24} /><TimelineRange duration={10} frameRate={24} pixelsPerSecond={50} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Mark In point" }));
    expect(useTimelineStore.getState().loopStart).toBe(2);
    const out = screen.getByRole("slider", { name: "Range Out point" });
    fireEvent.keyDown(out, { key: "ArrowLeft", shiftKey: true });
    expect(useTimelineStore.getState().loopEnd).toBeCloseTo(10 - 10 / 24);
    fireEvent.click(screen.getByRole("button", { name: "Clear preview range" }));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(useTimelineStore.getState().loopEnabled).toBe(false);
  });
  it("clamps handles to one frame apart and blocks edits during export", () => {
    useTimelineStore.getState().setLoopRange(2, 3);
    const view = render(<TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Range In point" }), { key: "End" });
    expect(useTimelineStore.getState().loopStart).toBeCloseTo(3 - 1 / 30);
    act(() => useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } }));
    view.rerender(<TimelineRange duration={10} frameRate={30} pixelsPerSecond={50} />);
    expect(screen.getByRole("slider", { name: "Range Out point" })).toBeDisabled();
  });
});
