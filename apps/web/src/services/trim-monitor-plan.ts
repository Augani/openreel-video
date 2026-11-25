import {
  planEditPointTrim,
  planTrimMonitor,
  type Project,
  type TimelineToolPlan,
} from "@openreel/core";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import type { EditSelection } from "../stores/edit-point-store";
import { useTrimMonitorStore } from "../stores/trim-monitor-store";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";

type EditSelectionPoint = Extract<EditSelection, { type: "edit" }>;

/**
 * The one place a selected edit point is turned into a plan. With the Trim Monitor open the monitor's
 * mode decides (roll, ripple in / out, slip, slide); otherwise it is the Ripple / Roll kind of the
 * selection. Key trims, typed offsets, the monitor's buttons and dynamic JKL trimming all come through
 * here, so they share the planners' sync lock, linked A/V and track lock rules.
 */
export function planSelectedEditTrim(project: Project, selection: EditSelectionPoint, frames: number): TimelineToolPlan {
  const linked = useEditorWorkspaceStore.getState().linkedSelection;
  const linkedIdsOf = (clipId: string): string[] =>
    getLinkedTimelineSelection(project, [clipId], linked).filter((id) => id !== clipId);
  const monitor = useTrimMonitorStore.getState();
  if (monitor.open) {
    return planTrimMonitor(project, {
      ref: { clipId: selection.clipId, edge: selection.edge },
      mode: monitor.mode,
      side: monitor.side,
      frames,
      linkedIdsOf,
    });
  }
  return planEditPointTrim(project, {
    clipId: selection.clipId,
    edge: selection.edge,
    frames,
    kind: selection.kind,
    linkedIds: linkedIdsOf(selection.clipId),
  });
}
