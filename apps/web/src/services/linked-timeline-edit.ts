import {
  resolveTimelinePlacement,
  type Clip,
  type Project,
} from "@openreel/core";
import { dragPlacementPolicy } from "../stores/project/drag-placement";
import { useProjectStore } from "../stores/project-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { toast } from "../stores/notification-store";
import {
  getEditableTimelineSelection,
  getLinkedTimelineSelection,
} from "../utils/linked-timeline-selection";
import {
  deleteTimelineItem,
  duplicateTimelineItem,
  getSplittableTimelineItemIds,
  splitTimelineItem,
  trimTimelineItemToPlayhead,
} from "../utils/timeline-item-actions";
import {
  moveLinkedCaptions,
  trimLinkedCaptions,
} from "../utils/linked-caption-edit";
import { EditingSession } from "./agent/editing-session";
import { editGraphicSelection, selectionHasGraphics } from "./graphic-commands";

const LINKED_TRACK_LOCKED =
  "Unlock the linked audio or video track, or turn off Linked selection.";
const isLinked = () => useEditorWorkspaceStore.getState().linkedSelection;
export function editableTimelineIds(
  ids: readonly string[],
  notify = true,
): string[] {
  const selection = getEditableTimelineSelection(
    useProjectStore.getState().project,
    ids,
    isLinked(),
  );
  if (selection.blocked && notify)
    toast.warning("Linked track is locked", LINKED_TRACK_LOCKED);
  return selection.ids;
}

/** One resolved selection and one undo group for every timeline entry point. */
export async function editTimelineSelection(
  ids: readonly string[],
  operation:
    | "split"
    | "delete"
    | "duplicate"
    | "ripple"
    | "trim-start"
    | "trim-end",
  time = 0,
): Promise<boolean> {
  const store = useProjectStore.getState();
  // Essential Graphics are one bar: route their share of the selection to the graphic commands.
  const graphics = selectionHasGraphics(ids)
    ? await editGraphicSelection(ids, operation, time)
    : { handled: false, ok: true, remaining: [...ids] };
  if (graphics.handled) {
    if (!graphics.ok || graphics.remaining.length === 0) return graphics.ok;
    ids = graphics.remaining;
  }
  let resolved = editableTimelineIds(ids);
  if (operation === "split" || operation.startsWith("trim"))
    resolved = getSplittableTimelineItemIds(store.project, resolved, time);
  if (!resolved.length) return false;
  store.beginHistoryGroup(`${operation} clips`);
  try {
    if (operation === "duplicate") return await duplicateSelection(resolved);
    if (operation === "ripple") {
      // One sync-lock aware plan for the whole selection: a linked A/V pair
      // closes together, and Sync Lock tracks follow (or block, naming the track).
      const clipIds = resolved.filter((id) => store.getClip(id));
      if (!clipIds.length) return false;
      const result = await store.rippleDeleteClips(clipIds);
      if (!result.success)
        throw new Error(result.error?.message ?? "The clip could not be edited.");
      return true;
    }
    for (const id of resolved) {
      const current = useProjectStore.getState();
      const success =
        operation === "split"
          ? await splitTimelineItem(current, id, time)
          : operation === "delete"
            ? await deleteTimelineItem(current, id)
            : await trimTimelineItemToPlayhead(
                current,
                id,
                time,
                operation === "trim-start",
              );
      if (!success) throw new Error("The clip could not be edited.");
    }
    return true;
  } catch (error) {
    toast.error(
      "Timeline edit failed",
      error instanceof Error ? error.message : "Please try again.",
    );
    return false;
  } finally {
    store.endHistoryGroup();
  }
}

async function duplicateSelection(ids: string[]): Promise<boolean> {
  const store = useProjectStore.getState();
  const clips = ids
    .map((id) => store.getClip(id))
    .filter((clip): clip is Clip => !!clip);
  if (clips.length) {
    const session = new EditingSession(),
      transaction = session.beginTransaction();
    const project = session.getProject();
    const first = Math.min(...clips.map((clip) => clip.startTime));
    let delta =
      Math.max(...clips.map((clip) => clip.startTime + clip.duration)) - first;
    // Find one gap that accommodates every selected clip, preserving sync.
    let collision: boolean;
    do {
      collision = false;
      for (const clip of clips) {
        for (const other of project.timeline.tracks.find(
          (track) => track.id === clip.trackId,
        )?.clips ?? []) {
          if (
            clip.startTime + delta <
              other.startTime + other.duration - 0.0001 &&
            clip.startTime + delta + clip.duration > other.startTime + 0.0001
          ) {
            delta = other.startTime + other.duration - clip.startTime;
            collision = true;
          }
        }
      }
    } while (collision);
    const replacements = new Map(
      clips.map((clip) => [clip.id, crypto.randomUUID()]),
    );
    const remap = (id: unknown): unknown => {
      if (typeof id !== "string") return id;
      if (!replacements.has(id)) replacements.set(id, crypto.randomUUID());
      return replacements.get(id)!;
    };
    const duplicates = clips.map(
      (clip): Clip => ({
        ...structuredClone(clip),
        id: replacements.get(clip.id)!,
        startTime: clip.startTime + delta,
        metadata: {
          ...clip.metadata,
          ...(clip.metadata?.splitSourceClipId
            ? { splitSourceClipId: remap(clip.metadata.splitSourceClipId) }
            : {}),
          ...(clip.metadata?.separatedFromClipId
            ? { separatedFromClipId: remap(clip.metadata.separatedFromClipId) }
            : {}),
        },
      }),
    );
    session.replaceDraft({
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) => ({
          ...track,
          clips: [
            ...track.clips,
            ...duplicates.filter((clip) => clip.trackId === track.id),
          ],
        })),
      },
    });
    await session.commitTransaction(transaction, "Duplicate clips");
  }
  for (const id of ids.filter((id) => !store.getClip(id)))
    await duplicateTimelineItem(useProjectStore.getState(), id);
  return true;
}

/** Atomic linked moves keep all companions on their own tracks. */
export async function moveLinkedTimelineClips(
  clipId: string,
  startTime: number,
  targetTrackId?: string,
): Promise<boolean> {
  const store = useProjectStore.getState();
  const primary = store.getClip(clipId);
  if (!primary) return false;
  const ids = editableTimelineIds([clipId]);
  if (!ids.length) return true; // Handled: blocked rather than a partial fallback.
  if (ids.length === 1) return false;
  const clips = ids.map((id) => store.getClip(id)!);
  const delta = Math.max(
    startTime - primary.startTime,
    -Math.min(...clips.map((clip) => clip.startTime)),
  );
  // Pointer movement and release can repeat the already-settled position.
  // Keep lock checks above, but avoid cloning/validating a full draft for it.
  if (Math.abs(delta) < 0.00001 && (!targetTrackId || targetTrackId === primary.trackId)) return true;
  const session = new EditingSession(),
    transaction = session.beginTransaction();
  let project = session.getProject();
  let destination = primary.trackId;
  if (targetTrackId && targetTrackId !== primary.trackId) {
    const placementProject = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            ids.includes(clip.id) && clip.id !== clipId
              ? { ...clip, startTime: clip.startTime + delta }
              : clip,
          ),
        })),
      },
    };
    const placement = resolveTimelinePlacement(placementProject, {
      targetTrackId,
      startTime: primary.startTime + delta,
      duration: primary.duration,
      policy: dragPlacementPolicy(),
      excludeItemIds: [clipId],
      newTrackId: crypto.randomUUID(),
    });
    if (!placement.ok) return true;
    if (placement.createdTrack) {
      const result = await session.applyAction({
        type: "track/add",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: {
          trackType: "video",
          trackId: placement.createdTrack.id,
          position: placement.createdTrack.position,
          mode: "standard",
        },
      });
      if (!result.success) throw new Error(result.error?.message);
      project = session.getProject();
    }
    destination = placement.trackId;
  }
  if (Math.abs(delta) < 0.00001 && destination === primary.trackId) return true;
  const moved = clips.map((clip) => ({
    ...clip,
    startTime: clip.startTime + delta,
    trackId: clip.id === clipId ? destination : clip.trackId,
  }));
  const movedById = new Map(moved.map((clip) => [clip.id, clip]));
  let next: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: [
          // Keep clips in their existing slots during a gesture. Moving a
          // keyed child to the end needlessly moves its DOM and can replay
          // StrictMode cleanup, closing the active drag history group.
          ...track.clips.flatMap((clip) => {
            const updated = movedById.get(clip.id);
            return updated ? (updated.trackId === track.id ? [updated] : []) : [clip];
          }),
          ...moved.filter((clip) => clip.trackId === track.id &&
            !track.clips.some((existing) => existing.id === clip.id)),
        ],
      })),
    },
  };
  const captionStore = {
    project: next,
    getAllTextClips: () => next.textClips ?? [],
    updateOverlayClipTiming: (
      id: string,
      updates: { startTime?: number; duration?: number },
    ) => {
      next = {
        ...next,
        textClips: next.textClips?.map((clip) =>
          clip.id === id ? { ...clip, ...updates } : clip,
        ),
      };
    },
    deleteTextClip: () => false,
  };
  // Caption source IDs belong to one media clip, so move each caption once.
  const movedCaptions = new Set<string>();
  for (const clip of clips) {
    moveLinkedCaptions(
      {
        ...captionStore,
        getAllTextClips: () =>
          (next.textClips ?? []).filter(
            (caption) => !movedCaptions.has(caption.id),
          ),
        updateOverlayClipTiming: (id, updates) => {
          movedCaptions.add(id);
          captionStore.updateOverlayClipTiming(id, updates);
        },
      },
      clip,
      clip.startTime + delta,
    );
  }
  session.replaceDraft(next);
  await session.commitTransaction(transaction, "Move linked clips");
  return true;
}

/** Apply the same edge delta and source trim to the linked group, with undo. */
export async function trimLinkedTimelineClips(
  clipId: string,
  edge: "left" | "right",
  time: number,
): Promise<void> {
  const store = useProjectStore.getState(),
    primary = store.getClip(clipId);
  if (!primary) return;
  const ids = editableTimelineIds([clipId]);
  if (!ids.length) return;
  const clips = ids.map((id) => store.getClip(id)!);
  const originalEdge =
    edge === "left" ? primary.startTime : primary.startTime + primary.duration;
  let delta = time - originalEdge;
  if (edge === "left") {
    delta = Math.max(
      delta,
      ...clips.map(
        (clip) => -Math.min(clip.startTime, clip.inPoint / (clip.speed ?? 1)),
      ),
    );
    delta = Math.min(delta, ...clips.map((clip) => clip.duration - 0.1));
  } else {
    delta = Math.max(delta, ...clips.map((clip) => 0.1 - clip.duration));
    for (const clip of clips) {
      const mediaDuration = store.project.mediaLibrary.items.find(
        (item) => item.id === clip.mediaId,
      )?.metadata.duration;
      if (mediaDuration && mediaDuration > 0)
        delta = Math.min(
          delta,
          (mediaDuration - clip.outPoint) / (clip.speed ?? 1),
        );
    }
  }
  if (Math.abs(delta) < 0.00001) return;
  const session = new EditingSession(),
    transaction = session.beginTransaction();
  const project = session.getProject();
  const updates = new Map(
    clips.map((clip) => {
      const duration = clip.duration + (edge === "left" ? -delta : delta);
      return [
        clip.id,
        {
          ...clip,
          duration,
          startTime: clip.startTime + (edge === "left" ? delta : 0),
          inPoint:
            clip.inPoint + (edge === "left" ? delta * (clip.speed ?? 1) : 0),
          outPoint:
            clip.outPoint + (edge === "right" ? delta * (clip.speed ?? 1) : 0),
          keyframes: clip.keyframes.map((keyframe) =>
            keyframe.id.startsWith("kf-exit-")
              ? { ...keyframe, time: duration + keyframe.time - clip.duration }
              : keyframe,
          ),
        },
      ];
    }),
  );
  let next = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => updates.get(clip.id) ?? clip),
      })),
    },
  };
  for (const clip of clips) {
    const trimmed = updates.get(clip.id)!;
    trimLinkedCaptions(
      {
        project: next,
        getAllTextClips: () => next.textClips ?? [],
        updateOverlayClipTiming: (id, changes) => {
          next = {
            ...next,
            textClips: next.textClips?.map((caption) =>
              caption.id === id ? { ...caption, ...changes } : caption,
            ),
          };
        },
        deleteTextClip: (id) => {
          next = {
            ...next,
            textClips: next.textClips?.filter((caption) => caption.id !== id),
          };
          return true;
        },
      },
      clip,
      trimmed.startTime,
      trimmed.startTime + trimmed.duration,
    );
  }
  session.replaceDraft(next);
  await session.commitTransaction(transaction, "Trim linked clips");
}

export function timelineDragRepresentatives(
  project: Project,
  ids: readonly string[],
  primaryId: string,
): string[] {
  const covered = new Set(
    getLinkedTimelineSelection(project, [primaryId], isLinked()),
  );
  const representatives: string[] = [];
  for (const id of ids) {
    if (covered.has(id)) continue;
    representatives.push(id);
    for (const companion of getLinkedTimelineSelection(
      project,
      [id],
      isLinked(),
    ))
      covered.add(companion);
  }
  return representatives;
}
