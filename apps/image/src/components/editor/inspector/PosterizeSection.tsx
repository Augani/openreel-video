import { useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer } from '../../../types/project';
import { DEFAULT_POSTERIZE } from '../../../types/adjustments';
import { Layers, RotateCcw } from 'lucide-react';

interface Props {
  layer: Layer;
}

export function PosterizeSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const posterize = layer.posterize;

  const handleLevelsChange = (levels: number) => {
    updateLayer(layer.id, {
      posterize: { ...posterize, levels },
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      posterize: { ...posterize, enabled },
    });
  };

  const resetPosterize = () => {
    updateLayer(layer.id, {
      posterize: { ...DEFAULT_POSTERIZE },
    });
  };

  const percentage = ((posterize.levels - 2) / 253) * 100;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Posterize</span>
          {posterize.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <input
          type="checkbox"
          checked={posterize.enabled}
          onChange={(e) => {
            e.stopPropagation();
            handleEnabledChange(e.target.checked);
          }}
          className="w-3.5 h-3.5 rounded border-border"
        />
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Levels</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground">{posterize.levels}</span>
              <button
                onClick={resetPosterize}
                className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
                title="Reset"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </div>

          <input
            type="range"
            value={posterize.levels}
            min={2}
            max={255}
            onChange={(e) => handleLevelsChange(Number(e.target.value))}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-2.5
              [&::-webkit-slider-thumb]:h-2.5
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary
              [&::-webkit-slider-thumb]:shadow-sm
              [&::-webkit-slider-thumb]:cursor-pointer"
            style={{
              background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${percentage}%, hsl(var(--secondary)) ${percentage}%, hsl(var(--secondary)) 100%)`
            }}
          />

          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>2</span>
            <span>255</span>
          </div>
        </div>
      )}
    </div>
  );
}
