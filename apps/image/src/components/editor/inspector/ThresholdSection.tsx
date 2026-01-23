import { useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer } from '../../../types/project';
import { DEFAULT_THRESHOLD } from '../../../types/adjustments';
import { Binary, RotateCcw } from 'lucide-react';

interface Props {
  layer: Layer;
}

export function ThresholdSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const threshold = layer.threshold;

  const handleLevelChange = (level: number) => {
    updateLayer(layer.id, {
      threshold: { ...threshold, level },
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      threshold: { ...threshold, enabled },
    });
  };

  const resetThreshold = () => {
    updateLayer(layer.id, {
      threshold: { ...DEFAULT_THRESHOLD },
    });
  };

  const percentage = (threshold.level / 255) * 100;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Binary size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Threshold</span>
          {threshold.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <input
          type="checkbox"
          checked={threshold.enabled}
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
            <span className="text-[10px] text-muted-foreground">Threshold Level</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground">{threshold.level}</span>
              <button
                onClick={resetThreshold}
                className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
                title="Reset"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </div>

          <input
            type="range"
            value={threshold.level}
            min={0}
            max={255}
            onChange={(e) => handleLevelChange(Number(e.target.value))}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-2.5
              [&::-webkit-slider-thumb]:h-2.5
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary
              [&::-webkit-slider-thumb]:shadow-sm
              [&::-webkit-slider-thumb]:cursor-pointer"
            style={{
              background: `linear-gradient(to right, #000000 0%, #000000 ${percentage}%, #ffffff ${percentage}%, #ffffff 100%)`
            }}
          />

          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>0 (Black)</span>
            <span>255 (White)</span>
          </div>

          <p className="text-[9px] text-muted-foreground">
            Pixels below the threshold become black, above become white.
          </p>
        </div>
      )}
    </div>
  );
}
