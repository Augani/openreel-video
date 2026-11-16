import { useState } from "react";
import { Button, Input } from "@openreel/ui";
import { Search } from "lucide-react";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { MusicLibraryPanel } from "./inspector/MusicLibraryPanel";
import type { BackgroundPreset } from "../../services/background-generator";
import { StockFootagePanel } from "./StockFootagePanel";
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";
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
          { value: "music", label: "Music" },
          { value: "sfx", label: "Sound FX" },
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
            <div className="workspace-stock-grid">
              {backgrounds
                .filter(
                  (p) =>
                    !query.trim() ||
                    p.name.toLowerCase().includes(query.trim().toLowerCase()),
                )
                .map((p) => (
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
            <p className="text-[10px] text-fg-muted mt-3">
              Built-in backgrounds, music and sound effects. Add a background to
              your project with one click.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <MusicLibraryPanel source={tab === "sfx" ? "sfx" : "music"} />
          </div>
        )}
      </div>
    </div>
  );
}
