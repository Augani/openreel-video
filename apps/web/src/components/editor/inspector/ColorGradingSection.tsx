import React, { useCallback, useMemo } from "react";
import { ChevronDown, RotateCcw, Sun, Thermometer } from "lucide-react";
import { LabeledSlider } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import type {
  ColorWheelValues,
  HSLValues,
  CurvesValues,
  LUTData,
} from "@openreel/core";
import {
  DEFAULT_COLOR_WHEELS,
  DEFAULT_HSL,
  DEFAULT_CURVES,
} from "@openreel/core";
import { ColorWheelsControl } from "./ColorWheelsControl";
import { CurvesEditor } from "./CurvesEditor";
import { LUTLoader } from "./LUTLoader";
import { HSLControls } from "./HSLControls";

const WHITE_BALANCE_PRESETS: Array<{
  label: string;
  temperature: number;
  tint: number;
}> = [
  { label: "Tungsten", temperature: -40, tint: 8 },
  { label: "Fluorescent", temperature: -15, tint: -10 },
  { label: "Daylight", temperature: 0, tint: 0 },
  { label: "Cloudy", temperature: 15, tint: 0 },
  { label: "Shade", temperature: 30, tint: 5 },
];

const SubSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full p-2 bg-background-tertiary hover:bg-background-tertiary/80 transition-colors"
      >
        <ChevronDown
          size={12}
          className={`transition-transform ${
            isOpen ? "" : "-rotate-90"
          } text-text-muted`}
        />
        <span className="text-[10px] font-medium text-text-primary">
          {title}
        </span>
      </button>
      {isOpen && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
};

interface ColorGradingSectionProps {
  clipId: string;
}

export const ColorGradingSection: React.FC<ColorGradingSectionProps> = ({
  clipId,
}) => {
  const { getColorGrading, updateColorGrading, resetColorGrading } =
    useProjectStore();

  const modifiedAt = useProjectStore((state) => state.project.modifiedAt);

  const colorGrading = useMemo(
    () => getColorGrading(clipId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipId, getColorGrading, modifiedAt],
  );

  const colorWheelValues: ColorWheelValues = useMemo(() => {
    return colorGrading.colorWheels || { ...DEFAULT_COLOR_WHEELS };
  }, [colorGrading.colorWheels]);

  const hslValues: HSLValues = useMemo(() => {
    return colorGrading.hsl || { ...DEFAULT_HSL };
  }, [colorGrading.hsl]);

  const curvesValues: CurvesValues = useMemo(() => {
    return colorGrading.curves || { ...DEFAULT_CURVES };
  }, [colorGrading.curves]);

  const temperatureValue = colorGrading.temperature ?? 0;
  const tintValue = colorGrading.tint ?? 0;

  const handleTemperatureChange = useCallback(
    (value: number) => {
      updateColorGrading(clipId, { temperature: value });
    },
    [clipId, updateColorGrading],
  );

  const handleTintChange = useCallback(
    (value: number) => {
      updateColorGrading(clipId, { tint: value });
    },
    [clipId, updateColorGrading],
  );

  const handleWhiteBalanceReset = useCallback(() => {
    updateColorGrading(clipId, { temperature: 0, tint: 0 });
  }, [clipId, updateColorGrading]);

  const handleWhiteBalancePreset = useCallback(
    (preset: { temperature: number; tint: number }) => {
      updateColorGrading(clipId, {
        temperature: preset.temperature,
        tint: preset.tint,
      });
    },
    [clipId, updateColorGrading],
  );

  const handleColorWheelsChange = useCallback(
    (values: ColorWheelValues) => {
      updateColorGrading(clipId, { colorWheels: values });
    },
    [clipId, updateColorGrading],
  );

  const handleColorWheelsReset = useCallback(() => {
    updateColorGrading(clipId, { colorWheels: { ...DEFAULT_COLOR_WHEELS } });
  }, [clipId, updateColorGrading]);

  const handleCurvesChange = useCallback(
    (values: CurvesValues) => {
      updateColorGrading(clipId, { curves: values });
    },
    [clipId, updateColorGrading],
  );

  const handleCurvesReset = useCallback(() => {
    updateColorGrading(clipId, { curves: { ...DEFAULT_CURVES } });
  }, [clipId, updateColorGrading]);

  const handleLUTChange = useCallback(
    (lutData: LUTData | null) => {
      updateColorGrading(clipId, { lut: lutData || undefined });
    },
    [clipId, updateColorGrading],
  );

  const handleHSLValuesChange = useCallback(
    (values: HSLValues) => {
      updateColorGrading(clipId, { hsl: values });
    },
    [clipId, updateColorGrading],
  );

  const handleHSLReset = useCallback(() => {
    updateColorGrading(clipId, { hsl: { ...DEFAULT_HSL } });
  }, [clipId, updateColorGrading]);

  const handleResetAll = useCallback(() => {
    resetColorGrading(clipId);
  }, [clipId, resetColorGrading]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={handleResetAll}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
        >
          <RotateCcw size={10} />
          Reset All
        </button>
      </div>

      <SubSection title="White Balance" defaultOpen>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] text-text-muted leading-snug">
              Warm up cool shots or cool down warm ones. Tint corrects green or
              magenta casts.
            </p>
            <button
              onClick={handleWhiteBalanceReset}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-muted hover:text-text-primary transition-colors shrink-0"
              title="Reset white balance"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Thermometer size={12} className="text-text-muted" />
              <LabeledSlider
                label="Temperature"
                value={temperatureValue}
                onChange={handleTemperatureChange}
                min={-100}
                max={100}
                step={1}
                className="flex-1"
              />
            </div>
            <div className="h-1 rounded-full pointer-events-none mx-5"
              style={{
                background:
                  "linear-gradient(to right, #4aa8ff 0%, #cccccc 50%, #ff9a3c 100%)",
                opacity: 0.7,
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Sun size={12} className="text-text-muted" />
              <LabeledSlider
                label="Tint"
                value={tintValue}
                onChange={handleTintChange}
                min={-100}
                max={100}
                step={1}
                className="flex-1"
              />
            </div>
            <div className="h-1 rounded-full pointer-events-none mx-5"
              style={{
                background:
                  "linear-gradient(to right, #4ad17f 0%, #cccccc 50%, #d44ad1 100%)",
                opacity: 0.7,
              }}
            />
          </div>

          <div className="pt-1">
            <span className="text-[10px] text-text-muted block mb-1.5">
              Presets
            </span>
            <div className="grid grid-cols-5 gap-1">
              {WHITE_BALANCE_PRESETS.map((preset) => {
                const isActive =
                  Math.abs(preset.temperature - temperatureValue) < 0.5 &&
                  Math.abs(preset.tint - tintValue) < 0.5;
                return (
                  <button
                    key={preset.label}
                    onClick={() => handleWhiteBalancePreset(preset)}
                    className={`py-1 rounded text-[9px] transition-colors ${
                      isActive
                        ? "bg-primary text-white"
                        : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
                    }`}
                    title={`Temp: ${preset.temperature}, Tint: ${preset.tint}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </SubSection>

      <SubSection title="Color Wheels" defaultOpen={false}>
        <ColorWheelsControl
          values={colorWheelValues}
          onChange={handleColorWheelsChange}
          onReset={handleColorWheelsReset}
        />
      </SubSection>

      <SubSection title="Curves">
        <CurvesEditor
          values={curvesValues}
          onChange={handleCurvesChange}
          onReset={handleCurvesReset}
        />
      </SubSection>

      <SubSection title="LUT">
        <LUTLoader
          lutData={colorGrading.lut as LUTData | null}
          onChange={handleLUTChange}
        />
      </SubSection>

      <SubSection title="HSL">
        <HSLControls
          values={hslValues}
          onChange={handleHSLValuesChange}
          onReset={handleHSLReset}
        />
      </SubSection>
    </div>
  );
};

export default ColorGradingSection;
