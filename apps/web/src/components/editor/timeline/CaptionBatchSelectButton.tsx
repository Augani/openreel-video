import React, { useMemo } from "react";
import { ListChecks } from "@/icons/lucide-compat";
import { Button } from "@openreel/ui";
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
        (track.role === "captions" ||
          track.name.trim().toLowerCase() === "captions"),
    );
    return captionTrack
      ? getTimelineTrackSelection(liveProject, captionTrack.id)
      : [];
  }, [getFullProject, projectRevision]);

  if (captionSelection.length < 2) return null;

  return (
    <Button onClick={() => selectMultiple(captionSelection)} type="button" aria-label={(`Select all captions (${captionSelection.length})`).trim() || undefined} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg whitespace-nowrap">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ListChecks size={14} aria-hidden />}</span>
      <span className="truncate">{`Select all captions (${captionSelection.length})`}</span>
    </Button>
  );
};
