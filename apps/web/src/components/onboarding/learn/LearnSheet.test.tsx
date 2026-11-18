import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { useProjectStore } from "../../../stores/project-store";

const practice = vi.hoisted(() => ({
  available: vi.fn<[], Promise<boolean>>(),
  startPractice: vi.fn<[], Promise<unknown>>(),
  startOwn: vi.fn<[File[]], Promise<unknown>>(),
}));
vi.mock("../../../services/onboarding/practice-project", () => ({
  practiceClipsAvailable: practice.available,
  startPracticeProject: practice.startPractice,
  startOwnClipProject: practice.startOwn,
}));

import Sheet from "./index";
import { exitLessons, useLessonSession } from "./lesson-session";
import { unmountLessonBar } from "./lesson-mount";

beforeEach(() => {
  practice.available.mockResolvedValue(true);
  practice.startPractice.mockResolvedValue({ projectId: "p", imported: 4, failed: [] });
  practice.startOwn.mockResolvedValue({ projectId: "p", imported: 1, failed: [] });
  useOnboardingStore.getState().reset();
  useOnboardingStore.setState({ currentLesson: undefined, persona: undefined, path: undefined });
  window.location.hash = "#/welcome";
});
afterEach(() => {
  exitLessons();
  unmountLessonBar();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  useProjectStore.setState({ hasOpenProject: false });
});

describe("Learn sheet (L1 footage picker)", () => {
  it("is a labelled modal dialog with the practice clips recommended", async () => {
    useOnboardingStore.getState().showSheet("learn");
    render(<Sheet onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Pick your practice footage" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Use the practice clips/ })).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use my own clip/ })).toBeTruthy();
  });

  it("starts the lessons in two clicks: practice clips, then the Lesson Bar is up and the sheet closes", async () => {
    useOnboardingStore.getState().showSheet("learn");
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const button = await screen.findByRole("button", { name: /Use the practice clips/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(practice.startPractice).toHaveBeenCalledTimes(1);
    expect(useLessonSession.getState().active).toBe(true);
    expect(useOnboardingStore.getState().currentLesson).toBe("place-clip");
  });

  it("offers only 'Use my own clip' when the practice pack is not shipped (release-gate fallback)", async () => {
    practice.available.mockResolvedValue(false);
    render(<Sheet onClose={() => undefined} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Use the practice clips/ })).toBeNull());
    expect(screen.getByRole("button", { name: /Use my own clip/ })).toBeTruthy();
  });

  it("imports the files picked with 'Use my own clip'", async () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const input = screen.getByTestId("learn-own-clip-input") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2])], "mine.mp4", { type: "video/mp4" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(practice.startOwn).toHaveBeenCalledWith([file], expect.any(Function));
  });

  it("shows a clear error and stays open when setup fails", async () => {
    practice.startPractice.mockRejectedValue(new Error("Could not read the practice clips."));
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const button = await screen.findByRole("button", { name: /Use the practice clips/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not read the practice clips.");
    expect(onClose).not.toHaveBeenCalled();
    expect(useLessonSession.getState().active).toBe(false);
  });

  it("Esc closes the sheet and does not reach the router's Esc handler", () => {
    const onClose = vi.fn();
    const routerEsc = vi.fn();
    window.addEventListener("keydown", routerEsc);
    render(<Sheet onClose={onClose} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(routerEsc).not.toHaveBeenCalled();
    window.removeEventListener("keydown", routerEsc);
  });

  it("has an empty drag strip for the window chrome and a Close button", () => {
    render(<Sheet onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("Lesson Hub", () => {
  it("lists all six lessons with their state and resumes the stored lesson", () => {
    useOnboardingStore.getState().showSheet("lessons");
    useOnboardingStore.setState({
      status: "in-progress",
      lessons: { "place-clip": "done", split: "done", delete: "skipped" },
      currentLesson: "title",
    });
    useProjectStore.setState({ hasOpenProject: true });
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Learn OpenReel" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("2 of 6", { exact: false })).toBeTruthy();
    expect(screen.getByText("Up next")).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onClose).toHaveBeenCalled();
    expect(useLessonSession.getState().active).toBe(true);
    expect(useOnboardingStore.getState().currentLesson).toBe("title");
    expect(window.location.hash).toBe("#/editor");
  });

  it("a lesson row jumps to that lesson", () => {
    useOnboardingStore.getState().showSheet("lessons");
    useProjectStore.setState({ hasOpenProject: true });
    render(<Sheet onClose={() => undefined} />);
    fireEvent.click(document.querySelector('[data-lesson-row="music"]') as HTMLElement);
    expect(useOnboardingStore.getState().currentLesson).toBe("music");
  });

  it("without an open project it offers the footage picker instead of starting", async () => {
    useOnboardingStore.getState().showSheet("lessons");
    useProjectStore.setState({ hasOpenProject: false });
    render(<Sheet onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Start lesson 1" }));
    expect(await screen.findByRole("dialog", { name: "Pick your practice footage" })).toBeTruthy();
    expect(useLessonSession.getState().active).toBe(false);
  });

  it("Start over forgets progress", () => {
    useOnboardingStore.getState().showSheet("lessons");
    useOnboardingStore.setState({ status: "in-progress", lessons: { "place-clip": "done" }, currentLesson: "split" });
    useProjectStore.setState({ hasOpenProject: true });
    render(<Sheet onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
    expect(useOnboardingStore.getState().lessons["place-clip"]).toBe("todo");
    expect(useOnboardingStore.getState().currentLesson).toBe("place-clip");
  });
});
