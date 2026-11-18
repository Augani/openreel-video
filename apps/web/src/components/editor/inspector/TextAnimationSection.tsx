import { Button as ShadcnButton, ToggleGroup, ToggleGroupItem } from "@openreel/ui";
import React, { useCallback, useMemo, useState } from "react";
import { Card } from "@openreel/ui";
import { Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@openreel/ui";

import { Type, Clock, Play } from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import type { TextAnimationSide } from "../../../services/text-animation-phases";
import { TextAnimationPhaseProvider, useTextAnimationPhaseActions, useTextAnimationSide } from "./text-animation-phase-context";
import {
  EffectLivePreview,
  EffectPreviewProvider,
  useLivePreviewActivity,
} from "../panels/effect-previews/EffectLivePreview";
import {
  DEFAULT_PREVIEW_TEXT,
  textPreviewDef,
  type PreviewTextSource,
} from "../panels/effect-previews/kind-defs";
import {
  DEFAULT_TEXT_STYLE,
  TEXT_ANIMATION_PRESETS,
  type TextAnimationPreset,
  type TextAnimationParams,
} from "@openreel/core";

interface PresetInfo {
  value: TextAnimationPreset;
  label: string;
  description: string;
}

const ANIMATION_PRESETS: PresetInfo[] = TEXT_ANIMATION_PRESETS.map(
  ({ id, name, description }) => ({
    value: id,
    label: name,
    description,
  }),
);

const ParamSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
}> = ({ label, value, onChange, min, max, step, unit = "" }) => (
  <PropertySlider
    label={label}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    formatValue={(nextValue) =>
      `${step < 1 ? Number(nextValue.toFixed(3)) : Math.round(nextValue)}${unit}`
    }
  />
);

const PresetSelector: React.FC<{
  value: TextAnimationPreset;
  onChange: (preset: TextAnimationPreset) => void;
  source: PreviewTextSource;
  inDuration: number;
  outDuration: number;
}> = ({ value, onChange, source, inDuration, outDuration }) => (
  <div className="space-y-2">
    <Label className="block space-y-1.5 text-xs font-normal text-fg-2">
      <span>Animation Preset</span>
      <Select value={value} onValueChange={next => onChange(next as TextAnimationPreset)}>
        <SelectTrigger aria-label="Animation Preset" className="h-[30px] min-w-0 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{ANIMATION_PRESETS.map(preset => <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>)}</SelectContent>
      </Select>
    </Label>
    <span className="text-fg-2 font-normal text-[9px]">
      {ANIMATION_PRESETS.find((p) => p.value === value)?.description}
    </span>
    <EffectPreviewProvider>
      <div className="grid grid-cols-2 gap-2" aria-label="Text animation previews">
        {ANIMATION_PRESETS.filter((preset) => preset.value !== "none").map(
          (preset) => (
            <TextAnimationPresetCard
              key={preset.value}
              preset={preset}
              selected={preset.value === value}
              onSelect={() => onChange(preset.value)}
              source={source}
              inDuration={inDuration}
              outDuration={outDuration}
            />
          ),
        )}
      </div>
    </EffectPreviewProvider>
  </div>
);

const TextAnimationPresetCard: React.FC<{
  preset: PresetInfo;
  selected: boolean;
  onSelect: () => void;
  source: PreviewTextSource;
  inDuration: number;
  outDuration: number;
}> = ({ preset, selected, onSelect, source, inDuration, outDuration }) => {
  const side = useTextAnimationSide();
  const { active, handlers } = useLivePreviewActivity();
  const def = useMemo(
    () => textPreviewDef(source, preset.value, side, inDuration, outDuration),
    [source, preset.value, side, inDuration, outDuration],
  );

  return (
    <ShadcnButton variant="ghost" size="sm"
      type="button"
      aria-label={`Preview and apply ${preset.label}`}
      aria-pressed={selected}
      onClick={onSelect}
      {...handlers}
      className={`block h-auto w-full whitespace-normal overflow-hidden rounded-lg border p-1.5 text-left text-[length:inherit] font-normal leading-[inherit] transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-bg-2 hover:border-primary/60"
      }`}
    >
      <span
        data-testid="text-animation-preset-preview"
        data-preset={preset.value}
        aria-hidden="true"
        className="relative mb-1.5 block aspect-video overflow-hidden rounded-md bg-bg-3"
      >
        <EffectLivePreview def={def} active={active} />
      </span>
      <span className="block truncate text-[9px] font-semibold text-fg">
        {preset.label}
      </span>
      <span className="block truncate text-[8px] text-fg-4">
        {preset.description}
      </span>
    </ShadcnButton>
  );
};

const EasingSelector: React.FC<{
  value: string;
  onChange: (easing: string) => void;
}> = ({ value, onChange }) => {
  const easingOptions = [
    { value: "linear", label: "Linear" },
    { value: "ease-in", label: "Ease In" },
    { value: "ease-out", label: "Ease Out" },
    { value: "ease-in-out", label: "Ease In Out" },
  ];

  return (
    <div className="space-y-1">
      <Label className="block space-y-1.5 text-xs font-normal text-fg-2">
        <span>Easing</span>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger aria-label="Easing" className="h-[30px] min-w-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{easingOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </Label>
    </div>
  );
};

interface TextAnimationSectionProps {
  clipId: string;
}

export const TextAnimationSection: React.FC<TextAnimationSectionProps> = ({
  clipId,
}) => {
  const [side, setSide] = useState<TextAnimationSide>("entry");
  return <TextAnimationPhaseProvider value={side}>
    <div className="space-y-4">
      <ToggleGroup type="single" value={side} aria-label="Text animation phase" className="grid grid-cols-2"
        onValueChange={value => { if (value === "entry" || value === "exit") setSide(value); }}>
        <ToggleGroupItem value="entry">Entry</ToggleGroupItem>
        <ToggleGroupItem value="exit">Exit</ToggleGroupItem>
      </ToggleGroup>
      <TextAnimationEditor key={clipId} clipId={clipId} />
    </div>
  </TextAnimationPhaseProvider>;
};

const TextAnimationEditor: React.FC<TextAnimationSectionProps> = ({ clipId }) => {
  const { getTextClip, applyTextAnimationPreset } = useTextAnimationPhaseActions();
  useProjectStore((state) => state.project);

  const textClip = getTextClip(clipId);

  const currentPreset: TextAnimationPreset =
    textClip?.animation?.preset || "none";
  const inDuration = textClip?.animation?.inDuration ?? 0.5;
  const outDuration = textClip?.animation?.outDuration ?? 0.5;
  const easing = textClip?.animation?.params?.easing ?? "ease-out";

  const previewSource = useMemo<PreviewTextSource>(
    () => ({
      text: textClip?.text || DEFAULT_PREVIEW_TEXT,
      style: textClip?.style ?? DEFAULT_TEXT_STYLE,
      transform: textClip?.transform,
    }),
    [textClip?.text, textClip?.style, textClip?.transform],
  );

  const handlePresetChange = useCallback(
    (preset: TextAnimationPreset) => {
      applyTextAnimationPreset(clipId, preset, inDuration, outDuration);
    },
    [clipId, applyTextAnimationPreset, inDuration, outDuration],
  );

  const handleInDurationChange = useCallback(
    (newInDuration: number) => {
      applyTextAnimationPreset(
        clipId,
        currentPreset,
        newInDuration,
        outDuration,
      );
    },
    [clipId, applyTextAnimationPreset, currentPreset, outDuration],
  );

  const handleOutDurationChange = useCallback(
    (newOutDuration: number) => {
      applyTextAnimationPreset(
        clipId,
        currentPreset,
        inDuration,
        newOutDuration,
      );
    },
    [clipId, applyTextAnimationPreset, currentPreset, inDuration],
  );

  const handleEasingChange = useCallback(
    (newEasing: string) => {
      applyTextAnimationPreset(clipId, currentPreset, inDuration, outDuration, {
        easing: newEasing as TextAnimationParams["easing"],
      });
    },
    [clipId, applyTextAnimationPreset, currentPreset, inDuration, outDuration],
  );

  if (!textClip) {
    return (
      <div className="p-4 text-center">
        <Type size={24} className="mx-auto mb-2 text-fg-3" />
        <span className="text-fg-2 font-normal text-[10px]">
          No text clip selected
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PresetSelector
        value={currentPreset}
        onChange={handlePresetChange}
        source={previewSource}
        inDuration={inDuration}
        outDuration={outDuration}
      />

      {currentPreset !== "none" && (
        <>
          <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={12} className="text-fg-3" />
              <span className="text-fg-2 text-[10px] font-medium">
                Timing
              </span>
            </div>

            <ParamSlider
              label="In Duration"
              value={inDuration}
              onChange={handleInDurationChange}
              min={0}
              max={5}
              step={0.1}
              unit="s"
            />

            <ParamSlider
              label="Out Duration"
              value={outDuration}
              onChange={handleOutDurationChange}
              min={0}
              max={5}
              step={0.1}
              unit="s"
            />
          </Card>

          <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
            <EasingSelector value={easing} onChange={handleEasingChange} />
          </Card>

          <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Play size={12} className="text-fg-3" />
              <span className="text-fg-2 text-[10px] font-medium">
                Preview
              </span>
            </div>
            <span className="text-fg-2 font-normal text-[9px]">
              Animation will play during preview and export. Total animation
              time: {(inDuration + outDuration).toFixed(1)}s
            </span>
          </Card>
        </>
      )}

      {currentPreset === "fade" && (
        <FadeParams clipId={clipId} animation={textClip.animation} />
      )}

      {(currentPreset === "slide-left" ||
        currentPreset === "slide-right" ||
        currentPreset === "slide-up" ||
        currentPreset === "slide-down") && (
        <SlideParams clipId={clipId} animation={textClip.animation} />
      )}

      {currentPreset === "scale" && (
        <ScaleParams clipId={clipId} animation={textClip.animation} />
      )}

      {currentPreset === "bounce" && (
        <BounceParams clipId={clipId} animation={textClip.animation} />
      )}

      {currentPreset === "rotate" && (
        <RotateParams clipId={clipId} animation={textClip.animation} />
      )}

      {currentPreset === "wave" && (
        <WaveParams clipId={clipId} animation={textClip.animation} />
      )}

      {currentPreset === "shake" && (
        <ShakeParams clipId={clipId} animation={textClip.animation} />
      )}

      {currentPreset === "pop" && (
        <PopParams clipId={clipId} animation={textClip.animation} />
      )}

      {currentPreset === "glitch" && (
        <GlitchParams clipId={clipId} animation={textClip.animation} />
      )}
    </div>
  );
};

const FadeParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const startOpacity = animation?.params?.fadeOpacity?.start ?? 0;
  const endOpacity = animation?.params?.fadeOpacity?.end ?? 1;

  const handleChange = (start: number, end: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "fade",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { fadeOpacity: { start, end } },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Fade Settings
      </span>
      <ParamSlider
        label="Start Opacity"
        value={startOpacity}
        onChange={(v) => handleChange(v, endOpacity)}
        min={0}
        max={1}
        step={0.1}
        unit=""
      />
      <ParamSlider
        label="End Opacity"
        value={endOpacity}
        onChange={(v) => handleChange(startOpacity, v)}
        min={0}
        max={1}
        step={0.1}
        unit=""
      />
    </Card>
  );
};

const SlideParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams; preset?: TextAnimationPreset };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const slideDistance = animation?.params?.slideDistance ?? 0.2;

  const handleChange = (distance: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      textClip.animation.preset,
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { slideDistance: distance },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Slide Settings
      </span>
      <ParamSlider
        label="Distance"
        value={slideDistance}
        onChange={handleChange}
        min={0.05}
        max={1}
        step={0.05}
        unit=""
      />
    </Card>
  );
};

const ScaleParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const scaleFrom = animation?.params?.scaleFrom ?? 0;
  const scaleTo = animation?.params?.scaleTo ?? 1;

  const handleChange = (from: number, to: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "scale",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { scaleFrom: from, scaleTo: to },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Scale Settings
      </span>
      <ParamSlider
        label="Scale From"
        value={scaleFrom}
        onChange={(v) => handleChange(v, scaleTo)}
        min={0}
        max={2}
        step={0.1}
        unit="x"
      />
      <ParamSlider
        label="Scale To"
        value={scaleTo}
        onChange={(v) => handleChange(scaleFrom, v)}
        min={0}
        max={2}
        step={0.1}
        unit="x"
      />
    </Card>
  );
};

const BounceParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const bounceHeight = animation?.params?.bounceHeight ?? 0.1;
  const bounceCount = animation?.params?.bounceCount ?? 3;

  const handleChange = (height: number, count: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "bounce",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { bounceHeight: height, bounceCount: count },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Bounce Settings
      </span>
      <ParamSlider
        label="Height"
        value={bounceHeight}
        onChange={(v) => handleChange(v, bounceCount)}
        min={0.01}
        max={0.5}
        step={0.01}
        unit=""
      />
      <ParamSlider
        label="Bounces"
        value={bounceCount}
        onChange={(v) => handleChange(bounceHeight, Math.round(v))}
        min={1}
        max={10}
        step={1}
        unit=""
      />
    </Card>
  );
};

const RotateParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const rotateAngle = animation?.params?.rotateAngle ?? 360;

  const handleChange = (angle: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "rotate",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { rotateAngle: angle },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Rotate Settings
      </span>
      <ParamSlider
        label="Angle"
        value={rotateAngle}
        onChange={handleChange}
        min={-720}
        max={720}
        step={15}
        unit="°"
      />
    </Card>
  );
};

const WaveParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const waveAmplitude = animation?.params?.waveAmplitude ?? 0.02;
  const waveFrequency = animation?.params?.waveFrequency ?? 2;

  const handleChange = (amplitude: number, frequency: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "wave",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { waveAmplitude: amplitude, waveFrequency: frequency },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Wave Settings
      </span>
      <ParamSlider
        label="Amplitude"
        value={waveAmplitude}
        onChange={(v) => handleChange(v, waveFrequency)}
        min={0.005}
        max={0.1}
        step={0.005}
        unit=""
      />
      <ParamSlider
        label="Frequency"
        value={waveFrequency}
        onChange={(v) => handleChange(waveAmplitude, v)}
        min={0.5}
        max={5}
        step={0.5}
        unit=""
      />
    </Card>
  );
};

const ShakeParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const shakeIntensity = animation?.params?.shakeIntensity ?? 0.01;
  const shakeSpeed = animation?.params?.shakeSpeed ?? 20;

  const handleChange = (intensity: number, speed: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "shake",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { shakeIntensity: intensity, shakeSpeed: speed },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Shake Settings
      </span>
      <ParamSlider
        label="Intensity"
        value={shakeIntensity}
        onChange={(v) => handleChange(v, shakeSpeed)}
        min={0.001}
        max={0.05}
        step={0.001}
        unit=""
      />
      <ParamSlider
        label="Speed"
        value={shakeSpeed}
        onChange={(v) => handleChange(shakeIntensity, v)}
        min={5}
        max={50}
        step={5}
        unit=""
      />
    </Card>
  );
};

const PopParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const popOvershoot = animation?.params?.popOvershoot ?? 1.2;

  const handleChange = (overshoot: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "pop",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { popOvershoot: overshoot },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Pop Settings
      </span>
      <ParamSlider
        label="Overshoot"
        value={popOvershoot}
        onChange={handleChange}
        min={1}
        max={2}
        step={0.05}
        unit="x"
      />
    </Card>
  );
};

const GlitchParams: React.FC<{
  clipId: string;
  animation?: { params?: TextAnimationParams };
}> = ({ clipId, animation }) => {
  const { applyTextAnimationPreset, getTextClip } = useTextAnimationPhaseActions();
  const textClip = getTextClip(clipId);

  const glitchIntensity = animation?.params?.glitchIntensity ?? 0.02;
  const glitchSpeed = animation?.params?.glitchSpeed ?? 10;

  const handleChange = (intensity: number, speed: number) => {
    if (!textClip?.animation) return;
    applyTextAnimationPreset(
      clipId,
      "glitch",
      textClip.animation.inDuration,
      textClip.animation.outDuration,
      { glitchIntensity: intensity, glitchSpeed: speed },
    );
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-2">
      <span className="text-fg-2 text-[10px] font-medium">
        Glitch Settings
      </span>
      <ParamSlider
        label="Intensity"
        value={glitchIntensity}
        onChange={(v) => handleChange(v, glitchSpeed)}
        min={0.005}
        max={0.1}
        step={0.005}
        unit=""
      />
      <ParamSlider
        label="Speed"
        value={glitchSpeed}
        onChange={(v) => handleChange(glitchIntensity, v)}
        min={1}
        max={30}
        step={1}
        unit=""
      />
    </Card>
  );
};
