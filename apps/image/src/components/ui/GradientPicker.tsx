import { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, RotateCw } from 'lucide-react';
import { Slider } from '@openreel/ui';
import type { Gradient } from '../../types/project';

interface GradientPickerProps {
  value: Gradient | null;
  onChange: (gradient: Gradient) => void;
}

const PRESET_GRADIENTS: Gradient[] = [
  { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#8b5cf6' }] },
  { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ec4899' }, { offset: 1, color: '#f97316' }] },
  { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#10b981' }, { offset: 1, color: '#06b6d4' }] },
  { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#fbbf24' }, { offset: 1, color: '#ef4444' }] },
  { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#1e293b' }, { offset: 1, color: '#475569' }] },
  { type: 'radial', angle: 0, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#3b82f6' }] },
];

const DEFAULT_GRADIENT: Gradient = {
  type: 'linear',
  angle: 90,
  stops: [
    { offset: 0, color: '#3b82f6' },
    { offset: 1, color: '#8b5cf6' },
  ],
};

export function GradientPicker({ value, onChange }: GradientPickerProps) {
  const gradient = value ?? DEFAULT_GRADIENT;
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);

  const gradientString = useMemo(() => {
    const stopsStr = gradient.stops
      .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
      .join(', ');

    return gradient.type === 'linear'
      ? `linear-gradient(${gradient.angle}deg, ${stopsStr})`
      : `radial-gradient(circle, ${stopsStr})`;
  }, [gradient]);

  const handleTypeChange = useCallback((type: 'linear' | 'radial') => {
    onChange({ ...gradient, type });
  }, [gradient, onChange]);

  const handleAngleChange = useCallback((angle: number) => {
    onChange({ ...gradient, angle });
  }, [gradient, onChange]);

  const handleStopColorChange = useCallback((index: number, color: string) => {
    const newStops = [...gradient.stops];
    newStops[index] = { ...newStops[index], color };
    onChange({ ...gradient, stops: newStops });
  }, [gradient, onChange]);

  const handleStopOffsetChange = useCallback((index: number, offset: number) => {
    const newStops = [...gradient.stops];
    newStops[index] = { ...newStops[index], offset };
    newStops.sort((a, b) => a.offset - b.offset);
    const newIndex = newStops.findIndex((s) => s === newStops[index]);
    setSelectedStopIndex(newIndex !== -1 ? newIndex : index);
    onChange({ ...gradient, stops: newStops });
  }, [gradient, onChange]);

  const addStop = useCallback(() => {
    if (gradient.stops.length >= 5) return;

    const midOffset = gradient.stops.length > 1
      ? (gradient.stops[0].offset + gradient.stops[gradient.stops.length - 1].offset) / 2
      : 0.5;

    const newStops = [...gradient.stops, { offset: midOffset, color: '#ffffff' }];
    newStops.sort((a, b) => a.offset - b.offset);
    onChange({ ...gradient, stops: newStops });
    setSelectedStopIndex(newStops.length - 1);
  }, [gradient, onChange]);

  const removeStop = useCallback((index: number) => {
    if (gradient.stops.length <= 2) return;

    const newStops = gradient.stops.filter((_, i) => i !== index);
    onChange({ ...gradient, stops: newStops });
    setSelectedStopIndex(Math.min(selectedStopIndex, newStops.length - 1));
  }, [gradient, onChange, selectedStopIndex]);

  const selectPreset = useCallback((preset: Gradient) => {
    onChange(preset);
    setSelectedStopIndex(0);
  }, [onChange]);

  return (
    <div className="space-y-3">
      <div
        className="h-10 rounded-lg border border-input cursor-pointer"
        style={{ background: gradientString }}
      />

      <div className="flex gap-1">
        {PRESET_GRADIENTS.map((preset, index) => {
          const presetStr = preset.type === 'linear'
            ? `linear-gradient(${preset.angle}deg, ${preset.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`
            : `radial-gradient(circle, ${preset.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`;

          return (
            <button
              key={index}
              onClick={() => selectPreset(preset)}
              className="w-8 h-8 rounded border border-input hover:border-primary transition-colors"
              style={{ background: presetStr }}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => handleTypeChange('linear')}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            gradient.type === 'linear'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
        >
          Linear
        </button>
        <button
          onClick={() => handleTypeChange('radial')}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            gradient.type === 'radial'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
        >
          Radial
        </button>
      </div>

      {gradient.type === 'linear' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-muted-foreground">Angle</label>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{gradient.angle}°</span>
              <button
                onClick={() => handleAngleChange((gradient.angle + 45) % 360)}
                className="p-0.5 rounded hover:bg-accent transition-colors"
              >
                <RotateCw size={12} className="text-muted-foreground" />
              </button>
            </div>
          </div>
          <Slider
            value={[gradient.angle]}
            onValueChange={([angle]) => handleAngleChange(angle)}
            min={0}
            max={360}
            step={1}
          />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-muted-foreground">Color Stops</label>
          <button
            onClick={addStop}
            disabled={gradient.stops.length >= 5}
            className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Plus size={12} className="text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-2">
          {gradient.stops.map((stop, index) => (
            <div
              key={index}
              className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                selectedStopIndex === index ? 'bg-secondary' : 'hover:bg-secondary/50'
              }`}
              onClick={() => setSelectedStopIndex(index)}
            >
              <input
                type="color"
                value={stop.color}
                onChange={(e) => handleStopColorChange(index, e.target.value)}
                className="w-6 h-6 rounded border border-input cursor-pointer"
              />
              <div className="flex-1">
                <Slider
                  value={[stop.offset * 100]}
                  onValueChange={([offset]) => handleStopOffsetChange(index, offset / 100)}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <span className="text-[10px] text-muted-foreground w-8 text-right">
                {Math.round(stop.offset * 100)}%
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeStop(index);
                }}
                disabled={gradient.stops.length <= 2}
                className="p-1 rounded hover:bg-destructive/20 transition-colors disabled:opacity-50"
              >
                <Trash2 size={12} className="text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
