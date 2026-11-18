import { Pen } from "@/icons/lucide-compat";
import { Button } from "@openreel/ui";
import { useMaskPenStore } from "../../../stores/mask-pen-store";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";

/** Clip the pen tool should target: the single selected timeline clip. */
export function maskPenTargetClipId(): string | null {
  const ids = useUIStore.getState().getSelectedClipIds();
  if (ids.length !== 1) return null;
  const clip = useProjectStore
    .getState()
    .project.timeline.tracks.flatMap((track) => track.clips)
    .find((candidate) => candidate.id === ids[0]);
  return clip ? clip.id : null;
}

/** Arms the pen on the selected clip (draw mode), or leaves it. */
export function toggleMaskPen(): void {
  const pen = useMaskPenStore.getState();
  if (pen.active) {
    pen.disarm();
    return;
  }
  const clipId = maskPenTargetClipId();
  if (!clipId) {
    toast.warning(
      "Select a clip first",
      "Select one video or image clip, then use the pen to draw a mask on the Program monitor.",
    );
    return;
  }
  pen.arm(clipId, null);
}

/** Program monitor header toggle for the mask pen tool. */
export function MaskPenButton() {
  const active = useMaskPenStore((s) => s.active);
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      aria-label="Mask pen tool"
      aria-pressed={active}
      title="Mask pen tool: draw and edit Bezier masks on the Program monitor (Esc to leave)"
      onClick={toggleMaskPen}
      className={`workspace-preview-guides h-7 w-7 p-0 ${active ? "text-accent bg-accent-soft" : ""}`}
    >
      <Pen size={14} aria-hidden />
    </Button>
  );
}
