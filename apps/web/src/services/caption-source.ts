import type { Project } from "@openreel/core";
import { getTrackBadge } from "../components/editor/timeline/track-badge";

/** The source described by the Text card is also the source opened for captions. */
export function resolveCaptionSource(
  project: Project,
  selected: readonly { type: string; id: string }[],
) {
  const media = new Map(project.mediaLibrary.items.map(item => [item.id, item]));
  const eligible = (mediaId: string) => {
    const type = media.get(mediaId)?.type;
    return type === "video" || type === "audio";
  };
  const clips = project.timeline.tracks.flatMap(track => track.clips);
  const selectedClip = selected.filter(item => item.type === "clip")
    .map(item => clips.find(clip => clip.id === item.id))
    .find(clip => clip && eligible(clip.mediaId));
  if (selectedClip) return {
    clipIds: [selectedClip.id], sourceTrackId: undefined,
    sourceLabel: media.get(selectedClip.mediaId)!.name,
    summary: `From selected clip · ${media.get(selectedClip.mediaId)!.name}`,
  };

  const dialogue = project.timeline.tracks.find(track =>
    track.role === "dialogue" && track.clips.some(clip => eligible(clip.mediaId)));
  if (dialogue) {
    const clipIds = dialogue.clips.filter(clip => eligible(clip.mediaId))
      .sort((a, b) => a.startTime - b.startTime).map(clip => clip.id);
    const badge = getTrackBadge(project.timeline.tracks, dialogue.id);
    return { clipIds, sourceTrackId: dialogue.id, sourceLabel: dialogue.name,
      summary: `From dialogue${badge ? ` on ${badge}` : ""} · ${clipIds.length} ${clipIds.length === 1 ? "clip" : "clips"}` };
  }

  const fallback = clips.find(clip => eligible(clip.mediaId));
  return { clipIds: fallback ? [fallback.id] : [], sourceTrackId: undefined,
    sourceLabel: fallback ? media.get(fallback.mediaId)!.name : undefined,
    summary: fallback ? `From ${media.get(fallback.mediaId)!.name}` : "Add dialogue to your timeline" };
}

/** Project versions can reuse source arrays, so cache the complete published version. */
export function createCaptionSourceSummarySelector(
  selected: readonly { type: string; id: string }[],
) {
  let previousProject: Project | undefined;
  let summary = "";
  return (project: Project) => {
    if (project !== previousProject) {
      summary = resolveCaptionSource(project, selected).summary;
      previousProject = project;
    }
    return summary;
  };
}
