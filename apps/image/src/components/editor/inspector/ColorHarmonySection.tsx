import { useState } from 'react';
import { getAllHarmonies, type HarmonyType } from '../../../utils/color-harmony';
import { Palette, Copy, Check } from 'lucide-react';
import { ColorPalettes, QuickColorSwatches } from '../../ui/ColorPalettes';

interface Props {
  baseColor: string;
  onColorSelect?: (color: string) => void;
}

export function ColorHarmonySection({ baseColor, onColorSelect }: Props) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const [selectedHarmony, setSelectedHarmony] = useState<HarmonyType>('complementary');

  const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(baseColor);
  if (!isValidHex) return null;

  const harmonies = getAllHarmonies(baseColor);
  const activeHarmony = harmonies.find((h) => h.type === selectedHarmony) ?? harmonies[0];

  const handleCopyColor = async (color: string) => {
    try {
      await navigator.clipboard.writeText(color);
      setCopiedColor(color);
      setTimeout(() => setCopiedColor(null), 1500);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Palette size={14} className="text-muted-foreground" />
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Color Harmony
        </h4>
      </div>

      <div className="flex flex-wrap gap-1">
        {harmonies.map((harmony) => (
          <button
            key={harmony.type}
            onClick={() => setSelectedHarmony(harmony.type)}
            className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
              selectedHarmony === harmony.type
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            }`}
          >
            {harmony.name}
          </button>
        ))}
      </div>

      <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
        <div className="flex gap-1.5">
          {activeHarmony.colors.map((color, index) => (
            <div key={index} className="flex-1 flex flex-col items-center gap-1">
              <button
                onClick={() => onColorSelect?.(color)}
                className="w-full aspect-square rounded-lg border border-border hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer"
                style={{ backgroundColor: color }}
                title={`Click to apply ${color}`}
              />
              <button
                onClick={() => handleCopyColor(color)}
                className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {copiedColor === color ? (
                  <Check size={10} className="text-green-500" />
                ) : (
                  <Copy size={10} />
                )}
                <span className="font-mono">{color.toUpperCase()}</span>
              </button>
            </div>
          ))}
        </div>

        <p className="text-[9px] text-muted-foreground text-center">
          Click a color to apply, or copy its hex code
        </p>
      </div>

      {onColorSelect && (
        <>
          <QuickColorSwatches onColorSelect={onColorSelect} selectedColor={baseColor} />
          <ColorPalettes onColorSelect={onColorSelect} selectedColor={baseColor} />
        </>
      )}
    </div>
  );
}
