import { PrimaryTextProperties } from "../PrimaryTextProperties";
import React from "react";
import { TextSection, ShapeSection, SVGSection } from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { useT } from "@openreel/i18n/react";

interface StyleTabProps {
  clipId: string;
  showTextSection: boolean;
  showShapeSection: boolean;
  showSVGSection: boolean;
}

export const StyleTab: React.FC<StyleTabProps> = ({
  clipId,
  showTextSection,
  showShapeSection,
  showSVGSection,
}) => {
  const t = useT();
  return (
    <>
      {showTextSection && (
        <><PrimaryTextProperties clipId={clipId}/><InspectorSection title={t("Advanced text properties")} sectionId="text-properties" sectionIds={["text-materials"]}><TextSection clipId={clipId}/></InspectorSection></>
      )}
      {showShapeSection && (
        <InspectorSection title={t("Shape Properties")} sectionId="shape-properties" defaultOpen>
          <ShapeSection clipId={clipId} />
        </InspectorSection>
      )}
      {showSVGSection && (
        <InspectorSection title={t("SVG Properties")} sectionId="svg-properties" defaultOpen>
          <SVGSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
