import React from "react";
import { Button } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { RawSourceSettingsDialog } from "../project-panel/RawSourceSettingsDialog";
import { InspectorSection } from "./shell/InspectorSection";

/**
 * Inspector entry for a clip whose source is a camera RAW still: a summary of how it is developed and a
 * button to the RAW Source Settings dialog (the same dialog as the Project panel's context menu).
 * Renders nothing for any other clip.
 */
export const RawSourceSection: React.FC<{ clipId: string }> = ({ clipId }) => {
  const media = useProjectStore((s) => {
    const clip = s.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    return clip ? s.project.mediaLibrary.items.find((m) => m.id === clip.mediaId) : undefined;
  });
  const [open, setOpen] = React.useState(false);
  if (!media?.raw) return null;
  const settings = media.raw.settings;
  return (
    <InspectorSection title="RAW Source" sectionId="raw-source" defaultOpen>
      <div className="space-y-2 text-xs" data-testid="inspector-raw-source">
        {settings ? (
          <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
            <dt className="text-fg-3">White balance</dt>
            <dd>{settings.temperature} K, tint {settings.tint > 0 ? `+${settings.tint}` : settings.tint}</dd>
            <dt className="text-fg-3">Exposure</dt>
            <dd>{settings.exposure > 0 ? "+" : ""}{settings.exposure.toFixed(2)} EV</dd>
            <dt className="text-fg-3">Highlights</dt>
            <dd>{Math.round(settings.highlightRecovery * 100)}% recovery</dd>
            <dt className="text-fg-3">Demosaic</dt>
            <dd>{settings.demosaic}</dd>
            <dt className="text-fg-3">Output</dt>
            <dd>{settings.outputColorSpace}</dd>
          </dl>
        ) : (
          <p className="text-fg-3">Developed when it was imported ({media.raw.format.toUpperCase()}).</p>
        )}
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="inspector-raw-open">
          RAW Source Settings…
        </Button>
        {open && <RawSourceSettingsDialog media={media} onClose={() => setOpen(false)} />}
      </div>
    </InspectorSection>
  );
};
