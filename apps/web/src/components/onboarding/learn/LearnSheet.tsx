import type { JSX } from "react";
import { useCallback, useState } from "react";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { useProjectStore } from "../../../stores/project-store";
import type { OnboardingSheetProps } from "../types";
import { LessonHub } from "./LessonHub";
import { PickFootage } from "./PickFootage";
import { SheetFrame } from "./SheetFrame";
import { startLessons } from "./lesson-mount";
import { resetLessons } from "./lesson-session";
import type { LessonId } from "./lessons";

type View = { kind: "pick"; from?: LessonId } | { kind: "hub" };

/**
 * The Learn sheet. The host opens it for `openSheet === "learn"` (the L1 footage picker) and
 * `"lessons"` (the Lesson Hub). The lessons themselves run in the real editor under the Lesson Bar, so
 * this sheet closes as soon as they start.
 */
export function LearnSheet({ onClose }: OnboardingSheetProps): JSX.Element {
  const openSheet = useOnboardingStore((s) => s.openSheet);
  const [view, setView] = useState<View>(() => (openSheet === "lessons" ? { kind: "hub" } : { kind: "pick" }));

  const launch = useCallback(
    (id?: LessonId) => {
      if (useProjectStore.getState().hasOpenProject) {
        window.location.hash = "#/editor";
        startLessons(id);
        onClose();
        return;
      }
      // No project to practise on: set one up first (practice clips or the user's own clip).
      setView({ kind: "pick", from: id });
    },
    [onClose],
  );

  const startOver = useCallback(() => {
    resetLessons();
    launch();
  }, [launch]);

  return (
    <SheetFrame labelledBy="learn-sheet-title" onClose={onClose} wide={view.kind === "hub"}>
      {view.kind === "hub" ? (
        <LessonHub onLaunch={launch} onStartOver={startOver} />
      ) : (
        <PickFootage fromLesson={view.from} onStarted={onClose} />
      )}
    </SheetFrame>
  );
}
