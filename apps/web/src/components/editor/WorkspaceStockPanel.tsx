import { useState } from "react";
import { Button, Input } from "@openreel/ui";
import { Search } from "lucide-react";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import type { BackgroundPreset } from "../../services/background-generator";
import { StockFootagePanel } from "./StockFootagePanel";
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";
const BACKGROUND_GROUPS: { category: BackgroundPreset["category"]; title: string }[] = [
  { category: "solid", title: "Solid colours" },
  { category: "gradient", title: "Gradients" },
  { category: "pattern", title: "Patterns" },
  { category: "mesh", title: "Mesh" },
];

export function WorkspaceStockPanel({
  backgrounds,
  onImportBackground,
  generatingBackground,
}: {
  backgrounds: readonly BackgroundPreset[];
  onImportBackground: (preset: BackgroundPreset) => void;
  generatingBackground: string | null;
}) {
  const [tab, setTab] = useState("footage");
  const [query, setQuery] = useState("");
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const lockedReason = useTimelineStore((state) => state.playbackLockedReason);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkspaceTabs
        label="Stock sources"
        value={tab}
        onChange={setTab}
        options={[
          { value: "footage", label: "Footage" },
          { value: "backgrounds", label: "Backgrounds" },
        ]}
      />
      <div
        className="flex min-h-0 flex-1 flex-col pt-2.5"
        {...workspaceTabPanel("Stock sources", tab)}
      >
        {tab === "footage" ? (
          <StockFootagePanel />
        ) : tab === "backgrounds" ? (
          <div className="flex-1 min-h-0 overflow-auto px-2.5 pb-3">
            <div className="workspace-search mb-3">
              <Search />
              <Input
                aria-label="Search stock backgrounds"
                placeholder="Search backgrounds"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {BACKGROUND_GROUPS.map(({ category, title }) => {
              const needle = query.trim().toLowerCase();
              const group = backgrounds.filter(
                (p) =>
                  p.category === category &&
                  (!needle || p.name.toLowerCase().includes(needle)),
              );
              if (!group.length) return null;
              return (
                <section key={category} aria-label={title} className="mb-3">
                  <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-muted">
                    {title}
                  </h4>
                  <div className="workspace-stock-grid is-compact">
                    {group.map((p) => (
                      <Button
                        key={p.id}
                        variant="ghost"
                        disabled={
                          generatingBackground !== null ||
                          exporting ||
                          Boolean(lockedReason)
                        }
                        title={
                          exporting
                            ? "Wait for export to finish"
                            : lockedReason || undefined
                        }
                        onClick={() => onImportBackground(p)}
                      >
                        <span style={{ background: p.thumbnail }} />
                        <small>{p.name}</small>
                      </Button>
                    ))}
                  </div>
                </section>
              );
            })}
            <p className="text-[10px] text-fg-muted mt-3">
              Generated backgrounds. Add one to your project with a click.
              Music and sound effects are in the Audio panel.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
