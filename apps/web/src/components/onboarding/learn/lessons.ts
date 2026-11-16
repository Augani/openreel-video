/**
 * The six Learn lessons (spec 2.5). Copy is plain-language and jargon free. `{splitKey}` / `{deleteKey}`
 * are replaced with the live key bindings (lesson-keys.ts). Completion is decided from project state
 * (predicates.ts), never from clicks.
 */

export type LessonId = "place-clip" | "split" | "delete" | "title" | "music" | "export";

export interface LessonDef {
  readonly id: LessonId;
  readonly title: string;
  /** One sentence; may contain {splitKey} / {deleteKey}. */
  readonly instruction: string;
  /** Shown briefly when the lesson completes. */
  readonly success: string;
  /** CSS selector of the panel to point at ("Show me"). */
  readonly target: string;
  /** Prefilled how-do-I question for "Ask AI to explain". It must never edit the project. */
  readonly explainTopic: string;
  /** What "Do this step for me" asks the AI to do. Absent when the step needs the user (export). */
  readonly doPrompt?: string;
}

export const LESSONS: readonly LessonDef[] = [
  {
    id: "place-clip",
    title: "Put a clip on the timeline",
    instruction: "Drag a clip from the Media panel onto the timeline.",
    success: "Nice. That block is your clip. Everything you do next happens on the timeline.",
    target: "[data-tour='timeline']",
    explainTopic: "how to put a clip from the media panel onto the timeline",
    doPrompt: "Add the first clip from my media library to the timeline.",
  },
  {
    id: "split",
    title: "Cut a clip in two",
    instruction: "Move the playhead to where you want to cut, then press {splitKey}.",
    success: "That's a split. One clip is now two, and you can treat each piece separately.",
    target: "[data-tour='timeline']",
    explainTopic: "how to split a clip at the playhead",
    doPrompt: "Split the clip on the timeline in two at the current playhead position.",
  },
  {
    id: "delete",
    title: "Remove the part you don't want",
    instruction: "Select the piece you don't want and press {deleteKey}.",
    success: "Gone. Undo is always one keypress away if you change your mind.",
    target: "[data-tour='timeline']",
    explainTopic: "how to select a clip piece and delete it from the timeline",
    doPrompt: "Delete the second piece of the split clip from the timeline.",
  },
  {
    id: "title",
    title: "Add a title",
    instruction: "Add a title. Open Text and click Title.",
    success: "Your title is on the timeline. Select it to change the words, font and colour.",
    target: "[data-tour='assets']",
    explainTopic: "how to add a title using the Text panel",
    doPrompt: "Add a short title text clip to the start of the timeline.",
  },
  {
    id: "music",
    title: "Add music and turn it down",
    instruction: "Add the music clip to the timeline, select it, then lower its Volume in the Inspector.",
    success: "Music under picture should sit quietly. You just balanced your first mix.",
    target: "[data-tour='inspector']",
    explainTopic: "how to add a music clip and lower its volume in the inspector",
    doPrompt: "Add the music clip to the timeline on its own audio track and lower its volume so it sits under the picture.",
  },
  {
    id: "export",
    title: "Export your video",
    instruction: "Press Export and choose Start.",
    success: "You made a video.",
    target: "[data-editor-export-control]",
    explainTopic: "how to export my finished video",
  },
];

export const LESSON_IDS: readonly LessonId[] = LESSONS.map((l) => l.id);

export function getLesson(id: string | undefined): LessonDef | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function isLessonId(value: unknown): value is LessonId {
  return typeof value === "string" && (LESSON_IDS as readonly string[]).includes(value);
}
