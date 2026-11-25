import { MousePointerClick } from "@/icons/lucide-compat";
import { Button } from "@openreel/ui";
import { useMaskPenStore } from "../../../stores/mask-pen-store";
import { useObjectMaskStore } from "../../../stores/object-mask-store";
import { toast } from "../../../stores/notification-store";
import { maskPenTargetClipId } from "./MaskPenButton";

/** Arms the object mask tool on the selected clip, or leaves it. */
export function toggleObjectMask(): void {
  const tool = useObjectMaskStore.getState();
  if (tool.active) {
    tool.disarm();
    return;
  }
  const clipId = maskPenTargetClipId();
  if (!clipId) {
    toast.warning("Select a clip first", "Select one video or image clip, then click an object on the Program monitor to mask it.");
    return;
  }
  useMaskPenStore.getState().disarm();
  tool.arm(clipId);
}

/** Program monitor header toggle for the object mask tool. */
export function ObjectMaskButton() {
  const active = useObjectMaskStore((s) => s.active);
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      aria-label="Object mask tool"
      aria-pressed={active}
      title="Object mask: click or brush an object on the Program monitor to mask it, then track it in the Mask panel (Esc to leave)"
      onClick={toggleObjectMask}
      className={`workspace-preview-guides h-7 w-7 p-0 ${active ? "text-accent bg-accent-soft" : ""}`}
    >
      <MousePointerClick size={14} aria-hidden />
    </Button>
  );
}
