import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  Key,
  Plus,
  Trash2,
  ChevronDown,
  Diamond,
  DiamondIcon,
} from "@/icons/lucide-compat";
import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";


import { useNumericDraft } from "./shell/useNumericDraft";

import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEngineStore } from "../../../stores/engine-store";
import {
  KeyframeEngine,
  EASING_CATEGORIES,
  PRO_EFFECT_KEYFRAME_PROPERTIES,
  COLOR_GRADE_KEYFRAME_PROPERTIES,
  getPluginRegistry,
  parsePluginKeyframeProperty,
  pluginIdFromEffectType,
  pluginKeyframeChannels,
  resolvePluginParam,
  hexToRgb,
  type EasingName,
} from "@openreel/core";
import type { Keyframe, EasingType, Effect } from "@openreel/core";
import {
  effectInstanceKeyframeProperty,
  getAnimatableEffectParams,
  parseEffectInstanceKeyframeProperty,
} from "@openreel/core/video/effect-instance-keyframes";

const keyframeEngine = new KeyframeEngine();
const EMPTY_KEYFRAMES: Keyframe[] = [];

interface AnimatableProperty {
  id: string;
  label: string;
  category: string;
  defaultValue: unknown;
  min?: number;
  max?: number;
  step?: number;
}

const ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  {
    id: "position.x",
    label: "Position X",
    category: "Transform",
    defaultValue: 0,
    min: -2000,
    max: 2000,
  },
  {
    id: "position.y",
    label: "Position Y",
    category: "Transform",
    defaultValue: 0,
    min: -2000,
    max: 2000,
  },
  {
    id: "scale.x",
    label: "Scale X",
    category: "Transform",
    defaultValue: 1,
    min: 0,
    max: 10,
    step: 0.01,
  },
  {
    id: "scale.y",
    label: "Scale Y",
    category: "Transform",
    defaultValue: 1,
    min: 0,
    max: 10,
    step: 0.01,
  },
  {
    id: "rotation",
    label: "Rotation",
    category: "Transform",
    defaultValue: 0,
    min: -360,
    max: 360,
  },
  {
    id: "opacity",
    label: "Opacity",
    category: "Transform",
    defaultValue: 1,
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    id: "volume",
    label: "Volume",
    category: "Audio",
    defaultValue: 1,
    min: 0,
    max: 2,
    step: 0.01,
  },
  {
    id: "pan",
    label: "Pan",
    category: "Audio",
    defaultValue: 0,
    min: -1,
    max: 1,
    step: 0.01,
  },
  ...COLOR_GRADE_KEYFRAME_PROPERTIES.map((property) => ({
    id: property.id,
    label: property.label,
    category: property.group === "tone" ? "Basic Correction" : "Vignette",
    defaultValue: property.defaultValue,
    min: property.min,
    max: property.max,
    step: property.step,
  })),
];

const formatEasingLabel = (easing: string): string => {
  return (
    easing
      .replace(/([A-Z])/g, " $1")
      .replace(/^ease/, "")
      .trim() || easing
  );
};

function titleCaseType(type: string): string {
  return type
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Instance-keyed channels (fx:<effectId>:<param>) of every classic effect on the
 * clip. Two copies of an effect list separately and animate independently.
 */
function effectInstanceProperties(
  effects: readonly Effect[] | undefined,
): AnimatableProperty[] {
  const totals = new Map<string, number>();
  for (const effect of effects ?? []) totals.set(effect.type, (totals.get(effect.type) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out: AnimatableProperty[] = [];
  for (const effect of effects ?? []) {
    const nth = (seen.get(effect.type) ?? 0) + 1;
    seen.set(effect.type, nth);
    const name = `${titleCaseType(effect.type)}${(totals.get(effect.type) ?? 0) > 1 ? ` ${nth}` : ""}`;
    const params =
      effect.type === "hsl-secondary"
        ? PRO_EFFECT_KEYFRAME_PROPERTIES.filter((property) => property.type === effect.type).map((property) => ({
            key: property.key,
            label: property.label,
            min: property.min,
            max: property.max,
            step: property.step,
            defaultValue: property.defaultValue,
          }))
        : getAnimatableEffectParams(effect);
    for (const param of params) {
      out.push({
        id: effectInstanceKeyframeProperty(effect.id, param.key),
        label: `${name}: ${param.label}`,
        category: "Effects",
        defaultValue: param.defaultValue,
        min: param.min,
        max: param.max,
        step: param.step,
      });
    }
  }
  return out;
}

/** Animatable channels of the installed plugins that have an effect on this clip. */
function pluginAnimatableProperties(
  effects: readonly { type: string }[] | undefined,
): AnimatableProperty[] {
  const registry = getPluginRegistry();
  const seen = new Set<string>();
  const out: AnimatableProperty[] = [];
  for (const effect of effects ?? []) {
    const id = pluginIdFromEffectType(effect.type);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const plugin = registry.get(id);
    if (!plugin) continue;
    for (const channel of pluginKeyframeChannels(plugin.manifest)) {
      out.push({
        id: channel.id,
        label: channel.label,
        category: "Plugins",
        defaultValue: channel.defaultValue,
        min: channel.min,
        max: channel.max,
        step: channel.step,
      });
    }
  }
  return out;
}

const subscribePlugins = (listener: () => void) => getPluginRegistry().subscribe(listener);
const pluginRevision = () => getPluginRegistry().getRevision();

const PropertySelector: React.FC<{
  selectedProperty: string | null;
  onSelect: (propertyId: string) => void;
  existingProperties: string[];
  properties?: AnimatableProperty[];
  showEffectHint?: boolean;
}> = ({ selectedProperty, onSelect, existingProperties, properties = ANIMATABLE_PROPERTIES, showEffectHint = false }) => {
  const [isOpen, setIsOpen] = useState(false);

  const categories = [...new Set(properties.map((p) => p.category))];

  const selectedLabel = selectedProperty
    ? properties.find((p) => p.id === selectedProperty)?.label ||
      selectedProperty
    : "Select Property";

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
      <Button type="button" aria-label={(selectedLabel).trim() || undefined} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-between">
        {(selectedLabel) ? <span className="truncate">{selectedLabel}</span> : null}
        <span className="flex shrink-0 items-center justify-center">{<ChevronDown
            size={12}
            className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
            aria-hidden
          />}</span>
      </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" aria-label="Animate property" className="w-[min(260px,calc(100vw-32px))] p-0">
        <div className="max-h-64 overflow-y-auto p-1.5">
          {categories.map((category) => (
            <div key={category} className="space-y-1">
              <div className="px-2 py-1 bg-bg-2">
                <span className="text-[12px] leading-5 text-fg-2 font-bold">
                  {category}
                </span>
              </div>
              {properties.filter(
                (p) => p.category === category,
              ).map((prop) => {
                const hasKeyframes = existingProperties.includes(prop.id);
                return (
                  <Button variant="ghost" key={prop.id} onClick={() => {
                      onSelect(prop.id);
                      setIsOpen(false);
                    }} type="button" aria-pressed={selectedProperty === prop.id} aria-label={`Select ${prop.label}`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (selectedProperty === prop.id ? "" : "border-transparent bg-transparent hover:bg-bg-2"), "p-2", "w-full")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] leading-5 text-fg font-normal">
                        {prop.label}
                      </span>
                      {hasKeyframes && (
                        <Diamond
                          size={10}
                          className="text-primary fill-primary"
                          aria-hidden
                        />
                      )}
                    </div>
                  </Button>
                );
              })}
            </div>
          ))}
          {showEffectHint && (
            <p
              role="note"
              data-testid="keyframes-effect-hint"
              className="px-2 py-1.5 text-[11px] leading-4 text-fg-3"
            >
              Effect parameters only appear for effects on this clip. Add the effect first, then animate it here.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const EasingCurvePreview: React.FC<{ easing: string; size?: number }> = ({
  easing,
  size = 16,
}) => {
  const getPath = (easingType: string): string => {
    const easingPaths: Record<string, string> = {
      linear: "M0,16 L16,0",
      easeIn: "M0,16 Q8,16 16,0",
      easeOut: "M0,16 Q8,0 16,0",
      easeInOut: "M0,16 Q4,16 8,8 Q12,0 16,0",
      easeInQuad: "M0,16 C0,16 12,16 16,0",
      easeOutQuad: "M0,16 C4,0 16,0 16,0",
      easeInOutQuad: "M0,16 C0,16 6,16 8,8 C10,0 16,0 16,0",
      easeInCubic: "M0,16 C0,16 14,16 16,0",
      easeOutCubic: "M0,16 C2,0 16,0 16,0",
      easeInOutCubic: "M0,16 C0,16 5,16 8,8 C11,0 16,0 16,0",
      easeInElastic: "M0,16 Q2,18 4,16 Q6,14 8,16 Q12,8 16,0",
      easeOutElastic: "M0,16 Q4,8 8,0 Q10,2 12,0 Q14,-2 16,0",
      easeInBounce: "M0,16 L4,16 L6,14 L8,16 L12,8 L16,0",
      easeOutBounce: "M0,16 L4,8 L8,0 L10,2 L12,0 L14,2 L16,0",
    };
    return easingPaths[easingType] || easingPaths.linear;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="text-primary"
    >
      <path
        d={getPath(easing)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

const EasingSelector: React.FC<{
  value: EasingType;
  onChange: (easing: EasingName) => void;
}> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const currentLabel = formatEasingLabel(value);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
      <Button type="button" aria-label={(currentLabel).trim() || undefined} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<EasingCurvePreview easing={value} size={14} />}</span>
        {(currentLabel) ? <span className="truncate">{currentLabel}</span> : null}
        <span className="flex shrink-0 items-center justify-center">{<ChevronDown size={10} aria-hidden />}</span>
      </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" aria-label="Easing choices" className="w-52 p-0">
        <div className="max-h-64 overflow-y-auto p-1.5">
          {EASING_CATEGORIES.map((category) => (
            <div key={category.name} className="space-y-1">
              <div className="sticky top-0 px-2 py-1 bg-bg-2">
                <span className="text-[12px] leading-5 text-fg-2 font-bold">
                  {category.name}
                </span>
              </div>
              {category.easings.map((easing) => (
                <Button variant="ghost" key={easing} onClick={() => {
                    onChange(easing);
                    setIsOpen(false);
                  }} type="button" aria-pressed={value === easing} aria-label={`Use ${formatEasingLabel(easing)} easing`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (value === easing ? "" : "border-transparent bg-transparent hover:bg-bg-2"), "p-2")}>
                  <div className="flex items-center gap-2">
                    <EasingCurvePreview easing={easing} size={14} />
                    <span className="text-[12px] leading-5 text-fg font-normal">
                      {formatEasingLabel(easing)}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

function KeyframeNumberInput({ value, onChange, min, max, step }: {
  value: number; onChange: (value: number) => void; min?: number; max?: number; step: number;
}) {
  const draft = useNumericDraft({ value, onChange, min, max, step });
  return <Input {...draft} type="text" inputMode="decimal" role="spinbutton" aria-label="Keyframe value"
    aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} className="h-7 w-[72px] px-2 text-xs" />;
}

const KeyframeItem: React.FC<{
  keyframe: Keyframe;
  onUpdate: (updates: Partial<Omit<Keyframe, "id">>) => void;
  onDelete: () => void;
  onEasingChange: (easing: EasingName) => void;
  property: AnimatableProperty | undefined;
}> = ({ keyframe, onUpdate, onDelete, onEasingChange, property }) => {
  return (
    <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-2 flex items-center gap-2 border border-border"
    >
      <DiamondIcon
        size={12}
        className="text-primary fill-primary flex-shrink-0"
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] leading-5 text-fg-2 font-normal">
            {keyframe.time.toFixed(2)}s
          </span>
          <span className="text-[12px] leading-5 text-fg-2 font-normal">
            •
          </span>
          <KeyframeNumberInput
            value={typeof keyframe.value === "number" ? keyframe.value : 0}
            onChange={value => onUpdate({ value })}
            min={property?.min}
            max={property?.max}
            step={property?.step ?? 1}
          />
        </div>
      </div>
      <EasingSelector value={keyframe.easing} onChange={onEasingChange} />
      <Button variant="ghost" size="icon-sm" onClick={onDelete} type="button" aria-label="Delete keyframe" title="Delete keyframe" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
        {<Trash2 size={12} aria-hidden />}
      </Button>
    </Card>
  );
};

interface KeyframesSectionProps {
  clipId: string;
}

/**
 * KeyframesSection Component
 *
 * - 20.1: Add keyframes at specific times with values
 * - 20.2: Select easing type for keyframe interpolation
 */
export const KeyframesSection: React.FC<KeyframesSectionProps> = ({
  clipId,
}) => {
  const { updateClipKeyframes, project } = useProjectStore();
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);

  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);

  const clip = useMemo(() => {
    for (const track of project.timeline.tracks) {
      const timelineClip = track.clips.find(clip => clip.id === clipId);
      if (timelineClip) return timelineClip;
    }

    const graphicsEngine = getGraphicsEngine();
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return svgClip;

    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return shapeClip;

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) return stickerClip;

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return textClip;

    return undefined;
  }, [clipId, getGraphicsEngine, getTitleEngine, project]);
  const keyframes = clip?.keyframes ?? EMPTY_KEYFRAMES;
  const localTime = playheadPosition - (clip?.startTime ?? 0);
  const insideClip = !!clip && localTime >= 0 && localTime <= clip.duration;

  const propertiesWithKeyframes = useMemo(() => {
    return [...new Set(keyframes.map((kf) => kf.property))];
  }, [keyframes]);

  const propertyKeyframes = useMemo(() => {
    if (!selectedProperty) return [];
    return keyframeEngine.getKeyframesForProperty(keyframes, selectedProperty);
  }, [keyframes, selectedProperty]);

  const registryRevision = useSyncExternalStore(subscribePlugins, pluginRevision);
  const allProperties = useMemo(
    () => [
      ...ANIMATABLE_PROPERTIES,
      ...effectInstanceProperties(clip?.effects),
      ...pluginAnimatableProperties(clip?.effects),
    ],
    // registryRevision: installing or removing a plugin changes the channels on offer
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clip?.effects, registryRevision],
  );

  const propertyDef = useMemo(() => {
    return allProperties.find((p) => p.id === selectedProperty);
  }, [selectedProperty, allProperties]);

  const currentValue = useMemo(() => {
    if (!selectedProperty || propertyKeyframes.length === 0) {
      if (clip && selectedProperty) {
        const [group, axis] = selectedProperty.split(".");
        const instanceProperty = parseEffectInstanceKeyframeProperty(selectedProperty);
        const pluginProperty = parsePluginKeyframeProperty(selectedProperty);
        if (pluginProperty) {
          // Start the animation from the effect's stored value (or the plugin default).
          const effect = clip.effects?.find(effect => effect.type === `plugin:${pluginProperty.pluginId}`);
          const plugin = getPluginRegistry().get(pluginProperty.pluginId);
          const def = plugin?.manifest.parameters.find(p => p.key === pluginProperty.key);
          if (def) {
            const stored = resolvePluginParam(def, effect?.params[def.key]);
            if (typeof stored === "number") return stored;
            if (pluginProperty.part === "x" || pluginProperty.part === "y") {
              return (stored as { x: number; y: number })[pluginProperty.part];
            }
            if (pluginProperty.part && typeof stored === "string") {
              return hexToRgb(stored)[pluginProperty.part as "r" | "g" | "b"];
            }
          }
        } else if (instanceProperty) {
          // The instance owns its params (even when disabled); fall back to the channel default.
          const effect = clip.effects?.find(effect => effect.id === instanceProperty.effectId);
          const value = effect?.params[instanceProperty.param];
          if (typeof value === "number") return value;
        } else {
          const value = (clip.transform as unknown as Record<string, unknown>)[group];
          const scalar = axis && value && typeof value === "object" ? (value as Record<string, unknown>)[axis] : value;
          if (typeof scalar === "number") return scalar;
          if (group === "volume" && "volume" in clip) return clip.volume;
        }
      }
      return propertyDef?.defaultValue ?? 0;
    }
    const result = keyframeEngine.getValueAtTime(
      propertyKeyframes,
      localTime,
    );
    return result.value;
    // registryRevision: the plugin manifest read above changes on install/uninstall
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty, propertyKeyframes, localTime, propertyDef, clip, registryRevision]);

  const hasKeyframeAtPlayhead = useMemo(() => {
    if (!selectedProperty) return false;
    return propertyKeyframes.some(
      (kf) => Math.abs(kf.time - localTime) < 0.01,
    );
  }, [selectedProperty, propertyKeyframes, localTime]);

  const handleAddKeyframe = useCallback(() => {
    if (!selectedProperty || !clip || !insideClip || hasKeyframeAtPlayhead) return;

    const newKeyframe = keyframeEngine.addKeyframe(
      clipId,
      selectedProperty,
      localTime,
      currentValue,
      "linear",
    );

    const updatedKeyframes = [...keyframes, newKeyframe].sort(
      (a, b) => a.time - b.time,
    );
    updateClipKeyframes(clipId, updatedKeyframes);
  }, [
    clipId,
    clip,
    selectedProperty,
    localTime,
    insideClip,
    hasKeyframeAtPlayhead,
    currentValue,
    keyframes,
    updateClipKeyframes,
  ]);

  const handleUpdateKeyframe = useCallback(
    (keyframeId: string, updates: Partial<Omit<Keyframe, "id">>) => {
      const updatedKeyframes = keyframeEngine.updateKeyframe(
        keyframes,
        keyframeId,
        updates,
      );
      updateClipKeyframes(clipId, updatedKeyframes);
    },
    [clipId, keyframes, updateClipKeyframes],
  );

  const handleDeleteKeyframe = useCallback(
    (keyframeId: string) => {
      const updatedKeyframes = keyframeEngine.removeKeyframe(
        keyframes,
        keyframeId,
      );
      updateClipKeyframes(clipId, updatedKeyframes);
    },
    [clipId, keyframes, updateClipKeyframes],
  );

  const handleEasingChange = useCallback(
    (keyframeId: string, easing: EasingName) => {
      const updatedKeyframes = keyframeEngine.updateKeyframe(
        keyframes,
        keyframeId,
        { easing: easing as EasingType },
      );
      updateClipKeyframes(clipId, updatedKeyframes);
    },
    [clipId, keyframes, updateClipKeyframes],
  );

  if (!clip) {
    return (
      <span className="text-[12px] leading-5 text-fg-2 font-normal block text-center py-4">
        No clip selected
      </span>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-[12px] leading-5 text-fg-2 font-bold block">
          Animate Property
        </span>
        <PropertySelector
          selectedProperty={selectedProperty}
          onSelect={setSelectedProperty}
          existingProperties={propertiesWithKeyframes}
          properties={allProperties}
          showEffectHint
        />
      </div>

      {selectedProperty && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-2 flex items-center justify-between gap-3 border border-border"
        >
          <span className="text-[12px] leading-5 text-fg-2 font-normal">
            Clip time {localTime.toFixed(2)}s
          </span>
          <span className="text-[12px] leading-5 text-fg font-normal font-mono">
            {typeof currentValue === "number"
              ? currentValue.toFixed(2)
              : String(currentValue)}
          </span>
        </Card>
      )}

      {selectedProperty && (
        <Button onClick={handleAddKeyframe} type="button" aria-label={(hasKeyframeAtPlayhead
              ? `Keyframe exists at ${localTime.toFixed(2)}s`
              : `Add Keyframe at ${localTime.toFixed(2)}s`).trim() || undefined} disabled={hasKeyframeAtPlayhead || !insideClip} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (hasKeyframeAtPlayhead ? "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg" : "bg-accent text-accent-fg hover:bg-accent/90"), "w-full")}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{hasKeyframeAtPlayhead ? (
              <Key size={12} aria-hidden />
            ) : (
              <Plus size={12} aria-hidden />
            )}</span>
          <span className="truncate">{hasKeyframeAtPlayhead
              ? `Keyframe exists at ${localTime.toFixed(2)}s`
              : `Add Keyframe at ${localTime.toFixed(2)}s`}</span>
        </Button>
      )}

      {selectedProperty && propertyKeyframes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-5 text-fg-2 font-bold">
              Keyframes ({propertyKeyframes.length})
            </span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {propertyKeyframes.map((kf) => (
              <KeyframeItem
                key={kf.id}
                keyframe={kf}
                property={propertyDef}
                onUpdate={(updates) => handleUpdateKeyframe(kf.id, updates)}
                onDelete={() => handleDeleteKeyframe(kf.id)}
                onEasingChange={(easing) => handleEasingChange(kf.id, easing)}
              />
            ))}
          </div>
        </div>
      )}

      {!selectedProperty && (
        <div className="text-center py-4">
          <Key size={24} className="mx-auto text-fg-3 mb-2" aria-hidden />
          <span className="text-[12px] leading-5 text-fg-2 font-normal">
            Select a property to animate
          </span>
        </div>
      )}

      {selectedProperty && propertyKeyframes.length === 0 && (
        <span className="text-[12px] leading-5 text-fg-2 font-normal block text-center py-2">
          No keyframes for this property. Add one to start animating.
        </span>
      )}
    </div>
  );
};

