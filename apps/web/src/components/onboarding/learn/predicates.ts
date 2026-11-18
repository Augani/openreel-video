import type { Project } from "@openreel/core";
import type { LessonId } from "./lessons";

/**
 * Lesson completion is decided from project state, not clicks (spec 2.5). A lesson is "done" when the
 * project reaches the state the lesson teaches, no matter how the user got there (keys, menus, drag, AI).
 *
 * A snapshot is a small, serialisable summary of the project; predicates compare the current snapshot with
 * a `baseline` taken when the lesson became active.
 */

export interface SnapshotClip {
  readonly id: string;
  readonly kind: "video" | "audio" | "image";
  readonly inPoint: number;
  readonly outPoint: number;
  readonly volume: number;
}

export interface LessonSnapshot {
  /** Every media clip on the timeline, with its media kind (track type is only a legacy hint). */
  readonly clips: readonly SnapshotClip[];
  readonly textClipCount: number;
  /** Queued/running export jobs plus an in-flight direct export. Grows when the user starts an export. */
  readonly exportActivity: number;
}

const VOLUME_EPSILON = 0.001;

export function snapshotProject(project: Project, exportActivity: number): LessonSnapshot {
  const kindById = new Map(project.mediaLibrary.items.map((item) => [item.id, item.type] as const));
  const clips: SnapshotClip[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      clips.push({
        id: clip.id,
        kind: kindById.get(clip.mediaId) ?? (track.type === "audio" ? "audio" : "video"),
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        volume: clip.volume,
      });
    }
  }
  return { clips, textClipCount: project.textClips?.length ?? 0, exportActivity };
}

export const EMPTY_SNAPSHOT: LessonSnapshot = { clips: [], textClipCount: 0, exportActivity: 0 };

const visual = (s: LessonSnapshot) => s.clips.filter((c) => c.kind !== "audio");

export function visualClipCount(s: LessonSnapshot): number {
  return visual(s).length;
}

type Predicate = (now: LessonSnapshot, baseline: LessonSnapshot) => boolean;

const PREDICATES: Readonly<Record<LessonId, Predicate>> = {
  // At least one clip on a video lane.
  "place-clip": (now) => visualClipCount(now) >= 1,

  // The clip count increased since the lesson started (the split made one clip two).
  split: (now, baseline) => visualClipCount(now) > visualClipCount(baseline),

  // A clip disappeared, or a surviving clip was trimmed (in/out changed) since the lesson started.
  delete: (now, baseline) => {
    if (visualClipCount(now) < visualClipCount(baseline)) return true;
    const before = new Map(visual(baseline).map((c) => [c.id, c] as const));
    return visual(now).some((c) => {
      const prev = before.get(c.id);
      return !!prev && (prev.inPoint !== c.inPoint || prev.outPoint !== c.outPoint);
    });
  },

  // A text clip exists.
  title: (now) => now.textClipCount >= 1,

  // An audio clip exists and its volume is no longer the default 1.0.
  music: (now) => now.clips.some((c) => c.kind === "audio" && Math.abs(c.volume - 1) > VOLUME_EPSILON),

  // An export was started (dialog confirmed or a job queued).
  export: (now, baseline) => now.exportActivity > baseline.exportActivity,
};

export function isLessonComplete(
  id: LessonId,
  now: LessonSnapshot,
  baseline: LessonSnapshot = EMPTY_SNAPSHOT,
): boolean {
  return PREDICATES[id](now, baseline);
}
