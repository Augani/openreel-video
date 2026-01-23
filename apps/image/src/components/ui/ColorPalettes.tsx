import { useState } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@openreel/ui';
import { ChevronDown, Palette } from 'lucide-react';

export interface ColorPalette {
  id: string;
  name: string;
  colors: string[];
}

export const PRESET_PALETTES: ColorPalette[] = [
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    colors: ['#ffffff', '#f5f5f5', '#d4d4d4', '#737373', '#262626', '#000000'],
  },
  {
    id: 'ocean-breeze',
    name: 'Ocean Breeze',
    colors: ['#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd', '#e0f2fe', '#f0f9ff'],
  },
  {
    id: 'sunset-glow',
    name: 'Sunset Glow',
    colors: ['#dc2626', '#f97316', '#facc15', '#fde047', '#fef08a', '#fefce8'],
  },
  {
    id: 'forest-green',
    name: 'Forest Green',
    colors: ['#14532d', '#166534', '#22c55e', '#4ade80', '#86efac', '#dcfce7'],
  },
  {
    id: 'royal-purple',
    name: 'Royal Purple',
    colors: ['#581c87', '#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe', '#f5f3ff'],
  },
  {
    id: 'warm-earth',
    name: 'Warm Earth',
    colors: ['#78350f', '#a16207', '#ca8a04', '#facc15', '#fde68a', '#fefce8'],
  },
  {
    id: 'cool-slate',
    name: 'Cool Slate',
    colors: ['#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1'],
  },
  {
    id: 'rose-garden',
    name: 'Rose Garden',
    colors: ['#881337', '#be123c', '#f43f5e', '#fb7185', '#fda4af', '#ffe4e6'],
  },
  {
    id: 'neon-nights',
    name: 'Neon Nights',
    colors: ['#0d0d0d', '#7c3aed', '#ec4899', '#22d3ee', '#a3e635', '#fbbf24'],
  },
  {
    id: 'pastel-dreams',
    name: 'Pastel Dreams',
    colors: ['#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#f3e8ff', '#ffe4e6'],
  },
  {
    id: 'monochrome-blue',
    name: 'Monochrome Blue',
    colors: ['#172554', '#1e3a8a', '#2563eb', '#60a5fa', '#93c5fd', '#dbeafe'],
  },
  {
    id: 'autumn-harvest',
    name: 'Autumn Harvest',
    colors: ['#7c2d12', '#c2410c', '#ea580c', '#fb923c', '#fdba74', '#fed7aa'],
  },
];

interface ColorPalettesProps {
  onColorSelect: (color: string) => void;
  selectedColor?: string;
}

export function ColorPalettes({ onColorSelect, selectedColor }: ColorPalettesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedPalette, setExpandedPalette] = useState<string | null>(null);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
          <div className="flex items-center gap-2">
            <Palette size={14} className="text-muted-foreground" />
            <span className="text-xs font-medium">Color Palettes</span>
          </div>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-2 space-y-2 bg-background/50 rounded-b-lg border border-t-0 border-border max-h-[300px] overflow-y-auto">
          {PRESET_PALETTES.map((palette) => (
            <div key={palette.id} className="space-y-1">
              <button
                onClick={() => setExpandedPalette(expandedPalette === palette.id ? null : palette.id)}
                className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-secondary/50 transition-colors"
              >
                <span className="text-[10px] text-muted-foreground">{palette.name}</span>
                <div className="flex gap-0.5">
                  {palette.colors.slice(0, 6).map((color, i) => (
                    <div
                      key={i}
                      className="w-3 h-3 rounded-sm border border-border/50"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </button>
              {expandedPalette === palette.id && (
                <div className="grid grid-cols-6 gap-1 px-2 pb-1">
                  {palette.colors.map((color, i) => (
                    <button
                      key={i}
                      onClick={() => onColorSelect(color)}
                      className={`w-full aspect-square rounded border transition-all hover:scale-110 ${
                        selectedColor === color
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-border/50 hover:border-border'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface QuickColorSwatchesProps {
  onColorSelect: (color: string) => void;
  selectedColor?: string;
}

export function QuickColorSwatches({ onColorSelect, selectedColor }: QuickColorSwatchesProps) {
  const quickColors = [
    '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#1f2937',
  ];

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-muted-foreground">Quick Colors</label>
      <div className="grid grid-cols-6 gap-1">
        {quickColors.map((color) => (
          <button
            key={color}
            onClick={() => onColorSelect(color)}
            className={`w-full aspect-square rounded border transition-all hover:scale-110 ${
              selectedColor === color
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-border/50 hover:border-border'
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
    </div>
  );
}
