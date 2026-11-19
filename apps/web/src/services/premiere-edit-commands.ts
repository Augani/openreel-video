import { v4 as uuidv4 } from "uuid";
import {
  chooseTrackForMedia,
  clipSourceTimeAt,
  createEmptyTrack,
  createMediaClip,
  findTopmostVisualClipAt,
  findReverseMatch,
  planAddEdit,
  planAddEditToAllTracks,
  planExtract,
  planInsert,
  planLift,
  planOverwrite,
  resolveSourceTracks,
  type MediaItem,
  type NewTrackPlacement,
  type Project,
  type TargetMediaKind,
  type TrackChoice,
  type Track,
  type TimelineToolPlan,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { toast } from "../stores/notification-store";
import { formatFrameTimecode } from "../utils/frame-timecode";
import { getPrimarySelectedTrackId } from "../components/editor/timeline/primary-track";
import { getTimelineSelectionItem } from "../utils/timeline-item-actions";
import { CLEARED_LOOP_RANGE, readLoopRange } from "../stores/project/range-history";
import type { TimelineToolCommitOptions } from "../stores/project-store";

/**
 * Premiere-style edit commands. Each one is planned by pure logic in
 * @openreel/core and committed through commitTimelineToolEdit, the same path
 * ripple, slip and split use, so every command is exactly one undo step.
 *
 * The timeline In/Out range is the existing loop range (TimelineRange); there
 * is deliberately no second In/Out store. All reads of the playhead and range
 * happen synchronously at the start of a command.
 */
export interface CommandOutcome {
  success: boolean;
  message?: string;
}

const fail = (message: string): CommandOutcome => ({ success: false, message });

export function trackTypeForMedia(media: MediaItem): TargetMediaKind {
  if (media.type === "audio") return "audio";
  if (media.type === "image") return "image";
  return "video";
}

/** The media-library item selected in the Assets panel, if any. */
export function getSelectedMediaItem(): MediaItem | null {
  const { selectedItems } = useUIStore.getState();
  const { project } = useProjectStore.getState();
  for (let i = selectedItems.length - 1; i >= 0; i--) {
    const media = project.mediaLibrary.items.find(
      (item) => item.id === selectedItems[i].id,
    );
    if (media) return media;
  }
  return null;
}

/** The tracks whose target toggle is on, in timeline order, skipping locked
 * and removed tracks. Empty when nothing is targeted. */
export function getTargetedTrackIds(project: Project): string[] {
  const { targetedTrackIds } = useEditorWorkspaceStore.getState();
  if (!targetedTrackIds.length) return [];
  return project.timeline.tracks
    .filter((track) => !track.locked && targetedTrackIds.includes(track.id))
    .map((track) => track.id);
}

/** Where Insert/Overwrite should put media: the source-patched track, else the
 * first targeted track that fits, else the selected timeline track, else the
 * main track; a new track when none can take it. A video clip stays one clip,
 * exactly like an import: its audio is separated only on request (Separate
 * Audio) or when the source is patched to separate video and audio tracks. */
export function findTargetTrack(
  project: Project,
  media: MediaItem,
  kindOverride?: TargetMediaKind,
): { track: Track; created?: NewTrackPlacement } | null {
  const kind = kindOverride ?? trackTypeForMedia(media);
  const { targetTracks } = useEditorWorkspaceStore.getState();
  const choice = chooseTrackForMedia(project, {
    mediaKind: kind,
    targetTrackId: kind === "audio" ? targetTracks.audio : targetTracks.video,
    targetedTrackIds: getTargetedTrackIds(project),
    selectedTrackId: getPrimarySelectedTrackId(
      project,
      useUIStore.getState().selectedItems,
    ),
  });
  return realize(project, choice);
}

function realize(
  project: Project,
  choice: TrackChoice,
): { track: Track; created?: NewTrackPlacement } {
  if (choice.kind === "existing") return { track: choice.track };
  const created = createEmptyTrack(project, choice.trackType, uuidv4());
  return { track: created.track, created };
}

export interface SourceTracks {
  /** Picture (or the whole clip when the source is not split). */
  primary: { track: Track; created?: NewTrackPlacement };
  /** Sound track when the source is patched to separate video and audio tracks. */
  audio?: { track: Track; created?: NewTrackPlacement };
}

/** Destination tracks for a Source monitor edit: the source patch (video and
 * audio component each routed to a track), then targeting, selection, main. */
export function findSourceTracks(
  project: Project,
  media: MediaItem,
  component: "both" | "video" | "audio" = "both",
): SourceTracks {
  const { targetTracks } = useEditorWorkspaceStore.getState();
  const resolved = resolveSourceTracks(project, {
    mediaType: media.type === "audio" || media.type === "image" ? media.type : "video",
    hasAudio: media.metadata.hasAudio,
    component,
    patch: { video: targetTracks.video, audio: targetTracks.audio },
    targetedTrackIds: getTargetedTrackIds(project),
    selectedTrackId: getPrimarySelectedTrackId(
      project,
      useUIStore.getState().selectedItems,
    ),
  });
  return {
    primary: realize(project, resolved.primary),
    ...(resolved.audio ? { audio: realize(project, resolved.audio) } : {}),
  };
}

/** The explicit timeline In/Out range, clamped to the project. */
export function getMarkedRange(): { start: number; end: number } | null {
  const { loopStart, loopEnd } = useTimelineStore.getState();
  if (!(loopEnd > loopStart) || !Number.isFinite(loopStart + loopEnd)) return null;
  const start = Math.max(0, loopStart);
  return loopEnd - start > 1e-6 ? { start, end: loopEnd } : null;
}

function dropRemovedSelection(plan: TimelineToolPlan) {
  const removed = new Set(
    plan.edits.filter((edit) => edit.before && !edit.after).map((edit) => edit.id),
  );
  if (!removed.size) return;
  const ui = useUIStore.getState();
  const kept = ui.selectedItems.filter((item) => !removed.has(item.id));
  if (kept.length !== ui.selectedItems.length) ui.selectMultiple(kept);
}

export function commit(
  build: (project: Project) => TimelineToolPlan,
  emptyMessage: string,
  options?: TimelineToolCommitOptions,
): CommandOutcome & { plan?: TimelineToolPlan; actionId?: string } {
  try {
    const store = useProjectStore.getState();
    if (!store.hasOpenProject) return fail("Open a project before editing.");
    const plan = build(store.getFullProject());
    if (!plan.edits.length) return fail(emptyMessage);
    const result = store.commitTimelineToolEdit(plan, options);
    if (!result.success) return fail(result.error?.message ?? `${plan.label} failed`);
    dropRemovedSelection(plan);
    return { success: true, plan, actionId: result.actionId };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The edit failed.");
  }
}

function placeSelectedMedia(mode: "insert" | "overwrite"): CommandOutcome {
  // Read the playhead before anything else so it cannot drift mid-command.
  const time = useTimelineStore.getState().playheadPosition;
  const media = getSelectedMediaItem();
  if (!media) return fail("Select a media item in the library first.");
  const store = useProjectStore.getState();
  const target = findTargetTrack(store.project, media);
  if (!target) return fail(`No unlocked ${trackTypeForMedia(media)} track available.`);
  const { track, created } = target;
  let duration = 0;
  const outcome = commit((project) => {
    const clip = createMediaClip(media, track.id, uuidv4());
    duration = clip.duration;
    const plan = mode === "insert" ? planInsert : planOverwrite;
    return plan(
      project,
      time,
      [{ trackId: track.id, clip }],
      uuidv4(),
      created ? [created] : undefined,
    );
  }, "Nothing to place.");
  if (outcome.success) useTimelineStore.getState().seekTo(time + duration);
  return { success: outcome.success, message: outcome.message };
}

export const insertSelectedMedia = () => placeSelectedMedia("insert");
export const overwriteSelectedMedia = () => placeSelectedMedia("overwrite");

export function liftRange(): CommandOutcome {
  const range = getMarkedRange();
  if (!range) return fail("Set In and Out marks on the timeline first.");
  const outcome = commit(
    (project) => planLift(project, range, uuidv4(), targetsOrUndefined(project)),
    "Nothing to lift in the marked range.",
  );
  return { success: outcome.success, message: outcome.message };
}

export function extractRange(): CommandOutcome {
  const range = getMarkedRange();
  if (!range) return fail("Set In and Out marks on the timeline first.");
  const before = readLoopRange();
  const outcome = commit(
    (project) => planExtract(project, range, uuidv4(), targetsOrUndefined(project)),
    "Nothing to extract in the marked range.",
    // The range content is gone: the marks collapse onto the closed gap. The
    // range travels inside the edit's action, so Undo/Redo restore it with the
    // edit however much history has accumulated since.
    { loopRange: { before, after: CLEARED_LOOP_RANGE } },
  );
  if (outcome.success) {
    const timeline = useTimelineStore.getState();
    timeline.clearLoopRange();
    timeline.seekTo(range.start);
  }
  return { success: outcome.success, message: outcome.message };
}

/** Targeted tracks, or undefined (= every eligible track) when none is targeted. */
function targetsOrUndefined(project: Project): string[] | undefined {
  const targets = getTargetedTrackIds(project);
  return targets.length ? targets : undefined;
}

/** Add Edit at the playhead on the targeted tracks (every unlocked track when
 * nothing is targeted). */
export function addEditToTargetedTracks(): CommandOutcome {
  const time = useTimelineStore.getState().playheadPosition;
  const outcome = commit(
    (project) => planAddEdit(project, time, uuidv4(), getTargetedTrackIds(project)),
    "No clips under the playhead on the targeted tracks.",
  );
  return { success: outcome.success, message: outcome.message };
}

export function addEditToAllTracks(): CommandOutcome {
  const time = useTimelineStore.getState().playheadPosition;
  const outcome = commit(
    (project) => planAddEditToAllTracks(project, time, uuidv4()),
    "No unlocked clips under the playhead.",
  );
  return { success: outcome.success, message: outcome.message };
}

/** Select the source media of the given clip, or of the topmost clip under
 * the playhead when none is given. */
export function matchFrame(clipId?: string): CommandOutcome {
  const time = useTimelineStore.getState().playheadPosition;
  const project = useProjectStore.getState().project;
  const clip = clipId
    ? project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    : findTopmostVisualClipAt(
        project,
        time,
        // Targeted video tracks narrow the search; targeting only audio does not.
        getTargetedTrackIds(project).filter((id) => {
          const type = project.timeline.tracks.find((t) => t.id === id)?.type;
          return type === "video" || type === "image";
        }),
      );
  if (!clip) return fail("No video clip under the playhead.");
  const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  if (!media) return fail("Source media not found.");
  const timecode = formatFrameTimecode(
    clipSourceTimeAt(clip, time),
    media.metadata.frameRate || project.settings.frameRate,
  );
  useUIStore.getState().select({ type: "clip", id: media.id });
  useEditorWorkspaceStore.getState().setSection("media");
  // Premiere's Match Frame: the Source monitor opens on the matched frame.
  useSourceMonitorStore
    .getState()
    .open(media.id, project.id, clipSourceTimeAt(clip, time));
  return { success: true, message: `${media.name} at ${timecode}` };
}

/**
 * Reverse Match Frame (Shift+F): find the frame showing in the Source monitor
 * in the active sequence and park the playhead there. The topmost instance
 * wins; with none, nothing moves and the outcome explains why.
 */
export function reverseMatchFrame(): CommandOutcome {
  const source = useSourceMonitorStore.getState();
  const project = useProjectStore.getState().project;
  const media = source.mediaId
    ? project.mediaLibrary.items.find((item) => item.id === source.mediaId)
    : undefined;
  if (!media) return fail("Open a clip in the Source monitor first.");
  const frameRate = media.metadata.frameRate || project.settings.frameRate || 30;
  const hit = findReverseMatch(
    project,
    media.id,
    source.position,
    useTimelineStore.getState().playheadPosition,
    1 / frameRate,
  );
  if (!hit) return fail(`This frame of ${media.name} is not in the sequence.`);
  useTimelineStore.getState().seekTo(hit.time);
  useUIStore.getState().select({ type: "clip", id: hit.clipId });
  return {
    success: true,
    message: `${media.name} at ${formatFrameTimecode(hit.time, project.settings.frameRate || frameRate)}`,
  };
}

/** The track a paste lands on: the first targeted track of the copied track
 * type, else the selected track, else the first unlocked track. */
export function pickPasteTrack(project: Project): Track | undefined {
  const { clipboard } = useProjectStore.getState();
  const sourceType = clipboard?.[0]
    ? project.timeline.tracks.find((t) => t.id === clipboard[0].clip.trackId)?.type
    : undefined;
  const targeted = getTargetedTrackIds(project)
    .map((id) => project.timeline.tracks.find((t) => t.id === id))
    .find((track) => track && (!sourceType || track.type === sourceType));
  if (targeted) return targeted;
  const selectedId = getPrimarySelectedTrackId(project, useUIStore.getState().selectedItems);
  return (
    project.timeline.tracks.find((t) => t.id === selectedId && !t.locked) ??
    project.timeline.tracks.find((t) => !t.locked)
  );
}

/**
 * Paste Insert (Cmd+Shift+V): place the copied media clips at the playhead,
 * keeping their spacing, and ripple everything later by the pasted length. It
 * is an Insert, so sync-locked tracks split and shift with it.
 */
export function pasteInsertClips(): CommandOutcome {
  const time = useTimelineStore.getState().playheadPosition;
  const { clipboard } = useProjectStore.getState();
  const media = clipboard.filter((item) => item.kind === "media");
  if (!media.length) return fail("Copy media clips first. Paste Insert places media clips only.");
  const ids = new Map(media.map((item) => [item.clip.id, uuidv4()]));
  const pastedIds: string[] = [];
  const outcome = commit((project) => {
    const tracks = project.timeline.tracks;
    const destination = pickPasteTrack(project);
    if (!destination) throw new Error("No unlocked track available to paste onto.");
    const minStart = Math.min(...media.map((item) => item.clip.startTime));
    const firstIndex = tracks.findIndex((t) => t.id === media[0].clip.trackId);
    const destIndex = tracks.findIndex((t) => t.id === destination.id);
    const placements = media.map((item) => {
      const source = tracks.find((t) => t.id === item.clip.trackId);
      const sourceIndex = tracks.findIndex((t) => t.id === item.clip.trackId);
      const relative =
        firstIndex >= 0 && sourceIndex >= 0 && destIndex >= 0
          ? tracks[destIndex + sourceIndex - firstIndex]
          : undefined;
      const sameType = (t: Track | undefined) =>
        !!t && !t.locked && (!source || t.type === source.type);
      const target = sameType(relative)
        ? relative!
        : sameType(destination)
          ? destination
          : tracks.find((t) => sameType(t));
      if (!target) throw new Error("No unlocked track of the copied type to paste onto.");
      const id = ids.get(item.clip.id)!;
      pastedIds.push(id);
      const link = item.clip.metadata?.separatedFromClipId;
      return {
        trackId: target.id,
        offset: item.clip.startTime - minStart,
        clip: {
          ...structuredClone(item.clip),
          id,
          trackId: target.id,
          metadata: {
            ...item.clip.metadata,
            ...(typeof link === "string" ? { separatedFromClipId: ids.get(link) ?? link } : {}),
          },
        },
      };
    });
    return planInsert(project, time, placements, uuidv4());
  }, "Nothing to paste.");
  if (outcome.success) {
    const state = useProjectStore.getState();
    const items = pastedIds
      .map((id) => getTimelineSelectionItem(state, id))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length) useUIStore.getState().selectMultiple(items);
  }
  return { success: outcome.success, message: outcome.message };
}

/** Run a command and surface failures and confirmations as toasts. */
export function runWithToast(title: string, command: () => CommandOutcome): void {
  const outcome = command();
  if (!outcome.success) toast.warning(title, outcome.message);
  else if (outcome.message) toast.info(title, outcome.message);
}
