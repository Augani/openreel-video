import { useCallback, useEffect, useMemo } from "react";
import { useOnboardingStore, type OnboardingLessonState } from "../../../stores/onboarding-store";
import { LESSONS, getLesson, isLessonId, type LessonDef, type LessonId } from "./lessons";
import {
  beginLessons,
  completeLesson,
  exitLessons,
  resetLessons,
  useLessonSession,
  watchLessonState,
} from "./lesson-session";

export interface LessonProgressItem {
  readonly def: LessonDef;
  readonly index: number;
  readonly state: OnboardingLessonState;
  readonly isCurrent: boolean;
}

export interface LessonProgress {
  readonly items: readonly LessonProgressItem[];
  readonly current: LessonDef | undefined;
  /** 1-based position of the current lesson, for the "2 of 6" pill (0 when there is none). */
  readonly position: number;
  readonly total: number;
  /** Lessons marked done (skipped ones do not count). */
  readonly doneCount: number;
  /** Lessons that are done or skipped. */
  readonly settledCount: number;
  readonly celebrating: LessonDef | undefined;
  readonly finished: boolean;
  readonly active: boolean;
  readonly markDone: () => void;
  readonly skip: () => void;
  readonly exit: () => void;
  readonly start: (id?: LessonId) => void;
  readonly restart: () => void;
}

/** Progress for the Lesson Bar and the Lesson Hub, derived from the persisted onboarding store. */
export function useLessonProgress(): LessonProgress {
  const lessons = useOnboardingStore((s) => s.lessons);
  const currentLesson = useOnboardingStore((s) => s.currentLesson);
  const active = useLessonSession((s) => s.active);
  const celebratingId = useLessonSession((s) => s.celebrating);
  const finished = useLessonSession((s) => s.finished);

  const items = useMemo<LessonProgressItem[]>(
    () =>
      LESSONS.map((def, index) => ({
        def,
        index,
        state: lessons[def.id] ?? "todo",
        isCurrent: def.id === currentLesson,
      })),
    [lessons, currentLesson],
  );

  const current = getLesson(currentLesson);
  const position = current ? LESSONS.findIndex((l) => l.id === current.id) + 1 : 0;

  const markDone = useCallback(() => {
    const id = useOnboardingStore.getState().currentLesson;
    if (isLessonId(id)) completeLesson(id, "done");
  }, []);
  const skip = useCallback(() => {
    const id = useOnboardingStore.getState().currentLesson;
    if (isLessonId(id)) completeLesson(id, "skipped");
  }, []);
  const start = useCallback((id?: LessonId) => {
    beginLessons(id);
  }, []);
  const restart = useCallback(() => {
    resetLessons();
    beginLessons();
  }, []);

  return {
    items,
    current,
    position,
    total: LESSONS.length,
    doneCount: items.filter((i) => i.state === "done").length,
    settledCount: items.filter((i) => i.state !== "todo").length,
    celebrating: getLesson(celebratingId ?? undefined),
    finished,
    active,
    markDone,
    skip,
    exit: exitLessons,
    start,
    restart,
  };
}

/** Mount once while the Lesson Bar is up: watches the project and completes the current lesson from state. */
export function useLessonAutoComplete(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    return watchLessonState();
  }, [enabled]);
}
