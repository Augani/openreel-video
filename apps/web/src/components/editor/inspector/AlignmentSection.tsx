import React, { useCallback } from "react";
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";

interface AlignmentSectionProps {
  clipId: string;
}

export const AlignmentSection: React.FC<AlignmentSectionProps> = ({
  clipId,
}) => {
  const { updateClipTransform } = useProjectStore();

  const findClipTransform = useCallback(() => {
    const { project } = useProjectStore.getState();
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) {
        return clip.transform ?? { position: { x: 0.5, y: 0.5 } };
      }
    }
    return { position: { x: 0.5, y: 0.5 } };
  }, [clipId]);

  const handleAlign = useCallback(
    (axis: "x" | "y", value: number) => {
      const current = findClipTransform();
      const currentPos = current.position ?? { x: 0.5, y: 0.5 };
      updateClipTransform(clipId, {
        position: { ...currentPos, [axis]: value },
      });
    },
    [clipId, updateClipTransform, findClipTransform],
  );

  const handleCenterBoth = useCallback(() => {
    updateClipTransform(clipId, {
      position: { x: 0.5, y: 0.5 },
    });
  }, [clipId, updateClipTransform]);

  const buttonClass =
    "p-2 rounded-md bg-background-tertiary border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-text-secondary hover:text-primary";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-16">Horizontal</span>
        <div className="flex gap-1">
          <button
            className={buttonClass}
            onClick={() => handleAlign("x", 0)}
            title="Align Left"
          >
            <AlignHorizontalJustifyStart size={14} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("x", 0.5)}
            title="Center Horizontally"
          >
            <AlignHorizontalJustifyCenter size={14} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("x", 1)}
            title="Align Right"
          >
            <AlignHorizontalJustifyEnd size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-16">Vertical</span>
        <div className="flex gap-1">
          <button
            className={buttonClass}
            onClick={() => handleAlign("y", 0)}
            title="Align Top"
          >
            <AlignVerticalJustifyStart size={14} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("y", 0.5)}
            title="Center Vertically"
          >
            <AlignVerticalJustifyCenter size={14} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("y", 1)}
            title="Align Bottom"
          >
            <AlignVerticalJustifyEnd size={14} />
          </button>
        </div>
      </div>
      <button
        className="w-full py-1.5 text-[10px] rounded-md bg-background-tertiary border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-text-secondary hover:text-primary"
        onClick={handleCenterBoth}
        title="Center on Canvas"
      >
        Center on Canvas
      </button>
    </div>
  );
};
