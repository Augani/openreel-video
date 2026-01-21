import React, { useCallback, useState, useMemo } from "react";
import {
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  Plus,
  GripVertical,
  ChevronDown,
} from "lucide-react";
import type { PhotoBlendMode, PhotoLayer } from "@openreel/core";
import {
  LabeledSlider as Slider,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@openreel/ui";

const BLEND_MODES: { value: PhotoBlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "softLight", label: "Soft Light" },
  { value: "hardLight", label: "Hard Light" },
  { value: "colorDodge", label: "Color Dodge" },
  { value: "colorBurn", label: "Color Burn" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

const BlendModeSelector: React.FC<{
  value: PhotoBlendMode;
  onChange: (mode: PhotoBlendMode) => void;
}> = ({ value, onChange }) => {
  const selectedMode =
    BLEND_MODES.find((m) => m.value === value) || BLEND_MODES[0];

  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-text-secondary">Blend Mode</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 px-2 py-1 text-[10px] bg-background-tertiary border border-border rounded hover:border-primary transition-colors">
            <span className="text-text-primary">{selectedMode.label}</span>
            <ChevronDown size={12} className="text-text-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32 max-h-48 overflow-y-auto">
          {BLEND_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode.value}
              onClick={() => onChange(mode.value)}
              className={`text-[10px] ${
                mode.value === value ? "text-primary bg-background-tertiary" : ""
              }`}
            >
              {mode.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

/**
 * Layer Item Component
 */
const LayerItem: React.FC<{
  layer: PhotoLayer;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  draggable: boolean;
}> = ({
  layer,
  isSelected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDragStart,
  onDragOver,
  onDrop,
  draggable,
}) => {
  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/20 border border-primary"
          : "bg-background-tertiary border border-transparent hover:border-border"
      }`}
      onClick={onSelect}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Drag Handle */}
      <div className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary">
        <GripVertical size={14} />
      </div>

      {/* Layer Thumbnail */}
      <div className="w-8 h-8 bg-background-secondary rounded border border-border flex items-center justify-center overflow-hidden">
        {layer.content ? (
          <div className="w-full h-full bg-checkerboard" />
        ) : (
          <Layers size={14} className="text-text-muted" />
        )}
      </div>

      {/* Layer Name */}
      <div className="flex-1 min-w-0">
        <span
          className={`text-[10px] font-medium truncate block ${
            layer.visible ? "text-text-primary" : "text-text-muted"
          }`}
        >
          {layer.name}
        </span>
        <span className="text-[9px] text-text-muted capitalize">
          {layer.type}
        </span>
      </div>

      {/* Layer Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          className={`p-1 rounded transition-colors ${
            layer.visible
              ? "text-text-secondary hover:text-text-primary"
              : "text-text-muted hover:text-text-secondary"
          }`}
          title={layer.visible ? "Hide layer" : "Show layer"}
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          className={`p-1 rounded transition-colors ${
            layer.locked
              ? "text-warning hover:text-warning/80"
              : "text-text-muted hover:text-text-secondary"
          }`}
          title={layer.locked ? "Unlock layer" : "Lock layer"}
        >
          {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
      </div>
    </div>
  );
};

/**
 * PhotoLayersSection Props
 */
interface PhotoLayersSectionProps {
  layers: PhotoLayer[];
  selectedLayerIndex: number;
  onSelectLayer: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  onSetOpacity: (layerId: string, opacity: number) => void;
  onSetBlendMode: (layerId: string, blendMode: PhotoBlendMode) => void;
  onReorderLayers: (fromIndex: number, toIndex: number) => void;
  onAddLayer: () => void;
  onDeleteLayer: (layerId: string) => void;
  onDuplicateLayer: (layerId: string) => void;
}

/**
 * PhotoLayersSection Component
 *
 * - 18.1: Display layer list with image content
 * - 18.2: Add new layers above current layer
 * - 18.3: Reorder layers via drag and drop
 * - 18.4: Adjust layer opacity
 * - 18.5: Toggle layer visibility
 */
export const PhotoLayersSection: React.FC<PhotoLayersSectionProps> = ({
  layers,
  selectedLayerIndex,
  onSelectLayer,
  onToggleVisibility,
  onToggleLock,
  onSetOpacity,
  onSetBlendMode,
  onReorderLayers,
  onAddLayer,
  onDeleteLayer,
  onDuplicateLayer,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Get selected layer
  const selectedLayer = useMemo(() => {
    if (selectedLayerIndex >= 0 && selectedLayerIndex < layers.length) {
      return layers[selectedLayerIndex];
    }
    return null;
  }, [layers, selectedLayerIndex]);

  // Handle drag start
  const handleDragStart = useCallback(
    (index: number) => (e: React.DragEvent) => {
      setDraggedIndex(index);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", index.toString());
    },
    [],
  );

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (toIndex: number) => (e: React.DragEvent) => {
      e.preventDefault();
      if (draggedIndex !== null && draggedIndex !== toIndex) {
        onReorderLayers(draggedIndex, toIndex);
      }
      setDraggedIndex(null);
    },
    [draggedIndex, onReorderLayers],
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
  }, []);

  if (layers.length === 0) {
    return (
      <div className="p-4 text-center">
        <Layers size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-[10px] text-text-muted">No layers</p>
        <button
          onClick={onAddLayer}
          className="mt-2 px-3 py-1.5 text-[10px] bg-primary text-white rounded hover:bg-primary/90 transition-colors"
        >
          Add Layer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Layer List Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-secondary font-medium">
          Layers ({layers.length})
        </span>
        <button
          onClick={onAddLayer}
          className="p-1 text-text-muted hover:text-text-primary transition-colors"
          title="Add new layer"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Layer List - Reversed to show top layers first */}
      <div className="space-y-1" onDragEnd={handleDragEnd}>
        {[...layers].reverse().map((layer, reversedIndex) => {
          const actualIndex = layers.length - 1 - reversedIndex;
          return (
            <LayerItem
              key={layer.id}
              layer={layer}
              isSelected={actualIndex === selectedLayerIndex}
              onSelect={() => onSelectLayer(layer.id)}
              onToggleVisibility={() => onToggleVisibility(layer.id)}
              onToggleLock={() => onToggleLock(layer.id)}
              onDragStart={handleDragStart(actualIndex)}
              onDragOver={handleDragOver}
              onDrop={handleDrop(actualIndex)}
              draggable={!layer.locked}
            />
          );
        })}
      </div>

      {/* Selected Layer Properties */}
      {selectedLayer && (
        <div className="space-y-3 pt-3 border-t border-border">
          <span className="text-[10px] text-text-secondary font-medium">
            Layer Properties
          </span>

          {/* Opacity Slider */}
          <Slider
            label="Opacity"
            value={selectedLayer.opacity * 100}
            onChange={(value) => onSetOpacity(selectedLayer.id, value / 100)}
            min={0}
            max={100}
            unit="%"
          />

          {/* Blend Mode Selector */}
          <BlendModeSelector
            value={selectedLayer.blendMode}
            onChange={(mode) => onSetBlendMode(selectedLayer.id, mode)}
          />

          {/* Layer Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => onDuplicateLayer(selectedLayer.id)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] bg-background-tertiary border border-border rounded hover:border-primary transition-colors"
              title="Duplicate layer"
            >
              <Copy size={12} />
              <span>Duplicate</span>
            </button>
            <button
              onClick={() => onDeleteLayer(selectedLayer.id)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] bg-background-tertiary border border-border rounded hover:border-error text-error transition-colors"
              title="Delete layer"
              disabled={layers.length <= 1}
            >
              <Trash2 size={12} />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoLayersSection;
