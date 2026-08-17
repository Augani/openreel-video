import React from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Play, Pause, Plus, Download, FolderPlus, Volume2 } from "@/icons/lucide-compat";
import { useTranslation } from "react-i18next";

interface AudioResultProps {
  generatedAudio: Blob;
  voiceName: string;
  isPlaying: boolean;
  isGenerating: boolean;
  onTogglePlayback: () => void;
  onSaveToMedia: () => void;
  onAddToTimeline: () => void;
  onDownload: () => void;
}

export const AudioResult: React.FC<AudioResultProps> = ({
  generatedAudio,
  voiceName,
  isPlaying,
  isGenerating,
  onTogglePlayback,
  onSaveToMedia,
  onAddToTimeline,
  onDownload,
}) => {
  const { t } = useTranslation();
  return (
    <Card padding={3} variant="muted" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <Volume2 size={14} className="text-primary" aria-hidden />
          </div>
          <div>
            <Text type="label" weight="bold" display="block">
              {voiceName} {t(" Voice")}</Text>
            <Text type="supporting" color="secondary" display="block">
              {(generatedAudio.size / 1024).toFixed(1)} KB
            </Text>
          </div>
        </div>
        <IconButton
          label={isPlaying ? t("Pause preview") : t("Play preview")}
          icon={
            isPlaying ? (
              <Pause size={14} aria-hidden />
            ) : (
              <Play size={14} className="ml-0.5" aria-hidden />
            )
          }
          variant="primary"
          size="md"
          onClick={onTogglePlayback}
        />
      </div>

      <div className="flex gap-2">
        <Button
          label={t("Save to Media")}
          icon={<FolderPlus size={12} aria-hidden />}
          variant="primary"
          size="sm"
          onClick={onSaveToMedia}
          isDisabled={isGenerating}
          className="flex-1"
        />
        <IconButton
          label={t("Add to Timeline")}
          icon={<Plus size={12} aria-hidden />}
          variant="secondary"
          size="sm"
          onClick={onAddToTimeline}
          isDisabled={isGenerating}
        />
        <IconButton
          label={t("Download")}
          icon={<Download size={12} aria-hidden />}
          variant="secondary"
          size="sm"
          onClick={onDownload}
        />
      </div>
    </Card>
  );
};
