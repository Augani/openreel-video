import type { JSX } from "react";
import { Check, FolderOpen, Sparkles, X } from "../../../icons/lucide-compat";
import { useExportQueueStore } from "../../../stores/export-queue-store";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { exitLessons } from "./lesson-session";
import { isAiConnected } from "./explain";
import { lessonButton } from "./lesson-ui";

/** The finished export's on-disk path, once the export job has completed on desktop. */
function useExportedPath(): string | null {
  return useExportQueueStore((s) => {
    for (let i = s.queue.jobs.length - 1; i >= 0; i--) {
      const job = s.queue.jobs[i];
      if (job.status === "completed" && job.output?.storage === "disk" && job.output.path) return job.output.path;
    }
    return null;
  });
}

/**
 * L3 "You made a video." (spec 2.5). A calm card with a poster, not a celebration: no confetti, no loops.
 * Buttons: Show in Finder (once the file exists), Make another, Try the AI on this project (only when no AI
 * is connected yet) and Keep learning (opens the Lesson Hub).
 */
export function LessonFinish(): JSX.Element {
  const path = useExportedPath();
  const aiReady = isAiConnected();

  const reveal = () => {
    if (path) void window.openreel?.fs?.revealInFolder(path);
  };
  const makeAnother = () => {
    exitLessons();
    window.location.hash = "#/welcome";
  };
  const tryAi = () => {
    exitLessons();
    useOnboardingStore.getState().showSheet("ai");
  };
  const keepLearning = () => {
    exitLessons();
    useOnboardingStore.getState().showSheet("lessons");
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-end p-4">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="lesson-finish-title"
        data-testid="lesson-finish"
        onKeyDown={(e) => {
          if (e.key === "Escape") exitLessons();
        }}
        className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-border-strong bg-bg-1 shadow-glow-lg"
      >
        <div className="relative h-20 w-full overflow-hidden bg-bg-2" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/30 via-bg-2 to-bg" />
          <div className="absolute inset-x-6 bottom-6 top-6 rounded-lg border border-border-strong bg-bg/70" />
          <div className="absolute inset-0 grid place-items-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-fg shadow-glow-lg">
              <Check size={20} />
            </span>
          </div>
        </div>

        <div className="p-5">
          <h2 id="lesson-finish-title" className="text-lg font-semibold tracking-tight text-fg">
            You made a video.
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-fg-2">
            You placed, cut, trimmed, titled and mixed a clip, then exported it. That is the whole loop.
            {path ? " Your file is ready." : " Your export is on its way."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={lessonButton("solid")} onClick={keepLearning}>
              Keep learning
            </button>
            <button type="button" className={lessonButton("primary")} onClick={makeAnother}>
              Make another
            </button>
            {!aiReady && (
              <button type="button" className={lessonButton("primary")} onClick={tryAi}>
                <Sparkles size={13} aria-hidden="true" />
                Try the AI on this project
              </button>
            )}
            {path && (
              <button type="button" className={lessonButton("quiet")} onClick={reveal}>
                <FolderOpen size={13} aria-hidden="true" />
                Show in Finder
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          aria-label="Close"
          onClick={exitLessons}
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg bg-bg/60 text-fg-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
