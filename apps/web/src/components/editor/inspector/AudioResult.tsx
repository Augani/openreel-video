import React from "react";
import { Play, Pause, Plus, Download, FolderPlus, Volume2 } from "lucide-react";

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
    <div className="p-3 bg-background-tertiary rounded-lg border border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <Volume2 size={14} className="text-primary" />
          </div>
          <div>
            <p className="text-[10px] font-medium text-text-primary">
              {voiceName} Voice
            </p>
            <p className="text-[9px] text-text-muted">
              {(generatedAudio.size / 1024).toFixed(1)} KB
            </p>
          </div>
        </div>
        <button
          onClick={onTogglePlayback}
          className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white hover:opacity-90 transition-opacity"
        >
          {isPlaying ? (
            <Pause size={14} />
          ) : (
            <Play size={14} className="ml-0.5" />
          )}
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSaveToMedia}
          disabled={isGenerating}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-[10px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <FolderPlus size={12} />
          Save to Media
        </button>
        <button
          onClick={onAddToTimeline}
          disabled={isGenerating}
          className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-[10px] text-text-secondary hover:text-text-primary transition-colors"
          title="Add to Timeline"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={onDownload}
          className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-[10px] text-text-secondary hover:text-text-primary transition-colors"
          title="Download"
        >
          <Download size={12} />
        </button>
      </div>
    </div>
  );
};
