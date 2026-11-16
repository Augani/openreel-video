import React, { memo, useCallback, useMemo, useState } from "react";
import {
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import {
  Layers,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  Palette,
  Droplet,
  Copy,
} from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  createAdjustmentLayerForClip,
  duplicateAdjustmentLayer,
  editAdjustmentLayer,
  findAdvancedOwner,
  type AdvancedLayerScope,
} from "../../../services/advanced-layer-edit";
import type { AdjustmentLayer, BlendMode, Effect } from "@openreel/core";
interface AdjustmentLayerSectionProps {
  clipId: string;
}
const EMPTY_LAYERS: AdjustmentLayer[] = [];

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
    controls: [
      {
        param: "value",
        label: "Brightness",
        min: -100,
        max: 100,
        step: 1,
        format: "percent-value",
      },
    ],
  },
  {
    id: "contrast",
    name: "Contrast",
    effect: { type: "contrast", params: { value: 1.15 }, enabled: true },
    controls: [
      { param: "value", label: "Contrast", min: 0, max: 3, step: 0.01 },
    ],
  },
  {
    id: "saturation",
    name: "Saturation",
    effect: { type: "saturation", params: { value: 1.15 }, enabled: true },
    controls: [
      { param: "value", label: "Saturation", min: 0, max: 3, step: 0.01 },
    ],
  },
  {
    id: "grayscale",
    name: "Grayscale",
    effect: { type: "grayscale", params: { amount: 1 }, enabled: true },
    controls: [
      {
        param: "amount",
        label: "Amount",
        min: 0,
        max: 1,
        step: 0.01,
        format: "percent",
      },
    ],
  },
  {
    id: "sepia",
    name: "Sepia",
    effect: { type: "sepia", params: { amount: 1 }, enabled: true },
    controls: [
      {
        param: "amount",
        label: "Amount",
        min: 0,
        max: 1,
        step: 0.01,
        format: "percent",
      },
    ],
  },
  {
    id: "invert",
    name: "Invert",
    effect: { type: "invert", params: { amount: 1 }, enabled: true },
    controls: [
      {
        param: "amount",
        label: "Amount",
        min: 0,
        max: 1,
        step: 0.01,
        format: "percent",
      },
    ],
  },
  {
    id: "hue",
    name: "Hue Rotate",
    effect: { type: "hue", params: { rotation: 20 }, enabled: true },
    controls: [
      {
        param: "rotation",
        label: "Rotation",
        min: -180,
        max: 180,
        step: 1,
        format: "degrees",
      },
    ],
  },
  {
    id: "blur",
    name: "Blur",
    effect: { type: "blur", params: { radius: 6 }, enabled: true },
    controls: [
      {
        param: "radius",
        label: "Radius",
        min: 0,
        max: 40,
        step: 0.5,
        format: "pixels",
      },
    ],
  },
  {
    id: "sharpen",
    name: "Sharpen",
    effect: { type: "sharpen", params: { amount: 60 }, enabled: true },
    controls: [
      {
        param: "amount",
        label: "Amount",
        min: 0,
        max: 300,
        step: 5,
        format: "percent-value",
      },
    ],
  },
  {
    id: "vignette",
    name: "Vignette",
    effect: {
      type: "vignette",
      params: { amount: 45, midpoint: 0.55, feather: 0.35 },
      enabled: true,
    },
    controls: [
      {
        param: "amount",
        label: "Amount",
        min: 0,
        max: 100,
        step: 1,
        format: "percent-value",
      },
      {
        param: "midpoint",
        label: "Midpoint",
        min: 0,
        max: 1,
        step: 0.01,
        format: "percent",
      },
      {
        param: "feather",
        label: "Feather",
        min: 0.01,
        max: 1,
        step: 0.01,
        format: "percent",
      },
    ],
  },
  {
    id: "temperature",
    name: "Temperature",
    effect: { type: "temperature", params: { value: 20 }, enabled: true },
    controls: [
      { param: "value", label: "Warm / Cool", min: -100, max: 100, step: 1 },
    ],
  },
  {
    id: "tint",
    name: "Tint",
    effect: { type: "tint", params: { value: 15 }, enabled: true },
    controls: [
      {
        param: "value",
        label: "Green / Magenta",
        min: -100,
        max: 100,
        step: 1,
      },
    ],
  },
  {
    id: "grain",
    name: "Film Grain",
    effect: { type: "grain", params: { amount: 8, size: 1 }, enabled: true },
    controls: [
      {
        param: "amount",
        label: "Amount",
        min: 0,
        max: 50,
        step: 1,
        format: "percent-value",
      },
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
  { id: "add", name: "Add", group: "Lighten" },
  { id: "linear-dodge", name: "Linear Dodge", group: "Lighten" },
];

function adjustmentEffectPreviewStyle(type: string): React.CSSProperties {
  switch (type) {
    case "brightness":
      return { filter: "brightness(1.45)" };
    case "contrast":
      return { filter: "contrast(1.65)" };
    case "saturation":
      return { filter: "saturate(1.8)" };
    case "grayscale":
      return { filter: "grayscale(1)" };
    case "sepia":
      return { filter: "sepia(1)" };
    case "invert":
      return { filter: "invert(1)" };
    case "hue":
      return { filter: "hue-rotate(120deg)" };
    case "blur":
      return { filter: "blur(3px)" };
    case "sharpen":
      return { filter: "contrast(1.4) brightness(1.05)" };
    case "vignette":
      return { boxShadow: "inset 0 0 22px 8px rgba(0,0,0,.72)" };
    case "temperature":
      return { filter: "sepia(.5) saturate(1.35)" };
    case "tint":
      return { filter: "hue-rotate(45deg) saturate(1.25)" };
    case "grain":
      return { filter: "contrast(1.12)", opacity: 0.88 };
    default:
      return {};
  }
}

export const AdjustmentLayerSection: React.FC<AdjustmentLayerSectionProps> = ({
  clipId,
}) => {
  const layers = useProjectStore(
    (state) => state.project.adjustmentLayers ?? EMPTY_LAYERS,
  );
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const current = useProjectStore(
    useCallback(
      (state) => findAdvancedOwner(state.project, clipId)?.clip ?? null,
      [clipId],
    ),
  );
  const projectId = useProjectStore((state) => state.project.id),
    executor = useProjectStore((state) => state.actionExecutor);
  const frameRate = useProjectStore(
      (state) => state.project.settings.frameRate,
    ),
    duration = useProjectStore((state) => state.project.timeline.duration);
  const hasProject = useProjectStore((state) => state.hasOpenProject);
  const exporting = useUIStore((state) => state.exportState.isExporting),
    processing = useUIStore((state) => state.effectApplicationClipId !== null);
  const playbackLocked = useTimelineStore(
    (state) => !!state.playbackLockedReason,
  );
  const session = useMemo(
    () => ({ key: crypto.randomUUID(), scope: { projectId, executor } }),
    [projectId, executor],
  );
  const lockedTracks = useMemo(
    () =>
      new Set(tracks.filter((track) => track.locked).map((track) => track.id)),
    [tracks],
  );
  return (
    <AdjustmentControls
      key={`${session.key}:${clipId}`}
      scope={session.scope}
      layers={layers}
      clipId={clipId}
      trackId={current?.trackId ?? null}
      lockedTracks={lockedTracks}
      frameRate={frameRate}
      duration={duration}
      disabled={!hasProject || exporting || processing || playbackLocked}
    />
  );
};

function AdjustmentControls({
  scope,
  layers,
  clipId,
  trackId,
  lockedTracks,
  frameRate,
  duration,
  disabled,
}: {
  scope: AdvancedLayerScope;
  layers: AdjustmentLayer[];
  clipId: string;
  trackId: string | null;
  lockedTracks: Set<string>;
  frameRate: number;
  duration: number;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const local = layers.filter((layer) => layer.trackId === trackId),
    other = layers.filter((layer) => layer.trackId !== trackId);
  const create = () => {
    const id = createAdjustmentLayerForClip(scope, clipId);
    if (id) setExpanded(id);
  };
  const render = (layer: AdjustmentLayer) => (
    <AdjustmentCard
      key={layer.id}
      layer={layer}
      scope={scope}
      open={expanded === layer.id}
      setExpanded={setExpanded}
      frameRate={frameRate}
      duration={duration}
      disabled={disabled || lockedTracks.has(layer.trackId)}
    />
  );
  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-2 rounded-[7px] border-primary/30 bg-primary/10 p-2 shadow-none">
        <Layers size={16} aria-hidden className="text-primary" />
        <div>
          <span className="block text-[11px] font-bold text-fg">
            Adjustment Layers
          </span>
          <span className="block text-[9px] text-fg-2">
            Non-destructive effects on clips below
          </span>
        </div>
      </Card>
      <Button
        type="button"
        size="sm"
        className="w-full"
        onClick={create}
        disabled={disabled || !trackId || lockedTracks.has(trackId)}
      >
        <Plus size={14} aria-hidden />
        Add Adjustment Layer
      </Button>
      {local.length > 0 && (
        <div className="space-y-2">
          <span className="text-[12px] font-bold text-fg-2">
            Track Layers ({local.length})
          </span>
          <div className="space-y-1.5">{local.map(render)}</div>
        </div>
      )}
      {other.length > 0 && (
        <div className="space-y-2 border-t border-border pt-2">
          <span className="text-[12px] font-bold text-fg-2">Other Layers</span>
          <div className="space-y-1.5">{other.map(render)}</div>
        </div>
      )}
      <p className="border-t border-border pt-2 text-center text-[9px] text-fg-2">
        Apply color, effects to all clips below
      </p>
    </div>
  );
}

const AdjustmentCard = memo(function AdjustmentCard({
  layer,
  scope,
  open,
  setExpanded,
  frameRate,
  duration,
  disabled,
}: {
  layer: AdjustmentLayer;
  scope: AdvancedLayerScope;
  open: boolean;
  setExpanded: (id: string | null) => void;
  frameRate: number;
  duration: number;
  disabled: boolean;
}) {
  const update = (changes: Partial<AdjustmentLayer>) =>
    editAdjustmentLayer(scope, layer.id, (current) => ({
      ...current,
      ...changes,
    }));
  const updateEffect = (id: string, changes: Partial<Effect>) =>
    editAdjustmentLayer(scope, layer.id, (current) => ({
      ...current,
      effects: current.effects.map((effect) =>
        effect.id === id ? { ...effect, ...changes, id: effect.id } : effect,
      ),
    }));
  const parameter = (id: string, key: string, value: number) =>
    editAdjustmentLayer(scope, layer.id, (current) => ({
      ...current,
      effects: current.effects.map((effect) =>
        effect.id === id
          ? { ...effect, params: { ...effect.params, [key]: value } }
          : effect,
      ),
    }));
  const add = (preset: (typeof EFFECT_PRESETS)[number]) =>
    editAdjustmentLayer(scope, layer.id, (current) => ({
      ...current,
      effects: [
        ...current.effects,
        {
          ...preset.effect,
          params: structuredClone(preset.effect.params),
          id: crypto.randomUUID(),
        },
      ],
    }));
  const frame = 1 / Math.max(1, frameRate);
  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => setExpanded(value ? layer.id : null)}
    >
      <Card className="overflow-hidden rounded-[7px] border-transparent bg-bg-2 p-0 shadow-none">
        <div className="flex items-center gap-1 p-1">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${open ? "Collapse" : "Expand"} ${layer.name}`}
              className="h-auto min-w-0 flex-1 justify-start gap-2 p-1 text-[10px] font-normal"
            >
              <ChevronRight
                size={12}
                aria-hidden
                className={open ? "rotate-90" : ""}
              />
              <Layers size={12} aria-hidden className="text-emerald-500" />
              <span className="truncate">{layer.name}</span>
            </Button>
          </CollapsibleTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={layer.enabled ? "Hide layer" : "Show layer"}
            aria-pressed={layer.enabled}
            disabled={disabled}
            onClick={() => update({ enabled: !layer.enabled })}
          >
            {layer.enabled ? (
              <Eye size={12} aria-hidden />
            ) : (
              <EyeOff size={12} aria-hidden />
            )}
          </Button>
        </div>
        <CollapsibleContent className="space-y-3 px-2 pb-2">
          <PropertySlider
            label="Opacity"
            min={0}
            max={100}
            step={1}
            value={layer.opacity * 100}
            onChange={(value) => update({ opacity: value / 100 })}
            formatValue={(value) => `${Math.round(value)}%`}
            isDisabled={disabled}
          />
          <div className="grid grid-cols-2 gap-2">
            <PropertySlider
              label="Start"
              min={0}
              max={Math.max(duration, layer.startTime + layer.duration)}
              step={frame}
              value={layer.startTime}
              onChange={(value) => update({ startTime: Math.max(0, value) })}
              formatValue={(value) => `${value.toFixed(2)}s`}
              isDisabled={disabled}
            />
            <PropertySlider
              label="Duration"
              min={Math.min(frame, layer.duration)}
              max={Math.max(duration, layer.duration)}
              step={frame}
              value={layer.duration}
              onChange={(value) =>
                update({
                  duration: Math.max(Math.min(frame, layer.duration), value),
                })
              }
              formatValue={(value) => `${value.toFixed(2)}s`}
              isDisabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <span className="flex items-center gap-1 text-[10px] text-fg-2">
              <Palette size={10} aria-hidden />
              Blend Mode
            </span>
            <Select
              value={layer.blendMode}
              disabled={disabled}
              onValueChange={(value) => {
                if (BLEND_MODES.some((mode) => mode.id === value))
                  update({ blendMode: value as BlendMode });
              }}
            >
              <SelectTrigger
                aria-label="Blend mode"
                className="h-7 w-full text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set(BLEND_MODES.map((mode) => mode.group))].map(
                  (group) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {BLEND_MODES.filter((mode) => mode.group === group).map(
                        (mode) => (
                          <SelectItem key={mode.id} value={mode.id}>
                            {mode.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="flex items-center gap-1 text-[10px] text-fg-2">
              <Droplet size={10} aria-hidden />
              Effects ({layer.effects.length})
            </span>
            <div className="space-y-1">
              {layer.effects.map((effect) => {
                const preset = EFFECT_PRESETS.find(
                    (item) => item.effect.type === effect.type,
                  ),
                  name = preset?.name ?? effect.type;
                return (
                  <Card
                    key={effect.id}
                    className="space-y-2 rounded-[7px] border-transparent bg-bg-1 p-2 shadow-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-semibold text-fg">
                        {name}
                      </span>
                      <div className="flex gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${effect.enabled === false ? "Enable" : "Disable"} ${name} effect`}
                          disabled={disabled}
                          onClick={() =>
                            updateEffect(effect.id, {
                              enabled: effect.enabled === false,
                            })
                          }
                        >
                          {effect.enabled === false ? (
                            <EyeOff size={10} aria-hidden />
                          ) : (
                            <Eye size={10} aria-hidden />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${name} effect`}
                          disabled={disabled}
                          className="text-red-400"
                          onClick={() =>
                            editAdjustmentLayer(scope, layer.id, (current) => ({
                              ...current,
                              effects: current.effects.filter(
                                (item) => item.id !== effect.id,
                              ),
                            }))
                          }
                        >
                          <Trash2 size={10} aria-hidden />
                        </Button>
                      </div>
                    </div>
                    {preset?.controls.map((control) => {
                      const stored = effect.params?.[control.param],
                        value =
                          typeof stored === "number" ? stored : control.min;
                      return (
                        <PropertySlider
                          key={control.param}
                          label={control.label}
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={value}
                          isDisabled={disabled}
                          onChange={(next) =>
                            parameter(effect.id, control.param, next)
                          }
                          formatValue={(next) =>
                            control.format === "percent"
                              ? `${Math.round(next * 100)}%`
                              : control.format === "percent-value"
                                ? `${Number(next.toFixed(2))}%`
                                : control.format === "degrees"
                                  ? `${Math.round(next)}°`
                                  : control.format === "pixels"
                                    ? `${next.toFixed(1)}px`
                                    : next.toFixed(control.step < 0.1 ? 2 : 1)
                          }
                        />
                      );
                    })}
                  </Card>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {EFFECT_PRESETS.map((preset) => (
                <Button
                  type="button"
                  variant="ghost"
                  key={preset.id}
                  aria-label={`+ ${preset.name}`}
                  disabled={disabled}
                  onClick={() => add(preset)}
                  className="block h-auto min-w-0 whitespace-normal rounded-[7px] border border-transparent bg-bg-2 p-1 text-left hover:bg-bg-3"
                >
                  {" "}
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
                    <span className="absolute bottom-0.5 left-1 text-[7px] font-bold uppercase text-white/75">
                      Before
                    </span>
                    <span className="absolute bottom-0.5 right-1 text-[7px] font-bold uppercase text-white/90">
                      Effect
                    </span>
                  </span>
                  <span className="text-[9px] text-fg-2">+ {preset.name}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="flex-1"
              onClick={() => {
                const id = duplicateAdjustmentLayer(scope, layer.id);
                if (id) setExpanded(id);
              }}
            >
              <Copy size={10} aria-hidden />
              Duplicate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="flex-1 text-red-400"
              onClick={() => {
                if (editAdjustmentLayer(scope, layer.id, () => null))
                  setExpanded(null);
              }}
            >
              <Trash2 size={10} aria-hidden />
              Delete
            </Button>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
});

