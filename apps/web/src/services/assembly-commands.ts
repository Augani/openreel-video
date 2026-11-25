import {
  DEFAULT_ASSEMBLY_OPTIONS,
  orderAssemblyMedia,
  planAutomateToSequence,
  type AssemblyOptions,
  type AssemblyResult,
  type MediaItem,
} from "@openreel/core";
import { resolveDefaultTransition } from "@openreel/core/video/transition-presets";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { commit, type CommandOutcome } from "./premiere-edit-commands";

/**
 * Automate to Sequence. The Project panel selection (in the order it was selected) is laid out from the playhead as
 * ONE insert or overwrite plan (core/timeline/assembly.ts): one undo step, the same clips an Insert from the Source
 * monitor makes, so preview and export treat them like any hand-placed clip.
 */
export type AssemblyRequest = Omit<AssemblyOptions, "at">;

export const DEFAULT_ASSEMBLY_REQUEST: AssemblyRequest = (({ at: _at, ...rest }) => {
  void _at;
  return rest;
})(DEFAULT_ASSEMBLY_OPTIONS);

/** The selected Project-panel media, in selection order. */
export function getAssemblySelection(): MediaItem[] {
  const items = useProjectStore.getState().project.mediaLibrary.items;
  const known = new Set(items.map((item) => item.id));
  const ids = useUIStore.getState().selectedItems.filter((item) => known.has(item.id)).map((item) => item.id);
  return orderAssemblyMedia(items, ids, "selection");
}

/** The default transition's label, shown in the dialog next to its checkbox. */
export function defaultTransitionLabel(): string {
  const fallback = resolveDefaultTransition(useProjectStore.getState().project);
  return `${fallback.label ?? fallback.type}, ${fallback.duration}s`;
}

/** The ordered media and the placement the dialog's current options would make, for its summary line. */
export function previewAssembly(request: AssemblyRequest): AssemblyResult {
  const state = useProjectStore.getState();
  const ordered = orderAssemblyMedia(state.project.mediaLibrary.items, getAssemblySelection().map((item) => item.id), request.order);
  return planAutomateToSequence(state.getFullProject(), ordered, { ...request, at: useTimelineStore.getState().playheadPosition });
}

export function automateToSequence(request: AssemblyRequest): CommandOutcome & { count?: number } {
  const state = useProjectStore.getState();
  if (!state.hasOpenProject) return { success: false, message: "Open a project before editing." };
  // Read the playhead first so it cannot drift while the plan is built.
  const at = useTimelineStore.getState().playheadPosition;
  const ordered = orderAssemblyMedia(state.project.mediaLibrary.items, getAssemblySelection().map((item) => item.id), request.order);
  let built: Extract<AssemblyResult, { ok: true }> | undefined;
  let failure: string | undefined;
  const outcome = commit((project) => {
    const result = planAutomateToSequence(project, ordered, { ...request, at });
    if (!result.ok) {
      failure = result.message;
      return { label: "Automate to Sequence", delta: 0, edits: [] };
    }
    built = result;
    return result.plan;
  }, "Nothing to place.");
  if (!outcome.success || !built) return { success: false, message: failure ?? outcome.message };
  useTimelineStore.getState().seekTo(built.end);
  const count = built.placed.length;
  return {
    success: true,
    count,
    message: `Placed ${count} clip${count === 1 ? "" : "s"}${built.transitionCount ? ` with ${built.transitionCount} transition${built.transitionCount === 1 ? "" : "s"}` : ""}`,
  };
}
