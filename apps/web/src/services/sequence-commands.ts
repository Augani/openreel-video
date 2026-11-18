import { v4 as uuidv4 } from "uuid";
import {
  activateSequence,
  closeSequenceTab,
  createSequence,
  createSequenceFromMedia,
  deleteSequence,
  duplicateSequence,
  ensureSequences,
  getCompoundClipId,
  getSequence,
  insertSequenceAsNest,
  listSequences,
  moveSequencesToBin,
  nestClips,
  renameSequence,
  reorderOpenSequences,
  type NewSequenceOptions,
  type Project,
  type SequenceEditResult,
} from "@openreel/core";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";

/**
 * Sequence commands. Each one computes the next project with the pure functions
 * in @openreel/core (timeline/sequences.ts) and commits it as exactly ONE
 * `project/applyEditSnapshot` action: one undo step, the same path the agent
 * tools use. Switching sequences is a history step too, so undo/redo always
 * run against the timeline that the recorded action belongs to.
 */

const playheads = new Map<string, number>();

/** Forget the parked playhead of every sequence that no longer exists (deleted, or undone away). */
export function prunePlayheads(project: Pick<Project, "sequences">): void {
  const alive = new Set((project.sequences ?? []).map((sequence) => sequence.id));
  for (const id of [...playheads.keys()]) if (!alive.has(id)) playheads.delete(id);
}

/** Parked playhead count; exposed for tests. */
export const parkedPlayheadCount = (): number => playheads.size;

function blockedReason(): string | null {
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return "Open a project first.";
  if (useUIStore.getState().exportState.isExporting) return "Wait for the export to finish.";
  if (useUIStore.getState().effectApplicationClipId !== null) return "Wait for the effect to finish applying.";
  if (useTimelineStore.getState().playbackLockedReason) return "Wait for playback processing to finish.";
  return null;
}

export type SequenceCommandResult = SequenceEditResult;

/** Compute and commit one sequence edit. Failures are returned, not thrown. */
export async function commitSequenceEdit(
  label: string,
  build: (project: Project) => SequenceEditResult,
): Promise<SequenceCommandResult> {
  const blocked = blockedReason();
  if (blocked) return { ok: false, message: blocked };
  const store = useProjectStore.getState();
  const previous = store.getFullProject();
  const built = build(previous);
  if (!built.ok) return built;
  const switching = built.project.activeSequenceId !== previous.activeSequenceId;
  let result: SequenceEditResult = built;
  if (switching && previous.activeSequenceId) {
    // The In/Out range belongs to the sequence it was marked in: park it there.
    const { playheadPosition, loopStart, loopEnd } = useTimelineStore.getState();
    playheads.set(previous.activeSequenceId, playheadPosition);
    const leaving = previous.activeSequenceId;
    const marked = loopEnd > loopStart;
    result = {
      ...built,
      project: {
        ...built.project,
        sequences: built.project.sequences?.map((sequence) => {
          if (sequence.id !== leaving) return sequence;
          const { inPoint: _in, outPoint: _out, ...rest } = sequence;
          void _in;
          void _out;
          return marked ? { ...rest, inPoint: loopStart, outPoint: loopEnd } : rest;
        }),
      },
    };
  }
  store.beginHistoryGroup(label);
  let applied;
  try {
    // The handler deep-copies everything but the media items (shallow copies). Cloning the
    // items here would replace every Blob with a new object, which the render cache reads as
    // "all media changed" and would invalidate every frame under a clip for an overlay edit.
    const snapshot = editSnapshot(result.project);
    const detached = structuredClone({ ...snapshot, mediaLibrary: undefined });
    applied = await store.executeAction({
      type: "project/applyEditSnapshot",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { snapshot: { ...detached, mediaLibrary: snapshot.mediaLibrary } },
    });
  } finally {
    store.endHistoryGroup();
  }
  if (!applied.success) return { ok: false, message: applied.error?.message ?? "The change failed." };
  prunePlayheads(result.ok ? result.project : previous);
  if (switching) {
    const timeline = useTimelineStore.getState();
    timeline.stop();
    useUIStore.getState().clearSelection();
    const nextId = result.ok ? result.project.activeSequenceId : undefined;
    const target = result.ok ? result.project.sequences?.find((sequence) => sequence.id === nextId) : undefined;
    if (target?.inPoint !== undefined && target.outPoint !== undefined) timeline.setLoopRange(target.inPoint, target.outPoint);
    else timeline.clearLoopRange();
    timeline.seekTo(Math.min(nextId ? (playheads.get(nextId) ?? 0) : 0, useProjectStore.getState().project.timeline.duration));
  }
  return result;
}

async function run(title: string, label: string, build: (project: Project) => SequenceEditResult): Promise<SequenceCommandResult> {
  const result = await commitSequenceEdit(label, build);
  if (!result.ok) toast.warning(title, result.message);
  return result;
}

export const openSequence = (id: string) => run("Open sequence", "Open sequence", (p) => activateSequence(p, id));
export const newSequence = (options: NewSequenceOptions = {}) => run("New sequence", "New sequence", (p) => createSequence(p, options));
export const newSequenceFromMedia = (mediaId: string) => run("New sequence", "New sequence from clip", (p) => createSequenceFromMedia(p, mediaId));
export const renameSequenceCommand = (id: string, name: string) => run("Rename sequence", "Rename sequence", (p) => renameSequence(p, id, name));
export const duplicateSequenceCommand = (id: string) => run("Duplicate sequence", "Duplicate sequence", (p) => duplicateSequence(p, id));
export const deleteSequenceCommand = (id: string) => run("Delete sequence", "Delete sequence", (p) => deleteSequence(p, id));
export const closeSequenceTabCommand = (id: string) => run("Close sequence", "Close sequence tab", (p) => closeSequenceTab(p, id));
export const reorderSequenceTab = (id: string, toIndex: number) => run("Reorder sequences", "Reorder sequence tabs", (p) => reorderOpenSequences(p, id, toIndex));
export const moveSequencesToBinCommand = (ids: readonly string[], binId: string | null) =>
  run("Move sequence", "Move sequence to bin", (p) => moveSequencesToBin(p, ids, binId));

/** Premiere's "Nest...": the selected timeline clips become one nested sequence. */
export async function nestSelectedClips(name?: string): Promise<SequenceCommandResult> {
  const ids = useUIStore.getState().getSelectedClipIds();
  return run("Nest", "Nest clips", (p) => nestClips(p, ids, name));
}

/** Drop a sequence from the Project panel onto a timeline lane. */
export async function placeSequenceOnTimeline(sequenceId: string, trackId: string | undefined, startTime: number): Promise<SequenceCommandResult> {
  return run("Nest sequence", "Nest sequence", (p) => insertSequenceAsNest(p, sequenceId, { trackId, startTime }));
}

/** Open the sequence a nest clip points at (double-click a nest on the timeline). */
export async function openNestClip(clipId: string): Promise<SequenceCommandResult> {
  const project = ensureSequences(useProjectStore.getState().getFullProject());
  const clip = project.timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
  const id = clip ? getCompoundClipId(clip) : null;
  if (!id || !getSequence(project, id)) return { ok: false, message: "That nested sequence no longer exists." };
  return openSequence(id);
}

/** Sequences as the UI shows them, migrating a plain project on the fly (read-only: nothing is committed). */
export function readSequences(project: Project) {
  const ready = ensureSequences(project);
  return { sequences: listSequences(ready), activeId: ready.activeSequenceId as string, openIds: ready.openSequenceIds ?? [] };
}
