import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DroppedFrameCounter } from "@openreel/core";

vi.mock("../../../stores/engine-store", () => ({
  useEngineStore: (selector: (s: { playbackController: null }) => unknown) => selector({ playbackController: null }),
}));

import { DroppedFrameIndicator, type DroppedFrameSource } from "./DroppedFrameIndicator";
import { indicatorView, useDroppedFrameIndicatorPrefs } from "./dropped-frame-indicator-state";

function sourceOf(counter: DroppedFrameCounter): DroppedFrameSource {
  return {
    getDroppedFrames: () => counter.count,
    resetDroppedFrames: () => counter.reset(),
    subscribeDroppedFrames: (l) => counter.subscribe(l),
  };
}

describe("indicatorView", () => {
  it("is green at zero, yellow with the count from the first drop, and blank while off", () => {
    expect(indicatorView(0, true)).toMatchObject({ tone: "green", text: "0" });
    expect(indicatorView(1, true)).toMatchObject({ tone: "yellow", text: "1", label: "1 dropped frame during this playback" });
    expect(indicatorView(12, true).label).toBe("12 dropped frames during this playback");
    expect(indicatorView(12, false)).toMatchObject({ tone: "off", text: "" });
  });
  it("sanitises bad counts", () => {
    expect(indicatorView(Number.NaN, true).tone).toBe("green");
    expect(indicatorView(-3, true).tone).toBe("green");
    expect(indicatorView(2.9, true).text).toBe("2");
  });
});

describe("DroppedFrameIndicator", () => {
  beforeEach(() => {
    useDroppedFrameIndicatorPrefs.setState({ enabled: true });
  });

  it("starts green, turns yellow with the count as frames drop, and green again after a reset", () => {
    const counter = new DroppedFrameCounter();
    render(<DroppedFrameIndicator source={sourceOf(counter)} />);
    const root = screen.getByTestId("dropped-frame-indicator");
    expect(root.dataset.tone).toBe("green");

    act(() => counter.increment());
    act(() => counter.increment(2));
    expect(root.dataset.tone).toBe("yellow");
    expect(screen.getByTestId("dropped-frame-count").textContent).toBe("3");
    expect(screen.getByRole("button", { name: "3 dropped frames during this playback" })).toBeTruthy();

    act(() => counter.reset());
    expect(root.dataset.tone).toBe("green");
  });

  it("reflects a count that already exists when it mounts", () => {
    const counter = new DroppedFrameCounter();
    counter.increment(5);
    render(<DroppedFrameIndicator source={sourceOf(counter)} />);
    expect(screen.getByTestId("dropped-frame-count").textContent).toBe("5");
  });

  it("shows no count when the setting is off, and stops listening on unmount", () => {
    const counter = new DroppedFrameCounter();
    useDroppedFrameIndicatorPrefs.setState({ enabled: false });
    const { unmount } = render(<DroppedFrameIndicator source={sourceOf(counter)} />);
    act(() => counter.increment());
    expect(screen.getByTestId("dropped-frame-indicator").dataset.tone).toBe("off");
    expect(screen.queryByTestId("dropped-frame-count")).toBeNull();
    unmount();
    expect(() => counter.increment()).not.toThrow();
  });

  it("renders green with no playback engine yet", () => {
    render(<DroppedFrameIndicator source={null} />);
    expect(screen.getByTestId("dropped-frame-indicator").dataset.tone).toBe("green");
  });

  const openMenu = () => {
    const trigger = screen.getByRole("button");
    fireEvent.keyDown(trigger, { key: "Enter" });
  };

  it("toggles the preference from the menu and updates the tone", async () => {
    const counter = new DroppedFrameCounter();
    render(<DroppedFrameIndicator source={sourceOf(counter)} />);
    openMenu();
    const item = await screen.findByRole("menuitemcheckbox", { name: "Show dropped frame indicator" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item);
    expect(useDroppedFrameIndicatorPrefs.getState().enabled).toBe(false);
    expect(screen.getByTestId("dropped-frame-indicator").dataset.tone).toBe("off");
  });

  it("Reset count zeroes the source", async () => {
    const counter = new DroppedFrameCounter();
    counter.increment(4);
    const source = sourceOf(counter);
    const reset = vi.spyOn(source, "resetDroppedFrames");
    render(<DroppedFrameIndicator source={source} />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reset count" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(counter.count).toBe(0);
  });

  it("persists the preference under its storage key", () => {
    useDroppedFrameIndicatorPrefs.getState().setEnabled(false);
    expect(localStorage.getItem("openreel-dropped-frame-indicator")).toContain('"enabled":false');
  });
});
