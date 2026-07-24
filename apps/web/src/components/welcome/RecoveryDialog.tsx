import { useState } from "react";
import { RotateCcw, Clock, FileVideo, ChevronDown, Trash2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
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
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onDismiss()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title="Recover Your Work"
            subtitle="We found an unsaved project"
            onOpenChange={(open) => !open && onDismiss()}
            startContent={<RotateCcw className="w-5 h-5 text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
          <ClickableCard
            label={`Recover ${mostRecent.projectName}`}
            isDisabled={selectedSave === mostRecent.id}
            onClick={() => handleRecover(mostRecent.id)}
            padding={4}
            variant="muted"
            className="w-full bg-background-tertiary rounded-xl border border-border p-4 mb-4 text-left hover:border-primary/50 hover:bg-background-elevated transition-all group disabled:opacity-70"
          >
            <div className="flex items-center gap-3 mb-3">
              <FileVideo className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors" />
              <Text type="supporting" color="primary" weight="medium" className="truncate">
                {mostRecent.projectName}
              </Text>
            </div>
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Clock className="w-4 h-4 shrink-0" />
              <Text type="supporting" color="secondary" className="text-sm">Last saved {formatTimeAgo(mostRecent.timestamp)}</Text>
              <span className="text-text-muted/50">•</span>
              <Text type="supporting" color="secondary" className="text-text-muted/70 truncate">
                {formatDate(mostRecent.timestamp)}
              </Text>
            </div>
          </ClickableCard>

          {olderSaves.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <Button
                  label={`${olderSaves.length} older ${olderSaves.length === 1 ? "save" : "saves"} available`}
                  variant="ghost"
                  size="sm"
                  icon={
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-200 ${showOlderSaves ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  }
                  onClick={() => setShowOlderSaves((value) => !value)}
                  className="text-sm text-text-muted hover:text-text-secondary"
                />
                {onClearAll && (
                  <IconButton
                    label="Clear all saved projects"
                    onClick={handleClearAll}
                    isDisabled={isClearing}
                    icon={<Trash2 className="w-4 h-4" aria-hidden />}
                    size="sm"
                    variant="ghost"
                    className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  />
                )}
              </div>

              {showOlderSaves && (
              <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                {olderSaves.map((save) => (
                  <ClickableCard
                    key={save.id}
                    label={`Recover ${save.projectName}`}
                    onClick={() => handleRecover(save.id)}
                    isDisabled={selectedSave === save.id}
                    padding={3}
                    variant="muted"
                    className="w-full text-left p-3 rounded-lg bg-background-tertiary border border-border hover:border-border-hover hover:bg-background-elevated transition-all group disabled:opacity-70"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <Text type="supporting" color="primary" weight="medium" className="text-sm truncate group-hover:text-primary transition-colors">
                          {save.projectName}
                        </Text>
                        <Text type="supporting" color="secondary" className="text-xs text-text-muted mt-1">
                          {formatDate(save.timestamp)}
                        </Text>
                      </div>
                      <Text type="supporting" color="secondary" className="text-xs text-text-muted/70 shrink-0">
                        {formatTimeAgo(save.timestamp)}
                      </Text>
                    </div>
                  </ClickableCard>
                ))}
              </div>
              )}
            </div>
          )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <div className="flex w-full gap-2">
              <Button
                label="Start Fresh"
                variant="secondary"
                onClick={onDismiss}
                className="flex-1"
              />
              <Button
                label={selectedSave === mostRecent.id ? "Recovering..." : "Recover Project"}
                variant="primary"
                onClick={() => handleRecover(mostRecent.id)}
                isDisabled={selectedSave === mostRecent.id}
                className="flex-1"
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
