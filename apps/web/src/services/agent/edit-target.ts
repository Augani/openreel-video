import { resolveTimelineItem, type Project, type TimelineItemKind, type ResolvedTimelineItem } from "@openreel/core";

export interface AIEditTarget {
  readonly projectId: string;
  readonly id?: string;
  readonly trackId?: string;
  readonly kind?: TimelineItemKind | "transition" | "marker" | "track";
  readonly startTime: number;
  readonly duration?: number;
}

interface TargetCall {
  name?: string;
  args: Record<string, unknown>;
  result?: { data?: unknown };
  timelineTarget?: AIEditTarget;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Live targets take precedence; recorded targets retain removed edits and history navigation. */
export function resolveAIEditTarget(project: Project, call: TargetCall, items?: ReadonlyMap<string, ResolvedTimelineItem>): AIEditTarget | undefined {
  if (call.timelineTarget && call.timelineTarget.projectId !== project.id) return undefined;
  const data = record(call.result?.data), nested = record(data.clip);
  const ids = [data.id, data.clipId, data.newClipId, nested.id, data.transitionId, data.markerId,
    call.args.clipId, call.args.clipAId, call.args.transitionId, call.args.markerId,
    ...(call.name?.includes("track") ? [data.trackId, call.args.trackId] : [])]
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  for (const id of ids) {
    const item = items ? items.get(id) : resolveTimelineItem(project, id);
    if (item) return { projectId: project.id, id, trackId: item.trackId, kind: item.kind, startTime: item.startTime, duration: item.duration };
    if (project.timeline.tracks.some(track => track.id === id)) return { projectId: project.id, id, trackId: id, kind: "track", startTime: 0 };
    const marker = project.timeline.markers.find(marker => marker.id === id);
    if (marker) return { projectId: project.id, id, kind: "marker", startTime: marker.time };
    for (const track of project.timeline.tracks) {
      const transition = track.transitions.find(transition => transition.id === id);
      if (!transition) continue;
      const before = track.clips.find(clip => clip.id === transition.clipAId);
      const after = track.clips.find(clip => clip.id === transition.clipBId);
      if (before) return { projectId: project.id, id, trackId: track.id, kind: "transition",
        startTime: after?.startTime ?? (transition.edge === "in" ? before.startTime : before.startTime + before.duration) };
    }
  }
  if (call.timelineTarget?.projectId === project.id && time(call.timelineTarget.startTime)) return call.timelineTarget;
  const clip = record(call.args.clip);
  const start = [data.startTime, call.args.time, call.args.startTime, clip.startTime].find(time);
  if (start === undefined) return undefined;
  const duration = [data.duration, call.args.duration, clip.duration].find(time);
  return { projectId: project.id, startTime: start, ...(duration !== undefined ? { duration } : {}) };
}
