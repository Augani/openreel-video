import React, { useCallback, useState, useEffect } from "react";

import { Loader2 } from "@/icons/lucide-compat";
import { InspectorToggle } from "./shell/InspectorControls";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { getPersonSegmentationEngine } from "@openreel/core";

interface BehindSubjectSectionProps {
  clipId: string;
}

export const BehindSubjectSection: React.FC<BehindSubjectSectionProps> = ({
  clipId,
}) => {
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const updateTextBehindSubject = useProjectStore(
    (state) => state.updateTextBehindSubject,
  );
  const modifiedAt = useProjectStore((state) => state.project.modifiedAt);
  const [isLoading, setIsLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const engine = getTitleEngine();
    const textClip = engine?.getTextClip(clipId);
    setEnabled(textClip?.behindSubject ?? false);
  }, [clipId, getTitleEngine, modifiedAt]);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      const engine = getTitleEngine();
      if (!engine) return;

      setError(null);
      setEnabled(checked);

      if (!checked) {
        updateTextBehindSubject(clipId, false);
        return;
      }

      const segEngine = getPersonSegmentationEngine();
      if (!segEngine.isInitialized()) {
        setIsLoading(true);
        try {
          await segEngine.initialize();
        } catch (modelError) {
          console.warn(
            "[BehindSubject] Person model initialization failed:",
            modelError,
          );
          setError("Failed to load AI model. Check your connection.");
          updateTextBehindSubject(clipId, false);
          setEnabled(false);
          setIsLoading(false);
          return;
        }
        setIsLoading(false);
      }

      updateTextBehindSubject(clipId, true);
    },
    [clipId, getTitleEngine, updateTextBehindSubject],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[12px] leading-5 text-fg font-normal block">
            Place Behind Subject
          </span>
          <span className="text-fg-2 font-normal block text-[9px]">
            Text appears behind people in the video
          </span>
        </div>
        {isLoading ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : (
          <InspectorToggle
            ariaLabel="Place Behind Subject"
            checked={enabled}
            onChange={handleToggle}
          />
        )}
      </div>
      {isLoading && (
        <span className="text-fg-2 font-normal text-[9px]">
          Loading AI model...
        </span>
      )}
      {error && (
        <span className="font-normal text-[9px] text-red-400">
          {error}
        </span>
      )}
    </div>
  );
};
