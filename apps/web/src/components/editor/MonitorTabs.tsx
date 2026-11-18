import { cn } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useSourceMonitorStore, type MonitorTab } from "../../stores/source-monitor-store";

/** Program / Source switch shown in both monitors' headers. */
export function MonitorTabs({ active }: { active: MonitorTab }) {
  const setTab = useSourceMonitorStore((s) => s.setTab);
  const hasMulticam = useProjectStore((s) => (s.project.multicamSources?.length ?? 0) > 0);
  const tab = (id: MonitorTab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`monitor-tab-${id}`}
      aria-selected={active === id}
      data-testid={`monitor-tab-${id}`}
      onClick={() => setTab(id)}
      className={cn(
        "!h-6 rounded-[5px] !px-2 text-xs transition-colors",
        active === id ? "bg-bg-2 font-semibold text-fg" : "font-normal text-fg-3 hover:text-fg-2",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="Monitor" className="-ml-1.5 flex items-center gap-0.5">
      {tab("program", "Program")}
      {tab("source", "Source")}
      {(hasMulticam || active === "multicam") && tab("multicam", "Multicam")}
    </div>
  );
}
