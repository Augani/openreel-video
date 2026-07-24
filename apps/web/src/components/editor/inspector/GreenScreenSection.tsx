import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Video, Pipette, RefreshCw, Eye, EyeOff, Layers } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { MockSlider } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import type { RGB, ChromaKeySettings } from "@openreel/core";

interface GreenScreenSectionProps {
  clipId: string;
}

const ColorPreview: React.FC<{ color: RGB; onClick?: () => void }> = ({
  color,
  onClick,
}) => (
  <Button
    label="Pick color from video"
    variant="ghost"
    onClick={onClick}
    className="w-8 h-8 rounded-lg border-2 border-border hover:border-primary transition-colors"
    style={{
      backgroundColor: `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`,
    }}
  />
);

const ControlSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}> = ({ label, value, onChange, min = 0, max = 1, step = 0.01 }) => {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-fg-2">{label}</span>
        <span className="text-[10px] font-mono text-fg bg-bg-2 px-1.5 py-0.5 rounded border border-border">
          {Math.round(value * 100)}%
        </span>
      </div>
      <MockSlider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
    </div>
  );
};

const ColorPresetButton: React.FC<{
  color: RGB;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ color, label, isActive, onClick }) => (
  <SelectableCard
    label={label}
    isSelected={isActive}
    onChange={onClick}
    onClick={onClick}
    padding={1}
    variant={isActive ? "green" : "muted"}
    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] transition-colors ${
      isActive
        ? "bg-primary text-white"
        : "bg-bg-2 text-fg-3 hover:text-fg"
    }`}
  >
    <div
      className="w-3 h-3 rounded-sm border border-border"
      style={{
        backgroundColor: `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`,
      }}
    />
    {label}
  </SelectableCard>
);

const COLOR_PRESETS: { color: RGB; label: string }[] = [
  { color: { r: 0, g: 1, b: 0 }, label: "Green" },
  { color: { r: 0, g: 0, b: 1 }, label: "Blue" },
  { color: { r: 1, g: 0, b: 1 }, label: "Magenta" },
  { color: { r: 0, g: 1, b: 1 }, label: "Cyan" },
];

export const GreenScreenSection: React.FC<GreenScreenSectionProps> = ({
  clipId,
}) => {
  const project = useProjectStore((state) => state.project);
  const getChromaKeyEngine = useEngineStore(
    (state) => state.getChromaKeyEngine,
  );

  const [isPickingColor, setIsPickingColor] = useState(false);
  const [chromaKeyEngine, setChromaKeyEngine] =
    useState<import("@openreel/core").ChromaKeyEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getChromaKeyEngine();
      if (!cancelled) {
        setChromaKeyEngine(engine);
      }
    };
    loadEngine();
    return () => {
      cancelled = true;
    };
  }, [getChromaKeyEngine]);

  const settings = useMemo<ChromaKeySettings>(() => {
    if (!chromaKeyEngine) {
      return {
        enabled: false,
        keyColor: { r: 0, g: 1, b: 0 },
        tolerance: 0.3,
        edgeSoftness: 0.1,
        spillSuppression: 0.5,
      };
    }
    return (
      chromaKeyEngine.getSettings(clipId) || {
        enabled: false,
        keyColor: { r: 0, g: 1, b: 0 },
        tolerance: 0.3,
        edgeSoftness: 0.1,
        spillSuppression: 0.5,
      }
    );
  }, [chromaKeyEngine, clipId, project.modifiedAt]);

  const handleToggleEnabled = useCallback(() => {
    if (!chromaKeyEngine) return;
    if (settings.enabled) {
      chromaKeyEngine.disableChromaKey(clipId);
    } else {
      chromaKeyEngine.enableChromaKey(clipId);
    }
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, [chromaKeyEngine, clipId, settings.enabled]);

  const handleSetKeyColor = useCallback(
    (color: RGB) => {
      if (!chromaKeyEngine) return;
      chromaKeyEngine.setKeyColor(clipId, color);
      void useProjectStore.getState().executeAction({
        type: "clip/setChromaKey",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId, chromaKey: chromaKeyEngine.getSettings(clipId) },
      });
    },
    [chromaKeyEngine, clipId],
  );

  const handleSetTolerance = useCallback(
    (value: number) => {
      if (!chromaKeyEngine) return;
      chromaKeyEngine.setTolerance(clipId, value);
      void useProjectStore.getState().executeAction({
        type: "clip/setChromaKey",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId, chromaKey: chromaKeyEngine.getSettings(clipId) },
      });
    },
    [chromaKeyEngine, clipId],
  );

  const handleSetEdgeSoftness = useCallback(
    (value: number) => {
      if (!chromaKeyEngine) return;
      chromaKeyEngine.setEdgeSoftness(clipId, value);
      void useProjectStore.getState().executeAction({
        type: "clip/setChromaKey",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId, chromaKey: chromaKeyEngine.getSettings(clipId) },
      });
    },
    [chromaKeyEngine, clipId],
  );

  const handleSetSpillSuppression = useCallback(
    (value: number) => {
      if (!chromaKeyEngine) return;
      chromaKeyEngine.setSpillSuppression(clipId, value);
      void useProjectStore.getState().executeAction({
        type: "clip/setChromaKey",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId, chromaKey: chromaKeyEngine.getSettings(clipId) },
      });
    },
    [chromaKeyEngine, clipId],
  );

  const handleResetToDefaults = useCallback(() => {
    if (!chromaKeyEngine) return;
    chromaKeyEngine.setSettings(clipId, {
      enabled: true,
      keyColor: { r: 0, g: 1, b: 0 },
      tolerance: 0.3,
      edgeSoftness: 0.1,
      spillSuppression: 0.5,
    });
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, [chromaKeyEngine, clipId]);

  const isActiveColor = (preset: RGB) =>
    Math.abs(settings.keyColor.r - preset.r) < 0.1 &&
    Math.abs(settings.keyColor.g - preset.g) < 0.1 &&
    Math.abs(settings.keyColor.b - preset.b) < 0.1;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-gradient-to-r from-green-500/20 to-emerald-500/20 rounded-lg border border-green-500/30">
        <Video size={16} className="text-green-400" />
        <div className="flex flex-col gap-0.5 flex-1">
          <span className="block text-[11px] font-medium text-fg">
            Green Screen
          </span>
          <Text type="supporting" color="secondary" display="block" className="text-[9px] text-fg-3">
            Remove background color from video
          </Text>
        </div>
        <IconButton
          label={settings.enabled ? "Disable chroma key" : "Enable chroma key"}
          icon={settings.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
          variant="ghost"
          size="sm"
          onClick={handleToggleEnabled}
          className={`p-1.5 rounded transition-colors ${
            settings.enabled
              ? "bg-green-500/30 text-green-400"
              : "bg-bg-2 text-fg-3 hover:text-fg"
          }`}
        />
      </div>

      {settings.enabled && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-fg">
                Key Color
              </span>
              <div className="flex items-center gap-2">
                <IconButton
                  label="Pick color from video"
                  icon={<Pipette size={12} />}
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsPickingColor(!isPickingColor)}
                  className={`p-1.5 rounded transition-colors ${
                    isPickingColor
                      ? "bg-primary text-white"
                      : "bg-bg-2 text-fg-3 hover:text-fg"
                  }`}
                />
                <ColorPreview color={settings.keyColor} />
              </div>
            </div>

            {isPickingColor && (
              <div className="p-2 bg-primary/10 border border-primary/30 rounded-lg">
                <Text type="supporting" color="primary" className="text-[9px] text-primary text-center">
                  Click on the video preview to pick a color
                </Text>
              </div>
            )}

            <div className="flex flex-wrap gap-1">
              {COLOR_PRESETS.map((preset) => (
                <ColorPresetButton
                  key={preset.label}
                  color={preset.color}
                  label={preset.label}
                  isActive={isActiveColor(preset.color)}
                  onClick={() => handleSetKeyColor(preset.color)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-border">
            <ControlSlider
              label="Tolerance"
              value={settings.tolerance}
              onChange={handleSetTolerance}
            />

            <ControlSlider
              label="Edge Softness"
              value={settings.edgeSoftness}
              onChange={handleSetEdgeSoftness}
            />

            <ControlSlider
              label="Spill Suppression"
              value={settings.spillSuppression}
              onChange={handleSetSpillSuppression}
            />
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button
              label="Reset to Defaults"
              variant="ghost"
              icon={<RefreshCw size={12} />}
              onClick={handleResetToDefaults}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] text-fg-2 hover:text-fg bg-bg-2 rounded-lg transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 p-2 bg-bg-2 rounded-lg">
            <Layers size={12} className="text-fg-3" />
            <Text type="supporting" color="secondary" className="text-[9px] text-fg-3 flex-1">
              Place video clips below this one to use as background
            </Text>
          </div>
        </>
      )}

      {!settings.enabled && (
        <div className="text-center py-4">
          <Video
            size={24}
            className="mx-auto mb-2 text-fg-3 opacity-50"
          />
          <Text type="supporting" color="secondary" display="block" className="text-[10px] text-fg-3">
            Enable to remove background color
          </Text>
          <Button
            label="Enable Green Screen"
            variant="primary"
            onClick={handleToggleEnabled}
            className="mt-2 px-4 py-1.5 text-[10px] bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg transition-colors"
          />
        </div>
      )}
    </div>
  );
};

export default GreenScreenSection;
