import React from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { Square, Pause, Play, X, Minimize2 } from "@/icons/lucide-compat";
import { useRecorderStore } from "../../stores/recorder-store";
import { formatDuration } from "../../services/screen-recorder";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
      <Button
        label={formatDuration(duration)}
        variant="destructive"
        size="md"
        onClick={expandControls}
        className="fixed bottom-6 right-6 z-[200] flex items-center gap-2 px-4 py-2 bg-red-600 rounded-full shadow-2xl hover:bg-red-700 transition-all group"
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
            <IconButton
              label={t("Resume recording")}
              icon={<Play size={20} className="text-white" aria-hidden />}
              size="lg"
              variant="primary"
              onClick={onResume}
              className="p-3 bg-primary hover:bg-primary-hover rounded-xl transition-colors"
            />
          ) : (
            <IconButton
              label={t("Pause recording")}
              icon={<Pause size={20} className="text-warning" aria-hidden />}
              size="lg"
              variant="secondary"
              onClick={onPause}
              className="p-3 bg-warning/20 hover:bg-warning/30 rounded-xl transition-colors"
            />
          )}

          <IconButton
            label={t("Stop recording")}
            icon={<Square size={20} className="text-white fill-white" aria-hidden />}
            size="lg"
            variant="destructive"
            onClick={onStop}
            className="p-3 bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
          />

          <IconButton
            label={t("Cancel recording")}
            icon={<X size={20} className="text-text-muted" aria-hidden />}
            size="lg"
            variant="ghost"
            onClick={onCancel}
            className="p-3 bg-background-tertiary hover:bg-background-elevated rounded-xl transition-colors"
          />
        </div>

        <div className="w-px h-8 bg-border" />

        <IconButton
          label={t("Minimize controls")}
          icon={<Minimize2 size={16} aria-hidden />}
          size="sm"
          variant="ghost"
          onClick={minimizeControls}
          className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-background-tertiary transition-colors"
        />
      </div>
    </div>
  );
};
