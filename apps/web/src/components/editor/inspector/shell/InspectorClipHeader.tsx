import * as React from "react";
import { ToolcraftBadge, ToolcraftText } from "@openreel/ui";

export interface InspectorClipHeaderProps {
  name: string;
  durationSeconds: number;
  typeLabel: string;
}

export const InspectorClipHeader: React.FC<InspectorClipHeaderProps> = ({
  name,
  durationSeconds,
  typeLabel,
}) => (
  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
    <div className="min-w-0">
      <ToolcraftText type="label" weight="bold" className="block" maxLines={1}>
        {name}
      </ToolcraftText>
      <ToolcraftText type="supporting" color="secondary" className="mt-0.5 block">
        {durationSeconds.toFixed(2)}s
      </ToolcraftText>
    </div>
    <ToolcraftBadge label={typeLabel} className="shrink-0 uppercase tracking-wide" />
  </div>
);
