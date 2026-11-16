import { findLinkedPartners, type Project } from "@openreel/core";
import { getTimelineItemRanges } from "./timeline-item-actions";

/** Timeline selection includes every separated stream; DSP resolution still
 * chooses the source's active audio stream. Inspector selection stays explicit. */
export function getLinkedTimelineSelection(
  project: Project,
  selectedIds: readonly string[],
  enabled: boolean,
): string[] {
  const selected = new Set(selectedIds);
  if (!enabled || !selected.size) return [...selected];
  // Expand connected relationships, retaining the primary clip first. Pairing
  // lives in core so J/L-cut offsets (which overlap a neighbour's partner)
  // keep resolving to the right clip.
  const tracks = project.timeline.tracks;
  for (const id of selected) {
    const clip = tracks.flatMap((track) => track.clips).find((c) => c.id === id);
    if (!clip) continue;
    for (const partner of findLinkedPartners(clip, tracks))
      selected.add(partner.clip.id);
  }
  return [...selected];
}

export function getEditableTimelineSelection(
  project: Project,
  selectedIds: readonly string[],
  linked: boolean,
): { ids: string[]; blocked: boolean } {
  const unlocked = new Set(
    project.timeline.tracks
      .filter((track) => !track.locked)
      .map((track) => track.id),
  );
  const ranges = getTimelineItemRanges(project);
  const editable = new Set(
    ranges.filter((item) => unlocked.has(item.trackId)).map((item) => item.id),
  );
  const ids = getLinkedTimelineSelection(
    project,
    selectedIds.filter((id) => editable.has(id)),
    linked,
  );
  const blocked = ids.some((id) => !editable.has(id));
  return { ids: blocked ? [] : ids, blocked };
}
