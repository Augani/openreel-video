import { describeMediaMetadata, type MarkerSourceMetadata, type MediaItem, type Project } from "@openreel/core";
import type { Marker } from "@openreel/core";

/** Source-clip logging metadata (description, keywords, scene / shot / take, reel, log comment) for exports. */

const hasMetadata = (item: MediaItem): boolean =>
  !!(item.description || item.keywords?.length || item.scene || item.shot || item.take || item.goodTake || item.reel || item.logComment);

/** The clip on the lowest video track (else any track) that covers `time`. */
function clipAt(project: Project, time: number): { name: string; media: MediaItem } | null {
  const tracks = [...project.timeline.tracks].sort((a, b) => Number(b.type === "video") - Number(a.type === "video"));
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (time < clip.startTime || time >= clip.startTime + clip.duration) continue;
      const media = project.mediaLibrary.items.find((i) => i.id === clip.mediaId);
      if (media) return { name: media.name, media };
    }
  }
  return null;
}

/** Marker CSV: what the clip under each sequence marker carries. */
export function markerSourceMetadata(project: Project): (marker: Marker) => MarkerSourceMetadata | undefined {
  return (marker) => {
    const hit = clipAt(project, marker.time);
    if (!hit || !hasMetadata(hit.media)) return undefined;
    const m = hit.media;
    return { clip: hit.name, description: m.description, keywords: m.keywords, scene: m.scene, shot: m.shot, take: m.take, reel: m.reel, logComment: m.logComment };
  };
}

/** WebVTT NOTE lines: one per source clip on the timeline that has metadata (first 20, in timeline order). */
export function captionMetadataNotes(project: Project): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  const clips = project.timeline.tracks.flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime);
  for (const clip of clips) {
    if (seen.has(clip.mediaId) || lines.length >= 20) continue;
    const media = project.mediaLibrary.items.find((i) => i.id === clip.mediaId);
    if (!media || !hasMetadata(media)) continue;
    seen.add(clip.mediaId);
    lines.push(`${media.name}: ${describeMediaMetadata(media).join(" | ")}`);
  }
  return lines;
}
