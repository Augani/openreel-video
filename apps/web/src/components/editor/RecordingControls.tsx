import React from "react";
import { Button } from "@openreel/ui";

import { Square, Pause, Play, X, Minimize2 } from "@/icons/lucide-compat";
import { useRecorderStore } from "../../stores/recorder-store";
import { formatDuration } from "../../services/screen-recorder";

interface RecordingControlsProps {
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  onStop,
  onPause,
  onResume,
  onCancel,
}) => {
  const {
    status,
    duration,
    isControlsMinimized,
    minimizeControls,
    expandControls,
  } = useRecorderStore();

  const isPaused = status === "paused";

  if (isControlsMinimized) {
    return (
      <Button onClick={expandControls} type="button" aria-label={(formatDuration(duration)).trim() || undefined} className="min-w-0 justify-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 text-[12px] text-white fixed bottom-6 right-6 z-[200] flex items-center gap-2 px-4 py-2 bg-red-600 rounded-full shadow-2xl hover:bg-red-700 transition-all group"
      >
        <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
        <span className="text-sm font-bold text-white">
          {formatDuration(duration)}
        </span>
      </Button>
    );
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]">
      <div className="flex items-center gap-4 px-6 py-4 bg-background-secondary/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl">
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full ${
              isPaused ? "bg-warning" : "bg-error animate-pulse"
            }`}
          />
          <span className="text-lg font-mono font-bold text-text-primary min-w-[80px]">
            {formatDuration(duration)}
          </span>
        </div>

        <div className="w-px h-8 bg-border" />

        <div className="flex items-center gap-2">
          {isPaused ? (
            <Button variant="ghost" size="icon-sm" onClick={onResume} type="button" aria-label="Resume recording" title="Resume recording" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-9 w-9 text-accent-fg p-3 bg-primary hover:bg-primary-hover rounded-xl transition-colors">
              {<Play size={20} className="text-white" aria-hidden />}
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" onClick={onPause} type="button" aria-label="Pause recording" title="Pause recording" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-9 w-9 border border-border text-fg-2 hover:text-fg p-3 bg-warning/20 hover:bg-warning/30 rounded-xl transition-colors">
              {<Pause size={20} className="text-warning" aria-hidden />}
            </Button>
          )}

          <Button variant="ghost" size="icon-sm" onClick={onStop} type="button" aria-label="Stop recording" title="Stop recording" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-9 w-9 text-status-error p-3 bg-red-600 hover:bg-red-700 rounded-xl transition-colors">
            {<Square size={20} className="text-white fill-white" aria-hidden />}
          </Button>

          <Button variant="ghost" size="icon-sm" onClick={onCancel} type="button" aria-label="Cancel recording" title="Cancel recording" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-9 w-9 text-fg-muted hover:text-fg p-3 bg-background-tertiary hover:bg-background-elevated rounded-xl transition-colors">
            {<X size={20} className="text-text-muted" aria-hidden />}
          </Button>
        </div>

        <div className="w-px h-8 bg-border" />

        <Button variant="ghost" size="icon-sm" onClick={minimizeControls} type="button" aria-label="Minimize controls" title="Minimize controls" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-background-tertiary transition-colors">
          {<Minimize2 size={16} aria-hidden />}
        </Button>
      </div>
    </div>
  );
};
