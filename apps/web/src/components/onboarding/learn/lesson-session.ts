import { create } from "zustand";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { useProjectStore } from "../../../stores/project-store";
import { useExportQueueStore } from "../../../stores/export-queue-store";
import { useUIStore } from "../../../stores/ui-store";
import { LESSONS, LESSON_IDS, getLesson, isLessonId, type LessonId } from "./lessons";
import { isLessonComplete, snapshotProject, EMPTY_SNAPSHOT, type LessonSnapshot } from "./predicates";

/**
 * Runtime of an active lesson run. Progress itself (which lessons are done, which one is current) lives in
 * the persisted onboarding store, so it survives a relaunch. This store only holds what must not persist:
 * whether the Lesson Bar is up, the per-lesson baseline and the brief "done" flash.
 */
export interface LessonSessionState {
  active: boolean;
  /** Snapshot taken when the current lesson became active; predicates compare against it. */
  baseline: LessonSnapshot;
  /** The lesson that just completed and is showing its success line before the next one starts. */
  celebrating: LessonId | null;
  /** All lessons are done or skipped: the "You made a video." card is up. */
  finished: boolean;
}

export const useLessonSession = create<LessonSessionState>(() => ({
  active: false,
  baseline: EMPTY_SNAPSHOT,
  celebrating: null,
  finished: false,
}));

/** How long the success line stays before the next lesson starts. */
export const CELEBRATE_MS = 1600;

let advanceTimer: ReturnType<typeof setTimeout> | null = null;

function clearAdvanceTimer(): void {
  if (advanceTimer !== null) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }
}

// Export activity is a monotonic count of export starts seen since the run began, not a queue length: a
// removed job plus a new one, or a queue restored on relaunch, must not misfire the lesson.
const seenJobIds = new Set<string>();
let exportEvents = 0;
let wasExporting = false;

/** Mark everything already in the queue as seen so only exports started from now on count. */
function primeExportTracking(): void {
  seenJobIds.clear();
  for (const job of useExportQueueStore.getState().queue.jobs) seenJobIds.add(job.id);
  wasExporting = useUIStore.getState().exportState.isExporting;
}

export function currentExportActivity(): number {
  for (const job of useExportQueueStore.getState().queue.jobs) {
    if (!seenJobIds.has(job.id)) {
      seenJobIds.add(job.id);
      exportEvents += 1;
    }
  }
  const exporting = useUIStore.getState().exportState.isExporting;
  if (exporting && !wasExporting) exportEvents += 1;
  wasExporting = exporting;
  return exportEvents;
}

export function takeSnapshot(): LessonSnapshot {
  return snapshotProject(useProjectStore.getState().project, currentExportActivity());
}

function lessonState(id: LessonId): "todo" | "done" | "skipped" {
  return useOnboardingStore.getState().lessons[id] ?? "todo";
}

/** The next lesson still to do, searching forward from `after` and then wrapping to the start. */
export function nextTodo(after?: LessonId): LessonId | null {
  const start = after ? LESSON_IDS.indexOf(after) + 1 : 0;
  const ordered = [...LESSON_IDS.slice(start), ...LESSON_IDS.slice(0, start)];
  return ordered.find((id) => lessonState(id) === "todo") ?? null;
}

function activate(id: LessonId, baseline: LessonSnapshot = takeSnapshot()): void {
  useOnboardingStore.getState().setCurrentLesson(id);
  useLessonSession.setState({ baseline, celebrating: null, finished: false });
}

/** Baseline for the next lesson, taken the moment the previous one completed (not after the success flash). */
let pendingBaseline: LessonSnapshot | null = null;

/**
 * Start (or resume) a lesson run. Resumes the stored current lesson when it is still to do, else the first
 * lesson still to do. `from` jumps to a specific lesson (Lesson Hub rows). Returns the lesson id, or null
 * when every lesson is already done or skipped.
 */
export function beginLessons(from?: LessonId): LessonId | null {
  clearAdvanceTimer();
  const ob = useOnboardingStore.getState();
  if (ob.status === "unseen" || ob.status === "skipped") ob.start("learn", "learn");
  const stored = useOnboardingStore.getState().currentLesson;
  const id =
    from ??
    (isLessonId(stored) && lessonState(stored) === "todo" ? stored : null) ??
    nextTodo();
  if (!id) return null;
  if (from && lessonState(from) !== "todo") useOnboardingStore.getState().setLesson(from, "todo");
  primeExportTracking();
  pendingBaseline = null;
  useLessonSession.setState({ active: true });
  activate(id);
  return id;
}

/** Forget lesson progress (Lesson Hub "Start over"). */
export function resetLessons(): void {
  clearAdvanceTimer();
  const ob = useOnboardingStore.getState();
  for (const id of LESSON_IDS) ob.setLesson(id, "todo");
  ob.setCurrentLesson(undefined);
  useLessonSession.setState({ celebrating: null, finished: false });
}

function finishRun(): void {
  const ob = useOnboardingStore.getState();
  ob.setCurrentLesson(undefined);
  ob.markDone();
  useLessonSession.setState({ finished: true, celebrating: null });
}

function proceedFrom(id: LessonId): void {
  advanceTimer = null;
  const baseline = pendingBaseline ?? undefined;
  pendingBaseline = null;
  const next = nextTodo(id);
  if (next) {
    activate(next, baseline);
    // Work done during the success flash may already satisfy the next lesson.
    evaluateCurrentLesson();
  } else finishRun();
}

/**
 * Close out a lesson. "done" shows the success line for a moment first; "skipped" moves on immediately.
 * "Mark as done" in the bar uses "done" too, so a user is never stuck on a predicate that disagrees with
 * their workflow (for example splitting through the AI).
 */
export function completeLesson(id: LessonId, how: "done" | "skipped" = "done"): void {
  // Already settled (a double trigger, or "Mark as done" during the success flash): keep the first result.
  if (lessonState(id) !== "todo") return;
  clearAdvanceTimer();
  useOnboardingStore.getState().setLesson(id, how);
  if (how === "skipped") {
    proceedFrom(id);
    return;
  }
  pendingBaseline = takeSnapshot();
  useLessonSession.setState({ celebrating: id });
  advanceTimer = setTimeout(() => proceedFrom(id), CELEBRATE_MS);
}

/** Leave the lessons. Progress stays; the Lesson Hub can resume. */
export function exitLessons(): void {
  const celebrating = useLessonSession.getState().celebrating;
  clearAdvanceTimer();
  pendingBaseline = null;
  if (celebrating) {
    // Exiting during the success flash must still move progress on, so a resume lands on the next lesson.
    const ob = useOnboardingStore.getState();
    const next = nextTodo(celebrating);
    if (next) ob.setCurrentLesson(next);
    else {
      ob.setCurrentLesson(undefined);
      ob.markDone();
    }
  }
  useLessonSession.setState({ active: false, celebrating: null, finished: false });
}

/** Re-evaluate the current lesson against the live project. Returns true when it just completed. */
export function evaluateCurrentLesson(): boolean {
  const session = useLessonSession.getState();
  if (!session.active || session.celebrating || session.finished) return false;
  const id = useOnboardingStore.getState().currentLesson;
  if (!isLessonId(id) || lessonState(id) !== "todo") return false;
  if (!isLessonComplete(id, takeSnapshot(), session.baseline)) return false;
  completeLesson(id, "done");
  return true;
}

/**
 * Watches the stores that carry lesson state. Returns an unsubscribe. Each store is only re-evaluated when
 * the slice it contributes actually changed, so typing, playback and scrubbing cost nothing.
 */
export function watchLessonState(): () => void {
  const offProject = useProjectStore.subscribe((state, prev) => {
    if (state.project !== prev.project) evaluateCurrentLesson();
  });
  const offQueue = useExportQueueStore.subscribe((state, prev) => {
    if (state.queue.jobs.length !== prev.queue.jobs.length) evaluateCurrentLesson();
  });
  const offUi = useUIStore.subscribe((state, prev) => {
    if (state.exportState.isExporting !== prev.exportState.isExporting) evaluateCurrentLesson();
  });
  evaluateCurrentLesson();
  return () => {
    offProject();
    offQueue();
    offUi();
  };
}

export { LESSONS, getLesson };
