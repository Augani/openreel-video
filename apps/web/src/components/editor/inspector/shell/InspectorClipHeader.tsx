import * as React from "react";

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
      <p className="text-[11.5px] text-fg font-medium truncate">{name}</p>
      <p className="text-[10px] text-fg-muted mt-0.5">{durationSeconds.toFixed(2)}s</p>
    </div>
    <span className="text-[10px] uppercase tracking-wide text-fg-3 bg-bg-2 border border-border rounded px-1.5 py-0.5 shrink-0">
      {typeLabel}
    </span>
  </div>
);
