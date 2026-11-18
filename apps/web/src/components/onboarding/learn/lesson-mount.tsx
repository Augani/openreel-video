import { createRoot, type Root } from "react-dom/client";
import { LessonBar } from "./LessonBar";
import { beginLessons } from "./lesson-session";
import type { LessonId } from "./lessons";

/**
 * The Lesson Bar outlives the Learn sheet (the sheet closes when the lessons start), and the sheet host is
 * owned by another package. So the bar mounts itself in its own React root on document.body: it keeps
 * working while the user moves through the editor, with no change to the app shell. It renders nothing
 * unless a lesson run is active and the route is the editor.
 */

const HOST_ATTR = "data-onboarding-lesson-bar";
let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountLessonBar(): void {
  if (root || typeof document === "undefined") return;
  host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<LessonBar />);
}

export function unmountLessonBar(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}

/** Starts or resumes the lessons and puts the Lesson Bar up. Returns the lesson that began, or null if all are done. */
export function startLessons(from?: LessonId): LessonId | null {
  const id = beginLessons(from);
  if (id) mountLessonBar();
  return id;
}

/** For a host that prefers to mount the bar in its own tree (for example next to OnboardingHost). */
export { LessonBar as LessonBarHost } from "./LessonBar";
