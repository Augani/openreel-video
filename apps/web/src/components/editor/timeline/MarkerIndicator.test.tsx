import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkerIndicator, dragMarker } from "./MarkerIndicator";

const marker = { id: "cue", label: "Original", color: "#4885ce", time: 4 };
afterEach(cleanup);
describe("marker label drafts", () => {
  it("starts each edit from the current label after external edits or Undo", () => {
    const update = vi.fn();
    const props = { marker, pixelsPerSecond: 50, scrollX: 0, onUpdate: update };
    const view = render(<MarkerIndicator {...props} />);
    fireEvent.doubleClick(screen.getByText("Original"));
    fireEvent.change(screen.getByRole("textbox", { name: "Marker label" }), { target: { value: "Draft" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    view.rerender(<MarkerIndicator {...props} marker={{ ...marker, label: "Restored externally" }} />);
    fireEvent.doubleClick(screen.getByText("Restored externally"));
    const input = screen.getByRole("textbox", { name: "Marker label" });
    expect(input).toHaveValue("Restored externally");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(update).not.toHaveBeenCalled();
  });
  it("commits a trimmed changed name and keeps input keys out of editor shortcuts", () => {
    const update = vi.fn(), shortcut = vi.fn();
    render(<div onKeyDown={shortcut}><MarkerIndicator marker={marker} pixelsPerSecond={50} scrollX={0} onUpdate={update} /></div>);
    fireEvent.doubleClick(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: "Marker label" });
    fireEvent.change(input, { target: { value: "  Cut here  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(marker.id, { label: "Cut here" });
    expect(shortcut).not.toHaveBeenCalled();
  });
});

describe("range markers on the ruler", () => {
  const range = { id: "r", label: "Range", color: "#ef4444", time: 2, duration: 3 };
  const drag = (element: Element, from: number, to: number) => {
    fireEvent.mouseDown(element, { clientX: from, button: 0 });
    fireEvent.mouseMove(window, { clientX: to });
    fireEvent.mouseUp(window, { clientX: to });
  };

  it("draws a bar as wide as the range", () => {
    render(<MarkerIndicator variant="ruler" marker={range} pixelsPerSecond={50} scrollX={0} />);
    const bar = screen.getByTestId("ruler-marker-range");
    expect(bar.style.left).toBe("100px");
    expect(bar.style.width).toBe("150px");
  });

  it("dragging the body moves the marker by whole frames and keeps its length", () => {
    const update = vi.fn();
    render(<MarkerIndicator variant="ruler" marker={range} pixelsPerSecond={50} scrollX={0} frameRate={30} onUpdate={update} />);
    drag(screen.getByTestId("ruler-marker-range"), 100, 150);
    expect(update).toHaveBeenCalledTimes(1);
    const [id, updates] = update.mock.calls[0];
    expect(id).toBe("r");
    expect(updates.time).toBeCloseTo(3, 6);
    expect(updates.duration).toBeUndefined();
  });

  it("the end handle resizes and the start handle moves the in point keeping the out point", () => {
    const update = vi.fn();
    render(<MarkerIndicator variant="ruler" marker={range} pixelsPerSecond={50} scrollX={0} frameRate={30} onUpdate={update} />);
    drag(screen.getByTestId("marker-handle-end"), 250, 300);
    expect(update.mock.calls[0][1]).toMatchObject({ duration: expect.closeTo(4, 6) });
    expect(update.mock.calls[0][1].time).toBeUndefined();
    drag(screen.getByTestId("marker-handle-start"), 100, 150);
    expect(update.mock.calls[1][1].time).toBeCloseTo(3, 6);
    expect(update.mock.calls[1][1].duration).toBeCloseTo(2, 6);
  });

  it("a click without movement selects and seeks instead of editing", () => {
    const update = vi.fn(), seek = vi.fn(), select = vi.fn();
    render(<MarkerIndicator variant="ruler" marker={range} pixelsPerSecond={50} scrollX={0} onUpdate={update} onSeek={seek} onSelect={select} />);
    drag(screen.getByTestId("ruler-marker-range"), 120, 121);
    expect(update).not.toHaveBeenCalled();
    expect(seek).toHaveBeenCalledWith(2);
    expect(select).toHaveBeenCalledWith("r");
  });

  it("double click asks to edit it", () => {
    const edit = vi.fn();
    render(<MarkerIndicator variant="ruler" marker={range} pixelsPerSecond={50} scrollX={0} onEdit={edit} />);
    fireEvent.doubleClick(screen.getByTestId("ruler-marker-range"));
    expect(edit).toHaveBeenCalledWith("r");
  });
});

describe("dragMarker", () => {
  it("never moves before zero or shrinks a range below one frame", () => {
    expect(dragMarker({ time: 1, duration: 2 }, "move", -5, 30).time).toBe(0);
    const start = dragMarker({ time: 1, duration: 2 }, "start", 10, 30);
    expect(start.time).toBeCloseTo(3 - 1 / 30, 6);
    expect(start.duration).toBeCloseTo(1 / 30, 6);
    expect(dragMarker({ time: 1, duration: 2 }, "end", -10, 30).duration).toBeCloseTo(1 / 30, 6);
  });
});
