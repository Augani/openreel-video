import type { Clip, Project } from "../types";
import {
  addClips,
  allTracksRipple,
  diffPlan,
  openTimelineGap,
  pruneTransitions,
  removeInside,
  shiftAfter,
  splitAt,
} from "./premiere-edits";
import { isSyncLocked } from "./sync-lock";
import type { TimelineToolPlan } from "./timeline-tool-edit";

/**
 * Resolving a timeline clip drag (Premiere semantics).
 *
 *  - default: OVERWRITE. The dropped clips replace what is under them on their
 *    tracks: covered clips are removed, straddling clips are trimmed or split.
 *  - Cmd/Ctrl: INSERT. Everything at or after the drop point ripples later by
 *    the dropped span on the dropped clips' tracks and every other unlocked
 *    sync-locked track (a straddling clip is split).
 *  - Alt: COPY. The originals go back to where the drag started and copies
 *    (fresh IDs) are placed with the same overwrite/insert resolution.
 *
 * The drag itself moves clips live, so this runs on the project AFTER the
 * move. The dropped clips are the ones whose track or start differ from
 * `origins`, a snapshot taken when the drag began; this naturally includes
 * linked partners and every clip of a multi-selection. The result is one
 * TimelineToolPlan (diffed against the post-move project), committed inside the
 * drag's history group so the whole gesture is one undo step. No two clips on a
 * track overlap afterwards.
 */
const EPS = 1e-6;

export type ClipDropMode = "overwrite" | "insert";

export interface ClipDropOptions {
  mode: ClipDropMode;
  copy?: boolean;
}

export interface ClipOrigin {
  trackId: string;
  startTime: number;
}

/** Cmd/Ctrl = insert, Alt = copy, otherwise overwrite. */
export function clipDropOptionsFromModifiers(modifiers: {
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): ClipDropOptions {
  return {
    mode: modifiers.metaKey || modifiers.ctrlKey ? "insert" : "overwrite",
    copy: !!modifiers.altKey,
  };
}

/** Snapshot every media clip's track and start (taken when a drag begins). */
export function snapshotClipOrigins(project: Project): Map<string, ClipOrigin> {
  const origins = new Map<string, ClipOrigin>();
  for (const track of project.timeline.tracks)
    for (const clip of track.clips)
      origins.set(clip.id, { trackId: track.id, startTime: clip.startTime });
  return origins;
}

const endOf = (clip: Clip) => clip.startTime + clip.duration;

function withClipsOnTracks(
  work: Project,
  add: ReadonlyArray<Clip>,
  removeIds: ReadonlySet<string>,
): Project {
  return {
    ...work,
    timeline: {
      ...work.timeline,
      tracks: work.timeline.tracks.map((track) => {
        const kept = track.clips.filter((clip) => !removeIds.has(clip.id));
        const added = add.filter((clip) => clip.trackId === track.id);
        if (kept.length === track.clips.length && !added.length) return track;
        return {
          ...track,
          clips: [...kept, ...added].sort((a, b) => a.startTime - b.startTime),
        };
      }),
    },
  };
}

export function planClipDropResolution(
  project: Project,
  origins: ReadonlyMap<string, ClipOrigin>,
  options: ClipDropOptions,
  operationId: string,
): TimelineToolPlan {
  const label = options.copy
    ? options.mode === "insert"
      ? "Copy and insert clips"
      : "Copy and overwrite clips"
    : options.mode === "insert"
      ? "Insert clips"
      : "Overwrite clips";
  const moved: Clip[] = [];
  for (const track of project.timeline.tracks)
    for (const clip of track.clips) {
      const origin = origins.get(clip.id);
      if (!origin) continue;
      if (
        origin.trackId !== track.id ||
        Math.abs(origin.startTime - clip.startTime) > EPS
      )
        moved.push({ ...clip, trackId: track.id });
    }
  if (!moved.length) return { label, delta: 0, edits: [] };
  for (const clip of moved) {
    const track = project.timeline.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) throw new Error("Unlock the target track before editing.");
  }

  const movedIds = new Set(moved.map((clip) => clip.id));
  const placed: Clip[] = options.copy
    ? moved.map((clip, i) => ({
        ...structuredClone(clip),
        id: `${clip.id.slice(0, 48)}:copy:${operationId}:${i}`,
      }))
    : moved;
  // The base timeline: dragged clips lifted out; for a copy, the originals are
  // back where the drag started.
  const restored: Clip[] = options.copy
    ? moved.map((clip) => {
        const origin = origins.get(clip.id)!;
        return { ...clip, trackId: origin.trackId, startTime: origin.startTime };
      })
    : [];
  let work = withClipsOnTracks(project, restored, movedIds);

  const editTracks = [...new Set(placed.map((clip) => clip.trackId))];
  const counter = { n: 0 };
  let reference: Project;
  if (options.mode === "overwrite") {
    for (const clip of placed) {
      work = splitAt(work, [clip.trackId], clip.startTime, operationId, counter);
      work = splitAt(work, [clip.trackId], endOf(clip), operationId, counter);
    }
    reference = work;
    for (const clip of placed)
      work = removeInside(work, [clip.trackId], clip.startTime, endOf(clip));
  } else {
    const at = Math.min(...placed.map((clip) => clip.startTime));
    const length = Math.max(...placed.map(endOf)) - at;
    const tracks = work.timeline.tracks
      .filter(
        (track) =>
          !track.locked && (editTracks.includes(track.id) || isSyncLocked(track)),
      )
      .map((track) => track.id);
    work = splitAt(work, tracks, at, operationId, counter);
    reference = work;
    work = shiftAfter(work, tracks, at, length);
    work = openTimelineGap(work, at, length, operationId, allTracksRipple(work, tracks));
  }
  work = pruneTransitions(work, reference);
  work = addClips(
    work,
    placed.map((clip) => ({ trackId: clip.trackId, clip, offset: clip.startTime })),
    0,
  );
  return diffPlan(project, work, label);
}
