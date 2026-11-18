import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore, ONBOARDING_STORAGE_KEY } from "../../../stores/onboarding-store";
import { useExportQueueStore } from "../../../stores/export-queue-store";
import { useUIStore } from "../../../stores/ui-store";
import { CELEBRATE_MS, beginLessons, exitLessons, nextTodo, resetLessons, useLessonSession } from "./lesson-session";
import { useLessonAutoComplete, useLessonProgress } from "./useLessonProgress";
import { setFixtureProject } from "./test-utils";

function mountProgress() {
  return renderHook(() => {
    const progress = useLessonProgress();
    useLessonAutoComplete(progress.active && !progress.finished);
    return progress;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  useOnboardingStore.getState().reset();
  // reset() keeps optional fields (currentLesson, persona...) of the previous test, so clear them here.
  useOnboardingStore.setState({ currentLesson: undefined, persona: undefined, path: undefined, completedAt: undefined });
  exitLessons();
  setFixtureProject([]);
});
afterEach(() => {
  exitLessons();
  vi.useRealTimers();
});

describe("useLessonProgress", () => {
  it("starts at lesson 1 and records the learn persona", () => {
    const { result } = mountProgress();
    expect(result.current.active).toBe(false);
    act(() => void beginLessons());
    expect(result.current.active).toBe(true);
    expect(result.current.current?.id).toBe("place-clip");
    expect(result.current.position).toBe(1);
    expect(result.current.total).toBe(6);
    expect(useOnboardingStore.getState()).toMatchObject({ status: "in-progress", persona: "learn", path: "learn" });
  });

  it("completes lesson 1 from project state, flashes the success line, then moves on", () => {
    const { result } = mountProgress();
    act(() => void beginLessons());
    act(() => setFixtureProject([{ id: "a", media: "v" }]));
    expect(result.current.celebrating?.id).toBe("place-clip");
    expect(result.current.items[0].state).toBe("done");
    act(() => void vi.advanceTimersByTime(CELEBRATE_MS + 10));
    expect(result.current.celebrating).toBeUndefined();
    expect(result.current.current?.id).toBe("split");
  });

  it("completes lesson 2 when a split increases the clip count (baseline taken at lesson start)", () => {
    setFixtureProject([{ id: "a", media: "v" }]);
    const { result } = mountProgress();
    act(() => void beginLessons("split"));
    expect(result.current.current?.id).toBe("split");
    expect(result.current.celebrating).toBeUndefined();
    act(() => setFixtureProject([{ id: "a", media: "v", outPoint: 3 }, { id: "b", media: "v", inPoint: 3 }]));
    expect(result.current.celebrating?.id).toBe("split");
  });

  it("is not tied to how the edit happened: a trim completes the delete lesson", () => {
    setFixtureProject([{ id: "a", media: "v" }]);
    const { result } = mountProgress();
    act(() => void beginLessons("delete"));
    act(() => setFixtureProject([{ id: "a", media: "v", outPoint: 4 }]));
    expect(result.current.celebrating?.id).toBe("delete");
  });

  it("Mark as done is always available and moves on even if the predicate disagrees", () => {
    const { result } = mountProgress();
    act(() => void beginLessons("title"));
    act(() => result.current.markDone());
    expect(result.current.items.find((i) => i.def.id === "title")?.state).toBe("done");
    act(() => void vi.advanceTimersByTime(CELEBRATE_MS + 10));
    expect(result.current.current?.id).toBe("music");
  });

  it("Skip lesson moves on immediately and is recorded as skipped", () => {
    const { result } = mountProgress();
    act(() => void beginLessons());
    act(() => result.current.skip());
    expect(result.current.items[0].state).toBe("skipped");
    expect(result.current.current?.id).toBe("split");
    expect(result.current.doneCount).toBe(0);
    expect(result.current.settledCount).toBe(1);
  });

  it("persists progress and resumes the stored lesson after a relaunch", () => {
    const first = mountProgress();
    act(() => void beginLessons());
    act(() => first.result.current.skip());
    act(() => first.result.current.skip());
    first.unmount();

    const stored = JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}") as {
      state?: { lessons?: Record<string, string>; currentLesson?: string };
    };
    expect(stored.state?.lessons).toEqual({ "place-clip": "skipped", split: "skipped" });
    expect(stored.state?.currentLesson).toBe("delete");

    // "Relaunch": the runtime is gone, the persisted progress is not.
    exitLessons();
    const second = mountProgress();
    expect(second.result.current.active).toBe(false);
    act(() => void beginLessons());
    expect(second.result.current.current?.id).toBe("delete");
  });

  it("finishing the last lesson marks onboarding done and shows the finish state", () => {
    const { result } = mountProgress();
    act(() => void beginLessons());
    for (let i = 0; i < 6; i++) act(() => result.current.skip());
    expect(result.current.finished).toBe(true);
    expect(useOnboardingStore.getState().status).toBe("done");
    expect(useLessonSession.getState().finished).toBe(true);
  });

  it("Start over forgets progress", () => {
    const { result } = mountProgress();
    act(() => void beginLessons());
    act(() => result.current.skip());
    act(() => resetLessons());
    expect(result.current.settledCount).toBe(0);
    expect(nextTodo()).toBe("place-clip");
  });

  it("the export lesson completes when an export starts", () => {
    setFixtureProject([{ id: "a", media: "v" }]);
    const { result } = mountProgress();
    act(() => void beginLessons("export"));
    act(() =>
      useUIStore.getState().setExportState({ isExporting: true, progress: 0, phase: "Preparing" }),
    );
    expect(result.current.celebrating?.id).toBe("export");
  });

  it("exiting during the success flash still advances the stored lesson", () => {
    const { result } = mountProgress();
    act(() => void beginLessons("title"));
    act(() => result.current.markDone());
    act(() => exitLessons());
    expect(useOnboardingStore.getState().currentLesson).toBe("music");
    expect(useOnboardingStore.getState().lessons.title).toBe("done");
  });

  it("an edit made during the success flash counts for the next lesson", () => {
    setFixtureProject([{ id: "a", media: "v" }]);
    const { result } = mountProgress();
    act(() => void beginLessons("place-clip"));
    act(() => result.current.markDone());
    act(() => setFixtureProject([{ id: "a", media: "v", outPoint: 3 }, { id: "b", media: "v", inPoint: 3 }]));
    act(() => void vi.advanceTimersByTime(CELEBRATE_MS + 10));
    expect(result.current.celebrating?.id).toBe("split");
  });

  it("removing a queued export and adding another does not fake an export, a new job does", () => {
    setFixtureProject([{ id: "a", media: "v" }]);
    useExportQueueStore.setState({ queue: { jobs: [{ id: "old" } as never], paused: true } });
    const { result } = mountProgress();
    act(() => void beginLessons("export"));
    act(() => useExportQueueStore.setState({ queue: { jobs: [], paused: true } }));
    expect(result.current.celebrating).toBeUndefined();
    act(() => useExportQueueStore.setState({ queue: { jobs: [{ id: "new" } as never], paused: true } }));
    expect(result.current.celebrating?.id).toBe("export");
  });

  it("does not react to project changes while no lesson run is active", () => {
    mountProgress();
    act(() => setFixtureProject([{ id: "a", media: "v" }]));
    expect(useOnboardingStore.getState().lessons).toEqual({});
  });
});
