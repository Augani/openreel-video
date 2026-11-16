import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, GraduationCap, Lightbulb, Sparkles, SkipForward, X } from "../../../icons/lucide-compat";
import { LESSONS, type LessonDef } from "./lessons";
import { LessonText, lessonButton, useLiveLessonKeys, usePrefersReducedMotion } from "./lesson-ui";
import { useLessonProgress, useLessonAutoComplete } from "./useLessonProgress";
import { useTargetRect, type TargetRect } from "./useTargetRect";
import { askAiToDoStep, askAiToExplain, isAiConnected } from "./explain";
import { LessonFinish } from "./LessonFinish";

const SHOW_ME_MS = 3000;
const PREVIEW_SELECTOR = "[data-tour='preview']";

function useIsEditorRoute(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash.startsWith("#/editor"),
    () => false,
  );
}

function Ring({ rect, emphasised, reduced }: { rect: TargetRect; emphasised: boolean; reduced: boolean }): JSX.Element {
  const pad = emphasised ? 4 : 2;
  return (
    <div
      aria-hidden="true"
      data-testid="lesson-ring"
      data-emphasised={emphasised ? "true" : "false"}
      className={[
        "pointer-events-none fixed z-[58] rounded-xl border transition-[opacity,border-color,box-shadow] duration-200 motion-reduce:transition-none",
        emphasised
          ? `border-2 border-accent shadow-glow-lg ${reduced ? "" : "motion-safe:animate-pulse"}`
          : "border-accent/30 opacity-70",
      ].join(" ")}
      style={{
        left: rect.left - pad,
        top: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }}
    />
  );
}

function ProgressDots({ states, currentId }: { states: ReadonlyArray<{ id: string; state: string }>; currentId?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {states.map((s) => (
        <span
          key={s.id}
          className={[
            "h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none",
            s.id === currentId ? "w-4 bg-accent" : "w-1.5",
            s.id !== currentId && s.state === "done" ? "bg-accent/70" : "",
            s.id !== currentId && s.state === "skipped" ? "bg-fg-3/60" : "",
            s.id !== currentId && s.state === "todo" ? "bg-border-strong" : "",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

/**
 * The Lesson Bar (spec 2.5): a slim, non-modal card docked at the top of the Preview with the step, one
 * sentence, a progress pill and "Show me" / "Skip lesson" / "Mark as done" / "Exit". It never blocks the
 * editor (only the card itself takes pointer events) and "Mark as done" is always available.
 */
export function LessonBar(): JSX.Element | null {
  const progress = useLessonProgress();
  const keys = useLiveLessonKeys();
  const reduced = usePrefersReducedMotion();
  const inEditor = useIsEditorRoute();
  const previewRect = useTargetRect(inEditor ? PREVIEW_SELECTOR : null);
  const lesson: LessonDef | undefined = progress.celebrating ?? progress.current;
  const targetRect = useTargetRect(inEditor && !progress.finished && lesson ? lesson.target : null);
  const [showMe, setShowMe] = useState(false);
  const showMeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [asking, setAsking] = useState(false);
  const aiReady = isAiConnected();

  useLessonAutoComplete(progress.active && !progress.finished);

  useEffect(() => {
    setShowMe(false);
    if (showMeTimer.current) clearTimeout(showMeTimer.current);
  }, [lesson?.id]);
  useEffect(
    () => () => {
      if (showMeTimer.current) clearTimeout(showMeTimer.current);
    },
    [],
  );

  const onShowMe = useCallback(() => {
    setShowMe(true);
    if (showMeTimer.current) clearTimeout(showMeTimer.current);
    showMeTimer.current = setTimeout(() => setShowMe(false), SHOW_ME_MS);
  }, []);

  const onExplain = useCallback(() => {
    if (!lesson) return;
    setAsking(true);
    void askAiToExplain(lesson).finally(() => setAsking(false));
  }, [lesson]);

  const onDoStep = useCallback(() => {
    if (!lesson) return;
    setAsking(true);
    void askAiToDoStep(lesson).finally(() => setAsking(false));
  }, [lesson]);

  if (!progress.active || !inEditor) return null;
  if (progress.finished) return <LessonFinish />;
  if (!lesson) return null;

  const celebrating = !!progress.celebrating;
  const width = previewRect ? Math.min(760, Math.max(360, previewRect.width - 24)) : 720;
  const style = previewRect
    ? { left: previewRect.left + previewRect.width / 2, top: previewRect.top + 12, width }
    : { left: "50%", top: 56, width };

  return (
    <>
      {targetRect && !celebrating && <Ring rect={targetRect} emphasised={showMe} reduced={reduced} />}
      <section
        role="region"
        aria-label={`Lesson ${progress.position} of ${progress.total}: ${lesson.title}`}
        data-testid="lesson-bar"
        data-lesson={lesson.id}
        data-celebrating={celebrating ? "true" : "false"}
        className="fixed z-[60] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl border border-border-strong bg-bg-1/95 p-3 shadow-glow-lg backdrop-blur"
        style={style}
      >
        <div className="flex items-start gap-3">
          <div
            className={[
              "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
              celebrating ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent",
            ].join(" ")}
          >
            {celebrating ? <Check size={16} aria-hidden="true" /> : <GraduationCap size={16} aria-hidden="true" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className="rounded-full border border-border bg-bg-2 px-2 py-0.5 text-2xs font-medium tabular-nums text-fg-2"
                data-testid="lesson-progress"
              >
                {progress.position} of {progress.total}
              </span>
              <ProgressDots
                states={LESSONS.map((l) => ({ id: l.id, state: progress.items.find((i) => i.def.id === l.id)?.state ?? "todo" }))}
                currentId={lesson.id}
              />
            </div>
            <h2 className="mt-1.5 text-sm font-semibold tracking-tight text-fg">{lesson.title}</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-2" role="status" aria-live="polite">
              {celebrating ? lesson.success : <LessonText template={lesson.instruction} keys={keys} />}
            </p>
          </div>

          {!celebrating && (
            <button type="button" className={lessonButton("quiet")} onClick={progress.exit} aria-label="Exit lessons">
              <X size={14} aria-hidden="true" />
              Exit
            </button>
          )}
        </div>

        {!celebrating && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-11">
            <button type="button" className={lessonButton("primary")} onClick={onShowMe}>
              Show me
            </button>
            {aiReady && (
              <button type="button" className={lessonButton("quiet")} onClick={onExplain} disabled={asking}>
                <Lightbulb size={13} aria-hidden="true" />
                Ask AI to explain
              </button>
            )}
            {aiReady && lesson.doPrompt && (
              <button type="button" className={lessonButton("quiet")} onClick={onDoStep} disabled={asking}>
                <Sparkles size={13} aria-hidden="true" />
                Do this step for me
              </button>
            )}
            <span className="flex-1" />
            <button type="button" className={lessonButton("quiet")} onClick={progress.skip}>
              <SkipForward size={13} aria-hidden="true" />
              Skip lesson
            </button>
            <button type="button" className={lessonButton("quiet")} onClick={progress.markDone}>
              <Check size={13} aria-hidden="true" />
              Mark as done
            </button>
          </div>
        )}
      </section>
    </>
  );
}
