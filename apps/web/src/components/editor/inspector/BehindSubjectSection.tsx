import React, { useCallback, useState, useEffect } from "react";
import { ToolcraftText as Text } from "@openreel/ui";
import { Loader2 } from "@/icons/lucide-compat";
import { MockToggle } from "./shell/InspectorControls";
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
          <Text type="supporting" color="primary" className="block">
            Place Behind Subject
          </Text>
          <Text type="supporting" color="secondary" className="block text-[9px]">
            Text appears behind people in the video
          </Text>
        </div>
        {isLoading ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : (
          <MockToggle
            ariaLabel="Place Behind Subject"
            checked={enabled}
            onChange={handleToggle}
          />
        )}
      </div>
      {isLoading && (
        <Text type="supporting" color="secondary" className="text-[9px]">
          Loading AI model...
        </Text>
      )}
      {error && (
        <Text type="supporting" className="text-[9px] text-red-400">
          {error}
        </Text>
      )}
    </div>
  );
};
