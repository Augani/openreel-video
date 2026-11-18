import React, { useMemo, useState } from "react";
import {
  EffectLivePreview,
  EffectPreviewProvider,
  useLivePreviewActivity,
} from "../panels/effect-previews/EffectLivePreview";
import { particlePreviewDef } from "../panels/effect-previews/kind-defs";
import {
  PARTICLE_PRESETS,
  createEffectFromPreset,
  type ParticlePreset,
  type ParticleEffect,
  type ParticleConfig,
} from "@openreel/core";
import {
  Button,
  Card,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  cn,
} from "@openreel/ui";
import {
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Play,
} from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { useNumericDraft } from "./shell/useNumericDraft";
import { ColorSelector } from "../../../motion/components/primitives";
interface ParticleEffectsSectionProps {
  clipId: string;
  clipDuration: number;
  clipStartTime: number;
  frameRate?: number;
  effects: ParticleEffect[];
  disabled?: boolean;
  onAddEffect: (effect: ParticleEffect) => unknown;
  onUpdateEffect: (
    id: string,
    config:
      | Partial<ParticleConfig>
      | ((current: ParticleConfig) => Partial<ParticleConfig>),
  ) => unknown;
  onRemoveEffect: (id: string) => unknown;
  onToggleEffect: (id: string, enabled: boolean) => unknown;
  onUpdateTiming: (id: string, start: number, duration: number) => unknown;
  onPreviewEffect?: (id: string) => unknown;
}
const groupedPresets = PARTICLE_PRESETS.reduce<
  Record<string, ParticlePreset[]>
>((groups, preset) => {
  (groups[preset.type] ??= []).push(preset);
  return groups;
}, {});
export function ParticleEffectsSection({
  clipId,
  clipDuration,
  clipStartTime,
  frameRate = 30,
  effects,
  disabled = false,
  onAddEffect,
  ...handlers
}: ParticleEffectsSectionProps) {
  const [selectedPreset, setSelectedPreset] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const add = () => {
    const effect = createEffectFromPreset(
      selectedPreset,
      crypto.randomUUID(),
      clipId,
      clipStartTime,
      clipDuration,
    );
    if (effect) {
      onAddEffect(effect);
      setExpanded((current) => new Set(current).add(effect.id));
    }
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0">
      <div className="flex min-w-0 gap-2">
        <Select
          value={selectedPreset}
          onValueChange={setSelectedPreset}
          disabled={disabled}
        >
          <SelectTrigger
            aria-label="Particle effect preset"
            className="h-[30px] min-w-0 flex-1 text-xs"
          >
            <SelectValue placeholder="Select effect preset…" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(groupedPresets).map(([type, presets]) => (
              <SelectGroup key={type}>
                <SelectLabel className="capitalize">{type}</SelectLabel>
                {presets?.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          aria-label="Add"
          disabled={disabled || !selectedPreset}
          onClick={add}
          className="h-[30px] gap-1.5 px-2.5 text-xs"
        >
          <Plus size={14} aria-hidden />
          Add
        </Button>
      </div>
      <EffectPreviewProvider>
        <div
          className="grid grid-cols-2 gap-2"
          aria-label="Particle preset previews"
        >
          {PARTICLE_PRESETS.map((preset) => (
            <ParticlePresetCard
              key={preset.id}
              preset={preset}
              selected={selectedPreset === preset.id}
              onSelect={() => setSelectedPreset(preset.id)}
            />
          ))}
        </div>
      </EffectPreviewProvider>
      {effects.length === 0 ? (
        <div className="py-6 text-center text-xs text-fg-3">
          <Sparkles size={24} className="mx-auto mb-2 opacity-50" aria-hidden />
          <p className="text-fg-2">No particle effects added</p>
          <p className="mt-1 text-[10px]">
            Select a preset above to add effects
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {effects.map((effect) => (
            <ParticleEditor
              key={effect.id}
              effect={effect}
              clipStartTime={clipStartTime}
              clipDuration={clipDuration}
              frameRate={frameRate}
              disabled={disabled}
              open={expanded.has(effect.id)}
              onOpenChange={(open) =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (open) next.add(effect.id);
                  else next.delete(effect.id);
                  return next;
                })
              }
              {...handlers}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
function ParticleEditor({
  effect,
  clipStartTime,
  clipDuration,
  frameRate,
  disabled,
  open,
  onOpenChange,
  onUpdateEffect,
  onRemoveEffect,
  onToggleEffect,
  onUpdateTiming,
  onPreviewEffect,
}: Pick<
  ParticleEffectsSectionProps,
  | "clipStartTime"
  | "clipDuration"
  | "onUpdateEffect"
  | "onRemoveEffect"
  | "onToggleEffect"
  | "onUpdateTiming"
  | "onPreviewEffect"
> & {
  effect: ParticleEffect;
  frameRate: number;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false),
    [colorsOpen, setColorsOpen] = useState(false);
  const relative = effect.startTime - clipStartTime,
    frame = 1 / (Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30);
  const start = useNumericDraft({
    value: relative,
    min: 0,
    max: Math.max(0, clipDuration - frame),
    step: 0.1,
    live: false,
    format: (value) => String(Number(value.toPrecision(12))),
    onChange: (value) =>
      onUpdateTiming(
        effect.id,
        clipStartTime + value,
        Math.min(effect.duration, clipDuration - value),
      ),
  });
  const duration = useNumericDraft({
    value: effect.duration,
    min: Math.min(frame, clipDuration),
    max: Math.max(frame, clipDuration - relative),
    step: 0.1,
    live: false,
    format: (value) => String(Number(value.toPrecision(12))),
    onChange: (value) => onUpdateTiming(effect.id, effect.startTime, value),
  });
  const update = (
    config:
      | Partial<ParticleConfig>
      | ((current: ParticleConfig) => Partial<ParticleConfig>),
  ) => onUpdateEffect(effect.id, config);
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="min-w-0 overflow-hidden rounded-[7px] border-border bg-bg-2 p-0 shadow-none">
        <div className="flex min-w-0 items-center gap-2 px-3 py-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={open ? "Collapse effect" : "Expand effect"}
              className="h-7 w-7"
            >
              {open ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
            </Button>
          </CollapsibleTrigger>
          <span className="min-w-0 flex-1 truncate text-xs font-medium capitalize text-fg">
            {effect.type}
          </span>
          {onPreviewEffect && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Preview effect"
              onClick={() => onPreviewEffect(effect.id)}
              className="h-7 w-7"
            >
              <Play size={12} aria-hidden />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={effect.enabled ? "Disable effect" : "Enable effect"}
            aria-pressed={effect.enabled}
            onClick={() => onToggleEffect(effect.id, !effect.enabled)}
            className={cn(
              "h-7 w-7",
              effect.enabled ? "text-accent" : "text-fg-3",
            )}
          >
            {effect.enabled ? (
              <Eye size={12} aria-hidden />
            ) : (
              <EyeOff size={12} aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove effect"
            onClick={() => onRemoveEffect(effect.id)}
            className="h-7 w-7 text-fg-3 hover:text-red-400"
          >
            <Trash2 size={12} aria-hidden />
          </Button>
        </div>
        <div inert={!open} aria-hidden={!open}>
          <CollapsibleContent className="space-y-3 border-t border-border px-3 pb-3 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <Label className="space-y-1.5 text-xs font-normal text-fg-2">
                <span>Start Time (s)</span>
                <Input
                  {...start}
                  aria-label="Start Time"
                  aria-description="Seconds from the clip start"
                  inputMode="decimal"
                  className="h-[30px] text-right font-mono text-[11px]"
                />
              </Label>
              <Label className="space-y-1.5 text-xs font-normal text-fg-2">
                <span>Duration (s)</span>
                <Input
                  {...duration}
                  aria-label="Duration"
                  aria-description="Seconds"
                  inputMode="decimal"
                  className="h-[30px] text-right font-mono text-[11px]"
                />
              </Label>
            </div>
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 w-full justify-between px-0 text-[11px] text-fg-2"
                >
                  Particle Settings
                  <ChevronDown size={12} className={settingsOpen ? undefined : "-rotate-90"} aria-hidden />
                </Button>
              </CollapsibleTrigger>
              <div inert={!settingsOpen} aria-hidden={!settingsOpen}>
                <CollapsibleContent className="space-y-3 pt-2">
                  <PropertySlider
                    isDisabled={disabled}
                    label="Particle Count"
                    value={effect.config.particleCount}
                    min={0}
                    max={Math.max(500, effect.config.particleCount)}
                    step={10}
                    onChange={(value) =>
                      update({ particleCount: Math.round(value) })
                    }
                  />
                  <PropertySlider
                    isDisabled={disabled}
                    label="Speed"
                    value={effect.config.speed}
                    min={0}
                    max={Math.max(500, effect.config.speed)}
                    step={10}
                    onChange={(value) => update({ speed: value })}
                  />
                  <PropertySlider
                    isDisabled={disabled}
                    label="Gravity"
                    value={effect.config.gravity}
                    min={Math.min(-500, effect.config.gravity)}
                    max={Math.max(500, effect.config.gravity)}
                    step={10}
                    onChange={(value) => update({ gravity: value })}
                  />
                  <PropertySlider
                    isDisabled={disabled}
                    label="Emission Rate"
                    value={effect.config.emissionRate}
                    min={0}
                    max={Math.max(500, effect.config.emissionRate)}
                    step={1}
                    onChange={(value) => update({ emissionRate: value })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <PropertySlider
                      isDisabled={disabled}
                      label="Min Size"
                      value={effect.config.size.min}
                      min={0}
                      max={effect.config.size.max}
                      step={1}
                      onChange={(value) =>
                        update((current) => ({
                          size: {
                            ...current.size,
                            min: Math.min(value, current.size.max),
                          },
                        }))
                      }
                    />
                    <PropertySlider
                      isDisabled={disabled}
                      label="Max Size"
                      value={effect.config.size.max}
                      min={effect.config.size.min}
                      max={Math.max(30, effect.config.size.max)}
                      step={1}
                      onChange={(value) =>
                        update((current) => ({
                          size: {
                            ...current.size,
                            max: Math.max(value, current.size.min),
                          },
                        }))
                      }
                    />
                  </div>
                  <PropertySlider
                    isDisabled={disabled}
                    label="Turbulence"
                    value={effect.config.turbulence}
                    min={0}
                    max={Math.max(100, effect.config.turbulence)}
                    step={5}
                    onChange={(value) => update({ turbulence: value })}
                  />
                  <Label className="block space-y-1.5 text-xs font-normal text-fg-2">
                    <span>Blend Mode</span>
                    <Select
                      value={effect.config.blendMode}
                      disabled={disabled}
                      onValueChange={(value) => {
                        if (
                          ["normal", "add", "multiply", "screen"].includes(
                            value,
                          )
                        )
                          update({
                            blendMode: value as ParticleConfig["blendMode"],
                          });
                      }}
                    >
                      <SelectTrigger
                        aria-label="Blend Mode"
                        className="h-[30px] text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="add">Additive</SelectItem>
                        <SelectItem value="multiply">Multiply</SelectItem>
                        <SelectItem value="screen">Screen</SelectItem>
                      </SelectContent>
                    </Select>
                  </Label>
                </CollapsibleContent>
              </div>
            </Collapsible>
            <Collapsible open={colorsOpen} onOpenChange={setColorsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 w-full justify-between px-0 text-[11px] text-fg-2"
                >
                  Colors ({effect.config.colors.length})
                  <ChevronDown size={12} className={colorsOpen ? undefined : "-rotate-90"} aria-hidden />
                </Button>
              </CollapsibleTrigger>
              <div inert={!colorsOpen} aria-hidden={!colorsOpen}>
                <CollapsibleContent className="pt-2">
                  <div className="flex flex-wrap gap-1">
                    {effect.config.colors.map((color, index) => (
                      <ColorSwatch
                        key={index}
                        disabled={disabled}
                        color={color}
                        onChange={(value) =>
                          update((current) => ({
                            colors: current.colors.map((item, i) =>
                              i === index ? value : item,
                            ),
                          }))
                        }
                        onRemove={
                          effect.config.colors.length > 1
                            ? () =>
                                update((current) => ({
                                  colors:
                                    current.colors.length > 1
                                      ? current.colors.filter(
                                          (_, i) => i !== index,
                                        )
                                      : current.colors,
                                }))
                            : undefined
                        }
                      />
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Add color"
                      onClick={() =>
                        update((current) => ({
                          colors: [...current.colors, "#ffffff"],
                        }))
                      }
                      className="h-7 w-7 border-dashed"
                    >
                      <Plus size={12} aria-hidden />
                    </Button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </CollapsibleContent>
        </div>
      </Card>
    </Collapsible>
  );
}

const ParticlePresetCard: React.FC<{
  preset: ParticlePreset;
  selected: boolean;
  onSelect: () => void;
}> = ({ preset, selected, onSelect }) => {
  const { active, handlers } = useLivePreviewActivity();
  const def = useMemo(() => particlePreviewDef(preset), [preset]);

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={`Preview ${preset.name}`}
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
        data-testid="particle-preset-preview"
        data-preset-id={preset.id}
        aria-hidden="true"
        className="relative mb-1.5 block aspect-video overflow-hidden rounded-md bg-bg-3"
      >
        <EffectLivePreview def={def} active={active} />
      </span>
      <span className="block truncate text-[9px] font-semibold text-fg">
        {preset.name}
      </span>
      <span className="block truncate text-[8px] text-fg-4">
        {preset.description}
      </span>
    </Button>
  );
};

interface ColorSwatchProps {
  disabled?: boolean;
  color: string;
  onChange: (color: string) => void;
  onRemove?: () => void;
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({
  color,
  onChange,
  onRemove,
  disabled,
}) => {
  return (
    <div className="flex items-center gap-1">
      <ColorSelector
        disabled={disabled}
        value={color}
        onChange={onChange}
        label={`Edit color ${color}`}
        showValue={false}
      />
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          type="button"
          aria-label="Remove color"
          title="Remove color"
          className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent hover:bg-bg-2 text-fg-3 hover:text-red-400"
        >
          {<Trash2 size={12} aria-hidden />}
        </Button>
      )}
    </div>
  );
};

