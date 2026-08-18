import type { Project } from "@openreel/core";
import type { ProjectState } from "../stores/project-store";
import type { SelectionItem } from "../stores/ui-store";
import { trimLinkedCaptions } from "./linked-caption-edit";

export type TimelineItemKind =
  | "media"
  | "text"
  | "shape"
  | "svg"
  | "sticker";

type TimelineActionStore = Pick<
  ProjectState,
  | "getClip"
  | "getTextClip"
  | "getShapeClip"
  | "getSVGClip"
  | "getStickerClip"
  | "removeClip"
  | "deleteTextClip"
  | "deleteShapeClip"
  | "deleteSVGClip"
  | "deleteStickerClip"
  | "duplicateClip"
  | "duplicateOverlayClip"
  | "splitClip"
  | "splitOverlayClip"
  | "trimToPlayhead"
  | "trimOverlayToPlayhead"
  | "project"
  | "getAllTextClips"
  | "updateOverlayClipTiming"
>;

export interface TimelineItemRange {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
  kind: TimelineItemKind;
}

export interface TimelineMarqueeBounds {
  minTime: number;
  maxTime: number;
  minY: number;
  maxY: number;
}

export function getTimelineItemKind(
  store: Pick<
    TimelineActionStore,
    "getClip" | "getTextClip" | "getShapeClip" | "getSVGClip" | "getStickerClip"
  >,
  clipId: string,
): TimelineItemKind | null {
  if (store.getClip(clipId)) return "media";
  if (store.getTextClip(clipId)) return "text";
  if (store.getShapeClip(clipId)) return "shape";
  if (store.getSVGClip(clipId)) return "svg";
  if (store.getStickerClip(clipId)) return "sticker";
  return null;
}

export function getTimelineSelectionItem(
  store: Pick<
    TimelineActionStore,
    "getClip" | "getTextClip" | "getShapeClip" | "getSVGClip" | "getStickerClip"
  >,
  clipId: string,
): SelectionItem | null {
  const media = store.getClip(clipId);
  if (media) return { id: clipId, trackId: media.trackId, type: "clip" };
  const text = store.getTextClip(clipId);
  if (text) return { id: clipId, trackId: text.trackId, type: "text-clip" };
  const graphic =
    store.getShapeClip(clipId) ||
    store.getSVGClip(clipId) ||
    store.getStickerClip(clipId);
  return graphic
    ? { id: clipId, trackId: graphic.trackId, type: "shape-clip" }
    : null;
}

export async function deleteTimelineItem(
  store: TimelineActionStore,
  clipId: string,
): Promise<boolean> {
  switch (getTimelineItemKind(store, clipId)) {
    case "media":
      return (await store.removeClip(clipId)).success;
    case "text":
      return store.deleteTextClip(clipId);
    case "shape":
      return store.deleteShapeClip(clipId);
    case "svg":
      return store.deleteSVGClip(clipId);
    case "sticker":
      return store.deleteStickerClip(clipId);
    default:
      return false;
  }
}

export async function duplicateTimelineItem(
  store: TimelineActionStore,
  clipId: string,
): Promise<boolean> {
  if (getTimelineItemKind(store, clipId) === "media") {
    return (await store.duplicateClip(clipId)).success;
  }
  return store.duplicateOverlayClip(clipId) !== null;
}

export async function splitTimelineItem(
  store: TimelineActionStore,
  clipId: string,
  time: number,
): Promise<boolean> {
  if (getTimelineItemKind(store, clipId) === "media") {
    return (await store.splitClip(clipId, time)).success;
  }
  return store.splitOverlayClip(clipId, time) !== null;
}

export async function trimTimelineItemToPlayhead(
  store: TimelineActionStore,
  clipId: string,
  playheadTime: number,
  trimStart: boolean,
): Promise<boolean> {
  if (getTimelineItemKind(store, clipId) === "media") {
    const sourceClip = store.getClip(clipId);
    const result = await store.trimToPlayhead(clipId, playheadTime, trimStart);
    const updatedClip = store.getClip(clipId);
    if (result.success && sourceClip && updatedClip) {
      trimLinkedCaptions(
        store,
        sourceClip,
        updatedClip.startTime,
        updatedClip.startTime + updatedClip.duration,
      );
    }
    return result.success;
  }
  return store.trimOverlayToPlayhead(clipId, playheadTime, trimStart) !== null;
}

export function getTimelineItemRanges(project: Project): TimelineItemRange[] {
  const items: TimelineItemRange[] = [];

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      items.push({
        id: clip.id,
        trackId: track.id,
        startTime: clip.startTime,
        duration: clip.duration,
        kind: "media",
      });
    }
  }

  const append = (
    clips: ReadonlyArray<{
      id: string;
      trackId: string;
      startTime: number;
      duration: number;
    }> | undefined,
    kind: Exclude<TimelineItemKind, "media">,
  ) => {
    for (const clip of clips ?? []) {
      items.push({ ...clip, kind });
    }
  };

  append(project.textClips, "text");
  append(project.shapeClips, "shape");
  append(project.svgClips, "svg");
  append(project.stickerClips, "sticker");

  return items;
}

export function getSplittableTimelineItemIds(
  project: Project,
  selectedIds: readonly string[],
  time: number,
): string[] {
  const selected = new Set(selectedIds);
  return getTimelineItemRanges(project)
    .filter(
      (item) =>
        selected.has(item.id) &&
        time > item.startTime &&
        time < item.startTime + item.duration,
    )
    .map((item) => item.id);
}

export function getTimelineSelectionItems(project: Project): SelectionItem[] {
  return getTimelineItemRanges(project).map(toSelectionItem);
}

/** Select every media or overlay clip assigned to one timeline track. */
export function getTimelineTrackSelection(
  project: Project,
  trackId: string,
): SelectionItem[] {
  return getTimelineItemRanges(project)
    .filter((item) => item.trackId === trackId)
    .sort((left, right) =>
      left.startTime === right.startTime
        ? left.id.localeCompare(right.id)
        : left.startTime - right.startTime,
    )
    .map(toSelectionItem);
}

function toSelectionItem(item: TimelineItemRange): SelectionItem {
  return {
    id: item.id,
    trackId: item.trackId,
    type: item.kind === "media" ? "clip" : item.kind === "text" ? "text-clip" : "shape-clip",
  };
}

export function getTimelineMarqueeSelection(
  project: Project,
  bounds: TimelineMarqueeBounds,
  getTrackHeight: (
    trackId: string,
    trackType: Project["timeline"]["tracks"][number]["type"],
  ) => number,
): SelectionItem[] {
  const itemsByTrack = new Map<string, TimelineItemRange[]>();
  for (const item of getTimelineItemRanges(project)) {
    const items = itemsByTrack.get(item.trackId) ?? [];
    items.push(item);
    itemsByTrack.set(item.trackId, items);
  }

  const selected: SelectionItem[] = [];
  let currentY = 0;
  for (const track of project.timeline.tracks) {
    const height = getTrackHeight(track.id, track.type);
    const trackOverlaps =
      bounds.minY < currentY + height && bounds.maxY > currentY;
    if (trackOverlaps) {
      for (const item of itemsByTrack.get(track.id) ?? []) {
        const itemEnd = item.startTime + item.duration;
        if (bounds.minTime < itemEnd && bounds.maxTime > item.startTime) {
          selected.push({
            id: item.id,
            trackId: item.trackId,
            type:
              item.kind === "media"
                ? "clip"
                : item.kind === "text"
                  ? "text-clip"
                  : "shape-clip",
          });
        }
      }
    }
    currentY += height;
  }
  return selected;
}
