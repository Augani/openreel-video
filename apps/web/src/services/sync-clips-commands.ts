import { mergeClips, synchronizeClips, type MediaItem, type Project, type ClipSyncMode, type ClipSyncResult } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";
import { commitSequenceEdit } from "./sequence-commands";

/**
 * Synchronize (timeline) and Merge Clips (project panel), the Premiere pair.
 * The audio match is the multicam one (downsampled GCC-PHAT, loaded lazily so
 * it stays out of the editor's first chunk); the edit is ONE undo step through
 * `commitSequenceEdit`.
 */

const SYNC_TITLE = "Synchronize";

async function offsetsFor(mediaIds: readonly string[], onProgress?: (message: string) => void) {
  const { analyzeAudioOffsets } = await import("./multicam-controller");
  return analyzeAudioOffsets(mediaIds, onProgress);
}

/** Selected timeline clips in selection order. */
export function selectedSyncClipIds(): string[] {
  return useUIStore.getState().getSelectedClipIds();
}

export function canSynchronize(project: Project, clipIds: readonly string[]): boolean {
  const all = new Set(project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  return clipIds.filter((id) => all.has(id)).length >= 2;
}

/** Align the selected clips (the first selected stays put). Returns the core result, never throws. */
export async function synchronizeSelectedClips(mode: ClipSyncMode, clipIds: readonly string[] = selectedSyncClipIds()): Promise<ClipSyncResult> {
  const project = useProjectStore.getState().getFullProject();
  const clips = clipIds.map((id) => project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id));
  if (clips.length < 2 || clips.some((c) => !c)) {
    const message = "Select two or more clips to synchronize.";
    toast.warning(SYNC_TITLE, message);
    return { ok: false, message };
  }
  let offsets: number[] | undefined;
  let confidence: number[] | undefined;
  if (mode === "audio") {
    const anchorMedia = clips[0]!.mediaId;
    const others = [...new Set(clips.map((c) => c!.mediaId).filter((id) => id !== anchorMedia))];
    try {
      const analysed = await offsetsFor([anchorMedia, ...others], (message) => toast.info(SYNC_TITLE, message));
      offsets = clips.map((c) => (c!.mediaId === anchorMedia ? 0 : analysed.offsets[others.indexOf(c!.mediaId) + 1]));
      confidence = clips.map((c) => (c!.mediaId === anchorMedia ? 1 : analysed.confidence[others.indexOf(c!.mediaId) + 1]));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the audio of the selected clips.";
      toast.warning(SYNC_TITLE, message);
      return { ok: false, message };
    }
  }
  const result = (await commitSequenceEdit("Synchronize clips", (p) => synchronizeClips(p, { clipIds, mode, offsets, confidence }))) as ClipSyncResult;
  if (!result.ok) toast.warning(SYNC_TITLE, result.message);
  else if (result.moved.length === 0) toast.info(SYNC_TITLE, "The clips were already in sync.");
  else toast.success(SYNC_TITLE, `Synchronized ${clipIds.length} clips.`);
  return result;
}

/** One video and one audio asset out of the selected media ids, or null. */
export function mergeCandidates(items: readonly MediaItem[], selectedIds: readonly string[]): { video: MediaItem; audio: MediaItem } | null {
  const picked = items.filter((m) => selectedIds.includes(m.id));
  const video = picked.filter((m) => m.type === "video");
  const audio = picked.filter((m) => m.type === "audio");
  return picked.length === 2 && video.length === 1 && audio.length === 1 ? { video: video[0], audio: audio[0] } : null;
}

/** Merge Clips: place the video and its separately recorded audio, aligned by waveform, at the playhead. */
export async function mergeSelectedAssets(options: { muteCameraAudio: boolean }, selectedIds: readonly string[] = useUIStore.getState().selectedItems.map((s) => s.id)): Promise<ClipSyncResult> {
  const items = useProjectStore.getState().project.mediaLibrary.items;
  const pair = mergeCandidates(items, selectedIds);
  if (!pair) {
    const message = "Select one video and one audio asset to merge.";
    toast.warning("Merge Clips", message);
    return { ok: false, message };
  }
  let analysed: { offsets: number[]; confidence: number[] };
  try {
    analysed = await offsetsFor([pair.video.id, pair.audio.id], (message) => toast.info("Merge Clips", message));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the audio of those assets.";
    toast.warning("Merge Clips", message);
    return { ok: false, message };
  }
  const startTime = useTimelineStore.getState().playheadPosition;
  const result = (await commitSequenceEdit("Merge clips", (p) =>
    mergeClips(p, { videoMediaId: pair.video.id, audioMediaId: pair.audio.id, offsetSeconds: analysed.offsets[1], confidence: analysed.confidence[1], muteCameraAudio: options.muteCameraAudio, startTime }),
  )) as ClipSyncResult;
  if (!result.ok) toast.warning("Merge Clips", result.message);
  else toast.success("Merge Clips", `Merged ${pair.video.name} with ${pair.audio.name} at the playhead.`);
  return result;
}
