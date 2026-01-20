import React, { useState } from "react";
import { RotateCcw, X, Clock, FileVideo, ChevronDown } from "lucide-react";
import type { AutoSaveMetadata } from "../../services/auto-save";

interface RecoveryDialogProps {
  saves: AutoSaveMetadata[];
  onRecover: (saveId: string) => void;
  onDismiss: () => void;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({
  saves,
  onRecover,
  onDismiss,
}) => {
  const [showOlderSaves, setShowOlderSaves] = useState(false);
  const [selectedSave, setSelectedSave] = useState<string | null>(null);
  const mostRecent = saves[0];
  const olderSaves = saves.slice(1);

  const handleRecover = (saveId: string) => {
    setSelectedSave(saveId);
    onRecover(saveId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onDismiss}
      />

      <div className="relative bg-background-secondary border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl shrink-0">
                <RotateCcw className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  Recover Your Work
                </h2>
                <p className="text-sm text-text-secondary mt-0.5">
                  We found an unsaved project
                </p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-background-tertiary transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5">
          <button
            onClick={() => handleRecover(mostRecent.id)}
            disabled={selectedSave === mostRecent.id}
            className="w-full bg-background-tertiary rounded-xl border border-border p-4 mb-4 text-left hover:border-primary/50 hover:bg-background-elevated transition-all group disabled:opacity-70"
          >
            <div className="flex items-center gap-3 mb-3">
              <FileVideo className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors" />
              <span className="font-medium text-text-primary truncate">
                {mostRecent.projectName}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Last saved {formatTimeAgo(mostRecent.timestamp)}</span>
              <span className="text-text-muted/50">•</span>
              <span className="text-text-muted/70 truncate">
                {formatDate(mostRecent.timestamp)}
              </span>
            </div>
          </button>

          <div className="flex gap-3">
            <button
              onClick={onDismiss}
              className="flex-1 px-4 py-2.5 rounded-lg font-medium text-sm text-text-secondary bg-background-tertiary border border-border hover:bg-background-elevated hover:text-text-primary active:scale-[0.98] transition-all"
            >
              Start Fresh
            </button>
            <button
              onClick={() => handleRecover(mostRecent.id)}
              disabled={selectedSave === mostRecent.id}
              className="flex-1 px-4 py-2.5 rounded-lg font-medium text-sm text-white bg-primary hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {selectedSave === mostRecent.id ? "Recovering..." : "Recover Project"}
            </button>
          </div>

          {olderSaves.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <button
                onClick={() => setShowOlderSaves(!showOlderSaves)}
                className="flex items-center gap-2 text-sm text-text-muted hover:text-text-secondary transition-colors w-full"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${showOlderSaves ? "rotate-180" : ""}`}
                />
                <span>
                  {olderSaves.length} older {olderSaves.length === 1 ? "save" : "saves"} available
                </span>
              </button>

              {showOlderSaves && (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                  {olderSaves.map((save) => (
                    <button
                      key={save.id}
                      onClick={() => handleRecover(save.id)}
                      disabled={selectedSave === save.id}
                      className="w-full text-left p-3 rounded-lg bg-background-tertiary border border-border hover:border-border-hover hover:bg-background-elevated transition-all group disabled:opacity-70"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
                            {save.projectName}
                          </div>
                          <div className="text-xs text-text-muted mt-1">
                            {formatDate(save.timestamp)}
                          </div>
                        </div>
                        <div className="text-xs text-text-muted/70 shrink-0">
                          {formatTimeAgo(save.timestamp)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
