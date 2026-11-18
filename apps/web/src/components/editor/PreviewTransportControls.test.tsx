import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewTransportControls } from "./PreviewTransportControls";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";

beforeEach(() => {
  useTimelineStore.setState({ playheadPosition: 2, playbackState: "stopped", playbackLockedReason: null,
    loopStart: 0, loopEnd: 0, loopEnabled: false, scrollX: 0 });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
});
afterEach(cleanup);

function mount(overrides: Partial<Parameters<typeof PreviewTransportControls>[0]> = {}) {
  const onTogglePlayback = vi.fn();
  const props = { duration: 10, frameRate: 30, playing: false, lockedReason: null,
    exporting: false, onTogglePlayback, ...overrides };
  return { ...render(<PreviewTransportControls {...props}/>), onTogglePlayback, props };
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("authored preview transport", () => {
  it("pauses and seeks to the real timeline boundaries", () => {
    mount();
    useTimelineStore.setState({ playbackState: "playing", playheadPosition: 4 });
    click("Go to end");
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
    expect(useTimelineStore.getState().playbackState).toBe("paused");
    click("Go to start");
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
  });

  it("steps adjacent frames from the latest position without accumulating a fractional seek", () => {
    mount();
    useTimelineStore.setState({ playheadPosition: 2.01, playbackState: "playing" });
    click("Previous frame");
    expect(useTimelineStore.getState().playheadPosition).toBe(2);
    click("Next frame");
    click("Next frame");
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(2 + 2 / 30);
    expect(useTimelineStore.getState().playbackState).toBe("paused");
    useTimelineStore.setState({ playheadPosition: 10 });
    click("Next frame");
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
  });

  it("uses the project's fractional frame rate", () => {
    mount({ frameRate: 23.976 });
    useTimelineStore.setState({ playheadPosition: 0 });
    click("Next frame");
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(1 / 23.976);
    click("Previous frame");
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
  });

  it("marks a valid range at the current playhead and repairs crossed boundaries", () => {
    mount();
    click("Mark in");
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 2, loopEnd: 10, loopEnabled: false });
    useTimelineStore.setState({ playheadPosition: 4.01 });
    click("Mark out");
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 2, loopEnd: 4 });
    useTimelineStore.setState({ playheadPosition: 1 });
    click("Mark out");
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 0, loopEnd: 1 });
    useTimelineStore.setState({ playheadPosition: 10 });
    click("Mark in");
    expect(useTimelineStore.getState().loopStart).toBeCloseTo(10 - 1 / 30);
    expect(useTimelineStore.getState().loopEnd).toBe(10);
  });

  it.each(["lock", "export"])("honors a %s that arrives after rendering", reason => {
    const { onTogglePlayback } = mount();
    if (reason === "lock") useTimelineStore.setState({ playbackLockedReason: "Preparing media" });
    else useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
    click("Next frame"); click("Go to end"); click("Mark in"); click("Play");
    expect(useTimelineStore.getState()).toMatchObject({ playheadPosition: 2, loopStart: 0, loopEnd: 0 });
    expect(onTogglePlayback).not.toHaveBeenCalled();
  });

});
