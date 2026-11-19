import { create } from "zustand";

/**
 * The planar-track corners as shown on the Program monitor. The Inspector section owns the numbers and mirrors
 * them here; the overlay's draggable handles write back through `edit`. Source pixels of the tracked clip's media,
 * ordered top-left, top-right, bottom-right, bottom-left (eight numbers).
 */
export interface PlanarTrackOverlayState {
  clipId: string | null;
  corners: number[] | null;
  mediaWidth: number;
  mediaHeight: number;
  /** Bumped by overlay drags only, so the Inspector can tell a drag from its own writes. */
  editRevision: number;
  open: (input: { clipId: string; corners: number[]; mediaWidth: number; mediaHeight: number }) => void;
  close: (clipId: string) => void;
  mirror: (clipId: string, corners: number[]) => void;
  edit: (corners: number[]) => void;
}

const same = (a: readonly number[] | null, b: readonly number[]): boolean => a !== null && a.length === b.length && a.every((v, i) => v === b[i]);

export const usePlanarTrackOverlayStore = create<PlanarTrackOverlayState>((set, get) => ({
  clipId: null, corners: null, mediaWidth: 0, mediaHeight: 0, editRevision: 0,
  open: input => set({ ...input }),
  close: clipId => { if (get().clipId === clipId) set({ clipId: null, corners: null }); },
  mirror: (clipId, corners) => { const s = get(); if (s.clipId === clipId && !same(s.corners, corners)) set({ corners }); },
  edit: corners => { const s = get(); if (s.clipId && !same(s.corners, corners)) set({ corners, editRevision: s.editRevision + 1 }); },
}));

/** Move one corner by (dx, dy) source pixels from `start`, kept inside the media (a little outside is allowed for pins at the frame edge). */
export function dragPlanarCorner(start: readonly number[], index: number, dx: number, dy: number, mediaWidth: number, mediaHeight: number): number[] {
  const next = [...start];
  next[index * 2] = Math.round(Math.max(0, Math.min(mediaWidth, start[index * 2] + dx)) * 10) / 10;
  next[index * 2 + 1] = Math.round(Math.max(0, Math.min(mediaHeight, start[index * 2 + 1] + dy)) * 10) / 10;
  return next;
}

/** Move the whole quad, clamped so no corner leaves the media. */
export function dragPlanarQuad(start: readonly number[], dx: number, dy: number, mediaWidth: number, mediaHeight: number): number[] {
  const xs = start.filter((_, i) => i % 2 === 0), ys = start.filter((_, i) => i % 2 === 1);
  const mx = Math.max(-Math.min(...xs), Math.min(mediaWidth - Math.max(...xs), dx)), my = Math.max(-Math.min(...ys), Math.min(mediaHeight - Math.max(...ys), dy));
  return start.map((v, i) => Math.round((v + (i % 2 === 0 ? mx : my)) * 10) / 10);
}

export function defaultPlanarCorners(mediaWidth: number, mediaHeight: number): number[] {
  const x0 = mediaWidth * 0.3, x1 = mediaWidth * 0.7, y0 = mediaHeight * 0.3, y1 = mediaHeight * 0.7;
  return [x0, y0, x1, y0, x1, y1, x0, y1].map(v => Math.round(v));
}
