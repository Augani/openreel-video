import React from "react";
import { ToolcraftPanelSection } from "@openreel/ui";
import { useInspectorNavigationStore } from "../../../../stores/inspector-navigation-store";
import { useUIStore } from "../../../../stores/ui-store";

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
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const request = useInspectorNavigationStore((state) =>
    state.request?.sectionId === sectionId ? state.request : null,
  );
  const requestIsSelected = useUIStore((state) => Boolean(request &&
    state.selectedItems.some((item) => item.id === request.clipId)));

  React.useEffect(() => {
    if (!request || !requestIsSelected) return;
    setIsCollapsed(false);
    const frame = requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView?.({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
      sectionRef.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [request, requestIsSelected]);

  return (
    <div ref={sectionRef}>
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
    </div>
  );
};
