import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { applySpatialInterpolation, type Clip, type Keyframe, type Project } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { SpatialPathOverlay } from "./SpatialPathOverlay";

const key = (id: string, property: string, time: number, value: number): Keyframe => ({ id, property, time, value, easing: "linear" });
const base: Keyframe[] = [
  key("x0", "position.x", 0, 0), key("y0", "position.y", 0, 0),
  key("x1", "position.x", 1, 100), key("y1", "position.y", 1, 80),
  key("x2", "position.x", 2, 200), key("y2", "position.y", 2, 0),
];
const BOUNDS = { originX: 400, originY: 300, displayScale: 0.5, par: 1 };

function load(keyframes: Keyframe[], locked = false) {
  const clip = { id: "clip", startTime: 0, duration: 4, keyframes, effects: [] } as unknown as Clip;
  const current = useProjectStore.getState().project;
  const project = { ...current, timeline: { ...current.timeline, tracks: [{ id: "t", locked, clips: [clip] }] } } as unknown as Project;
  useProjectStore.setState({ project });
}
const keysOf = () => (useProjectStore.getState().project.timeline.tracks[0].clips[0] as Clip).keyframes;

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId = 1; });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SpatialPathOverlay", () => {
  it("draws nothing without a position path", () => {
    load([key("o1", "opacity", 0, 0), key("o2", "opacity", 1, 1)]);
    const { container } = render(<SpatialPathOverlay clipId="clip" bounds={BOUNDS} />);
    expect(container.firstChild).toBeNull();
  });

  it("draws the route and key points at monitor coordinates, with handles only for non-linear keys", () => {
    load(applySpatialInterpolation(base, ["x1"], "auto-bezier"));
    render(<SpatialPathOverlay clipId="clip" bounds={BOUNDS} />);
    const first = screen.getByTestId("spatial-vertex-0");
    expect(Number(first.getAttribute("cx"))).toBeCloseTo(400, 6); // origin + 0 * scale
    expect(Number(screen.getByTestId("spatial-vertex-1").getAttribute("cx"))).toBeCloseTo(450, 6); // 400 + 100 * 0.5
    expect(Number(screen.getByTestId("spatial-vertex-1").getAttribute("cy"))).toBeCloseTo(340, 6); // 300 + 80 * 0.5
    expect(screen.getByTestId("spatial-vertex-1").getAttribute("data-spatial-mode")).toBe("auto-bezier");
    expect(screen.getByTestId("spatial-handle-1-out")).toBeTruthy();
    expect(screen.getByTestId("spatial-handle-1-in")).toBeTruthy();
    expect(screen.queryByTestId("spatial-handle-0-out")).toBeNull();
    expect(screen.getByTestId("spatial-path-route").getAttribute("points")!.split(" ").length).toBe(49);
  });

  it("drags a handle: live preview while moving, one Continuous Bezier edit on release", () => {
    load(applySpatialInterpolation(base, ["x1"], "auto-bezier"));
    const { container } = render(<SpatialPathOverlay clipId="clip" bounds={BOUNDS} />);
    vi.spyOn(container.querySelector("svg")!, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
    const handle = screen.getByTestId("spatial-handle-1-out");
    const depth = useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 340, button: 0 });
    // Pointer at (600, 240) monitor px = position (400, -120)... (600-400)/0.5, (240-300)/0.5; key 1 is at (100, 80).
    fireEvent.pointerMove(handle, { clientX: 600, clientY: 240 });
    expect(keysOf().find((k) => k.id === "x1")!.spatialMode).toBe("auto-bezier"); // nothing committed mid-drag
    fireEvent.pointerUp(handle, { clientX: 600, clientY: 240 });
    const x1 = keysOf().find((k) => k.id === "x1")!;
    expect(x1.spatialMode).toBe("continuous-bezier");
    expect(x1.spatialOut!.x).toBeCloseTo(400 - 100, 6);
    expect(x1.spatialOut!.y).toBeCloseTo(-120 - 80, 6);
    expect(useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize()).toBe(depth + 1);
  });

  it("drags a key point and refuses edits on a locked track", () => {
    load(base);
    const { container } = render(<SpatialPathOverlay clipId="clip" bounds={BOUNDS} />);
    vi.spyOn(container.querySelector("svg")!, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
    const vertex = screen.getByTestId("spatial-vertex-1");
    fireEvent.pointerDown(vertex, { clientX: 450, clientY: 340, button: 0 });
    fireEvent.pointerMove(vertex, { clientX: 500, clientY: 400 });
    fireEvent.pointerUp(vertex, { clientX: 500, clientY: 400 });
    expect(keysOf().find((k) => k.id === "x1")!.value).toBeCloseTo(200, 6);
    expect(keysOf().find((k) => k.id === "y1")!.value).toBeCloseTo(200, 6);
    cleanup();
    load(base, true);
    const locked = render(<SpatialPathOverlay clipId="clip" bounds={BOUNDS} />);
    vi.spyOn(locked.container.querySelector("svg")!, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
    const lockedVertex = screen.getByTestId("spatial-vertex-1");
    fireEvent.pointerDown(lockedVertex, { clientX: 450, clientY: 340, button: 0 });
    fireEvent.pointerMove(lockedVertex, { clientX: 500, clientY: 400 });
    fireEvent.pointerUp(lockedVertex, { clientX: 500, clientY: 400 });
    expect(keysOf().find((k) => k.id === "x1")!.value).toBe(100);
  });
});
