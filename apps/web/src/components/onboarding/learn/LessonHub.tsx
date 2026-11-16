import type { JSX } from "react";
import { Check, Circle, Minus, RotateCcw } from "../../../icons/lucide-compat";
import { lessonButton, LessonText, useLiveLessonKeys } from "./lesson-ui";
import { useLessonProgress } from "./useLessonProgress";
import type { LessonId } from "./lessons";

interface LessonHubProps {
  /** The user chose a lesson (or Resume). The caller decides whether a project must be created first. */
  onLaunch: (id?: LessonId) => void;
  onStartOver: () => void;
}

const STATE_LABEL = { done: "Done", skipped: "Skipped", todo: "To do" } as const;

/**
 * The Lesson Hub (spec 2.5): every lesson with a tick, resumable from Help > Learn OpenReel. Rows are real
 * buttons, so the whole list is keyboard reachable; nothing here depends on a lesson run being active.
 */
export function LessonHub({ onLaunch, onStartOver }: LessonHubProps): JSX.Element {
  const progress = useLessonProgress();
  const keys = useLiveLessonKeys();
  const allSettled = progress.settledCount === progress.total;
  const started = progress.settledCount > 0;
  const primaryLabel = allSettled ? "Do them again" : started ? "Resume" : "Start lesson 1";

  return (
    <div>
      <div className="mb-5">
        <h1 id="learn-sheet-title" className="text-xl font-semibold tracking-tight text-fg">
          Learn OpenReel
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          <span className="tabular-nums">
            {progress.doneCount} of {progress.total}
          </span>{" "}
          lessons done. Pick up where you left off, or redo any of them.
        </p>
        <div
          role="progressbar"
          aria-label="Lessons completed"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.doneCount}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-3"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${(progress.doneCount / progress.total) * 100}%` }}
          />
        </div>
      </div>

      <ol className="overflow-hidden rounded-2xl border border-border bg-bg-1" aria-label="Lessons">
        {progress.items.map((item) => {
          const upNext = item.isCurrent && item.state === "todo";
          return (
            <li key={item.def.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                data-lesson-row={item.def.id}
                onClick={() => onLaunch(item.def.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 motion-reduce:transition-none"
              >
                <span
                  className={[
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                    item.state === "done" ? "bg-accent text-accent-fg" : "border border-border-strong text-fg-3",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {item.state === "done" ? (
                    <Check size={13} />
                  ) : item.state === "skipped" ? (
                    <Minus size={13} />
                  ) : (
                    <Circle size={8} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">
                      {item.index + 1}. {item.def.title}
                    </span>
                    {upNext && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">
                        Up next
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-fg-2">
                    <LessonText template={item.def.instruction} keys={keys} />
                  </span>
                </span>
                <span className="mt-0.5 shrink-0 text-2xs font-medium text-fg-3">{STATE_LABEL[item.state]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-autofocus
          className={lessonButton("solid")}
          onClick={() => onLaunch(allSettled ? progress.items[0]?.def.id : undefined)}
        >
          {primaryLabel}
        </button>
        {started && (
          <button type="button" className={lessonButton("quiet")} onClick={onStartOver}>
            <RotateCcw size={13} aria-hidden="true" />
            Start over
          </button>
        )}
      </div>
    </div>
  );
}
