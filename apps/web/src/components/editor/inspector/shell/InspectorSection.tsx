import React from "react";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from "@openreel/ui";
import { ChevronRight } from "lucide-react";
import { useInspectorNavigationStore } from "../../../../stores/inspector-navigation-store";
import { useUIStore } from "../../../../stores/ui-store";

interface InspectorSectionProps {
  title: string;
  defaultOpen?: boolean;
  sectionId?: string;
  sectionIds?: readonly string[];
  children: React.ReactNode;
}

export const InspectorSection: React.FC<InspectorSectionProps> = ({
  title,
  defaultOpen = false,
  sectionId,
  sectionIds,
  children,
}) => {
  const [isCollapsed, setIsCollapsed] = React.useState(!defaultOpen);
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const request = useInspectorNavigationStore((state) =>
    state.request && (state.request.sectionId === sectionId || sectionIds?.includes(state.request.sectionId)) ? state.request : null,
  );
  const requestIsSelected = useUIStore((state) => Boolean(request &&
    state.selectedItems.some((item) => item.id === request.clipId)));
  const pendingNavigation = React.useRef<{
    request: NonNullable<typeof request>;
    focusPending: boolean;
  } | null>(null);

  const alignRequestedSection = React.useCallback(() => {
    const pending = pendingNavigation.current;
    if (!pending || useInspectorNavigationStore.getState().request !== pending.request ||
      !useUIStore.getState().selectedItems.some((item) => item.id === pending.request.clipId)) return;
    const anchor = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-inspector-anchor]") ?? [])
      .find((element) => element.dataset.inspectorAnchor === pending.request.sectionId);
    const nestedSection = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-section-id]") ?? [])
      .find((element) => element.dataset.sectionId === pending.request.sectionId);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (anchor ?? nestedSection ?? sectionRef.current)?.scrollIntoView?.({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
    if (pending.focusPending) {
      const control = (anchor ?? nestedSection)?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]");
      (control ?? triggerRef.current)?.focus({ preventScroll: true });
      pending.focusPending = false;
    }
  }, []);

  const cancelPendingNavigation = React.useCallback(() => {
    pendingNavigation.current = null;
  }, []);

  const completeExpansion = React.useCallback(() => {
    // The first frame can be clamped while the animated body is still short.
    // Align once more when its full height gives the scroll area enough room.
    alignRequestedSection();
    pendingNavigation.current = null;
  }, [alignRequestedSection]);

  React.useEffect(() => {
    if (!request || !requestIsSelected) return;
    pendingNavigation.current = { request, focusPending: true };
    setIsCollapsed(false);
    const frame = requestAnimationFrame(alignRequestedSection);
    return () => {
      cancelAnimationFrame(frame);
      if (pendingNavigation.current?.request === request) pendingNavigation.current = null;
    };
  }, [request, requestIsSelected, alignRequestedSection]);

  const label = `${isCollapsed ? "Expand" : "Collapse"} ${title.trim() || "section"} section`;

  return (
    <div
      ref={sectionRef}
      className="workspace-inspector-section-host"
      data-inspector-section={sectionId}
      onWheelCapture={cancelPendingNavigation}
      onPointerDownCapture={cancelPendingNavigation}
      onKeyDownCapture={cancelPendingNavigation}
    >
      <Collapsible
        asChild
        open={!isCollapsed}
        onOpenChange={(open) => {
          cancelPendingNavigation();
          setIsCollapsed(!open);
        }}
      >
        <section
          className={cn(
            "group/inspector-section border-b border-border last:border-b-0",
            "workspace-inspector-section mb-0 rounded-none border-0 border-b border-border bg-transparent",
          )}
          data-collapsed={String(isCollapsed)}
          data-section-id={sectionId}
        >
          <div
            className="flex min-h-10 min-w-0 items-center justify-between gap-2 px-3.5 py-2.5"
            data-slot="inspector-section-header"
          >
            <CollapsibleTrigger asChild>
              <Button
                ref={triggerRef}
                variant="ghost"
                aria-label={label}
                className="h-auto min-w-0 flex-1 justify-start p-0 hover:bg-transparent"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight
                    size={13}
                    aria-hidden
                    className={cn("shrink-0 text-fg-muted transition-transform", !isCollapsed && "rotate-90")}
                  />
                  <span className="min-w-0 truncate text-[13px] font-semibold text-fg">{title}</span>
                </div>
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent data-slot="inspector-section-body" onAnimationComplete={completeExpansion}>
            <div className="space-y-3 px-3.5 pb-4 pt-0">{children}</div>
          </CollapsibleContent>
        </section>
      </Collapsible>
    </div>
  );
};
