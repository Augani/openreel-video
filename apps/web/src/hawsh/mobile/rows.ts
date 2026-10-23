/**
 * Rows of the phone touch timeline: the project's tracks reduced to what a phone shows — video
 * (thumbnail strips), text and captions (pills), audio (thin bars). Pure, so it is unit-tested.
 */
import type { Project } from "@openreel/core";

export type RowKind = "video" | "text" | "audio";
export interface RowClip {
  id: string;
  start: number;
  duration: number;
  label: string;
  thumb: string | null;
  selection: "clip" | "text-clip";
}
export interface Row { trackId: string; kind: RowKind; clips: RowClip[] }

const ORDER: Record<RowKind, number> = { video: 0, text: 1, audio: 2 };

export function timelineRows(project: Pick<Project, "timeline" | "mediaLibrary"> & { textClips?: Project["textClips"] }): Row[] {
  const media = new Map(project.mediaLibrary.items.map((m) => [m.id, m]));
  const texts = project.textClips ?? [];
  const rows: Row[] = [];
  for (const track of project.timeline.tracks) {
    if (track.hidden) continue;
    const kind: RowKind | null = track.type === "audio" ? "audio"
      : track.type === "text" || track.role === "captions" ? "text"
      : track.type === "video" || track.type === "image" ? "video" : null;
    if (!kind) continue;
    const clips: RowClip[] = [
      ...track.clips.map((c) => {
        const m = media.get(c.mediaId);
        return { id: c.id, start: c.startTime, duration: c.duration, label: m?.name ?? "", thumb: m?.thumbnailUrl ?? null, selection: "clip" as const };
      }),
      ...texts.filter((t) => t.trackId === track.id).map((t) => ({
        id: t.id, start: t.startTime, duration: t.duration, label: t.text, thumb: null, selection: "text-clip" as const,
      })),
    ].sort((a, b) => a.start - b.start);
    if (clips.length) rows.push({ trackId: track.id, kind: clips.every((c) => c.selection === "text-clip") ? "text" : kind, clips });
  }
  return rows.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}
