import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { LessonBar } from "./LessonBar";
import { CELEBRATE_MS, beginLessons, exitLessons } from "./lesson-session";
import { setFixtureProject } from "./test-utils";

function setReducedMotion(reduced: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function addTarget(selector: string): HTMLElement {
  const el = document.createElement("div");
  const attr = selector.replace(/^\[|\]$/g, "").replace(/'/g, "");
  const [name, value] = attr.split("=");
  el.setAttribute(name, value ?? "");
  el.getBoundingClientRect = () => ({ left: 10, top: 80, width: 300, height: 200, right: 310, bottom: 280, x: 10, y: 80, toJSON: () => ({}) });
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
  window.location.hash = "#/editor";
  useOnboardingStore.getState().reset();
  useOnboardingStore.setState({ currentLesson: undefined, persona: undefined, path: undefined });
  useAIConnectionStore.setState({ apiKey: "" });
  keyboardShortcuts.resetAllShortcuts();
  setFixtureProject([]);
});
afterEach(() => {
  exitLessons();
  document.body.innerHTML = "";
  vi.useRealTimers();
  window.location.hash = "";
});

describe("LessonBar", () => {
  it("renders nothing until a lesson run is active", () => {
    render(<LessonBar />);
    expect(screen.queryByTestId("lesson-bar")).toBeNull();
  });

  it("shows the step, one sentence and an 'n of 6' pill, as a labelled region", () => {
    render(<LessonBar />);
    act(() => void beginLessons());
    const region = screen.getByRole("region", { name: /Lesson 1 of 6/ });
    expect(region).toBeTruthy();
    expect(screen.getByTestId("lesson-progress").textContent).toBe("1 of 6");
    expect(screen.getByText("Put a clip on the timeline")).toBeTruthy();
    expect(screen.getByText(/Drag a clip from the Media panel/)).toBeTruthy();
  });

  it("Mark as done, Skip lesson, Show me and Exit are all present on every lesson", () => {
    render(<LessonBar />);
    act(() => void beginLessons());
    for (const name of ["Show me", "Skip lesson", "Mark as done", "Exit lessons"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("Mark as done advances after the success line", () => {
    render(<LessonBar />);
    act(() => void beginLessons());
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(screen.getByTestId("lesson-bar").getAttribute("data-celebrating")).toBe("true");
    expect(screen.getByText(/That block is your clip/)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(CELEBRATE_MS + 10));
    expect(screen.getByTestId("lesson-bar").getAttribute("data-lesson")).toBe("split");
    expect(screen.getByTestId("lesson-progress").textContent).toBe("2 of 6");
  });

  it("names the live split key, including under the Premiere preset", () => {
    render(<LessonBar />);
    act(() => void beginLessons("split"));
    const defaultKey = keyboardShortcuts.formatShortcut("editing.split");
    expect(screen.getByText(defaultKey, { selector: "kbd" })).toBeTruthy();
    act(() => {
      keyboardShortcuts.applyPreset("premiere");
      window.dispatchEvent(new Event("focus"));
    });
    const premiereKey = keyboardShortcuts.formatShortcut("editing.split");
    expect(premiereKey).not.toBe(defaultKey);
    expect(screen.getByText(premiereKey, { selector: "kbd" })).toBeTruthy();
  });

  it("Skip lesson moves to the next lesson without a success line", () => {
    render(<LessonBar />);
    act(() => void beginLessons());
    fireEvent.click(screen.getByRole("button", { name: "Skip lesson" }));
    expect(screen.getByTestId("lesson-bar").getAttribute("data-lesson")).toBe("split");
    expect(screen.getByTestId("lesson-bar").getAttribute("data-celebrating")).toBe("false");
  });

  it("Exit hides the bar and keeps progress", () => {
    render(<LessonBar />);
    act(() => void beginLessons());
    fireEvent.click(screen.getByRole("button", { name: "Skip lesson" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit lessons" }));
    expect(screen.queryByTestId("lesson-bar")).toBeNull();
    expect(useOnboardingStore.getState().lessons["place-clip"]).toBe("skipped");
    expect(useOnboardingStore.getState().currentLesson).toBe("split");
  });

  it("does not show outside the editor route", () => {
    window.location.hash = "#/welcome";
    render(<LessonBar />);
    act(() => void beginLessons());
    expect(screen.queryByTestId("lesson-bar")).toBeNull();
  });

  it("is non-modal: the page behind it stays interactive (no full-screen overlay)", () => {
    render(<LessonBar />);
    act(() => void beginLessons());
    const bar = screen.getByTestId("lesson-bar");
    expect(bar.getAttribute("aria-modal")).toBeNull();
    expect(bar.className).not.toMatch(/inset-0/);
  });

  describe("Show me", () => {
    it("emphasises the target for about 3 seconds, then settles", () => {
      addTarget("[data-tour='timeline']");
      render(<LessonBar />);
      act(() => void beginLessons());
      act(() => void vi.advanceTimersByTime(600));
      const ring = screen.getByTestId("lesson-ring");
      expect(ring.getAttribute("data-emphasised")).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: "Show me" }));
      expect(screen.getByTestId("lesson-ring").getAttribute("data-emphasised")).toBe("true");
      act(() => void vi.advanceTimersByTime(3100));
      expect(screen.getByTestId("lesson-ring").getAttribute("data-emphasised")).toBe("false");
    });

    it("pulses by default but not under prefers-reduced-motion", () => {
      addTarget("[data-tour='timeline']");
      const { unmount } = render(<LessonBar />);
      act(() => void beginLessons());
      act(() => void vi.advanceTimersByTime(600));
      fireEvent.click(screen.getByRole("button", { name: "Show me" }));
      expect(screen.getByTestId("lesson-ring").className).toContain("animate-pulse");
      unmount();
      exitLessons();

      setReducedMotion(true);
      render(<LessonBar />);
      act(() => void beginLessons());
      act(() => void vi.advanceTimersByTime(600));
      fireEvent.click(screen.getByRole("button", { name: "Show me" }));
      expect(screen.getByTestId("lesson-ring").className).not.toContain("animate-pulse");
    });
  });

  describe("Ask AI to explain", () => {
    it("is hidden until a model is connected", () => {
      render(<LessonBar />);
      act(() => void beginLessons());
      expect(screen.queryByRole("button", { name: /Ask AI to explain/ })).toBeNull();
    });

    it("shows when a model is connected", () => {
      useAIConnectionStore.setState({ provider: "anthropic", apiKey: "test-key" });
      render(<LessonBar />);
      act(() => void beginLessons());
      expect(screen.getByRole("button", { name: /Ask AI to explain/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Do this step for me" })).toBeTruthy();
    });

    it("hides Do this step for me on the export lesson and while no model is connected", () => {
      render(<LessonBar />);
      act(() => void beginLessons("export"));
      expect(screen.queryByRole("button", { name: "Do this step for me" })).toBeNull();
    });
  });

  it("shows the finish card when every lesson is done or skipped", () => {
    render(<LessonBar />);
    act(() => void beginLessons());
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole("button", { name: "Skip lesson" }));
    expect(screen.getByRole("dialog", { name: /You made a video/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep learning" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make another" })).toBeTruthy();
    // No AI connected yet: the hand-off is offered.
    expect(screen.getByRole("button", { name: /Try the AI on this project/ })).toBeTruthy();
    // Nothing exported yet: no Show in Finder.
    expect(screen.queryByRole("button", { name: /Show in Finder/ })).toBeNull();
  });
});
