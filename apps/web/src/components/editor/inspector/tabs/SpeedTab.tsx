import React from "react";
import type { Clip } from "@openreel/core";
import { SpeedSection, StabilizationSection, SpeedRampSection } from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { useT } from "@openreel/i18n/react";

interface SpeedTabClip {
  id: string;
  mediaId: string;
}

interface SpeedTabProps {
  showVideoControls: boolean;
  showSpeedControls?: boolean;
  selectedClip: SpeedTabClip | null;
}

export const SpeedTab: React.FC<SpeedTabProps> = ({
  showVideoControls,
  showSpeedControls = showVideoControls,
  selectedClip,
}) => {
  const t = useT();
  return (
    <>
      {showSpeedControls &&
        selectedClip &&
        !selectedClip.mediaId.startsWith("text-") &&
        !selectedClip.mediaId.startsWith("shape-") &&
        !selectedClip.mediaId.startsWith("svg-") &&
        !selectedClip.mediaId.startsWith("sticker-") && (
          <>
            <InspectorSection
              title={t("Speed & Direction")}
              sectionId="speed"
              defaultOpen={false}
            >
              <SpeedSection clip={selectedClip as Clip} />
            </InspectorSection>
          </>
        )}
      {showVideoControls &&
        selectedClip &&
        !selectedClip.mediaId.startsWith("text-") &&
        !selectedClip.mediaId.startsWith("shape-") &&
        !selectedClip.mediaId.startsWith("svg-") &&
        !selectedClip.mediaId.startsWith("sticker-") && (
          <InspectorSection
            title={t("Stabilization")}
            sectionId="stabilization"
            defaultOpen={false}
          >
            <StabilizationSection clip={selectedClip as Clip} />
          </InspectorSection>
        )}
      {showVideoControls &&
        selectedClip &&
        !selectedClip.mediaId.startsWith("text-") &&
        !selectedClip.mediaId.startsWith("shape-") &&
        !selectedClip.mediaId.startsWith("svg-") &&
        !selectedClip.mediaId.startsWith("sticker-") && (
          <InspectorSection
            title={t("Speed Curves")}
            sectionId="speed-curves"
            defaultOpen={false}
          >
            <SpeedRampSection clip={selectedClip as Clip} />
          </InspectorSection>
        )}
    </>
  );
};
