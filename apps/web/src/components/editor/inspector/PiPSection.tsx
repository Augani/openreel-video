import React, { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  PictureInPicture2,
  Square,
  LayoutGrid,
  Move,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import type { Transform } from "@openreel/core";

interface PiPSectionProps {
  clipId: string;
}

interface PiPPreset {
  id: string;
  name: string;
  icon: "corner" | "split" | "center" | "custom";
  transform: Partial<Transform>;
}

const PIP_PRESETS: PiPPreset[] = [
  {
    id: "top-left",
    name: "Top Left",
    icon: "corner",
    transform: {
      position: { x: -0.35, y: -0.35 },
      scale: { x: 0.3, y: 0.3 },
    },
  },
  {
    id: "top-right",
    name: "Top Right",
    icon: "corner",
    transform: {
      position: { x: 0.35, y: -0.35 },
      scale: { x: 0.3, y: 0.3 },
    },
  },
  {
    id: "bottom-left",
    name: "Bottom Left",
    icon: "corner",
    transform: {
      position: { x: -0.35, y: 0.35 },
      scale: { x: 0.3, y: 0.3 },
    },
  },
  {
    id: "bottom-right",
    name: "Bottom Right",
    icon: "corner",
    transform: {
      position: { x: 0.35, y: 0.35 },
      scale: { x: 0.3, y: 0.3 },
    },
  },
  {
    id: "split-left",
    name: "Split Left",
    icon: "split",
    transform: {
      position: { x: -0.25, y: 0 },
      scale: { x: 0.5, y: 1 },
    },
  },
  {
    id: "split-right",
    name: "Split Right",
    icon: "split",
    transform: {
      position: { x: 0.25, y: 0 },
      scale: { x: 0.5, y: 1 },
    },
  },
  {
    id: "split-top",
    name: "Split Top",
    icon: "split",
    transform: {
      position: { x: 0, y: -0.25 },
      scale: { x: 1, y: 0.5 },
    },
  },
  {
    id: "split-bottom",
    name: "Split Bottom",
    icon: "split",
    transform: {
      position: { x: 0, y: 0.25 },
      scale: { x: 1, y: 0.5 },
    },
  },
  {
    id: "center-small",
    name: "Center Small",
    icon: "center",
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 0.5, y: 0.5 },
    },
  },
  {
    id: "center-medium",
    name: "Center Medium",
    icon: "center",
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 0.7, y: 0.7 },
    },
  },
  {
    id: "fullscreen",
    name: "Full Screen",
    icon: "center",
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
    },
  },
];

const PresetIcon: React.FC<{ type: string; className?: string }> = ({
  type,
  className = "",
}) => {
  switch (type) {
    case "corner":
      return <Square size={14} className={className} />;
    case "split":
      return <LayoutGrid size={14} className={className} />;
    case "center":
      return <Maximize2 size={14} className={className} />;
    default:
      return <Move size={14} className={className} />;
  }
};

const ControlSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({
  label,
  value,
  onChange,
  min = -1,
  max = 1,
  step = 0.01,
  unit = "",
}) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-secondary">{label}</span>
        <span className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border">
          {value.toFixed(2)}
          {unit}
        </span>
      </div>
      <div className="relative h-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className="absolute inset-0 bg-background-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-sm pointer-events-none"
          style={{ left: `calc(${percentage}% - 5px)` }}
        />
      </div>
    </div>
  );
};

const PresetButton: React.FC<{
  preset: PiPPreset;
  isActive: boolean;
  onClick: () => void;
  translatedName?: string;
}> = ({ preset, isActive, onClick, translatedName }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
      isActive
        ? "bg-primary/20 border-primary text-primary"
        : "bg-background-tertiary border-border text-text-muted hover:text-text-primary hover:border-primary/50"
    }`}
    title={translatedName || preset.name}
  >
    <PresetIcon type={preset.icon} />
    <span className="text-[8px] truncate max-w-full">{translatedName || preset.name}</span>
  </button>
);

export const PiPSection: React.FC<PiPSectionProps> = ({ clipId }) => {
  const { t } = useTranslation();
  const project = useProjectStore((state) => state.project);
  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );

  const [showAdvanced, setShowAdvanced] = useState(false);

  const clip = useMemo(() => {
    for (const track of project.timeline.tracks) {
      const foundClip = track.clips.find((c) => c.id === clipId);
      if (foundClip) return foundClip;
    }
    return null;
  }, [project, clipId]);

  const currentTransform = useMemo<Transform>(() => {
    if (!clip) {
      return {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      };
    }
    return clip.transform;
  }, [clip]);

  const activePresetId = useMemo(() => {
    for (const preset of PIP_PRESETS) {
      const pt = preset.transform;
      if (
        pt.position &&
        pt.scale &&
        Math.abs(currentTransform.position.x - pt.position.x) < 0.05 &&
        Math.abs(currentTransform.position.y - pt.position.y) < 0.05 &&
        Math.abs(currentTransform.scale.x - pt.scale.x) < 0.05 &&
        Math.abs(currentTransform.scale.y - pt.scale.y) < 0.05
      ) {
        return preset.id;
      }
    }
    return null;
  }, [currentTransform]);

  const handlePresetClick = useCallback(
    (preset: PiPPreset) => {
      if (!clip) return;
      const newTransform: Transform = {
        ...currentTransform,
        position: preset.transform.position || currentTransform.position,
        scale: preset.transform.scale || currentTransform.scale,
      };
      updateClipTransform(clipId, newTransform);
    },
    [clip, clipId, currentTransform, updateClipTransform],
  );

  const handlePositionChange = useCallback(
    (axis: "x" | "y", value: number) => {
      if (!clip) return;
      const newTransform: Transform = {
        ...currentTransform,
        position: {
          ...currentTransform.position,
          [axis]: value,
        },
      };
      updateClipTransform(clipId, newTransform);
    },
    [clip, clipId, currentTransform, updateClipTransform],
  );

  const handleScaleChange = useCallback(
    (axis: "x" | "y" | "both", value: number) => {
      if (!clip) return;
      const newScale =
        axis === "both"
          ? { x: value, y: value }
          : { ...currentTransform.scale, [axis]: value };
      const newTransform: Transform = {
        ...currentTransform,
        scale: newScale,
      };
      updateClipTransform(clipId, newTransform);
    },
    [clip, clipId, currentTransform, updateClipTransform],
  );

  const handleBorderRadiusChange = useCallback(
    (value: number) => {
      if (!clip) return;
      const newTransform: Transform = {
        ...currentTransform,
        borderRadius: value,
      };
      updateClipTransform(clipId, newTransform);
    },
    [clip, clipId, currentTransform, updateClipTransform],
  );

  const handleOpacityChange = useCallback(
    (value: number) => {
      if (!clip) return;
      const newTransform: Transform = {
        ...currentTransform,
        opacity: value,
      };
      updateClipTransform(clipId, newTransform);
    },
    [clip, clipId, currentTransform, updateClipTransform],
  );

  const handleReset = useCallback(() => {
    if (!clip) return;
    const defaultTransform: Transform = {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      borderRadius: 0,
    };
    updateClipTransform(clipId, defaultTransform);
  }, [clip, clipId, updateClipTransform]);

  const cornerPresets = PIP_PRESETS.filter((p) => p.icon === "corner");
  const splitPresets = PIP_PRESETS.filter((p) => p.icon === "split");
  const centerPresets = PIP_PRESETS.filter((p) => p.icon === "center");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-gradient-to-r bg-primary/10 rounded-lg border border-primary/30">
        <PictureInPicture2 size={16} className="text-primary" />
        <div className="flex-1">
          <span className="text-[11px] font-medium text-text-primary">
            {t("inspector.pip")}
          </span>
          <p className="text-[9px] text-text-muted">
            {t("inspector.pipDescription")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-medium text-text-secondary">
          {t("inspector.pipCornerPositions")}
        </span>
        <div className="grid grid-cols-4 gap-1">
          {cornerPresets.map((preset) => (
            <PresetButton
              key={preset.id}
              preset={preset}
              isActive={activePresetId === preset.id}
              onClick={() => handlePresetClick(preset)}
              translatedName={t(`inspector.pip${preset.name.replace(/\s+/g, "")}`)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-medium text-text-secondary">
          {t("inspector.pipSplitScreen")}
        </span>
        <div className="grid grid-cols-4 gap-1">
          {splitPresets.map((preset) => (
            <PresetButton
              key={preset.id}
              preset={preset}
              isActive={activePresetId === preset.id}
              onClick={() => handlePresetClick(preset)}
              translatedName={t(`inspector.pip${preset.name.replace(/\s+/g, "")}`)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-medium text-text-secondary">
          {t("inspector.pipCenterFull")}
        </span>
        <div className="grid grid-cols-3 gap-1">
          {centerPresets.map((preset) => (
            <PresetButton
              key={preset.id}
              preset={preset}
              isActive={activePresetId === preset.id}
              onClick={() => handlePresetClick(preset)}
              translatedName={t(`inspector.pip${preset.name.replace(/\s+/g, "")}`)}
            />
          ))}
        </div>
      </div>

      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full py-1.5 text-[10px] text-text-secondary hover:text-text-primary bg-background-tertiary rounded-lg transition-colors"
      >
        {showAdvanced ? t("inspector.hide") : t("inspector.show")} Advanced Controls
      </button>

      {showAdvanced && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="space-y-2">
            <span className="text-[10px] font-medium text-text-secondary">
              {t("inspector.position")}
            </span>
            <ControlSlider
              label={t("inspector.pipHorizontal")}
              value={currentTransform.position.x}
              onChange={(v) => handlePositionChange("x", v)}
              min={-1}
              max={1}
            />
            <ControlSlider
              label={t("inspector.pipVertical")}
              value={currentTransform.position.y}
              onChange={(v) => handlePositionChange("y", v)}
              min={-1}
              max={1}
            />
          </div>

          <div className="space-y-2">
            <span className="text-[10px] font-medium text-text-secondary">
              {t("inspector.scale")}
            </span>
            <ControlSlider
              label={t("inspector.pipUniformScale")}
              value={currentTransform.scale.x}
              onChange={(v) => handleScaleChange("both", v)}
              min={0.1}
              max={2}
            />
            <ControlSlider
              label={t("inspector.scaleX")}
              value={currentTransform.scale.x}
              onChange={(v) => handleScaleChange("x", v)}
              min={0.1}
              max={2}
            />
            <ControlSlider
              label={t("inspector.scaleY")}
              value={currentTransform.scale.y}
              onChange={(v) => handleScaleChange("y", v)}
              min={0.1}
              max={2}
            />
          </div>

          <div className="space-y-2">
            <span className="text-[10px] font-medium text-text-secondary">
              {t("inspector.appearance")}
            </span>
            <ControlSlider
              label={t("inspector.pipBorderRadius")}
              value={currentTransform.borderRadius || 0}
              onChange={handleBorderRadiusChange}
              min={0}
              max={50}
              unit="px"
            />
            <ControlSlider
              label={t("inspector.opacity")}
              value={currentTransform.opacity}
              onChange={handleOpacityChange}
              min={0}
              max={1}
            />
          </div>
        </div>
      )}

      <button
        onClick={handleReset}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-text-secondary hover:text-text-primary bg-background-tertiary rounded-lg transition-colors"
      >
        <RotateCcw size={12} />
        {t("inspector.resetToDefault")}
      </button>

      <p className="text-[9px] text-text-muted text-center">
        {t("inspector.pipDragToFineTune")}
      </p>
    </div>
  );
};

export default PiPSection;
