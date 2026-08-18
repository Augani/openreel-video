import React, { useMemo } from "react";
import { ListChecks } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineTrackSelection } from "../../../utils/timeline-item-actions";

export const CaptionBatchSelectButton: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const getFullProject = useProjectStore((state) => state.getFullProject);
  const selectMultiple = useUIStore((state) => state.selectMultiple);
  const projectRevision = project.modifiedAt;

  const captionSelection = useMemo(() => {
    void projectRevision;
    const liveProject = getFullProject();
    const captionTrack = liveProject.timeline.tracks.find(
      (track) =>
        track.type === "text" && track.name.trim().toLowerCase() === "captions",
    );
    return captionTrack
      ? getTimelineTrackSelection(liveProject, captionTrack.id)
      : [];
  }, [getFullProject, projectRevision]);

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
