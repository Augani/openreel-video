import { useProjectStore } from "../../stores/project-store";
import { useUIStore, type SelectionType } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { resolveAIEditTarget } from "./edit-target";
import type { ToolCallView } from "../../stores/chat-store";

export function jumpToAIEdit(call: ToolCallView): void {
  const timeline = useTimelineStore.getState(), ui = useUIStore.getState(), store = useProjectStore.getState();
  if (!store.hasOpenProject || timeline.playbackLockedReason || ui.exportState.isExporting) return;
  const project = store.getFullProject();
  const target = resolveAIEditTarget(project, call);
  if (!target) return;
  const selectionTypes: Partial<Record<NonNullable<typeof target.kind>, SelectionType>> = {
    media: "clip", text: "text-clip", shape: "shape-clip", svg: "shape-clip", sticker: "shape-clip",
    motion: "motion-instance", transition: "transition", marker: "marker", track: "track",
  };
  timeline.pause();
  // A deleted target still has a useful historical time, but cannot be selected.
  const current = target.id ? resolveAIEditTarget(project, { args: { clipId: target.id } }) : undefined;
  const type = current?.kind && selectionTypes[current.kind];
  if (current?.id && type) ui.select({ type, id: current.id, trackId: current.trackId });
  timeline.seekTo(target.startTime);
  useTimelineStore.getState().scrollToPlayhead();
}
