import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasShortcutFocus } from "../../services/keyboard-shortcuts";
import { PreviewScrubber } from "./PreviewScrubber";
import { useTimelineStore } from "../../stores/timeline-store";

function Scrubber({ duration = 10 }: { duration?: number }) {
  const position = useTimelineStore((state) => state.playheadPosition);
  return (
    <PreviewScrubber
      position={position}
      duration={duration}
      frameRate={30}
      onSeek={useTimelineStore.getState().seekTo}
    />
  );
}
afterEach(cleanup);
describe("preview scrubber", () => {
  it("seeks by one frame from the keyboard and exposes a readable timecode", () => {
    useTimelineStore.setState({
      playheadPosition: 2,
      playbackState: "stopped",
    });
    const nudgeSelection = vi.fn();
    render(<div onKeyDown={(event) => { if (hasShortcutFocus(event.nativeEvent)) nudgeSelection(); }}><Scrubber /></div>);
    const slider = screen.getByRole("slider", { name: "Preview position" });
    expect(slider).toHaveAttribute("aria-valuetext", "00:00:02:00");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(
      2 + 1 / 30,
    );
    expect(slider).toHaveAttribute("aria-valuetext", "00:00:02:01");
    expect(nudgeSelection).not.toHaveBeenCalled();
    fireEvent.keyDown(slider, { key: "End" });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(10);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
  });
  it("cannot seek into a placeholder duration when the project is empty", () => {
    useTimelineStore.setState({ playheadPosition: 0 });
    render(<Scrubber duration={0} />);
    const slider = screen.getByRole("slider", { name: "Preview position" });
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
  });
});
