import React from "react";
import { ColorGradingSection } from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { useTranslation } from "react-i18next";

export interface ColorTabProps {
  clipId: string;
  showColorGrading: boolean;
}

export const ColorTab: React.FC<ColorTabProps> = ({
  clipId,
  showColorGrading,
}) => {
  const { t } = useTranslation();
  return (
    <>
      {showColorGrading && (
        <>
          <InspectorSection
            title={t("Color Grading")}
            sectionId="color-grading"
            defaultOpen={false}
          >
            <ColorGradingSection clipId={clipId} />
          </InspectorSection>
        </>
      )}
    </>
  );
};
