import React from "react";
import { ToolcraftPanelSection } from "@openreel/ui";

export interface InspectorSectionProps {
  title: string;
  defaultOpen?: boolean;
  sectionId?: string;
  children: React.ReactNode;
}

export const InspectorSection: React.FC<InspectorSectionProps> = ({
  title,
  defaultOpen = false,
  sectionId,
  children,
}) => {
  const [isCollapsed, setIsCollapsed] = React.useState(!defaultOpen);

  return (
    <ToolcraftPanelSection
      title={title}
      collapsed={isCollapsed}
      onCollapsedChange={setIsCollapsed}
      sectionId={sectionId}
      className="mb-4 rounded-[7px] border border-border bg-bg-1 last:border-b"
      bodyClassName="pt-0"
    >
      {children}
    </ToolcraftPanelSection>
  );
};
