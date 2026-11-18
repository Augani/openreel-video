import type { Project } from "@openreel/core";
import type { SelectionItem } from "../../../stores/ui-store";

/** Linked selections retain the explicitly selected item first. Resolve its
 * current owner so moving or deleting an item cannot leave a stale highlight. */
export function getPrimarySelectedTrackId(
  project: Project,
  selection: readonly SelectionItem[],
): string | null {
  const primary = selection[0];
  if (!primary) return null;
  const tracks = project.timeline.tracks;
  if (primary.type === "track") {
    return tracks.find((track) => track.id === primary.id)?.id ?? null;
  }
  if (primary.type === "transition") {
    return (
      tracks.find((track) =>
        track.transitions.some((item) => item.id === primary.id),
      )?.id ?? null
    );
  }
  if (
    !["clip", "text-clip", "shape-clip", "motion-instance"].includes(
      primary.type,
    )
  )
    return null;
  const mediaTrack = tracks.find((track) =>
    track.clips.some((item) => item.id === primary.id),
  );
  if (mediaTrack) return mediaTrack.id;
  const overlays = [
    project.textClips,
    project.shapeClips,
    project.svgClips,
    project.stickerClips,
    project.adjustmentLayers,
    project.motionInstances,
  ];
  for (const items of overlays) {
    const item = items?.find((candidate) => candidate.id === primary.id);
    if (item?.trackId && tracks.some((track) => track.id === item.trackId))
      return item.trackId;
  }
  return null;
}
