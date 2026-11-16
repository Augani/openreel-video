import type { Marker, MarkerKind } from "../types/timeline";

const EPS = 1e-6;

export interface MarkerNavOptions {
  readonly kind?: MarkerKind;
}

const kindOf = (marker: Marker): MarkerKind => marker.kind ?? "comment";

const matching = (markers: readonly Marker[], options?: MarkerNavOptions): Marker[] =>
  markers.filter((m) => !options?.kind || kindOf(m) === options.kind);

/** Markers ordered by time (stable for ties). */
export function sortMarkers(markers: readonly Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.time - b.time);
}

/** First marker strictly after `t` (a marker at the playhead is skipped). */
export function nextMarker(markers: readonly Marker[], t: number, options?: MarkerNavOptions): Marker | null {
  let best: Marker | null = null;
  for (const m of matching(markers, options)) {
    if (m.time > t + EPS && (best === null || m.time < best.time)) best = m;
  }
  return best;
}

/** Last marker strictly before `t`. */
export function prevMarker(markers: readonly Marker[], t: number, options?: MarkerNavOptions): Marker | null {
  let best: Marker | null = null;
  for (const m of matching(markers, options)) {
    if (m.time < t - EPS && (best === null || m.time > best.time)) best = m;
  }
  return best;
}

/** Markers whose span [time, time + duration] overlaps [a, b], sorted by time. */
export function markersInRange(markers: readonly Marker[], a: number, b: number): Marker[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return sortMarkers(markers.filter((m) => m.time <= hi + EPS && m.time + (m.duration ?? 0) >= lo - EPS));
}

/** The marker at (or whose range contains) `t`, preferring the latest start. */
export function markerAt(markers: readonly Marker[], t: number): Marker | null {
  let best: Marker | null = null;
  for (const m of markers) {
    const end = m.time + (m.duration ?? 0);
    if (t >= m.time - EPS && t <= end + EPS && (best === null || m.time > best.time)) best = m;
  }
  return best;
}
