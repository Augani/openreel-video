import { useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer } from '../../../types/project';
import type { GradientMapStop } from '../../../types/adjustments';
import { DEFAULT_GRADIENT_MAP } from '../../../types/adjustments';
import { Paintbrush, RotateCcw, Plus, X } from 'lucide-react';

interface Props {
  layer: Layer;
}

const GRADIENT_PRESETS = [
  { name: 'B&W', stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }] },
  { name: 'Sepia', stops: [{ position: 0, color: '#2b1810' }, { position: 0.5, color: '#8b5a2b' }, { position: 1, color: '#f5deb3' }] },
  { name: 'Duotone Blue', stops: [{ position: 0, color: '#001133' }, { position: 1, color: '#66ccff' }] },
  { name: 'Duotone Orange', stops: [{ position: 0, color: '#331100' }, { position: 1, color: '#ff9900' }] },
  { name: 'Sunset', stops: [{ position: 0, color: '#1a0533' }, { position: 0.5, color: '#ff6b35' }, { position: 1, color: '#f7c59f' }] },
];

export function GradientMapSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const gradientMap = layer.gradientMap;

  const handleStopChange = (index: number, updates: Partial<GradientMapStop>) => {
    const newStops = [...gradientMap.stops];
    newStops[index] = { ...newStops[index], ...updates };
    updateLayer(layer.id, {
      gradientMap: { ...gradientMap, stops: newStops },
    });
  };

  const addStop = () => {
    const newStops = [...gradientMap.stops, { position: 0.5, color: '#808080' }];
    newStops.sort((a, b) => a.position - b.position);
    updateLayer(layer.id, {
      gradientMap: { ...gradientMap, stops: newStops },
    });
  };

  const removeStop = (index: number) => {
    if (gradientMap.stops.length <= 2) return;
    const newStops = gradientMap.stops.filter((_, i) => i !== index);
    updateLayer(layer.id, {
      gradientMap: { ...gradientMap, stops: newStops },
    });
  };

  const handleReverseChange = (reverse: boolean) => {
    updateLayer(layer.id, {
      gradientMap: { ...gradientMap, reverse },
    });
  };

  const handleDitherChange = (dither: boolean) => {
    updateLayer(layer.id, {
      gradientMap: { ...gradientMap, dither },
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      gradientMap: { ...gradientMap, enabled },
    });
  };

  const applyPreset = (preset: typeof GRADIENT_PRESETS[0]) => {
    updateLayer(layer.id, {
      gradientMap: { ...gradientMap, stops: preset.stops },
    });
  };

  const resetGradientMap = () => {
    updateLayer(layer.id, {
      gradientMap: { ...DEFAULT_GRADIENT_MAP },
    });
  };

  const gradientStyle = `linear-gradient(to right, ${gradientMap.stops
    .map((s) => `${s.color} ${s.position * 100}%`)
    .join(', ')})`;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Paintbrush size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Gradient Map</span>
          {gradientMap.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <input
          type="checkbox"
          checked={gradientMap.enabled}
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
            <div className="flex gap-1 flex-wrap">
              {GRADIENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  className="px-2 py-1 text-[9px] bg-secondary/50 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <button
              onClick={resetGradientMap}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div
            className="h-6 rounded border border-border"
            style={{ background: gradientStyle }}
          />

          <div className="space-y-2">
            {gradientMap.stops.map((stop, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="color"
                  value={stop.color}
                  onChange={(e) => handleStopChange(index, { color: e.target.value })}
                  className="w-6 h-6 rounded border-none cursor-pointer"
                />
                <input
                  type="range"
                  value={stop.position * 100}
                  min={0}
                  max={100}
                  onChange={(e) => handleStopChange(index, { position: Number(e.target.value) / 100 })}
                  className="flex-1 h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-2.5
                    [&::-webkit-slider-thumb]:h-2.5
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-primary"
                />
                <span className="text-[10px] font-mono text-muted-foreground w-8">{Math.round(stop.position * 100)}%</span>
                {gradientMap.stops.length > 2 && (
                  <button
                    onClick={() => removeStop(index)}
                    className="p-0.5 text-muted-foreground hover:text-destructive rounded hover:bg-secondary transition-colors"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addStop}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus size={10} /> Add Stop
          </button>

          <div className="flex gap-4 pt-1 border-t border-border/50">
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={gradientMap.reverse}
                onChange={(e) => handleReverseChange(e.target.checked)}
                className="w-3 h-3 rounded border-border"
              />
              Reverse
            </label>
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={gradientMap.dither}
                onChange={(e) => handleDitherChange(e.target.checked)}
                className="w-3 h-3 rounded border-border"
              />
              Dither
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
