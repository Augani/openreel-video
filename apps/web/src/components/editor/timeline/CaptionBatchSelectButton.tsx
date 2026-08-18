import React, { useMemo } from "react";
import { ListChecks } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineTrackSelection } from "../../../utils/timeline-item-actions";

export const CaptionBatchSelectButton: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const selectMultiple = useUIStore((state) => state.selectMultiple);

  const captionSelection = useMemo(() => {
    const captionTrack = project.timeline.tracks.find(
      (track) =>
        track.type === "text" && track.name.trim().toLowerCase() === "captions",
    );
    return captionTrack
      ? getTimelineTrackSelection(project, captionTrack.id)
      : [];
  }, [project]);

  if (captionSelection.length < 2) return null;

  return (
    <Button
      label={`Select all captions (${captionSelection.length})`}
      icon={<ListChecks size={14} aria-hidden />}
      size="sm"
      variant="secondary"
      onClick={() => selectMultiple(captionSelection)}
      className="whitespace-nowrap"
    />
  );
};

export default CaptionBatchSelectButton;
