import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Layers,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Palette,
  Droplet,
  Copy,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftPopover as Popover } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import type { AdjustmentLayer, BlendMode, Effect } from "@openreel/core";

interface AdjustmentLayerSectionProps {
  clipId: string;
}

const EFFECT_PRESETS: Array<{
  id: string;
  name: string;
  effect: Omit<Effect, "id">;
  controls: readonly {
    param: string;
    label: string;
    min: number;
    max: number;
    step: number;
    format?: "percent" | "percent-value" | "degrees" | "pixels";
  }[];
}> = [
  {
    id: "brightness",
    name: "Brightness",
    effect: { type: "brightness", params: { value: 12 }, enabled: true },
    controls: [{ param: "value", label: "Brightness", min: -100, max: 100, step: 1, format: "percent-value" }],
  },
  {
    id: "contrast",
    name: "Contrast",
    effect: { type: "contrast", params: { value: 1.15 }, enabled: true },
    controls: [{ param: "value", label: "Contrast", min: 0, max: 3, step: 0.01 }],
  },
  {
    id: "saturation",
    name: "Saturation",
    effect: { type: "saturation", params: { value: 1.15 }, enabled: true },
    controls: [{ param: "value", label: "Saturation", min: 0, max: 3, step: 0.01 }],
  },
  {
    id: "grayscale",
    name: "Grayscale",
    effect: { type: "grayscale", params: { amount: 1 }, enabled: true },
    controls: [{ param: "amount", label: "Amount", min: 0, max: 1, step: 0.01, format: "percent" }],
  },
  {
    id: "sepia",
    name: "Sepia",
    effect: { type: "sepia", params: { amount: 1 }, enabled: true },
    controls: [{ param: "amount", label: "Amount", min: 0, max: 1, step: 0.01, format: "percent" }],
  },
  {
    id: "invert",
    name: "Invert",
    effect: { type: "invert", params: { amount: 1 }, enabled: true },
    controls: [{ param: "amount", label: "Amount", min: 0, max: 1, step: 0.01, format: "percent" }],
  },
  {
    id: "hue",
    name: "Hue Rotate",
    effect: { type: "hue", params: { rotation: 20 }, enabled: true },
    controls: [{ param: "rotation", label: "Rotation", min: -180, max: 180, step: 1, format: "degrees" }],
  },
  {
    id: "blur",
    name: "Blur",
    effect: { type: "blur", params: { radius: 6 }, enabled: true },
    controls: [{ param: "radius", label: "Radius", min: 0, max: 40, step: 0.5, format: "pixels" }],
  },
  {
    id: "sharpen",
    name: "Sharpen",
    effect: { type: "sharpen", params: { amount: 0.6 }, enabled: true },
    controls: [{ param: "amount", label: "Amount", min: 0, max: 3, step: 0.05 }],
  },
  {
    id: "vignette",
    name: "Vignette",
    effect: { type: "vignette", params: { amount: 0.45, midpoint: 0.55, feather: 0.35 }, enabled: true },
    controls: [
      { param: "amount", label: "Amount", min: 0, max: 1, step: 0.01, format: "percent" },
      { param: "midpoint", label: "Midpoint", min: 0, max: 1, step: 0.01, format: "percent" },
      { param: "feather", label: "Feather", min: 0.01, max: 1, step: 0.01, format: "percent" },
    ],
  },
  {
    id: "temperature",
    name: "Temperature",
    effect: { type: "temperature", params: { value: 20 }, enabled: true },
    controls: [{ param: "value", label: "Warm / Cool", min: -100, max: 100, step: 1 }],
  },
  {
    id: "tint",
    name: "Tint",
    effect: { type: "tint", params: { value: 15 }, enabled: true },
    controls: [{ param: "value", label: "Green / Magenta", min: -100, max: 100, step: 1 }],
  },
  {
    id: "grain",
    name: "Film Grain",
    effect: { type: "grain", params: { amount: 0.08, size: 1 }, enabled: true },
    controls: [
      { param: "amount", label: "Amount", min: 0, max: 0.5, step: 0.01, format: "percent" },
      { param: "size", label: "Size", min: 0.5, max: 4, step: 0.1 },
    ],
  },
];

const BLEND_MODES: Array<{ id: BlendMode; name: string; group: string }> = [
  { id: "normal", name: "Normal", group: "Basic" },
  { id: "multiply", name: "Multiply", group: "Darken" },
  { id: "screen", name: "Screen", group: "Lighten" },
  { id: "overlay", name: "Overlay", group: "Contrast" },
  { id: "darken", name: "Darken", group: "Darken" },
  { id: "lighten", name: "Lighten", group: "Lighten" },
  { id: "color-dodge", name: "Color Dodge", group: "Lighten" },
  { id: "color-burn", name: "Color Burn", group: "Darken" },
  { id: "hard-light", name: "Hard Light", group: "Contrast" },
  { id: "soft-light", name: "Soft Light", group: "Contrast" },
  { id: "difference", name: "Difference", group: "Inversion" },
  { id: "exclusion", name: "Exclusion", group: "Inversion" },
  { id: "hue", name: "Hue", group: "Component" },
  { id: "saturation", name: "Saturation", group: "Component" },
  { id: "color", name: "Color", group: "Component" },
  { id: "luminosity", name: "Luminosity", group: "Component" },
];

function adjustmentEffectPreviewStyle(type: string): React.CSSProperties {
  switch (type) {
    case "brightness": return { filter: "brightness(1.45)" };
    case "contrast": return { filter: "contrast(1.65)" };
    case "saturation": return { filter: "saturate(1.8)" };
    case "grayscale": return { filter: "grayscale(1)" };
    case "sepia": return { filter: "sepia(1)" };
    case "invert": return { filter: "invert(1)" };
    case "hue": return { filter: "hue-rotate(120deg)" };
    case "blur": return { filter: "blur(3px)" };
    case "sharpen": return { filter: "contrast(1.4) brightness(1.05)" };
    case "vignette": return { boxShadow: "inset 0 0 22px 8px rgba(0,0,0,.72)" };
    case "temperature": return { filter: "sepia(.5) saturate(1.35)" };
    case "tint": return { filter: "hue-rotate(45deg) saturate(1.25)" };
    case "grain": return { filter: "contrast(1.12)", opacity: 0.88 };
    default: return {};
  }
}

export const AdjustmentLayerSection: React.FC<AdjustmentLayerSectionProps> = ({
  clipId,
}) => {
  const getAdjustmentLayerEngine = useEngineStore(
    (state) => state.getAdjustmentLayerEngine,
  );
  const project = useProjectStore((state) => state.project);

  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [showBlendModes, setShowBlendModes] = useState(false);
  const [adjustmentLayerEngine, setAdjustmentLayerEngine] =
    useState<import("@openreel/core").AdjustmentLayerEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getAdjustmentLayerEngine();
      if (!cancelled) {
        setAdjustmentLayerEngine(engine);
      }
    };
    loadEngine();
    return () => {
      cancelled = true;
    };
  }, [getAdjustmentLayerEngine]);

  useEffect(() => {
    if (!adjustmentLayerEngine) return;
    adjustmentLayerEngine.loadLayers(project.adjustmentLayers ?? []);
  }, [adjustmentLayerEngine, project.adjustmentLayers]);

  const currentTrack = useMemo(() => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) {
          return track;
        }
      }
    }
    return null;
  }, [project.timeline.tracks, clipId]);

  const allLayers = project.adjustmentLayers ?? [];
  const trackLayers = useMemo(
    () => currentTrack
      ? allLayers.filter((layer) => layer.trackId === currentTrack.id)
      : [],
    [allLayers, currentTrack],
  );

  const persistLayers = useCallback(
    (engine: import("@openreel/core").AdjustmentLayerEngine) =>
      useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: engine.getAllLayers() },
      }),
    [],
  );

  const handleCreateLayer = useCallback(() => {
    if (!adjustmentLayerEngine || !currentTrack) return;

    const currentClip = currentTrack.clips.find((c) => c.id === clipId);
    const startTime = currentClip?.startTime || 0;
    const duration = currentClip?.duration || 5;

    const layer = adjustmentLayerEngine.createAdjustmentLayer(
      currentTrack.id,
      startTime,
      { duration, name: `Adjustment ${allLayers.length + 1}` },
    );

    setExpandedLayer(layer.id);
    void persistLayers(adjustmentLayerEngine);
  }, [adjustmentLayerEngine, currentTrack, clipId, allLayers.length, persistLayers]);

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.deleteLayer(layerId);
      if (expandedLayer === layerId) {
        setExpandedLayer(null);
      }

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine, expandedLayer],
  );

  const handleToggleEnabled = useCallback(
    (layerId: string, enabled: boolean) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.setEnabled(layerId, enabled);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleOpacityChange = useCallback(
    (layerId: string, opacity: number) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.setOpacity(layerId, opacity);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleBlendModeChange = useCallback(
    (layerId: string, blendMode: BlendMode) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.setBlendMode(layerId, blendMode);
      setShowBlendModes(false);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleAddEffect = useCallback(
    (layerId: string, effectType: string) => {
      if (!adjustmentLayerEngine) return;

      const preset = EFFECT_PRESETS.find((p) => p.id === effectType);
      if (!preset) return;

      adjustmentLayerEngine.addEffect(layerId, {
        id: `effect_${Date.now()}`,
        ...preset.effect,
      });

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleRemoveEffect = useCallback(
    (layerId: string, effectId: string) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.removeEffect(layerId, effectId);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleUpdateEffectParameter = useCallback(
    (layerId: string, effectId: string, param: string, value: number) => {
      if (!adjustmentLayerEngine) return;
      const layer = adjustmentLayerEngine.getLayer(layerId);
      const effect = layer?.effects.find((candidate) => candidate.id === effectId);
      if (!effect) return;
      adjustmentLayerEngine.updateEffect(layerId, effectId, {
        params: { ...effect.params, [param]: value },
      });
      void persistLayers(adjustmentLayerEngine);
    },
    [adjustmentLayerEngine, persistLayers],
  );

  const handleToggleEffect = useCallback(
    (layerId: string, effectId: string, enabled: boolean) => {
      if (!adjustmentLayerEngine) return;
      adjustmentLayerEngine.updateEffect(layerId, effectId, { enabled });
      void persistLayers(adjustmentLayerEngine);
    },
    [adjustmentLayerEngine, persistLayers],
  );

  const handleTimingChange = useCallback(
    (layerId: string, key: "startTime" | "duration", value: number) => {
      if (!adjustmentLayerEngine) return;
      adjustmentLayerEngine.updateLayer(layerId, {
        [key]: Math.max(key === "duration" ? 1 / project.settings.frameRate : 0, value),
      });
      void persistLayers(adjustmentLayerEngine);
    },
    [adjustmentLayerEngine, persistLayers, project.settings.frameRate],
  );

  const handleDuplicateLayer = useCallback(
    (layerId: string) => {
      if (!adjustmentLayerEngine) return;

      const duplicate = adjustmentLayerEngine.duplicateLayer(layerId);
      if (duplicate) {
        setExpandedLayer(duplicate.id);
      }

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const renderLayerItem = (layer: AdjustmentLayer) => {
    const isExpanded = expandedLayer === layer.id;
    const selectedBlendMode =
      BLEND_MODES.find((mode) => mode.id === layer.blendMode)?.name || "Normal";

    return (
      <Card
        key={layer.id}
        variant="muted"
        padding={0}
        className="overflow-hidden"
      >
        <div className="flex items-center gap-1 p-1">
          <button
            type="button"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${layer.name}`}
            aria-expanded={isExpanded}
            onClick={() => setExpandedLayer(isExpanded ? null : layer.id)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left outline-none transition-colors hover:bg-bg-2 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              size={12}
              className={`text-fg-3 transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <Layers size={12} className="text-emerald-500" aria-hidden />
            <Text
              type="supporting"
              color="primary"
              className="flex-1 truncate text-[10px]"
            >
              {layer.name}
            </Text>
          </button>
          <IconButton
            label={layer.enabled ? "Hide layer" : "Show layer"}
            icon={layer.enabled ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={() => handleToggleEnabled(layer.id, !layer.enabled)}
            className={layer.enabled ? "text-fg" : "text-fg-3 opacity-50"}
          />
        </div>

        {isExpanded && (
          <div className="px-2 pb-2 space-y-3">
            <PropertySlider
              label="Opacity"
              min={0}
              max={100}
              step={1}
              value={layer.opacity * 100}
              onChange={(value: number) =>
                handleOpacityChange(layer.id, value / 100)
              }
              formatValue={(value) => `${Math.round(value)}%`}
            />
            <div className="grid grid-cols-2 gap-2">
              <PropertySlider
                label="Start"
                min={0}
                max={Math.max(project.timeline.duration, layer.startTime + layer.duration)}
                step={1 / project.settings.frameRate}
                value={layer.startTime}
                onChange={(value) => handleTimingChange(layer.id, "startTime", value)}
                formatValue={(value) => `${value.toFixed(2)}s`}
              />
              <PropertySlider
                label="Duration"
                min={1 / project.settings.frameRate}
                max={Math.max(project.timeline.duration, layer.duration)}
                step={1 / project.settings.frameRate}
                value={layer.duration}
                onChange={(value) => handleTimingChange(layer.id, "duration", value)}
                formatValue={(value) => `${value.toFixed(2)}s`}
              />
            </div>

            <div className="space-y-1.5">
              <Text
                type="supporting"
                color="secondary"
                className="flex items-center gap-1 text-[10px]"
              >
                <Palette size={10} aria-hidden />
                Blend Mode
              </Text>
              <Popover
                isOpen={showBlendModes}
                onOpenChange={setShowBlendModes}
                placement="below"
                alignment="start"
                width={220}
                label="Blend mode"
                content={
                  <div className="max-h-48 overflow-y-auto p-1.5">
                    {BLEND_MODES.map((mode) => (
                      <ClickableCard
                        key={mode.id}
                        label={`Use ${mode.name} blend mode`}
                        padding={2}
                        variant={layer.blendMode === mode.id ? "green" : "transparent"}
                        onClick={() => handleBlendModeChange(layer.id, mode.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <Text type="supporting" color="primary">
                            {mode.name}
                          </Text>
                          <Text
                            type="supporting"
                            color="secondary"
                            className="text-[9px]"
                          >
                            {mode.group}
                          </Text>
                        </div>
                      </ClickableCard>
                    ))}
                  </div>
                }
              >
                <Button
                  label={selectedBlendMode}
                  variant="secondary"
                  size="sm"
                  endContent={<ChevronDown size={10} aria-hidden />}
                  className="w-full justify-between"
                />
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Text
                type="supporting"
                color="secondary"
                className="flex items-center gap-1 text-[10px]"
              >
                <Droplet size={10} aria-hidden />
                Effects ({layer.effects.length})
              </Text>
              {layer.effects.length > 0 && (
                <div className="space-y-1">
                  {layer.effects.map((effect) => {
                    const preset = EFFECT_PRESETS.find(
                      (candidate) => candidate.effect.type === effect.type,
                    );
                    return (
                      <Card key={effect.id} variant="transparent" padding={2} className="space-y-2 bg-bg-1">
                        <div className="flex items-center justify-between gap-2">
                          <Text type="supporting" color="primary" className="text-[9px] font-semibold">
                            {preset?.name ?? effect.type}
                          </Text>
                          <div className="flex items-center gap-0.5">
                            <IconButton
                              label={`${effect.enabled === false ? "Enable" : "Disable"} ${preset?.name ?? effect.type} effect`}
                              icon={effect.enabled === false ? <EyeOff size={10} aria-hidden /> : <Eye size={10} aria-hidden />}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleEffect(layer.id, effect.id, effect.enabled === false)}
                              className={effect.enabled === false ? "text-fg-muted" : "text-fg"}
                            />
                            <IconButton
                              label={`Remove ${preset?.name ?? effect.type} effect`}
                              icon={<Trash2 size={10} aria-hidden />}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveEffect(layer.id, effect.id)}
                              className="text-red-400"
                            />
                          </div>
                        </div>
                        {preset?.controls.map((control) => {
                          const stored = effect.params?.[control.param];
                          const value = typeof stored === "number" ? stored : control.min;
                          return (
                            <PropertySlider
                              key={control.param}
                              label={control.label}
                              min={control.min}
                              max={control.max}
                              step={control.step}
                              value={value}
                              onChange={(nextValue) =>
                                handleUpdateEffectParameter(layer.id, effect.id, control.param, nextValue)
                              }
                              formatValue={(nextValue) =>
                                control.format === "percent"
                                  ? `${Math.round(nextValue * 100)}%`
                                  : control.format === "percent-value"
                                    ? `${Math.round(nextValue)}%`
                                  : control.format === "degrees"
                                    ? `${Math.round(nextValue)}°`
                                    : control.format === "pixels"
                                      ? `${nextValue.toFixed(1)}px`
                                      : nextValue.toFixed(control.step < 0.1 ? 2 : 1)
                              }
                            />
                          );
                        })}
                      </Card>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_PRESETS.map((preset) => (
                  <ClickableCard
                    key={preset.id}
                    label={`+ ${preset.name}`}
                    onClick={() => handleAddEffect(layer.id, preset.id)}
                    variant="muted"
                    padding={1}
                    className="min-w-0"
                  >
                    <span
                      data-testid={`adjustment-effect-preview-${preset.id}`}
                      className="relative mb-1 block h-8 overflow-hidden rounded-[5px] bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)]"
                    >
                      <span
                        className="absolute inset-y-0 left-1/2 right-0 bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)]"
                        style={{
                          ...adjustmentEffectPreviewStyle(preset.effect.type),
                          backgroundSize: "200% 100%",
                          backgroundPosition: "right center",
                        }}
                      />
                      <span className="absolute inset-y-0 left-1/2 w-px bg-white/70" />
                      <span className="absolute bottom-0.5 left-1 text-[7px] font-bold uppercase text-white/75">Before</span>
                      <span className="absolute bottom-0.5 right-1 text-[7px] font-bold uppercase text-white/90">Effect</span>
                    </span>
                    <Text type="supporting" color="primary" className="block truncate text-[9px] font-semibold">
                      {preset.name}
                    </Text>
                  </ClickableCard>
                ))}
              </div>
            </div>

            <div className="flex gap-1 pt-2 border-t border-border">
              <Button
                label="Duplicate"
                icon={<Copy size={10} aria-hidden />}
                variant="secondary"
                size="sm"
                onClick={() => handleDuplicateLayer(layer.id)}
                className="flex-1"
              />
              <Button
                label="Delete"
                icon={<Trash2 size={10} aria-hidden />}
                variant="secondary"
                size="sm"
                onClick={() => handleDeleteLayer(layer.id)}
                className="flex-1 text-red-400"
              />
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      <Card
        variant="green"
        padding={2}
        className="flex items-center gap-2 border border-primary/30"
      >
        <Layers size={16} className="text-primary" aria-hidden />
        <div className="flex flex-1 flex-col gap-0.5">
          <Text type="body" color="primary" weight="bold" className="block text-[11px]">
            Adjustment Layers
          </Text>
          <Text type="supporting" color="secondary" className="block text-[9px]">
            Non-destructive effects on clips below
          </Text>
        </div>
      </Card>

      <Button
        label="Add Adjustment Layer"
        icon={<Plus size={14} aria-hidden />}
        variant={currentTrack ? "primary" : "secondary"}
        size="md"
        onClick={handleCreateLayer}
        isDisabled={!currentTrack}
        className="w-full"
      />

      {trackLayers.length > 0 && (
        <div className="space-y-2">
          <Text type="supporting" color="secondary" weight="bold">
            Track Layers ({trackLayers.length})
          </Text>
          <div className="space-y-1.5">{trackLayers.map(renderLayerItem)}</div>
        </div>
      )}

      {allLayers.length > trackLayers.length && (
        <div className="space-y-2 pt-2 border-t border-border">
          <Text type="supporting" color="secondary" weight="bold">
            Other Layers
          </Text>
          <div className="space-y-1.5">
            {allLayers
              .filter((l) => !trackLayers.some((tl) => tl.id === l.id))
              .map(renderLayerItem)}
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="block text-[9px] text-center">
          Apply color, effects to all clips below
        </Text>
      </div>
    </div>
  );
};

export default AdjustmentLayerSection;
