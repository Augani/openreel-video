import { useCallback, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger } from "@openreel/ui";

export function WorkspaceTabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: React.ReactNode }[];
  label: string;
}) {
  const prefix = `workspace-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const host = useRef<HTMLDivElement>(null);
  // A strip wider than its panel fades at the clipped edge, so a cut-off tab reads as "more this way", never as a broken label.
  const syncFades = useCallback(() => {
    const strip = host.current?.querySelector<HTMLElement>(".workspace-panel-tabs");
    if (!strip) return;
    strip.dataset.fadeStart = String(strip.scrollLeft > 2);
    strip.dataset.fadeEnd = String(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
  }, []);
  useEffect(() => {
    const strip = host.current?.querySelector<HTMLElement>(".workspace-panel-tabs");
    if (!strip) return;
    strip.addEventListener("scroll", syncFades, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncFades);
    observer?.observe(strip);
    syncFades();
    return () => {
      strip.removeEventListener("scroll", syncFades);
      observer?.disconnect();
    };
  }, [syncFades]);
  useEffect(() => {
    const selected = host.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    selected?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    syncFades();
  }, [value, syncFades]);
  return (
    <div ref={host} className="shrink-0 min-w-0">
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className="min-w-0"
    >
      <TabsList
        className="workspace-panel-tabs w-full justify-start rounded-none"
        aria-label={label}
        layoutId={label}
      >
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            id={`${prefix}-tab-${option.value}`}
            aria-controls={`${prefix}-panel`}
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
    </div>
  );
}

/** The shared content region can be a sibling of the tab list without changing its flex layout. */
export function workspaceTabPanel(label: string, value: string) {
  const prefix = `workspace-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return {
    role: "tabpanel" as const,
    id: `${prefix}-panel`,
    "aria-labelledby": `${prefix}-tab-${value}`,
    tabIndex: 0,
  };
}
