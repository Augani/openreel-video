import React from "react";
import { Sparkles } from "lucide-react";

interface EnhancedTextPreviewProps {
  enhancedPreview: string;
  onUpdate: (text: string) => void;
  onDiscard: () => void;
}

export const EnhancedTextPreview: React.FC<EnhancedTextPreviewProps> = ({
  enhancedPreview,
  onUpdate,
  onDiscard,
}) => {
  return (
    <div className="p-2 bg-amber-500/5 border border-amber-500/20 rounded-lg space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Sparkles size={9} className="text-amber-400" />
          <span className="text-[9px] font-medium text-amber-400">Enhanced — edit below then Generate</span>
        </div>
        <button
          onClick={onDiscard}
          className="text-[9px] text-text-muted hover:text-red-400 transition-colors"
        >
          Discard
        </button>
      </div>
      <textarea
        value={enhancedPreview}
        onChange={(e) => onUpdate(e.target.value)}
        className="w-full h-24 px-2 py-1.5 text-[10px] bg-background-tertiary rounded-md border border-amber-500/20 focus:border-amber-500/50 focus:outline-none resize-none text-text-primary leading-relaxed"
      />
    </div>
  );
};
