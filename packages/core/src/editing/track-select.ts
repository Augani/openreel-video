import type { Project } from "../types";

/**
 * Track Select Forward / Backward (Premiere's A and Shift+A).
 *
 * Clicking a clip selects that clip and everything after it (forward) or
 * before it (backward) on every track. Shift-click limits it to the clicked
 * clip's own track. Items on locked tracks are never selected, so a following
 * move or delete cannot touch them. The result is selection only: no project
 * change, so moving or deleting it afterwards is one ordinary undo step.
 */
export type TrackSelectKind = "media" | "text" | "shape" | "svg" | "sticker";

export interface TrackSelectItem {
  id: string;
  trackId: string;
  kind: TrackSelectKind;
  startTime: number;
  duration: number;
}

export interface TrackSelectOptions {
  direction: "forward" | "backward";
  /** Shift-click: only the clicked item's own track. */
  trackOnly?: boolean;
}

const EPS = 1e-6;

interface Placed {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
}

function allItems(project: Project): TrackSelectItem[] {
  const items: TrackSelectItem[] = [];
  for (const track of project.timeline.tracks)
    for (const clip of track.clips)
      items.push({
        id: clip.id,
        trackId: track.id,
        kind: "media",
        startTime: clip.startTime,
        duration: clip.duration,
      });
  const overlays: Array<[TrackSelectKind, ReadonlyArray<Placed> | undefined]> = [
    ["text", project.textClips],
    ["shape", project.shapeClips],
    ["svg", project.svgClips],
    ["sticker", project.stickerClips],
  ];
  for (const [kind, list] of overlays)
    for (const item of list ?? [])
      items.push({
        id: item.id,
        trackId: item.trackId,
        kind,
        startTime: item.startTime,
        duration: item.duration,
      });
  return items;
}

/** The items a Track Select click on `anchorId` selects, in timeline order. */
export function planTrackSelect(
  project: Project,
  anchorId: string,
  options: TrackSelectOptions,
): TrackSelectItem[] {
  const items = allItems(project);
  const anchor = items.find((item) => item.id === anchorId);
  if (!anchor) return [];
  const locked = new Set(
    project.timeline.tracks.filter((track) => track.locked).map((track) => track.id),
  );
  if (locked.has(anchor.trackId)) return [];
  const anchorEnd = anchor.startTime + anchor.duration;
  return items
    .filter((item) => {
      if (locked.has(item.trackId)) return false;
      if (options.trackOnly && item.trackId !== anchor.trackId) return false;
      if (item.id === anchor.id) return true;
      return options.direction === "forward"
        ? item.startTime >= anchor.startTime - EPS
        : item.startTime + item.duration <= anchorEnd + EPS;
    })
    .sort((a, b) =>
      a.startTime === b.startTime ? a.id.localeCompare(b.id) : a.startTime - b.startTime,
    );
}
