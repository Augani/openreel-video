import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, GraduationCap, Loader2, Sparkles } from "../../../icons/lucide-compat";
import {
  practiceClipsAvailable,
  startOwnClipProject,
  startPracticeProject,
  type PracticeProgress,
} from "../../../services/onboarding/practice-project";
import { PracticeClipStrip } from "./PracticeClipStrip";
import { startLessons } from "./lesson-mount";
import type { LessonId } from "./lessons";

interface PickFootageProps {
  /** Called after the project exists and the Lesson Bar is up. */
  onStarted: () => void;
  /** Start at a specific lesson (Lesson Hub rows). */
  fromLesson?: LessonId;
}

type Choice = "practice" | "own";

/** L1 "Pick your practice footage" (spec 2.5). Two clicks from the Learn tile to the first lesson. */
export function PickFootage({ onStarted, fromLesson }: PickFootageProps): JSX.Element {
  const [practiceReady, setPracticeReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [progress, setProgress] = useState<PracticeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void practiceClipsAvailable().then((ok) => {
      if (mounted.current) setPracticeReady(ok);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = useCallback(() => {
    startLessons(fromLesson);
    onStarted();
  }, [fromLesson, onStarted]);

  const run = useCallback(
    async (choice: Choice, task: () => Promise<unknown>) => {
      setBusy(choice);
      setError(null);
      try {
        await task();
        if (mounted.current) finish();
      } catch (reason) {
        if (mounted.current) {
          setError(reason instanceof Error ? reason.message : "Something went wrong. Try again.");
          setBusy(null);
          setProgress(null);
        }
      }
    },
    [finish],
  );

  const usePractice = () => void run("practice", () => startPracticeProject(setProgress));
  const onFiles = (files: FileList | null) => {
    const picked = files ? Array.from(files) : [];
    if (picked.length > 0) void run("own", () => startOwnClipProject(picked, setProgress));
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <GraduationCap size={22} aria-hidden="true" />
        </div>
        <h1 id="learn-sheet-title" className="text-xl font-semibold tracking-tight text-fg">
          Pick your practice footage
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
          Six short, hands-on lessons on a real project. About 10 minutes, and you can leave any time.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Footage choices">
        {practiceReady !== false && (
          <button
            type="button"
            data-autofocus
            disabled={busy !== null || practiceReady === null}
            onClick={usePractice}
            className="group relative rounded-xl border border-border bg-bg-2 p-4 text-left transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-glow focus-visible:border-accent/40 focus-visible:shadow-glow focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none"
          >
            <span className="mb-3 flex items-center justify-between">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
                {busy === "practice" ? (
                  <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Sparkles size={16} aria-hidden="true" />
                )}
              </span>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">
                Recommended
              </span>
            </span>
            <span className="block text-sm font-semibold text-fg">Use the practice clips</span>
            <span className="mt-1 block text-xs leading-relaxed text-fg-2">
              Three short clips and a music track made for learning. Nothing to download.
            </span>
            <PracticeClipStrip />
          </button>
        )}

        <button
          type="button"
          data-autofocus={practiceReady === false ? "" : undefined}
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
          className="group relative rounded-xl border border-border bg-bg-2 p-4 text-left transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-glow focus-visible:border-accent/40 focus-visible:shadow-glow focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none"
        >
          <span className="mb-3 flex items-center">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-bg-3 text-fg-2">
              {busy === "own" ? (
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <FolderOpen size={16} aria-hidden="true" />
              )}
            </span>
          </span>
          <span className="block text-sm font-semibold text-fg">Use my own clip</span>
          <span className="mt-1 block text-xs leading-relaxed text-fg-2">
            Pick a video from your computer. The lessons work with any footage.
          </span>
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="video/*,audio/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="learn-own-clip-input"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="mt-4 min-h-[2.5rem]" aria-live="polite">
        {busy && progress && (
          <div>
            <div className="flex items-center justify-between text-xs text-fg-2">
              <span>{progress.stage}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Setting up your project"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-3"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-xs text-fg-2">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
