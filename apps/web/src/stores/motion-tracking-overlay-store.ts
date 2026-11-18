import { create } from "zustand";
import type { Rectangle } from "@openreel/core";

/**
 * The motion-tracking target region as shown on the Program monitor. The
 * Inspector's Motion Tracking section owns the numeric fields and mirrors them
 * here while it is open; the on-canvas overlay drags this same rectangle, so
 * both stay one value. Source pixels of the tracked clip's media.
 */
export interface MotionTrackingOverlayState {
  clipId: string | null;
  region: Rectangle | null;
  mediaWidth: number;
  mediaHeight: number;
  /** Search margin around the target, in source pixels (what the tracker scans each frame). */
  searchMargin: number;
  /** Where the tracked point is at the playhead (source pixels), when a track exists. */
  point: { x: number; y: number } | null;
  /** Bumped by overlay edits only, so the Inspector can tell a drag from its own writes. */
  editRevision: number;
  open: (input: { clipId: string; region: Rectangle; mediaWidth: number; mediaHeight: number; searchMargin: number }) => void;
  close: (clipId: string) => void;
  mirror: (clipId: string, region: Rectangle) => void;
  setPoint: (clipId: string, point: { x: number; y: number } | null) => void;
  /** An edit made by dragging on the monitor. */
  edit: (region: Rectangle) => void;
}

const sameRegion = (a: Rectangle | null, b: Rectangle): boolean =>
  a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const useMotionTrackingOverlayStore = create<MotionTrackingOverlayState>((set, get) => ({
  clipId: null,
  region: null,
  mediaWidth: 0,
  mediaHeight: 0,
  searchMargin: 16,
  point: null,
  editRevision: 0,
  open: input => set({ ...input, point: null }),
  close: clipId => { if (get().clipId === clipId) set({ clipId: null, region: null, point: null }); },
  mirror: (clipId, region) => {
    const state = get();
    if (state.clipId === clipId && !sameRegion(state.region, region)) set({ region });
  },
  setPoint: (clipId, point) => {
    const state = get();
    if (state.clipId !== clipId) return;
    if (state.point?.x === point?.x && state.point?.y === point?.y) return;
    set({ point });
  },
  edit: region => {
    const state = get();
    if (!state.clipId || sameRegion(state.region, region)) return;
    set({ region, editRevision: state.editRevision + 1 });
  },
}));

/** Keep a dragged / resized rectangle inside the media and no smaller than `MIN_SIZE` source pixels. */
export const MIN_TRACKING_REGION = 8;

export function clampTrackingRegion(region: Rectangle, mediaWidth: number, mediaHeight: number): Rectangle {
  const width = Math.max(MIN_TRACKING_REGION, Math.min(mediaWidth, Math.round(region.width)));
  const height = Math.max(MIN_TRACKING_REGION, Math.min(mediaHeight, Math.round(region.height)));
  return {
    x: Math.max(0, Math.min(mediaWidth - width, Math.round(region.x))),
    y: Math.max(0, Math.min(mediaHeight - height, Math.round(region.y))),
    width,
    height,
  };
}

export type TrackingHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The region after dragging `handle` by (dx, dy) source pixels from `start`. Pure; clamped to the media. */
export function dragTrackingRegion(start: Rectangle, handle: TrackingHandle, dx: number, dy: number, mediaWidth: number, mediaHeight: number): Rectangle {
  if (handle === "move") return clampTrackingRegion({ ...start, x: start.x + dx, y: start.y + dy }, mediaWidth, mediaHeight);
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (handle.includes("w")) left = Math.min(right - MIN_TRACKING_REGION, left + dx);
  if (handle.includes("e")) right = Math.max(left + MIN_TRACKING_REGION, right + dx);
  if (handle.includes("n")) top = Math.min(bottom - MIN_TRACKING_REGION, top + dy);
  if (handle.includes("s")) bottom = Math.max(top + MIN_TRACKING_REGION, bottom + dy);
  left = Math.max(0, left); top = Math.max(0, top);
  right = Math.min(mediaWidth, right); bottom = Math.min(mediaHeight, bottom);
  return clampTrackingRegion({ x: left, y: top, width: right - left, height: bottom - top }, mediaWidth, mediaHeight);
}
