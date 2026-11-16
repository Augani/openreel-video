import React from "react";
import { Button } from "@openreel/ui";
import { Card } from "@openreel/ui";


import { Play, Pause, Plus, Download, FolderPlus, Volume2 } from "@/icons/lucide-compat";

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
  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <Volume2 size={14} className="text-primary" aria-hidden />
          </div>
          <div>
            <span className="text-[12px] leading-4 text-fg-2 font-bold block">
              {voiceName} Voice
            </span>
            <span className="text-[12px] leading-5 text-fg-2 font-normal block">
              {(generatedAudio.size / 1024).toFixed(1)} KB
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onTogglePlayback} type="button" aria-label={isPlaying ? "Pause preview" : "Play preview"} title={isPlaying ? "Pause preview" : "Play preview"} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 w-8 bg-accent text-accent-fg hover:bg-accent/90">
          {isPlaying ? (
              <Pause size={14} aria-hidden />
            ) : (
              <Play size={14} className="ml-0.5" aria-hidden />
            )}
        </Button>
      </div>

      <div className="flex gap-2">
        <Button onClick={onSaveToMedia} type="button" aria-label="Save to Media" disabled={(isGenerating)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 flex-1">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<FolderPlus size={12} aria-hidden />}</span>
          <span className="truncate">{"Save to Media"}</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onAddToTimeline} type="button" aria-label="Add to Timeline" title="Add to Timeline" disabled={(isGenerating)} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
          {<Plus size={12} aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDownload} type="button" aria-label="Download" title="Download" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
          {<Download size={12} aria-hidden />}
        </Button>
      </div>
    </Card>
  );
};
