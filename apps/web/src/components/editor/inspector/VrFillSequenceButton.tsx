import React from "react";
import { Button } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";

/**
 * VR Projection > Reframe to flat: renders the view in a rectangle of the chosen aspect inside the 2:1 picture, so
 * "Fill sequence" sets that aspect to the sequence's and the clip to Cover, which fills the frame with the view.
 */
export const VrFillSequenceButton: React.FC<{ effectId: string; onChange: (params: Record<string, unknown>) => void; clipId: string; disabled: boolean }> = ({ clipId, onChange, disabled }) => {
  const width = useProjectStore((s) => s.project.settings.width);
  const height = useProjectStore((s) => s.project.settings.height);
  const updateClipTransform = useProjectStore((s) => s.updateClipTransform);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      data-testid="vr-fill-sequence"
      className="h-[26px] w-full text-[10px]"
      onClick={() => {
        onChange({ aspect: Math.round((width / height) * 1000) / 1000 });
        void updateClipTransform(clipId, { fitMode: "cover" });
      }}
    >
      Fill sequence with this view
    </Button>
  );
};
