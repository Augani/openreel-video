import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbToVolume, type AutomationPoint, type Clip } from "@openreel/core";
import { ClipGainLine } from "./ClipGainLine";
import { dbToFraction } from "./clip-gain-geometry";

const W = 400;
const H = 42;

const clipWith = (volume: AutomationPoint[] | undefined): Clip => ({
  id: "clip",
  trackId: "track",
  mediaId: "media",
  startTime: 0,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
  ...(volume ? { automation: { volume } } : {}),
});

function setup(points: AutomationPoint[] | undefined, locked = false) {
  const onCommit = vi.fn();
  const view = render(<ClipGainLine clip={clipWith(points)} width={W} height={H} locked={locked} onCommit={onCommit} />);
  const svg = view.container.querySelector("svg") as SVGSVGElement;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) });
  return { ...view, svg, onCommit };
}

const segment = (c: HTMLElement, i = 0) => c.querySelector(`[data-gain-segment="${i}"]`) as Element;
const hit = (c: HTMLElement, i: number) => c.querySelector(`[data-gain-hit="${i}"]`) as Element;
const yOfDb = (db: number) => dbToFraction(db) * H;

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId = 1; });
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClipGainLine", () => {
  it("draws the flat clip gain with the 0 dB reference at 60 percent height", async () => {
    const { container } = setup(undefined);
    const unity = container.querySelector('[data-gain-grid="0"]') as SVGLineElement;
    expect(Number(unity.getAttribute("y1"))).toBeCloseTo(H * 0.4, 6);
    expect(container.querySelectorAll("[data-gain-point]")).toHaveLength(0);
    expect(container.querySelector("[data-gain-curve]")).not.toBeNull();
  });

  it("Cmd-click adds one point and commits exactly one action", async () => {
    const { container, onCommit } = setup(undefined);
    act(() => { fireEvent.pointerDown(segment(container), { clientX: 100, clientY: yOfDb(0), metaKey: true, button: 0 }); });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => { fireEvent.pointerUp(window, { clientX: 100, clientY: yOfDb(0) }); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("clip", [{ time: 1, value: 1 }]);
  });

  it("pointer-down, drag and up on a point commits one action with the dragged point", async () => {
    const { container, onCommit } = setup([{ time: 1, value: 1 }, { time: 2, value: 1 }]);
    act(() => { fireEvent.pointerDown(hit(container, 1), { clientX: 200, clientY: yOfDb(0), button: 0 }); });
    for (const y of [yOfDb(-3), yOfDb(-8), yOfDb(-12)]) act(() => { fireEvent.pointerMove(window, { clientX: 200, clientY: y }); });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => { fireEvent.pointerUp(window, { clientX: 200, clientY: yOfDb(-12) }); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [clipId, points] = onCommit.mock.calls[0] as [string, AutomationPoint[]];
    expect(clipId).toBe("clip");
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ time: 1, value: 1 });
    expect(points[1].time).toBeCloseTo(2, 6);
    expect(points[1].value).toBeCloseTo(dbToVolume(-12), 3);
  });

  it("Shift constrains the point to vertical movement and snaps near 0 dB", async () => {
    const { container, onCommit } = setup([{ time: 1, value: 0.5 }]);
    act(() => { fireEvent.pointerDown(hit(container, 0), { clientX: 100, clientY: yOfDb(-6), button: 0 }); });
    act(() => { fireEvent.pointerMove(window, { clientX: 220, clientY: yOfDb(-0.5), shiftKey: true }); });
    await act(async () => { fireEvent.pointerUp(window, { clientX: 220, clientY: yOfDb(-0.5), shiftKey: true }); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][1]).toEqual([{ time: 1, value: 1 }]);
  });

  it("dragging a segment raises only the points at its ends", async () => {
    const { container, onCommit } = setup([{ time: 1, value: 0.5 }, { time: 2, value: 0.5 }, { time: 3, value: 0.5 }]);
    // Segment 1 is between the points at 1s and 2s.
    act(() => { fireEvent.pointerDown(segment(container, 1), { clientX: 150, clientY: yOfDb(-6), button: 0 }); });
    act(() => { fireEvent.pointerMove(window, { clientX: 150, clientY: yOfDb(-6) - 6 }); });
    await act(async () => { fireEvent.pointerUp(window, { clientX: 150, clientY: yOfDb(-6) - 6 }); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const points = onCommit.mock.calls[0][1] as AutomationPoint[];
    const at = (t: number) => points.find((p) => p.time === t)!.value;
    expect(at(1)).toBeGreaterThan(0.5);
    expect(at(2)).toBeGreaterThan(0.5);
    expect(at(3)).toBe(0.5);
    expect(at(1)).toBeCloseTo(at(2), 9);
  });

  it("a click without movement on a point changes nothing", async () => {
    const { container, onCommit } = setup([{ time: 1, value: 1 }]);
    act(() => { fireEvent.pointerDown(hit(container, 0), { clientX: 100, clientY: yOfDb(0), button: 0 }); });
    await act(async () => { fireEvent.pointerUp(window, { clientX: 100, clientY: yOfDb(0) }); });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Alt-click removes a point, and removing the last one clears the lane", async () => {
    const { container, onCommit } = setup([{ time: 1, value: 1 }]);
    await act(async () => { fireEvent.pointerDown(hit(container, 0), { clientX: 100, clientY: yOfDb(0), altKey: true, button: 0 }); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("clip", null);
  });

  it("Escape during a drag cancels it without committing", async () => {
    const { container, onCommit } = setup([{ time: 1, value: 1 }]);
    act(() => { fireEvent.pointerDown(hit(container, 0), { clientX: 100, clientY: yOfDb(0), button: 0 }); });
    act(() => { fireEvent.pointerMove(window, { clientX: 100, clientY: yOfDb(-12) }); });
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    await act(async () => { fireEvent.pointerUp(window, { clientX: 100, clientY: yOfDb(-12) }); });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("on a locked track a press is routed to the action (which refuses) and never starts a drag", async () => {
    const { container, onCommit } = setup([{ time: 1, value: 1 }], true);
    act(() => { fireEvent.pointerDown(hit(container, 0), { clientX: 100, clientY: yOfDb(0), button: 0 }); });
    act(() => { fireEvent.pointerMove(window, { clientX: 100, clientY: yOfDb(-12) }); });
    await act(async () => { fireEvent.pointerUp(window, { clientX: 100, clientY: yOfDb(-12) }); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("clip", [{ time: 1, value: 1 }]);
  });
});
