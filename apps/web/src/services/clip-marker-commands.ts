import { sourceTimeForTimelineMarker, sourceToTimelineTime, type Clip, type Marker } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { toast } from "../stores/notification-store";
import { DEFAULT_MARKER_COLOR } from "./marker-commands";

/**
 * Clip markers (one timeline instance) and master-clip markers (the Source monitor's clip, shown
 * on every instance). Marker times are source-media seconds; see core `editing/clip-markers`.
 */

export type ClipMarkerTarget = { clipId: string } | { mediaId: string };

const newId = (): string => `marker-${crypto.randomUUID()}`;

const findClip = (clipId: string): Clip | undefined => {
  for (const track of useProjectStore.getState().project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

const currentMarkers = (target: ClipMarkerTarget): readonly Marker[] => {
  const project = useProjectStore.getState().project;
  if ("clipId" in target) return findClip(target.clipId)?.markers ?? [];
  return project.mediaLibrary.items.find((i) => i.id === target.mediaId)?.markers ?? [];
};

/** Clip under the playhead on the selected clips, else the topmost visual clip under it. */
export function clipForMarker(): Clip | null {
  const time = useTimelineStore.getState().playheadPosition;
  const selected = new Set(useUIStore.getState().getSelectedClipIds());
  const tracks = useProjectStore.getState().project.timeline.tracks;
  const covers = (c: Clip) => time >= c.startTime - 1e-6 && time <= c.startTime + c.duration + 1e-6;
  for (const track of tracks) {
    for (const clip of track.clips) if (selected.has(clip.id) && covers(clip)) return clip;
  }
  for (const track of tracks) {
    if (track.type !== "video" && track.type !== "audio" && track.type !== "image") continue;
    const clip = track.clips.find(covers);
    if (clip) return clip;
  }
  return null;
}

export async function addClipMarker(
  target: ClipMarkerTarget,
  sourceTime: number,
  extra: Partial<Marker> = {},
): Promise<string | null> {
  const list = currentMarkers(target);
  const marker: Marker = {
    id: newId(),
    time: Math.max(0, sourceTime),
    label: `Marker ${list.length + 1}`,
    color: DEFAULT_MARKER_COLOR,
    ...extra,
  };
  const result = await useProjectStore.getState().setClipMarkers(target, [...list, marker]);
  return result.success ? marker.id : null;
}

export async function updateClipMarker(
  target: ClipMarkerTarget,
  markerId: string,
  updates: Partial<Marker>,
): Promise<void> {
  const next = currentMarkers(target).map((m) => {
    if (m.id !== markerId) return m;
    const merged: Record<string, unknown> = { ...m };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    return merged as unknown as Marker;
  });
  await useProjectStore.getState().setClipMarkers(target, next);
}

export async function removeClipMarker(target: ClipMarkerTarget, markerId: string): Promise<void> {
  await useProjectStore.getState().setClipMarkers(
    target,
    currentMarkers(target).filter((m) => m.id !== markerId),
  );
}

/** Alt+Shift+M on the timeline: a clip marker at the playhead on the selected (or topmost) clip. */
export async function addClipMarkerAtPlayhead(): Promise<void> {
  const clip = clipForMarker();
  if (!clip) {
    toast.info("No clip at the playhead", "Select a clip or park the playhead over one to add a clip marker.");
    return;
  }
  const time = useTimelineStore.getState().playheadPosition;
  const source = sourceTimeForTimelineMarker(clip, time);
  if (source === null) return;
  const id = await addClipMarker({ clipId: clip.id }, source);
  if (id) {
    useEditorWorkspaceStore.getState().setSection("markers");
    useEditorWorkspaceStore.getState().setMarkerScope("clips");
  }
}

/** M / Alt+Shift+M in the Source monitor: a master-clip marker at the source playhead. */
export async function addSourceMarker(): Promise<void> {
  const { mediaId, position } = useSourceMonitorStore.getState();
  if (!mediaId) return;
  await addClipMarker({ mediaId }, position);
}

/** Park the playhead on a marker of a timeline instance (a range marker's start, clamped to the clip). */
export function seekToClipMarker(clip: Clip, marker: Pick<Marker, "time">): void {
  const timeline = useTimelineStore.getState();
  timeline.pause();
  timeline.seekTo(Math.max(0, sourceToTimelineTime(clip, Math.min(clip.outPoint, Math.max(clip.inPoint, marker.time)))));
  useTimelineStore.getState().scrollToPlayhead();
}
