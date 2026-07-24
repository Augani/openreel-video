import React, { useCallback, useRef, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { RotateCcw } from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import type { ColorWheelValues } from "@openreel/core";

export const DEFAULT_COLOR_WHEEL_VALUES: ColorWheelValues = {
  shadows: { r: 0, g: 0, b: 0 },
  midtones: { r: 0, g: 0, b: 0 },
  highlights: { r: 0, g: 0, b: 0 },
  shadowsLift: 0,
  midtonesGamma: 1,
  highlightsGain: 1,
};

interface ColorWheelsControlProps {
  values: ColorWheelValues;
  onChange: (values: ColorWheelValues) => void;
  onReset?: () => void;
}

interface ColorWheelProps {
  label: string;
  color: { r: number; g: number; b: number };
  onChange: (color: { r: number; g: number; b: number }) => void;
  onReset: () => void;
}

const LGGSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
}> = ({ label, value, onChange, min, max, defaultValue, step = 0.01 }) => {
  const handleDoubleClick = useCallback(() => {
    onChange(defaultValue);
  }, [onChange, defaultValue]);

  return (
    <div onDoubleClick={handleDoubleClick}>
      <PropertySlider
        label={label}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        formatValue={(nextValue) => nextValue.toFixed(2)}
      />
    </div>
  );
};

/**
 * Individual Color Wheel component
 *
 * Display color wheel for tonal range
 * Apply color shift when dragged
 */
const ColorWheel: React.FC<ColorWheelProps> = ({
  label,
  color,
  onChange,
  onReset,
}) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Convert RGB color shift to position on wheel
  const getPositionFromColor = useMemo(() => {
    // Calculate angle from color (simplified - using r and b as x/y)
    const x = color.r;
    const y = -color.b; // Invert b for visual consistency
    const saturation = Math.sqrt(x * x + y * y);
    const angle = Math.atan2(y, x);

    return {
      x: Math.cos(angle) * saturation * 44,
      y: Math.sin(angle) * saturation * 44,
      saturation: Math.min(saturation, 1),
    };
  }, [color.r, color.b]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const wheel = wheelRef.current;
      if (!wheel) return;

      isDragging.current = true;
      const rect = wheel.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const updatePosition = (clientX: number, clientY: number) => {
        const x = (clientX - rect.left - centerX) / centerX;
        const y = (clientY - rect.top - centerY) / centerY;

        // Clamp to unit circle
        const distance = Math.sqrt(x * x + y * y);
        const clampedDistance = Math.min(distance, 1);
        const normalizedX = distance > 0 ? (x / distance) * clampedDistance : 0;
        const normalizedY = distance > 0 ? (y / distance) * clampedDistance : 0;

        // Convert position to RGB color shift
        // Using a simplified mapping: x -> r, -y -> b, derived g
        const r = normalizedX;
        const b = -normalizedY;
        const g = -(r + b) / 2; // Balance to maintain neutral gray

        onChange({ r, g, b });
      };

      updatePosition(e.clientX, e.clientY);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (isDragging.current) {
          updatePosition(moveEvent.clientX, moveEvent.clientY);
        }
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onChange],
  );

  const handleDoubleClick = useCallback(() => {
    onReset();
  }, [onReset]);

  return (
    <div className="flex flex-col items-center gap-2">
      <Text type="supporting" color="secondary" className="text-[10px] uppercase tracking-wider font-medium">
        {label}
      </Text>
      <div
        ref={wheelRef}
        className="w-24 h-24 rounded-full relative cursor-crosshair shadow-inner"
        style={{
          background: `conic-gradient(
 from 90deg,
 hsl(0, 70%, 50%),
 hsl(60, 70%, 50%),
 hsl(120, 70%, 50%),
 hsl(180, 70%, 50%),
 hsl(240, 70%, 50%),
 hsl(300, 70%, 50%),
 hsl(360, 70%, 50%)
 )`,
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="Drag to adjust color. Double-click to reset."
      >
        {/* Center gradient overlay for saturation falloff */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 70%)",
          }}
        />
        {/* Indicator dot */}
        <div
          className="absolute w-4 h-4 border-2 border-white rounded-full shadow-md pointer-events-none z-10"
          style={{
            left: `calc(50% + ${getPositionFromColor.x}px - 8px)`,
            top: `calc(50% + ${getPositionFromColor.y}px - 8px)`,
            backgroundColor:
              getPositionFromColor.saturation > 0.1
                ? `rgb(${128 + color.r * 127}, ${128 + color.g * 127}, ${
                    128 + color.b * 127
                  })`
                : "white",
          }}
        />
      </div>
    </div>
  );
};

/**
 * ColorWheelsControl Component
 *
 * - 4.1: Display three color wheels for shadows, midtones, highlights
 * - 4.2: Apply color shift to corresponding tonal range when dragged
 * - 4.3: Modify shadow lift, midtone gamma, and highlight gain
 */
export const ColorWheelsControl: React.FC<ColorWheelsControlProps> = ({
  values,
  onChange,
  onReset,
}) => {
  // Handle color wheel changes
  const handleShadowsChange = useCallback(
    (color: { r: number; g: number; b: number }) => {
      onChange({ ...values, shadows: color });
    },
    [values, onChange],
  );

  const handleMidtonesChange = useCallback(
    (color: { r: number; g: number; b: number }) => {
      onChange({ ...values, midtones: color });
    },
    [values, onChange],
  );

  const handleHighlightsChange = useCallback(
    (color: { r: number; g: number; b: number }) => {
      onChange({ ...values, highlights: color });
    },
    [values, onChange],
  );

  // Handle lift/gamma/gain changes
  const handleLiftChange = useCallback(
    (lift: number) => {
      onChange({ ...values, shadowsLift: lift });
    },
    [values, onChange],
  );

  const handleGammaChange = useCallback(
    (gamma: number) => {
      onChange({ ...values, midtonesGamma: gamma });
    },
    [values, onChange],
  );

  const handleGainChange = useCallback(
    (gain: number) => {
      onChange({ ...values, highlightsGain: gain });
    },
    [values, onChange],
  );

  // Reset handlers for individual wheels
  const resetShadows = useCallback(() => {
    onChange({ ...values, shadows: { r: 0, g: 0, b: 0 } });
  }, [values, onChange]);

  const resetMidtones = useCallback(() => {
    onChange({ ...values, midtones: { r: 0, g: 0, b: 0 } });
  }, [values, onChange]);

  const resetHighlights = useCallback(() => {
    onChange({ ...values, highlights: { r: 0, g: 0, b: 0 } });
  }, [values, onChange]);

  return (
    <div className="space-y-4">
      {/* Reset All Button */}
      {onReset && (
        <div className="flex justify-end">
          <Button
            label="Reset"
            icon={<RotateCcw size={10} />}
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-fg-3 hover:text-fg transition-colors"
          />
        </div>
      )}

      {/* Color Wheels Row */}
      <div className="flex justify-around items-start">
        <ColorWheel
          label="Shadows"
          color={values.shadows}
          onChange={handleShadowsChange}
          onReset={resetShadows}
        />
        <ColorWheel
          label="Midtones"
          color={values.midtones}
          onChange={handleMidtonesChange}
          onReset={resetMidtones}
        />
        <ColorWheel
          label="Highlights"
          color={values.highlights}
          onChange={handleHighlightsChange}
          onReset={resetHighlights}
        />
      </div>

      {/* Lift/Gamma/Gain Sliders */}
      <div className="space-y-2 pt-2 border-t border-border">
        <LGGSlider
          label="Lift (Shadows)"
          value={values.shadowsLift}
          onChange={handleLiftChange}
          min={-1}
          max={1}
          defaultValue={0}
        />
        <LGGSlider
          label="Gamma (Midtones)"
          value={values.midtonesGamma}
          onChange={handleGammaChange}
          min={0.1}
          max={4}
          defaultValue={1}
        />
        <LGGSlider
          label="Gain (Highlights)"
          value={values.highlightsGain}
          onChange={handleGainChange}
          min={0}
          max={4}
          defaultValue={1}
        />
      </div>
    </div>
  );
};

export default ColorWheelsControl;
