import React, { useCallback } from "react";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Type, Clock, Play } from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import {
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
}> = ({ value, onChange }) => (
  <div className="space-y-2">
    <Selector
      label="Animation Preset"
      size="sm"
      width="100%"
      value={value}
      options={ANIMATION_PRESETS.map((preset) => ({
        label: preset.label,
        value: preset.value,
      }))}
      onChange={(nextValue) => onChange(nextValue as TextAnimationPreset)}
    />
    <Text type="supporting" color="secondary" className="text-[9px]">
      {ANIMATION_PRESETS.find((p) => p.value === value)?.description}
    </Text>
    <div className="grid grid-cols-2 gap-2" aria-label="Text animation previews">
      {ANIMATION_PRESETS.filter((preset) => preset.value !== "none").map(
        (preset) => (
          <TextAnimationPresetCard
            key={preset.value}
            preset={preset}
            selected={preset.value === value}
            onSelect={() => onChange(preset.value)}
          />
        ),
      )}
    </div>
  </div>
);

const TextAnimationPresetCard: React.FC<{
  preset: PresetInfo;
  selected: boolean;
  onSelect: () => void;
}> = ({ preset, selected, onSelect }) => {
  const [hovered, setHovered] = React.useState(false);
  const [progress, setProgress] = React.useState(0.62);

  React.useEffect(() => {
    if (!hovered) {
      setProgress(0.62);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      setProgress(((now - startedAt) % 1200) / 1200);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [hovered]);

  return (
    <button
      type="button"
      aria-label={`Preview and apply ${preset.label}`}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`overflow-hidden rounded-lg border p-1.5 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-bg-2 hover:border-primary/60"
      }`}
    >
      <span
        data-testid="text-animation-preset-preview"
        data-preset={preset.value}
        aria-hidden="true"
        className="relative mb-1.5 flex h-11 items-center justify-center overflow-hidden rounded-md bg-[radial-gradient(circle_at_50%_15%,rgba(139,92,246,.22),transparent_55%),#101521]"
      >
        <span
          className="text-[13px] font-black tracking-tight text-white"
          style={textAnimationPreviewStyle(preset.value, progress)}
        >
          OpenReel
        </span>
      </span>
      <span className="block truncate text-[9px] font-semibold text-fg">
        {preset.label}
      </span>
      <span className="block truncate text-[8px] text-fg-4">
        {preset.description}
      </span>
    </button>
  );
};

function textAnimationPreviewStyle(
  preset: TextAnimationPreset,
  progress: number,
): React.CSSProperties {
  const eased = 1 - Math.pow(1 - progress, 3);
  const wave = Math.sin(progress * Math.PI * 2);
  switch (preset) {
    case "typewriter":
    case "word-by-word":
      return { clipPath: `inset(0 ${(1 - eased) * 100}% 0 0)` };
    case "fade":
      return { opacity: eased };
    case "slide-left":
      return { opacity: eased, transform: `translateX(${(1 - eased) * 34}px)` };
    case "slide-right":
      return { opacity: eased, transform: `translateX(${(eased - 1) * 34}px)` };
    case "slide-up":
      return { opacity: eased, transform: `translateY(${(1 - eased) * 22}px)` };
    case "slide-down":
      return { opacity: eased, transform: `translateY(${(eased - 1) * 22}px)` };
    case "scale":
      return { opacity: eased, transform: `scale(${0.3 + eased * 0.7})` };
    case "blur":
      return { opacity: eased, filter: `blur(${(1 - eased) * 7}px)` };
    case "bounce":
      return { transform: `translateY(${-Math.abs(wave) * 12}px)` };
    case "rotate":
      return { opacity: eased, transform: `rotate(${(1 - eased) * -120}deg) scale(${0.55 + eased * 0.45})` };
    case "wave":
      return { transform: `translateY(${wave * 6}px) rotate(${wave * 2}deg)` };
    case "shake":
      return { transform: `translateX(${wave * 5}px)` };
    case "pop":
      return { transform: `scale(${0.45 + eased * 0.55 + Math.max(0, wave) * 0.12})` };
    case "glitch":
      return { transform: `translateX(${wave * 4}px) skewX(${wave * 6}deg)`, textShadow: `${wave * 3}px 0 #22d3ee, ${wave * -3}px 0 #f43f5e` };
    case "split":
      return { letterSpacing: `${(1 - eased) * 10}px`, opacity: eased };
    case "flip":
      return { opacity: eased > 0.08 ? 1 : 0, transform: `perspective(100px) rotateY(${(1 - eased) * -90}deg)` };
    case "rainbow":
      return { filter: `hue-rotate(${progress * 360}deg)`, color: "#f472b6" };
    case "rise":
      return {
        opacity: eased,
        transform: `translateY(${(1 - eased) * 20}px) scale(${0.88 + eased * 0.12})`,
        filter: `blur(${(1 - eased) * 6}px)`,
      };
    case "drop": {
      const landing = 1 - Math.abs(Math.cos(progress * Math.PI * 2.5)) * (1 - progress);
      return {
        opacity: progress > 0.02 ? 1 : 0,
        transform: `translateY(${(landing - 1) * 24}px) rotate(${(1 - landing) * -9}deg)`,
      };
    }
    case "elastic": {
      const elastic = progress === 1
        ? 1
        : 1 - Math.cos(progress * Math.PI * 3.5) * Math.exp(-progress * 5);
      return { opacity: progress > 0.02 ? 1 : 0, transform: `scale(${Math.max(0.1, elastic)})` };
    }
    case "swing":
      return {
        opacity: eased,
        transformOrigin: "50% 0%",
        transform: `rotate(${Math.cos(progress * Math.PI * 3) * (1 - progress) * 26}deg)`,
      };
    case "zoom-blur":
      return {
        opacity: eased,
        transform: `scale(${1.65 - eased * 0.65})`,
        filter: `blur(${(1 - eased) * 8}px)`,
      };
    case "cascade":
      return {
        opacity: eased,
        transform: `translate(${(1 - eased) * -12}px, ${(1 - eased) * 20}px) rotate(${(1 - eased) * -7}deg)`,
        letterSpacing: `${(1 - eased) * 3}px`,
      };
    case "none":
      return {};
  }
  return {};
}

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
      <Selector
        label="Easing"
        size="sm"
        width="100%"
        value={value}
        options={easingOptions}
        onChange={onChange}
      />
    </div>
  );
};

interface TextAnimationSectionProps {
  clipId: string;
}

export const TextAnimationSection: React.FC<TextAnimationSectionProps> = ({
  clipId,
}) => {
  const getTextClip = useProjectStore((state) => state.getTextClip);
  const applyTextAnimationPreset = useProjectStore(
    (state) => state.applyTextAnimationPreset,
  );
  useProjectStore((state) => state.project);

  const textClip = getTextClip(clipId);

  const currentPreset: TextAnimationPreset =
    textClip?.animation?.preset || "none";
  const inDuration = textClip?.animation?.inDuration ?? 0.5;
  const outDuration = textClip?.animation?.outDuration ?? 0.5;
  const easing = textClip?.animation?.params?.easing ?? "ease-out";

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
        <Text type="supporting" color="secondary" className="text-[10px]">
          No text clip selected
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PresetSelector value={currentPreset} onChange={handlePresetChange} />

      {currentPreset !== "none" && (
        <>
          <Card variant="muted" padding={3} className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={12} className="text-fg-3" />
              <Text type="supporting" color="secondary" className="text-[10px] font-medium">
                Timing
              </Text>
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

          <Card variant="muted" padding={3}>
            <EasingSelector value={easing} onChange={handleEasingChange} />
          </Card>

          <Card variant="muted" padding={3} className="border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Play size={12} className="text-fg-3" />
              <Text type="supporting" color="secondary" className="text-[10px] font-medium">
                Preview
              </Text>
            </div>
            <Text type="supporting" color="secondary" className="text-[9px]">
              Animation will play during preview and export. Total animation
              time: {(inDuration + outDuration).toFixed(1)}s
            </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Fade Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Slide Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Scale Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Bounce Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Rotate Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Wave Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Shake Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Pop Settings
      </Text>
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
  const { applyTextAnimationPreset, getTextClip } = useProjectStore();
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
    <Card variant="muted" padding={3} className="space-y-2">
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Glitch Settings
      </Text>
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

export default TextAnimationSection;
