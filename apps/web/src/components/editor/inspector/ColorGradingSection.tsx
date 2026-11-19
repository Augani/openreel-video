import React, { Suspense, lazy, useCallback, useEffect, useMemo } from "react";
import { Button } from "@openreel/ui";
import { Card } from "@openreel/ui";


import { PropertySlider } from "./shell/PropertySlider";
import { ChevronDown, Pipette, RotateCcw, Sparkles, Sun, Thermometer } from "@/icons/lucide-compat";
import { Switch } from "@openreel/ui";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";
import type {
  ColorWheelValues,
  HSLValues,
  CurvesValues,
} from "@openreel/core";
import {
  DEFAULT_TONE,
  DEFAULT_VIGNETTE,
  DEFAULT_COLOR_WHEELS,
  DEFAULT_HSL,
  DEFAULT_CURVES,
  createDefaultHueCurves,
  resolveColorPipelineVersion,
  type HueCurvesValues,
} from "@openreel/core";
import { ColorWheelsControl } from "./ColorWheelsControl";
import { CurvesEditor } from "./CurvesEditor";
import { HueCurvesEditor } from "./HueCurvesEditor";
import { useHueCurveKeyframes } from "./useHueCurveKeyframes";
import { ColorLibrarySection } from "./ColorLibrarySection";
import { toast } from "../../../stores/notification-store";
import { EffectPreviewProvider } from "../panels/effect-previews/EffectLivePreview";
import { HSLControls } from "./HSLControls";
import { GradeSliders } from "./BasicCorrectionControls";
import { MatchColorPopover } from "./MatchColorPopover";
import { measureAutoTone } from "../../../services/color-sampling";
import { useClipLookScene } from "./looks/useClipLookScene";
import { LookCompareProvider } from "./looks/compare-context";

const WhiteBalancePresets = lazy(() => import("./looks/WhiteBalancePresets"));

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
    <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-0 overflow-hidden border border-border">
      <Button onClick={() => setIsOpen(!isOpen)} type="button" aria-label={(title).trim() || undefined} className="min-w-0 justify-center rounded-[7px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 text-[12px] text-fg-2 hover:text-fg flex items-center gap-2 w-full p-2 bg-bg-2 hover:bg-bg-2/80 transition-colors">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ChevronDown
            size={12}
            className={`transition-transform ${
              isOpen ? "" : "-rotate-90"
            } text-fg-3`}
          />}</span>
        {(title) ? <span className="truncate">{title}</span> : null}
      </Button>
      {isOpen && <div className="p-3 space-y-3">{children}</div>}
    </Card>
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

  const clipScene = useClipLookScene(clipId);

  const colorWheelValues: ColorWheelValues = useMemo(() => {
    return colorGrading.colorWheels || { ...DEFAULT_COLOR_WHEELS };
  }, [colorGrading.colorWheels]);

  const hslValues: HSLValues = useMemo(() => {
    return colorGrading.hsl || { ...DEFAULT_HSL };
  }, [colorGrading.hsl]);

  const curvesValues: CurvesValues = useMemo(() => {
    return colorGrading.curves || { ...DEFAULT_CURVES };
  }, [colorGrading.curves]);

  // A clip with no grade yet shows (and, on its first edit, gets) the Premiere-order pipeline.
  const pipelineVersion =
    Object.keys(colorGrading).length === 0 ? 2 : resolveColorPipelineVersion(colorGrading);
  const hueCurvesValues: HueCurvesValues = useMemo(
    () => colorGrading.hueCurves || createDefaultHueCurves(),
    [colorGrading.hueCurves],
  );

  const commitHueCurves = useCallback(
    (values: HueCurvesValues) => {
      updateColorGrading(clipId, { hueCurves: values });
    },
    [clipId, updateColorGrading],
  );
  // Keyframed points are drawn at the playhead value; edits to them write keyframes.
  const hueCurveKeyframes = useHueCurveKeyframes(clipId, hueCurvesValues, commitHueCurves);

  const handleHueCurvesReset = useCallback(() => {
    updateColorGrading(clipId, { hueCurves: createDefaultHueCurves() });
  }, [clipId, updateColorGrading]);

  const handlePipelineChange = useCallback(
    (version: 1 | 2) => {
      if (version === pipelineVersion) return;
      void updateColorGrading(clipId, { pipelineVersion: version });
    },
    [clipId, pipelineVersion, updateColorGrading],
  );

  const scopesVisible = useUIStore((state) => state.scopesVisible);
  const setScopesVisible = useUIStore((state) => state.setScopesVisible);

  const temperatureValue = colorGrading.temperature ?? 0;
  const tintValue = colorGrading.tint ?? 0;
  const isWhiteBalanceActive = useCallback(
    (preset: { temperature: number; tint: number }) =>
      !(Math.abs(temperatureValue) < 0.5 && Math.abs(tintValue) < 0.5) &&
      Math.abs(preset.temperature - temperatureValue) < 0.5 &&
      Math.abs(preset.tint - tintValue) < 0.5,
    [temperatureValue, tintValue],
  );

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

  const wbPick = useColorMonitorStore((state) => state.whiteBalancePick);
  const wbSize = useColorMonitorStore((state) => state.whiteBalanceSize);
  const setWbPick = useColorMonitorStore((state) => state.setWhiteBalancePick);
  const setWbSize = useColorMonitorStore((state) => state.setWhiteBalanceSize);
  const wbArmed = wbPick?.clipId === clipId;
  // Leaving the clip (or the section) must not leave a stale eyedropper over the monitor.
  useEffect(
    () => () => {
      const state = useColorMonitorStore.getState();
      if (state.whiteBalancePick?.clipId === clipId) state.setWhiteBalancePick(null);
    },
    [clipId],
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

  const handleHSLValuesChange = useCallback(
    (values: HSLValues) => {
      updateColorGrading(clipId, { hsl: values });
    },
    [clipId, updateColorGrading],
  );

  const handleHSLReset = useCallback(() => {
    updateColorGrading(clipId, { hsl: { ...DEFAULT_HSL } });
  }, [clipId, updateColorGrading]);

  const [autoBusy, setAutoBusy] = React.useState(false);
  const handleAutoTone = useCallback(async () => {
    setAutoBusy(true);
    try {
      const result = await measureAutoTone();
      if (!result) {
        toast.error("Auto Tone unavailable", "Pause playback and make sure the Program monitor shows a frame.");
        return;
      }
      await updateColorGrading(clipId, { tone: result.tone });
    } finally {
      setAutoBusy(false);
    }
  }, [clipId, updateColorGrading]);

  const handleBasicReset = useCallback(() => {
    void updateColorGrading(clipId, { tone: { ...DEFAULT_TONE } });
  }, [clipId, updateColorGrading]);

  const handleVignetteReset = useCallback(() => {
    void updateColorGrading(clipId, { vignette: { ...DEFAULT_VIGNETTE } });
  }, [clipId, updateColorGrading]);

  const handleResetAll = useCallback(() => {
    resetColorGrading(clipId);
  }, [clipId, resetColorGrading]);

  return (
    <EffectPreviewProvider>
    <LookCompareProvider>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[10px] font-medium text-fg-2">
          <Switch
            checked={scopesVisible}
            onCheckedChange={setScopesVisible}
            aria-label="Show video scopes"
          />
          <span>Video scopes</span>
          <kbd className="rounded border border-border px-1 text-[9px] text-fg-3">Shift+S</kbd>
        </label>
        <Button onClick={handleResetAll} type="button" aria-label="Reset All" className="min-w-0 justify-center rounded-[7px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 bg-transparent hover:bg-bg-2 flex items-center gap-1 px-2 py-1 text-[10px] text-fg-3 hover:text-fg transition-colors">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<RotateCcw size={10} />}</span>
          <span className="truncate">{"Reset All"}</span>
        </Button>
      </div>

      <div
        className="space-y-1.5 rounded-[7px] border border-border bg-bg-2 p-2"
        data-testid="color-pipeline-selector"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-fg-2">Processing order</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Color processing order">
            {([
              { version: 1 as const, label: "Classic" },
              { version: 2 as const, label: "Premiere" },
            ]).map((option) => (
              <Button
                key={option.version}
                type="button"
                variant="ghost"
                role="radio"
                aria-checked={pipelineVersion === option.version}
                aria-label={`${option.label} processing order`}
                onClick={() => handlePipelineChange(option.version)}
                className={`h-6 rounded-[7px] border px-2 text-[10px] font-semibold ${
                  pipelineVersion === option.version
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-bg-1 text-fg-2 hover:text-fg"
                }`}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-[10px] leading-snug text-fg-3">
          {pipelineVersion === 2
            ? "White Balance and Basic Correction run first, then Color Wheels and Hue Curves in one float pass, then Curves, LUT, HSL and Vignette."
            : "This clip keeps the classic order (Color Wheels before Basic Correction) so its look is unchanged. Switch to Premiere to use Hue Curves and float processing."}
        </p>
      </div>

      <SubSection title="Looks and LUTs" defaultOpen>
        <ColorLibrarySection clipId={clipId} />
      </SubSection>

      <SubSection title="Basic Correction" defaultOpen>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                aria-label="Auto"
                title="Set Basic Correction from the current frame"
                disabled={autoBusy}
                onClick={() => void handleAutoTone()}
                className="h-7 gap-1 rounded-[7px] border border-border bg-bg-2 px-2 text-[10px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg disabled:opacity-50"
              >
                <Sparkles size={11} aria-hidden />
                <span>Auto</span>
              </Button>
              <MatchColorPopover clipId={clipId} />
            </div>
            <Button variant="ghost" size="icon-sm" onClick={handleBasicReset} type="button" aria-label="Reset basic correction" title="Reset basic correction" className="justify-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring h-7 w-7 bg-transparent hover:bg-bg-2 flex items-center gap-1 px-2 py-0.5 text-[10px] text-fg-3 hover:text-fg transition-colors shrink-0">
              {<RotateCcw size={10} />}
            </Button>
          </div>
          <GradeSliders clipId={clipId} grade={colorGrading} group="tone" idPrefix="basic-correction" />
        </div>
      </SubSection>

      <SubSection title="White Balance" defaultOpen>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-fg-2 font-normal text-[10px] leading-snug">
              Warm up cool shots or cool down warm ones. Tint corrects green or
              magenta casts.
            </span>
            <Button variant="ghost" size="icon-sm" onClick={handleWhiteBalanceReset} type="button" aria-label="Reset white balance" title="Reset white balance" className="justify-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent hover:bg-bg-2 flex items-center gap-1 px-2 py-0.5 text-[10px] text-fg-3 hover:text-fg transition-colors shrink-0">
              {<RotateCcw size={10} />}
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant={wbArmed ? "default" : "outline"}
                size="icon-sm"
                className={`h-7 w-7 shrink-0 ${wbArmed ? "bg-accent text-white ring-2 ring-accent/40 hover:bg-accent" : ""}`}
                aria-pressed={wbArmed}
                aria-label="White balance eyedropper"
                title="Pick a neutral area on the Program monitor (Esc cancels)"
                onClick={() => setWbPick(wbArmed ? null : { clipId })}
              >
                <Pipette size={12} aria-hidden />
              </Button>
              <div
                role="group"
                aria-label="White balance sample size"
                className="flex shrink-0 overflow-hidden rounded-[6px] border border-border"
              >
                {([1, 5] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={wbSize === option}
                    title={option === 1 ? "Sample a single pixel" : "Average a 5 by 5 pixel area"}
                    onClick={() => setWbSize(option)}
                    className={`whitespace-nowrap px-1.5 py-0.5 text-[9px] font-semibold ${
                      wbSize === option ? "bg-accent text-white" : "bg-bg-2 text-fg-3 hover:text-fg"
                    }`}
                  >
                    {option === 1 ? "Point" : "5×5"}
                  </button>
                ))}
              </div>
            <span className={`min-w-0 flex-1 truncate text-[10px] ${wbArmed ? "font-medium text-accent" : "text-fg-3"}`} title={wbArmed ? "Click a neutral area on the Program monitor. Esc cancels." : undefined}>
              {wbArmed ? "Click a neutral area" : "Pick neutral"}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Thermometer size={12} className="text-fg-3" />
              <PropertySlider
                label="Temperature"
                value={temperatureValue}
                onChange={handleTemperatureChange}
                min={-100}
                max={100}
                step={1}
                className="flex-1"
                formatValue={(value) =>
                  `${value > 0 ? "+" : ""}${Math.round(value)}`
                }
              />
            </div>
            <div
              className="h-1 rounded-full pointer-events-none mx-5"
              style={{
                background:
                  "linear-gradient(to right, #4aa8ff 0%, #cccccc 50%, #ff9a3c 100%)",
                opacity: 0.7,
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Sun size={12} className="text-fg-3" />
              <PropertySlider
                label="Tint"
                value={tintValue}
                onChange={handleTintChange}
                min={-100}
                max={100}
                step={1}
                className="flex-1"
                formatValue={(value) =>
                  `${value > 0 ? "+" : ""}${Math.round(value)}`
                }
              />
            </div>
            <div
              className="h-1 rounded-full pointer-events-none mx-5"
              style={{
                background:
                  "linear-gradient(to right, #4ad17f 0%, #cccccc 50%, #d44ad1 100%)",
                opacity: 0.7,
              }}
            />
          </div>

          <div className="pt-1">
            <span className="text-fg-2 font-normal mb-1.5 block text-[10px]">
              Presets
            </span>
            <Suspense
              fallback={
              <div className="flex flex-wrap gap-1" aria-busy="true">
                {WHITE_BALANCE_PRESETS.map((preset) => (
                  <span key={preset.label} className="rounded border border-border bg-bg-2 px-2 py-1 text-[10px] text-fg-2">
                    {preset.label}
                  </span>
                ))}
              </div>
            }>
              <WhiteBalancePresets
                presets={WHITE_BALANCE_PRESETS}
                currentGrading={colorGrading}
                clipEffects={clipScene.effects}
                isActive={isWhiteBalanceActive}
                onApply={handleWhiteBalancePreset}
              />
            </Suspense>
          </div>
        </div>
      </SubSection>

      <SubSection title="Vignette" defaultOpen={false}>
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="ghost" size="icon-sm" onClick={handleVignetteReset} type="button" aria-label="Reset vignette" title="Reset vignette" className="justify-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring h-7 w-7 bg-transparent hover:bg-bg-2 flex items-center gap-1 px-2 py-0.5 text-[10px] text-fg-3 hover:text-fg transition-colors shrink-0">
              {<RotateCcw size={10} />}
            </Button>
          </div>
          <GradeSliders clipId={clipId} grade={colorGrading} group="vignette" idPrefix="vignette" />
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

      <SubSection title="Hue Curves">
        <HueCurvesEditor
          values={hueCurveKeyframes.shown}
          onChange={hueCurveKeyframes.apply}
          keyframing={hueCurveKeyframes.keyframing}
          onReset={handleHueCurvesReset}
          enabled={pipelineVersion === 2}
          onEnable={() => handlePipelineChange(2)}
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
    </LookCompareProvider>
    </EffectPreviewProvider>
  );
};

