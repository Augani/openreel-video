import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@openreel/core";
import { TrackAutomationRows } from "./TrackAutomationLanes";
import { AUTOMATION_LANE_HEIGHT, laneFractionToValue, laneValueToFraction } from "./track-automation-geometry";

const PPS = 100;
const W = 800;
const H = AUTOMATION_LANE_HEIGHT;

const track = (automation?: Track["automation"], locked = false): Track =>
  ({ id: "t1", type: "audio", name: "A1", clips: [], transitions: [], locked, hidden: false, muted: false, solo: false, ...(automation ? { automation } : {}) }) as Track;

function setup(automation?: Track["automation"], locked = false) {
  const onCommit = vi.fn();
  const view = render(<TrackAutomationRows track={track(automation, locked)} pixelsPerSecond={PPS} width={W} onCommit={onCommit} />);
  const lane = (name: string) => view.container.querySelector(`[data-automation-lane="${name}"]`) as HTMLElement;
  for (const name of ["volume", "pan"]) {
    lane(name).getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) });
  }
  return { ...view, lane, onCommit };
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId = 1; });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("track automation geometry", () => {
  it("round-trips lane values through the lane height", () => {
    expect(laneFractionToValue("pan", laneValueToFraction("pan", -0.5))).toBeCloseTo(-0.5, 9);
    expect(laneValueToFraction("pan", 0)).toBe(0.5);
    expect(laneFractionToValue("volume", laneValueToFraction("volume", 1))).toBeCloseTo(1, 6);
    expect(laneFractionToValue("volume", laneValueToFraction("volume", 2))).toBeCloseTo(2, 6);
  });
});

describe("TrackAutomationRows", () => {
  it("shows the stored points of each lane", () => {
    const { container } = setup({ volume: [{ time: 1, value: 1 }, { time: 2, value: 0.5 }], pan: [{ time: 0, value: -1 }] });
    expect(container.querySelectorAll('[data-automation-lane="volume"] [data-automation-point]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-automation-lane="pan"] [data-automation-point]')).toHaveLength(1);
  });

  it("adds a point by click as one commit", async () => {
    const { lane, onCommit } = setup();
    fireEvent.pointerDown(lane("pan"), { clientX: 200, clientY: H / 2, button: 0 });
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 200, clientY: H / 2 });
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [trackId, laneName, points] = onCommit.mock.calls[0];
    expect(trackId).toBe("t1");
    expect(laneName).toBe("pan");
    expect(points).toHaveLength(1);
    expect(points[0].time).toBeCloseTo(2, 6);
    expect(points[0].value).toBeCloseTo(0, 6);
  });

  it("drags a point to a new time and value and commits once on release", async () => {
    const { container, onCommit } = setup({ pan: [{ time: 1, value: 0 }] });
    const hit = container.querySelector('[data-automation-lane="pan"] [data-automation-hit="0"]') as Element;
    fireEvent.pointerDown(hit, { clientX: 100, clientY: H / 2, button: 0 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 0 });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 300, clientY: 0 });
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const points = onCommit.mock.calls[0][2];
    expect(points[0].time).toBeCloseTo(3, 6);
    expect(points[0].value).toBeCloseTo(1, 6);
  });

  it("a press without movement on a point commits nothing; double-click deletes it", async () => {
    const { container, onCommit } = setup({ volume: [{ time: 1, value: 1 }, { time: 2, value: 2 }] });
    const hit = container.querySelector('[data-automation-lane="volume"] [data-automation-hit="0"]') as Element;
    fireEvent.pointerDown(hit, { clientX: 100, clientY: 20, button: 0 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 20 });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.doubleClick(hit);
    });
    expect(onCommit).toHaveBeenCalledWith("t1", "volume", [{ time: 2, value: 2 }]);
  });

  it("deleting the last point clears the lane", async () => {
    const { container, onCommit } = setup({ volume: [{ time: 1, value: 1 }] });
    const hit = container.querySelector('[data-automation-hit="0"]') as Element;
    await act(async () => {
      fireEvent.doubleClick(hit);
    });
    expect(onCommit).toHaveBeenCalledWith("t1", "volume", null);
  });

  it("ignores edits on a locked track", () => {
    const { lane, onCommit } = setup(undefined, true);
    fireEvent.pointerDown(lane("volume"), { clientX: 100, clientY: 10, button: 0 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 10 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
