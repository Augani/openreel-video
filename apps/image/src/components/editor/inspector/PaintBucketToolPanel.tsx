import { useUIStore } from '../../../stores/ui-store';
import { PaintBucket, RotateCcw } from 'lucide-react';

export function PaintBucketToolPanel() {
  const { paintBucketSettings, setPaintBucketSettings, brushSettings, setBrushSettings } = useUIStore();

  const resetSettings = () => {
    setPaintBucketSettings({
      color: '#000000',
      tolerance: 32,
      contiguous: true,
      antiAlias: true,
      opacity: 1,
      fillType: 'foreground',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PaintBucket size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Paint Bucket</h3>
        </div>
        <button
          onClick={resetSettings}
          className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Click on canvas to fill area with color.
      </p>

      <div className="space-y-3">
        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Fill Color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={brushSettings.color}
              onChange={(e) => setBrushSettings({ color: e.target.value })}
              className="w-10 h-10 rounded border border-border cursor-pointer"
            />
            <input
              type="text"
              value={brushSettings.color}
              onChange={(e) => setBrushSettings({ color: e.target.value })}
              className="flex-1 px-2 py-1.5 text-xs font-mono bg-secondary/50 border border-border rounded"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Tolerance</span>
            <span className="text-xs font-mono text-muted-foreground">{paintBucketSettings.tolerance}</span>
          </div>
          <input
            type="range"
            min={0}
            max={255}
            value={paintBucketSettings.tolerance}
            onChange={(e) => setPaintBucketSettings({ tolerance: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Opacity</span>
            <span className="text-xs font-mono text-muted-foreground">{Math.round(paintBucketSettings.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={paintBucketSettings.opacity * 100}
            onChange={(e) => setPaintBucketSettings({ opacity: Number(e.target.value) / 100 })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div className="space-y-2 pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={paintBucketSettings.contiguous}
              onChange={(e) => setPaintBucketSettings({ contiguous: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Contiguous
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={paintBucketSettings.antiAlias}
              onChange={(e) => setPaintBucketSettings({ antiAlias: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Anti-alias
          </label>
        </div>
      </div>
    </div>
  );
}
