import { useState, useCallback, useRef, useEffect } from 'react';
import { Pipette, Check } from 'lucide-react';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  showAlpha?: boolean;
  recentColors?: string[];
  onRecentColorAdd?: (color: string) => void;
}

interface HSV {
  h: number;
  s: number;
  v: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  h /= 360;
  s /= 100;
  v /= 100;
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

export function ColorPicker({
  color,
  onChange,
  showAlpha = false,
  recentColors = [],
  onRecentColorAdd,
}: ColorPickerProps) {
  const [isPickingColor, setIsPickingColor] = useState(false);
  const svPanelRef = useRef<HTMLDivElement>(null);
  const hueSliderRef = useRef<HTMLDivElement>(null);
  const alphaSliderRef = useRef<HTMLDivElement>(null);

  const rgb = hexToRgb(color.slice(0, 7));
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const alpha = color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1;

  const [localHsv, setLocalHsv] = useState<HSV>(hsv);
  const [localAlpha, setLocalAlpha] = useState(alpha);
  const [hexInput, setHexInput] = useState(color.slice(0, 7));
  const [inputMode, setInputMode] = useState<'hex' | 'rgb'>('hex');

  useEffect(() => {
    const newRgb = hexToRgb(color.slice(0, 7));
    const newHsv = rgbToHsv(newRgb.r, newRgb.g, newRgb.b);
    setLocalHsv(newHsv);
    setHexInput(color.slice(0, 7));
    if (color.length === 9) {
      setLocalAlpha(parseInt(color.slice(7, 9), 16) / 255);
    }
  }, [color]);

  const updateColor = useCallback(
    (h: number, s: number, v: number, a: number = localAlpha) => {
      const newRgb = hsvToRgb(h, s, v);
      let newColor = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
      if (showAlpha && a < 1) {
        newColor += Math.round(a * 255).toString(16).padStart(2, '0');
      }
      onChange(newColor);
      setLocalHsv({ h, s, v });
      setLocalAlpha(a);
    },
    [onChange, showAlpha, localAlpha]
  );

  const handleSVPanelMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const panel = svPanelRef.current;
      if (!panel) return;

      const updateFromEvent = (event: MouseEvent | React.MouseEvent) => {
        const rect = panel.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        updateColor(localHsv.h, x * 100, (1 - y) * 100);
      };

      updateFromEvent(e);

      const handleMouseMove = (event: MouseEvent) => updateFromEvent(event);
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [localHsv.h, updateColor]
  );

  const handleHueSliderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const slider = hueSliderRef.current;
      if (!slider) return;

      const updateFromEvent = (event: MouseEvent | React.MouseEvent) => {
        const rect = slider.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        updateColor(x * 360, localHsv.s, localHsv.v);
      };

      updateFromEvent(e);

      const handleMouseMove = (event: MouseEvent) => updateFromEvent(event);
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [localHsv.s, localHsv.v, updateColor]
  );

  const handleAlphaSliderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const slider = alphaSliderRef.current;
      if (!slider) return;

      const updateFromEvent = (event: MouseEvent | React.MouseEvent) => {
        const rect = slider.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        updateColor(localHsv.h, localHsv.s, localHsv.v, x);
      };

      updateFromEvent(e);

      const handleMouseMove = (event: MouseEvent) => updateFromEvent(event);
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [localHsv.h, localHsv.s, localHsv.v, updateColor]
  );

  const handleHexInputChange = (value: string) => {
    setHexInput(value);
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      const newRgb = hexToRgb(value);
      const newHsv = rgbToHsv(newRgb.r, newRgb.g, newRgb.b);
      updateColor(newHsv.h, newHsv.s, newHsv.v);
      onRecentColorAdd?.(value);
    }
  };

  const handleRgbInputChange = (channel: 'r' | 'g' | 'b', value: number) => {
    const newRgb = { ...rgb, [channel]: Math.max(0, Math.min(255, value)) };
    const newHsv = rgbToHsv(newRgb.r, newRgb.g, newRgb.b);
    updateColor(newHsv.h, newHsv.s, newHsv.v);
  };

  const handleEyedropper = async () => {
    if (!('EyeDropper' in window)) {
      return;
    }

    setIsPickingColor(true);
    try {
      const eyeDropper = new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper();
      const result = await eyeDropper.open();
      const newRgb = hexToRgb(result.sRGBHex);
      const newHsv = rgbToHsv(newRgb.r, newRgb.g, newRgb.b);
      updateColor(newHsv.h, newHsv.s, newHsv.v);
      onRecentColorAdd?.(result.sRGBHex);
    } catch {
      // User cancelled
    } finally {
      setIsPickingColor(false);
    }
  };

  const hueColor = hsvToRgb(localHsv.h, 100, 100);
  const currentRgb = hsvToRgb(localHsv.h, localHsv.s, localHsv.v);

  return (
    <div className="space-y-3">
      <div
        ref={svPanelRef}
        className="relative w-full h-32 rounded-lg cursor-crosshair"
        style={{
          backgroundColor: rgbToHex(hueColor.r, hueColor.g, hueColor.b),
        }}
        onMouseDown={handleSVPanelMouseDown}
      >
        <div
          className="absolute inset-0 rounded-lg"
          style={{
            background: 'linear-gradient(to right, white, transparent)',
          }}
        />
        <div
          className="absolute inset-0 rounded-lg"
          style={{
            background: 'linear-gradient(to top, black, transparent)',
          }}
        />
        <div
          className="absolute w-4 h-4 border-2 border-white rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${localHsv.s}%`,
            top: `${100 - localHsv.v}%`,
            backgroundColor: rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b),
          }}
        />
      </div>

      <div
        ref={hueSliderRef}
        className="relative h-3 rounded-full cursor-pointer"
        style={{
          background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
        }}
        onMouseDown={handleHueSliderMouseDown}
      >
        <div
          className="absolute w-4 h-4 border-2 border-white rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${(localHsv.h / 360) * 100}%`,
            top: '50%',
            backgroundColor: rgbToHex(hueColor.r, hueColor.g, hueColor.b),
          }}
        />
      </div>

      {showAlpha && (
        <div
          ref={alphaSliderRef}
          className="relative h-3 rounded-full cursor-pointer"
          style={{
            background: `linear-gradient(to right, transparent, ${rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b)}), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect fill='%23ccc' width='4' height='4'/%3E%3Crect fill='%23fff' x='4' width='4' height='4'/%3E%3Crect fill='%23fff' y='4' width='4' height='4'/%3E%3Crect fill='%23ccc' x='4' y='4' width='4' height='4'/%3E%3C/svg%3E")`,
          }}
          onMouseDown={handleAlphaSliderMouseDown}
        >
          <div
            className="absolute w-4 h-4 border-2 border-white rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${localAlpha * 100}%`,
              top: '50%',
              backgroundColor: rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b),
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-md border border-border shadow-inner"
          style={{
            backgroundColor: rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b),
            opacity: localAlpha,
          }}
        />

        {'EyeDropper' in window && (
          <button
            onClick={handleEyedropper}
            disabled={isPickingColor}
            className={`p-2 rounded-md transition-colors ${
              isPickingColor
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            <Pipette size={14} />
          </button>
        )}

        <div className="flex-1">
          <div className="flex gap-1 mb-1">
            <button
              onClick={() => setInputMode('hex')}
              className={`px-2 py-0.5 text-[9px] font-medium rounded transition-colors ${
                inputMode === 'hex' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              HEX
            </button>
            <button
              onClick={() => setInputMode('rgb')}
              className={`px-2 py-0.5 text-[9px] font-medium rounded transition-colors ${
                inputMode === 'rgb' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              RGB
            </button>
          </div>

          {inputMode === 'hex' ? (
            <input
              type="text"
              value={hexInput}
              onChange={(e) => handleHexInputChange(e.target.value)}
              className="w-full px-2 py-1 text-[11px] font-mono bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="#000000"
            />
          ) : (
            <div className="flex gap-1">
              <input
                type="number"
                value={rgb.r}
                onChange={(e) => handleRgbInputChange('r', Number(e.target.value))}
                min={0}
                max={255}
                className="w-full px-1 py-1 text-[11px] font-mono bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-center"
              />
              <input
                type="number"
                value={rgb.g}
                onChange={(e) => handleRgbInputChange('g', Number(e.target.value))}
                min={0}
                max={255}
                className="w-full px-1 py-1 text-[11px] font-mono bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-center"
              />
              <input
                type="number"
                value={rgb.b}
                onChange={(e) => handleRgbInputChange('b', Number(e.target.value))}
                min={0}
                max={255}
                className="w-full px-1 py-1 text-[11px] font-mono bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-center"
              />
            </div>
          )}
        </div>
      </div>

      {recentColors.length > 0 && (
        <div className="space-y-1">
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Recent</label>
          <div className="flex gap-1 flex-wrap">
            {recentColors.slice(0, 10).map((c, i) => (
              <button
                key={`${c}-${i}`}
                onClick={() => {
                  const newRgb = hexToRgb(c);
                  const newHsv = rgbToHsv(newRgb.r, newRgb.g, newRgb.b);
                  updateColor(newHsv.h, newHsv.s, newHsv.v);
                }}
                className="w-6 h-6 rounded-md border border-border hover:ring-2 hover:ring-primary transition-all relative group"
                style={{ backgroundColor: c }}
              >
                {c === color.slice(0, 7) && (
                  <Check size={12} className="absolute inset-0 m-auto text-white drop-shadow-md" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
