import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "../../stores/timeline-store";
import { PreviewTimecode } from "./PreviewTimecode";
beforeEach(() => useTimelineStore.setState({ playheadPosition: 0, playbackState: "paused", playbackLockedReason: null, viewportWidth: 800, scrollX: 0 }));
afterEach(cleanup);
describe("frame-accurate preview seeking", () => {
  it("seeks to typed frames and clamps requests to the project end", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={24} />);
    const input = screen.getByRole("textbox", { name: "Playhead timecode" });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "00:00:02:12" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useTimelineStore.getState().playheadPosition).toBe(2.5);
    act(() => input.focus()); fireEvent.change(input, { target: { value: "500" } }); fireEvent.blur(input);
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
  });
  it("keeps invalid input from seeking and Escape discards a draft", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={30} />);
    const input = screen.getByRole("textbox", { name: "Playhead timecode" });
    act(() => input.focus()); fireEvent.change(input, { target: { value: "bad time" } }); fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toBeInTheDocument(); expect(useTimelineStore.getState().playheadPosition).toBe(0);
    act(() => input.focus()); fireEvent.change(input, { target: { value: "9" } }); fireEvent.keyDown(input, { key: "Escape" });
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
  });
  it("steps one or ten frames from the draft without starting playback", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={60} />);
    const input = screen.getByRole("textbox", { name: "Playhead timecode" });
    act(() => input.focus()); fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(10 / 60);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(9 / 60);
    expect(useTimelineStore.getState().playbackState).toBe("paused");
  });
});
