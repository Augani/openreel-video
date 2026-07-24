import type { Track } from "@openreel/core";

export type TrackLayerFilter = "all" | Track["type"];

export interface FilteredTrackEntry {
  readonly track: Track;
  readonly index: number;
}

export function filterTrackLayerEntries(
  tracks: readonly Track[],
  query: string,
  typeFilter: TrackLayerFilter,
): FilteredTrackEntry[] {
  const normalized = query.trim().toLowerCase();
  return tracks.flatMap((track, index) => {
    if (typeFilter !== "all" && track.type !== typeFilter) return [];
    const searchable = `${track.name} ${track.type}`.toLowerCase();
    return !normalized || searchable.includes(normalized)
      ? [{ track, index }]
      : [];
  });
}
