import { describe, it, expect, vi } from "vitest";
import { applyWindowControl, windowIsMaximized } from "../src/main/window-controls";

function fakeWin(maximized = false) {
  const state = { maximized, minimized: false, closed: false };
  return {
    state,
    minimize: vi.fn(() => { state.minimized = true; }),
    maximize: vi.fn(() => { state.maximized = true; }),
    unmaximize: vi.fn(() => { state.maximized = false; }),
    close: vi.fn(() => { state.closed = true; }),
    isMaximized: vi.fn(() => state.maximized),
  };
}

describe("window-controls", () => {
  it("minimize/close call through", () => {
    const w = fakeWin();
    applyWindowControl(w as never, "minimize");
    expect(w.minimize).toHaveBeenCalled();
    applyWindowControl(w as never, "close");
    expect(w.close).toHaveBeenCalled();
  });
  it("maximize toggles based on current state", () => {
    const w = fakeWin(false);
    applyWindowControl(w as never, "toggleMaximize");
    expect(w.maximize).toHaveBeenCalledTimes(1);
    const w2 = fakeWin(true);
    applyWindowControl(w2 as never, "toggleMaximize");
    expect(w2.unmaximize).toHaveBeenCalledTimes(1);
  });
  it("windowIsMaximized reflects the window", () => {
    expect(windowIsMaximized(fakeWin(true) as never)).toBe(true);
    expect(windowIsMaximized(fakeWin(false) as never)).toBe(false);
  });
  it("is a no-op on a null window", () => {
    expect(() => applyWindowControl(null, "minimize")).not.toThrow();
    expect(windowIsMaximized(null)).toBe(false);
  });
});
