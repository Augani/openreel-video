import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";

const apply = vi.fn();
const preview = vi.fn();
const read = vi.fn();

vi.mock("../../../services/white-balance-eyedropper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/white-balance-eyedropper")>()),
  applyWhiteBalancePick: (...args: unknown[]) => apply(...args),
  previewWhiteBalancePick: (...args: unknown[]) => preview(...args),
  readCanvasSample: (...args: unknown[]) => read(...args),
}));
vi.mock("../scopes/preview-canvas-registry", () => ({
  getPreviewCanvas: () => ({ width: 200, height: 100 }),
}));

import { WhiteBalanceEyedropperLayer } from "./WhiteBalanceEyedropperLayer";

const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

beforeEach(() => {
  // jsdom has no PointerEvent: without it clientX / button are dropped from pointer events.
  if (typeof window.PointerEvent === "undefined") {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;
  }
  apply.mockReset().mockResolvedValue({ ok: true, solution: { temperature: -12, tint: 3, clamped: false, neutral: [0.5, 0.5, 0.5] } });
  preview.mockReset().mockReturnValue({ ok: true, solution: { temperature: -12, tint: 3, clamped: false, neutral: [0.5, 0.5, 0.5] } });
  read.mockReset().mockReturnValue([0.6, 0.5, 0.4]);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  useColorMonitorStore.setState({ whiteBalancePick: null, whiteBalanceSize: 5 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("White balance eyedropper layer", () => {
  it("renders only while armed and Esc cancels without picking", () => {
    render(<WhiteBalanceEyedropperLayer />);
    expect(screen.queryByTestId("wb-eyedropper-layer")).toBeNull();
    act(() => useColorMonitorStore.getState().setWhiteBalancePick({ clipId: "c" }));
    expect(screen.getByTestId("wb-eyedropper-layer").className).toContain("cursor-crosshair");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useColorMonitorStore.getState().whiteBalancePick).toBeNull();
    expect(screen.queryByTestId("wb-eyedropper-layer")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a click samples the clicked canvas pixel with the chosen footprint and disarms after applying", async () => {
    useColorMonitorStore.setState({ whiteBalanceSize: 1 });
    act(() => useColorMonitorStore.getState().setWhiteBalancePick({ clipId: "c" }));
    render(<WhiteBalanceEyedropperLayer />);
    fireEvent.pointerDown(screen.getByTestId("wb-eyedropper-layer"), { clientX: 100, clientY: 50, button: 0 });
    await act(async () => {});
    expect(read).toHaveBeenCalledWith(expect.anything(), 100, 50, 1);
    expect(apply).toHaveBeenCalledWith("c", [0.6, 0.5, 0.4], false);
    expect(useColorMonitorStore.getState().whiteBalancePick).toBeNull();
  });

  it("stays armed when the sample is clipped so another spot can be tried", async () => {
    apply.mockResolvedValue({ ok: false, reason: "unusable-sample" });
    act(() => useColorMonitorStore.getState().setWhiteBalancePick({ clipId: "c" }));
    render(<WhiteBalanceEyedropperLayer />);
    fireEvent.pointerDown(screen.getByTestId("wb-eyedropper-layer"), { clientX: 10, clientY: 10, button: 0 });
    await act(async () => {});
    expect(useColorMonitorStore.getState().whiteBalancePick).toEqual({ clipId: "c" });
  });

  it("right click cancels", () => {
    act(() => useColorMonitorStore.getState().setWhiteBalancePick({ clipId: "c" }));
    render(<WhiteBalanceEyedropperLayer />);
    fireEvent.pointerDown(screen.getByTestId("wb-eyedropper-layer"), { clientX: 10, clientY: 10, button: 2 });
    expect(useColorMonitorStore.getState().whiteBalancePick).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("hover shows the live Temperature / Tint read-out", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
      cb(0);
      return 1;
    });
    act(() => useColorMonitorStore.getState().setWhiteBalancePick({ clipId: "c" }));
    render(<WhiteBalanceEyedropperLayer />);
    fireEvent.pointerMove(screen.getByTestId("wb-eyedropper-layer"), { clientX: 60, clientY: 30 });
    await act(async () => {});
    expect(screen.getByTestId("wb-eyedropper-readout").textContent).toContain("Temp -12");
    expect(screen.getByTestId("wb-eyedropper-readout").textContent).toContain("Tint +3");
    vi.unstubAllGlobals();
  });
});
