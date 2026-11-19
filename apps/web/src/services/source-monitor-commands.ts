import { v4 as uuidv4 } from "uuid";
import {
  findReplaceTarget,
  planFitToFill,
  planReplaceEdit,
  planSourceEdit,
  sourceDropError,
  type MediaItem,
  type ReplaceAlignment,
  type ResolvedFitToFill,
  type ResolvedReplace,
  type ResolvedSourceEdit,
  type SourceComponent,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import {
  commit,
  findSourceTracks,
  getMarkedRange,
  getTargetedTrackIds,
  type CommandOutcome,
} from "./premiere-edit-commands";

/**
 * Source-monitor commands. Insert/Overwrite use the source In/Out (the whole
 * media when unmarked) with Premiere's three-point rules against the sequence
 * In/Out (the timeline range) and the Program playhead; see
 * packages/core/src/editing/source-edit.ts. Each is one committed plan, so one
 * undo step.
 */
const fail = (message: string): CommandOutcome => ({ success: false, message });

export function getSourceMedia(mediaId?: string | null): MediaItem | null {
  const id = mediaId ?? useSourceMonitorStore.getState().mediaId;
  if (!id) return null;
  return (
    useProjectStore.getState().project.mediaLibrary.items.find((m) => m.id === id) ??
    null
  );
}

export function openInSourceMonitor(mediaId: string, time?: number): CommandOutcome {
  const { project } = useProjectStore.getState();
  const media = project.mediaLibrary.items.find((m) => m.id === mediaId);
  if (!media) return fail("Media not found.");
  const duration = media.metadata.duration;
  const at = time === undefined ? undefined : Math.min(Math.max(0, time), duration > 0 ? duration : time);
  const source = useSourceMonitorStore.getState();
  source.open(mediaId, project.id, at);
  // A subclip opens with its window marked, like Premiere.
  if (media.subclip && at === undefined) {
    const marks = source.getMarks(mediaId);
    if (marks.in === undefined && marks.out === undefined) {
      useSourceMonitorStore.getState().setMark(mediaId, "in", media.subclip.inPoint);
      useSourceMonitorStore.getState().setMark(mediaId, "out", media.subclip.outPoint);
      useSourceMonitorStore.getState().setPosition(media.subclip.inPoint);
    }
  }
  return { success: true, message: `${media.name} opened in the Source monitor` };
}

export function setSourceMarks(
  mediaId: string,
  marks: { in?: number | null; out?: number | null },
): CommandOutcome {
  const media = getSourceMedia(mediaId);
  if (!media) return fail("Media not found.");
  const duration = media.metadata.duration > 0 ? media.metadata.duration : Infinity;
  if (
    typeof marks.in === "number" &&
    typeof marks.out === "number" &&
    marks.out <= marks.in
  )
    return fail("The source Out must be after the source In.");
  const store = useSourceMonitorStore.getState();
  store.bindProject(useProjectStore.getState().project.id);
  for (const which of ["in", "out"] as const) {
    const value = marks[which];
    if (value === undefined) continue;
    if (value === null) store.setMark(mediaId, which, null);
    else if (Number.isFinite(value) && value >= 0)
      store.setMark(mediaId, which, Math.min(value, duration));
    else return fail("Source marks must be non-negative times.");
  }
  return { success: true };
}

export interface SourceEditOutcome extends CommandOutcome {
  resolved?: ResolvedSourceEdit;
  clipId?: string;
  trackId?: string;
  /** Set when the source's audio was patched to its own track. */
  audioTrackId?: string;
}

/** Insert or Overwrite the Source monitor's marked range onto the patched /
 * targeted tracks. A video source whose audio is patched to an audio track
 * lands as two linked clips (picture on the video track, sound on the audio
 * track) in one undo step. */
export function editFromSource(
  mode: "insert" | "overwrite",
  component: SourceComponent = "both",
): SourceEditOutcome {
  // Read the playhead and sequence range synchronously so they cannot drift.
  const playhead = useTimelineStore.getState().playheadPosition;
  const sequence = getMarkedRange();
  const media = getSourceMedia();
  if (!media) return fail("Open a clip in the Source monitor first.");
  const marks = useSourceMonitorStore.getState().getMarks(media.id);
  const { primary, audio } = findSourceTracks(
    useProjectStore.getState().project,
    media,
    component,
  );
  const { track, created } = primary;
  const clipId = uuidv4();
  const audioClipId = uuidv4();
  let resolved: ResolvedSourceEdit | undefined;
  const outcome = commit((project) => {
    const planned = planSourceEdit(project, {
      mode,
      media,
      trackId: track.id,
      clipId,
      operationId: uuidv4(),
      sourceIn: marks.in,
      sourceOut: marks.out,
      playhead,
      sequenceIn: sequence?.start,
      sequenceOut: sequence?.end,
      component,
      newTrack: created,
      audioPatch: audio
        ? { trackId: audio.track.id, clipId: audioClipId, newTrack: audio.created }
        : undefined,
    });
    resolved = planned.resolved;
    return planned.plan;
  }, "Nothing to place.");
  if (!outcome.success || !resolved) return { success: false, message: outcome.message };
  useTimelineStore.getState().seekTo(resolved.at + resolved.duration);
  return {
    success: true,
    resolved,
    clipId,
    trackId: track.id,
    ...(audio ? { audioTrackId: audio.track.id } : {}),
  };
}

export const insertFromSource = (component?: SourceComponent) =>
  editFromSource("insert", component);
export const overwriteFromSource = (component?: SourceComponent) =>
  editFromSource("overwrite", component);

/** Drag-and-drop from the Source monitor: overwrite the marked range at a
 * time on a chosen track. Video needs an unlocked video track (never a text or
 * graphics lane), audio-only an audio track. */
export function dropSourceRange(
  mediaId: string,
  trackId: string,
  time: number,
  component: SourceComponent,
): CommandOutcome {
  const media = getSourceMedia(mediaId);
  if (!media) return fail("Media not found.");
  const project = useProjectStore.getState().project;
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  const refusal = sourceDropError(track, media, component);
  if (refusal) return fail(refusal);
  const marks = useSourceMonitorStore.getState().getMarks(mediaId);
  let resolved: ResolvedSourceEdit | undefined;
  const outcome = commit((current) => {
    const planned = planSourceEdit(current, {
      mode: "overwrite",
      media,
      trackId,
      clipId: uuidv4(),
      operationId: uuidv4(),
      sourceIn: marks.in,
      sourceOut: marks.out,
      // A drop places exactly where it lands: the sequence marks do not apply.
      playhead: Math.max(0, time),
      component,
    });
    resolved = planned.resolved;
    return planned.plan;
  }, "Nothing to place.");
  if (outcome.success && resolved) useTimelineStore.getState().seekTo(resolved.at + resolved.duration);
  return { success: outcome.success, message: outcome.message };
}

export interface FitToFillOutcome extends CommandOutcome {
  resolved?: ResolvedFitToFill;
  clipId?: string;
  trackId?: string;
  audioTrackId?: string;
}

const percent = (speed: number) => `${Math.round(speed * 1000) / 10}%`;

/**
 * Fit to Fill: the Source monitor's In/Out range (the whole media when
 * unmarked) is retimed to exactly fill the timeline In/Out range, and
 * overwritten onto the patched / targeted tracks. Audio follows the speed
 * with its pitch preserved. One undo step; no ripple, so Sync Lock has
 * nothing to move.
 */
export function fitToFillFromSource(component: SourceComponent = "both"): FitToFillOutcome {
  const sequence = getMarkedRange();
  if (!sequence) return fail("Fit to Fill needs In and Out marks on the timeline.");
  const media = getSourceMedia();
  if (!media) return fail("Open a clip in the Source monitor first.");
  if (media.type === "image") return fail("Fit to Fill needs video or audio; a still has no speed to change.");
  const marks = useSourceMonitorStore.getState().getMarks(media.id);
  const { primary, audio } = findSourceTracks(useProjectStore.getState().project, media, component);
  const { track, created } = primary;
  const clipId = uuidv4();
  const audioClipId = uuidv4();
  let resolved: ResolvedFitToFill | undefined;
  const outcome = commit((project) => {
    const planned = planFitToFill(project, {
      media,
      trackId: track.id,
      clipId,
      operationId: uuidv4(),
      sourceIn: marks.in,
      sourceOut: marks.out,
      sequenceIn: sequence.start,
      sequenceOut: sequence.end,
      component,
      newTrack: created,
      audioPatch: audio
        ? { trackId: audio.track.id, clipId: audioClipId, newTrack: audio.created }
        : undefined,
    });
    resolved = planned.resolved;
    return planned.plan;
  }, "Nothing to place.");
  if (!outcome.success || !resolved) return { success: false, message: outcome.message };
  useTimelineStore.getState().seekTo(resolved.at + resolved.duration);
  return {
    success: true,
    message: `Fit to Fill at ${percent(resolved.speed)} speed`,
    resolved,
    clipId,
    trackId: track.id,
    ...(audio ? { audioTrackId: audio.track.id } : {}),
  };
}

export interface ReplaceOutcome extends CommandOutcome {
  resolved?: ResolvedReplace;
}

/**
 * Replace edit: swap the footage of the selected timeline clip (else the
 * topmost clip under the playhead) for the Source monitor's clip. The clip
 * keeps its place and length. By default the Source monitor's current frame is
 * aligned with the timeline playhead; with the playhead outside the clip, or
 * `alignment: "in"`, the source In (media start when unmarked) lands on the
 * clip's first frame. Effects, keyframes and audio settings are kept unless
 * the Source monitor's Keep toggle is off. One undo step.
 */
export function replaceFromSource(
  options: { alignment?: ReplaceAlignment; keepAttributes?: boolean } = {},
): ReplaceOutcome {
  const playhead = useTimelineStore.getState().playheadPosition;
  const media = getSourceMedia();
  if (!media) return fail("Open a clip in the Source monitor first.");
  const source = useSourceMonitorStore.getState();
  const marks = source.getMarks(media.id);
  const keepAttributes = options.keepAttributes ?? source.replaceKeepsAttributes;
  const alignment = options.alignment ?? "playhead";
  const selectedClipIds = useUIStore
    .getState()
    .selectedItems.filter((item) => item.type === "clip")
    .map((item) => item.id);
  let resolved: ResolvedReplace | undefined;
  const outcome = commit((project) => {
    const target = findReplaceTarget(project, {
      media,
      selectedClipIds,
      playhead,
      targetedTrackIds: getTargetedTrackIds(project),
    });
    if (!target) throw new Error("Select a timeline clip, or park the playhead over one, to replace.");
    const planned = planReplaceEdit(project, {
      clipId: target.id,
      media,
      alignment,
      playhead,
      sourcePosition: source.position,
      sourceIn: marks.in,
      keepAttributes,
    });
    resolved = planned.resolved;
    return planned.plan;
  }, "Nothing to replace.");
  if (!outcome.success || !resolved) return { success: false, message: outcome.message };
  return {
    success: true,
    resolved,
    message: resolved.fellBackToIn
      ? `Replaced with ${media.name}, aligned at the source In (the playhead is outside the clip)`
      : `Replaced with ${media.name}`,
  };
}
