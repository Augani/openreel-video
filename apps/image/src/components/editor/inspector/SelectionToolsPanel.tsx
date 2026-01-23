import { useState } from 'react';
import { useUIStore } from '../../../stores/ui-store';
import { useSelectionStore } from '../../../stores/selection-store';
import { useProjectStore } from '../../../stores/project-store';
import {
  Square,
  Circle,
  Lasso,
  Pentagon,
  Wand2,
  Plus,
  Minus,
  BoxSelect,
  Trash2,
  RotateCcw,
  Download,
  Upload,
  ChevronDown,
  X,
} from 'lucide-react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step = 1, onChange }: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {value.toFixed(step < 1 ? 1 : 0)}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-2.5
          [&::-webkit-slider-thumb]:h-2.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:cursor-pointer"
        style={{
          background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${percentage}%, hsl(var(--secondary)) ${percentage}%, hsl(var(--secondary)) 100%)`,
        }}
      />
    </div>
  );
}

export function SelectionToolsPanel() {
  const {
    activeTool,
    setActiveTool,
    selectionToolSettings,
    setSelectionToolSettings,
    magicWandSettings,
    setMagicWandSettings,
  } = useUIStore();

  const {
    active: selection,
    saved: savedSelections,
    clearSelection,
    invertSelection,
    featherSelection,
    expandSelection,
    contractSelection,
    saveSelection,
    loadSelection,
    deleteSelection,
  } = useSelectionStore();

  const [showLoadMenu, setShowLoadMenu] = useState(false);

  const { project } = useProjectStore();
  const artboard = project?.artboards?.find((a) => a.id === project.activeArtboardId);
  const canvasBounds = artboard
    ? { x: 0, y: 0, width: artboard.size.width, height: artboard.size.height }
    : { x: 0, y: 0, width: 1920, height: 1080 };

  const isSelectionTool = [
    'marquee-rect',
    'marquee-ellipse',
    'lasso',
    'lasso-polygon',
    'magic-wand',
  ].includes(activeTool);

  const hasSelection = selection !== null;

  const selectionTools = [
    { id: 'marquee-rect' as const, icon: Square, label: 'Rectangular' },
    { id: 'marquee-ellipse' as const, icon: Circle, label: 'Elliptical' },
    { id: 'lasso' as const, icon: Lasso, label: 'Lasso' },
    { id: 'lasso-polygon' as const, icon: Pentagon, label: 'Polygonal' },
    { id: 'magic-wand' as const, icon: Wand2, label: 'Magic Wand' },
  ];

  const selectionModes = [
    { id: 'new' as const, icon: Square, label: 'New' },
    { id: 'add' as const, icon: Plus, label: 'Add' },
    { id: 'subtract' as const, icon: Minus, label: 'Subtract' },
    { id: 'intersect' as const, icon: BoxSelect, label: 'Intersect' },
  ];

  if (!isSelectionTool && !hasSelection) {
    return null;
  }

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2">
        <span className="text-xs font-medium">Selection Tools</span>
      </div>

      <div className="px-3 pb-3 space-y-3">
        <div className="flex flex-wrap gap-1">
          {selectionTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`p-1.5 rounded transition-colors ${
                activeTool === tool.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
              title={tool.label}
            >
              <tool.icon size={14} />
            </button>
          ))}
        </div>

        {isSelectionTool && (
          <>
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground font-medium">Mode</span>
              <div className="flex gap-1">
                {selectionModes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setSelectionToolSettings({ mode: mode.id })}
                    className={`flex-1 px-2 py-1.5 text-[10px] rounded transition-colors ${
                      selectionToolSettings.mode === mode.id
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <Slider
              label="Feather"
              value={selectionToolSettings.feather}
              min={0}
              max={100}
              onChange={(v) => setSelectionToolSettings({ feather: v })}
            />

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectionToolSettings.antiAlias}
                onChange={(e) => setSelectionToolSettings({ antiAlias: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-border"
              />
              <span className="text-[10px] text-muted-foreground">Anti-alias</span>
            </label>

            {activeTool === 'magic-wand' && (
              <div className="space-y-2.5 pt-2 border-t border-border">
                <Slider
                  label="Tolerance"
                  value={magicWandSettings.tolerance}
                  min={0}
                  max={255}
                  onChange={(v) => setMagicWandSettings({ tolerance: v })}
                />

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={magicWandSettings.contiguous}
                    onChange={(e) => setMagicWandSettings({ contiguous: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-border"
                  />
                  <span className="text-[10px] text-muted-foreground">Contiguous</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={magicWandSettings.sampleAllLayers}
                    onChange={(e) => setMagicWandSettings({ sampleAllLayers: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-border"
                  />
                  <span className="text-[10px] text-muted-foreground">Sample All Layers</span>
                </label>
              </div>
            )}
          </>
        )}

        {hasSelection && (
          <div className="space-y-2.5 pt-2 border-t border-border">
            <span className="text-[10px] text-muted-foreground font-medium">Selection Actions</span>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => invertSelection(canvasBounds)}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <RotateCcw size={10} />
                Invert
              </button>
              <button
                onClick={() => clearSelection()}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <Trash2 size={10} />
                Deselect
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <button
                  onClick={() => expandSelection(1)}
                  className="flex-1 px-2 py-1.5 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  Expand
                </button>
                <button
                  onClick={() => contractSelection(1)}
                  className="flex-1 px-2 py-1.5 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  Contract
                </button>
              </div>
              <button
                onClick={() => featherSelection(selectionToolSettings.feather || 5)}
                className="w-full px-2 py-1.5 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors"
              >
                Feather ({selectionToolSettings.feather || 5}px)
              </button>
            </div>

            <div className="flex gap-1.5">
              <button
                onClick={() => saveSelection(`Selection ${savedSelections.length + 1}`)}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors"
                title="Save Selection"
              >
                <Download size={10} />
                Save
              </button>
              <div className="flex-1 relative">
                <button
                  onClick={() => setShowLoadMenu(!showLoadMenu)}
                  disabled={savedSelections.length === 0}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Load Selection"
                >
                  <Upload size={10} />
                  Load
                  {savedSelections.length > 0 && (
                    <ChevronDown size={8} className={`transition-transform ${showLoadMenu ? 'rotate-180' : ''}`} />
                  )}
                </button>
                {showLoadMenu && savedSelections.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-10 max-h-32 overflow-y-auto">
                    {savedSelections.map((sel, idx) => (
                      <div
                        key={sel.id}
                        className="flex items-center justify-between px-2 py-1.5 hover:bg-secondary/50 group"
                      >
                        <button
                          onClick={() => {
                            loadSelection(sel.id);
                            setShowLoadMenu(false);
                          }}
                          className="flex-1 text-left text-[10px] text-foreground truncate"
                        >
                          Selection {idx + 1}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSelection(sel.id);
                          }}
                          className="p-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
