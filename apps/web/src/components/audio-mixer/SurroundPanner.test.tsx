import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SURROUND_PAN, type SurroundPan } from "@openreel/core";
import { SurroundPanner, formatSurroundPosition } from "./SurroundPanner";

const renderPanner = (pan: SurroundPan = DEFAULT_SURROUND_PAN, extra: Partial<React.ComponentProps<typeof SurroundPanner>> = {}) => {
  const onChange = vi.fn();
  render(<SurroundPanner label="Dialogue surround pan" testId="sp" pan={pan} onChange={onChange} {...extra} />);
  return { onChange };
};

describe("SurroundPanner", () => {
  it("shows where the source sits and how much each of the six speakers receives", () => {
    renderPanner({ x: -1, y: 1, divergence: 0, lfeSend: 0.5 });
    expect(screen.getByTestId("sp-position").textContent).toBe("L100 · Front");
    const gain = (name: string) => Number(screen.getByTestId(`sp-gain-${name}`).getAttribute("data-gain"));
    expect(gain("L")).toBeCloseTo(1, 3);
    expect(gain("R")).toBeCloseTo(0, 3);
    expect(gain("C")).toBeCloseTo(0, 3);
    expect(gain("LFE")).toBeCloseTo(0.5, 3);
    expect(gain("Ls")).toBeCloseTo(0, 3);
  });

  it("moves with the arrow keys (shift for big steps) and Home returns to front centre", () => {
    const { onChange } = renderPanner({ x: 0, y: 0, divergence: 0.2, lfeSend: 0 });
    const puck = screen.getByTestId("sp-puck");
    fireEvent.keyDown(puck, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 0.05, y: 0, divergence: 0.2, lfeSend: 0 });
    fireEvent.keyDown(puck, { key: "ArrowDown", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: -0.25, divergence: 0.2, lfeSend: 0 });
    fireEvent.keyDown(puck, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: 1, divergence: 0.2, lfeSend: 0 });
  });

  it("clamps the puck to the room", () => {
    const { onChange } = renderPanner({ x: 1, y: 1, divergence: 0, lfeSend: 0 });
    fireEvent.keyDown(screen.getByTestId("sp-puck"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 1, y: 1, divergence: 0, lfeSend: 0 });
  });

  it("offers Follow track only when the position can be cleared", () => {
    const { onChange } = renderPanner(DEFAULT_SURROUND_PAN, { source: "Clip" });
    expect(screen.queryByTestId("sp-reset")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    const onReset = vi.fn();
    render(<SurroundPanner label="Clip" testId="clip" pan={DEFAULT_SURROUND_PAN} onChange={() => undefined} onReset={onReset} source="Clip" />);
    fireEvent.click(screen.getByTestId("clip-reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("does not move while disabled", () => {
    const { onChange } = renderPanner(DEFAULT_SURROUND_PAN, { disabled: true });
    fireEvent.keyDown(screen.getByTestId("sp-puck"), { key: "ArrowLeft" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats positions", () => {
    expect(formatSurroundPosition({ x: 0, y: 1, divergence: 0, lfeSend: 0 })).toBe("C · Front");
    expect(formatSurroundPosition({ x: 0.5, y: -1, divergence: 0, lfeSend: 0 })).toBe("R50 · Rear");
  });
});
