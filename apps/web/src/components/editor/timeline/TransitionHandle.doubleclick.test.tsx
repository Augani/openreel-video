import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransitionHandle } from "./TransitionHandle";
import type { ResolvedTransitionHandle } from "./transition-handles";

const selectEditPoint = vi.fn();
const openTrimMonitor = vi.fn();
vi.mock("../../../services/edit-point-commands", () => ({ selectEditPoint: (...a: unknown[]) => selectEditPoint(...a) }));
vi.mock("../../../services/trim-monitor", () => ({ openTrimMonitor: () => openTrimMonitor() }));

const handle = {
  centerX: 120,
  transition: undefined,
  clipA: { id: "a" },
  clipB: { id: "b" },
  edge: undefined,
} as unknown as ResolvedTransitionHandle;

const mount = (h: ResolvedTransitionHandle = handle) =>
  render(<TransitionHandle handle={h} trackId="t" isSelected={false} onSelect={vi.fn()} />);

// jsdom has no PointerEvent; without it fireEvent drops button and coordinates.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim, configurable: true });
}

// Give the two physical presses deterministic timestamps even on a loaded CI runner.
function press(target: Element, timeStamp: number) {
  const event = createEvent.pointerDown(target, { button: 0, clientX: 1, clientY: 1 });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  fireEvent(target, event);
}

describe("TransitionHandle double-click", () => {
  afterEach(() => {
    cleanup();
    selectEditPoint.mockClear();
    openTrimMonitor.mockClear();
  });

  it("opens the Trim Monitor on the cut when the badge is double-clicked", () => {
    mount();
    const button = screen.getByRole("button");
    press(button, 100);
    press(document.body, 180);
    expect(selectEditPoint).toHaveBeenCalledWith("b", "left");
    expect(openTrimMonitor).toHaveBeenCalledTimes(1);
  });

  it("a single press only arms the menu and does not open the monitor", () => {
    mount();
    fireEvent.pointerDown(screen.getByRole("button"), { button: 0, clientX: 1, clientY: 1 });
    expect(openTrimMonitor).not.toHaveBeenCalled();
  });

  it("targets the clip's right edge for an outro handle", () => {
    mount({ centerX: 1, transition: undefined, clipA: { id: "a" }, clipB: undefined, edge: "out" } as unknown as ResolvedTransitionHandle);
    const button = screen.getByRole("button");
    press(button, 100);
    press(document.body, 180);
    expect(selectEditPoint).toHaveBeenCalledWith("a", "right");
  });
});
