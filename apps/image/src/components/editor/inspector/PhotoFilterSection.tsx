import { useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer } from '../../../types/project';
import type { PhotoFilterAdjustment } from '../../../types/adjustments';
import { DEFAULT_PHOTO_FILTER } from '../../../types/adjustments';
import { PHOTO_FILTER_COLORS } from '../../../adjustments/photo-filter';
import { SunDim, RotateCcw } from 'lucide-react';

interface Props {
  layer: Layer;
}

const FILTER_OPTIONS = [
  { id: 'warming-85', label: 'Warming (85)', group: 'Warming' },
  { id: 'warming-81', label: 'Warming (81)', group: 'Warming' },
  { id: 'cooling-80', label: 'Cooling (80)', group: 'Cooling' },
  { id: 'cooling-82', label: 'Cooling (82)', group: 'Cooling' },
  { id: 'custom', label: 'Custom Color', group: 'Custom' },
] as const;

type FilterType = typeof FILTER_OPTIONS[number]['id'];

export function PhotoFilterSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const photoFilter = layer.photoFilter;

  const handleFilterChange = (filter: FilterType) => {
    const color = filter === 'custom' ? photoFilter.color : (PHOTO_FILTER_COLORS[filter as keyof typeof PHOTO_FILTER_COLORS] ?? photoFilter.color);
    updateLayer(layer.id, {
      photoFilter: {
        ...photoFilter,
        filter,
        color,
      },
    });
  };

  const handleDensityChange = (density: number) => {
    updateLayer(layer.id, {
      photoFilter: {
        ...photoFilter,
        density,
      },
    });
  };

  const handleColorChange = (color: string) => {
    updateLayer(layer.id, {
      photoFilter: {
        ...photoFilter,
        filter: 'custom',
        color,
      } as PhotoFilterAdjustment,
    });
  };

  const handlePreserveLuminosityChange = (preserveLuminosity: boolean) => {
    updateLayer(layer.id, {
      photoFilter: {
        ...photoFilter,
        preserveLuminosity,
      },
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      photoFilter: {
        ...photoFilter,
        enabled,
      },
    });
  };

  const resetPhotoFilter = () => {
    updateLayer(layer.id, {
      photoFilter: { ...DEFAULT_PHOTO_FILTER },
    });
  };

  const densityPercentage = photoFilter.density;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SunDim size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Photo Filter</span>
          {photoFilter.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <input
          type="checkbox"
          checked={photoFilter.enabled}
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
            <select
              value={photoFilter.filter}
              onChange={(e) => handleFilterChange(e.target.value as FilterType)}
              className="text-[10px] bg-secondary border-none rounded px-2 py-1 text-foreground flex-1"
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <button
              onClick={resetPhotoFilter}
              className="p-1 ml-2 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Color</span>
            <input
              type="color"
              value={photoFilter.color}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-6 h-6 rounded border-none cursor-pointer"
            />
            <span className="text-[10px] font-mono text-muted-foreground">{photoFilter.color}</span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Density</span>
              <span className="text-[10px] font-mono text-muted-foreground">{photoFilter.density}%</span>
            </div>
            <input
              type="range"
              value={photoFilter.density}
              min={0}
              max={100}
              onChange={(e) => handleDensityChange(Number(e.target.value))}
              className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-2.5
                [&::-webkit-slider-thumb]:h-2.5
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-primary
                [&::-webkit-slider-thumb]:shadow-sm
                [&::-webkit-slider-thumb]:cursor-pointer"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${densityPercentage}%, hsl(var(--secondary)) ${densityPercentage}%, hsl(var(--secondary)) 100%)`
              }}
            />
          </div>

          <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={photoFilter.preserveLuminosity}
              onChange={(e) => handlePreserveLuminosityChange(e.target.checked)}
              className="w-3 h-3 rounded border-border"
            />
            Preserve Luminosity
          </label>
        </div>
      )}
    </div>
  );
}
