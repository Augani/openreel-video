import { useState } from "react";
import { RotateCcw, Clock, FileVideo, ChevronDown, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@openreel/ui";
import type { AutoSaveMetadata } from "../../services/auto-save";

interface RecoveryDialogProps {
  saves: AutoSaveMetadata[];
  onRecover: (saveId: string) => void;
  onDismiss: () => void;
  onClearAll?: () => void;
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
  onClearAll,
}) => {
  const [showOlderSaves, setShowOlderSaves] = useState(false);
  const [selectedSave, setSelectedSave] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const mostRecent = saves[0];
  const olderSaves = saves.slice(1);

  const handleClearAll = async () => {
    if (!onClearAll) return;
    setIsClearing(true);
    await onClearAll();
    setIsClearing(false);
    onDismiss();
  };

  const handleRecover = (saveId: string) => {
    setSelectedSave(saveId);
    onRecover(saveId);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="max-w-md p-0 gap-0 bg-background-secondary border-border overflow-hidden">
        <DialogHeader className="p-5 border-b border-border space-y-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl shrink-0">
              <RotateCcw className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-text-primary">
                Recover Your Work
              </DialogTitle>
              <DialogDescription className="text-sm text-text-secondary mt-0.5">
                We found an unsaved project
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

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
            <Button
              variant="outline"
              onClick={onDismiss}
              className="flex-1"
            >
              Start Fresh
            </Button>
            <Button
              onClick={() => handleRecover(mostRecent.id)}
              disabled={selectedSave === mostRecent.id}
              className="flex-1"
            >
              {selectedSave === mostRecent.id ? "Recovering..." : "Recover Project"}
            </Button>
          </div>

          {olderSaves.length > 0 && (
            <Collapsible
              open={showOlderSaves}
              onOpenChange={setShowOlderSaves}
              className="mt-4 pt-4 border-t border-border"
            >
              <div className="flex items-center justify-between">
                <CollapsibleTrigger className="flex items-center gap-2 text-sm text-text-muted hover:text-text-secondary transition-colors">
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-200 ${showOlderSaves ? "rotate-180" : ""}`}
                  />
                  <span>
                    {olderSaves.length} older {olderSaves.length === 1 ? "save" : "saves"} available
                  </span>
                </CollapsibleTrigger>
                {onClearAll && (
                  <button
                    onClick={handleClearAll}
                    disabled={isClearing}
                    className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title="Clear all saved projects"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <CollapsibleContent className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
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
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
