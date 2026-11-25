import {
  Button, Card, Input, Popover, PopoverContent, PopoverTrigger,
  Collapsible, CollapsibleContent, CollapsibleTrigger,
  Tabs, TabsList, TabsTrigger, TabsContent, cn,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Switch,
} from "@openreel/ui";
import React, { useCallback, useId, useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  RotateCcw,
  Eye,
  EyeOff,
  GripVertical,
  Copy,
  Search,
} from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { EffectAnimationControls } from "./EffectAnimationControls";
import { useCornerPinOverlayStore } from "../../../stores/corner-pin-overlay-store";
import { EffectPresetsPanel } from "./EffectPresetsPanel";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { applyEditorEffectToClip } from "../../../services/editor-effect-application";
import { toast } from "../../../stores/notification-store";
import type {
  VideoEffect,
  VideoEffectType,
} from "../../../bridges/effects-bridge";
import {
  getMotionShaderDef,
  getMotionShaderEffectDefs,
  defaultMotionShaderParams,
  isProEffectType,
  isBurnInEffectType,
  BURN_IN_SPECS,
  resolveBurnInParams,
  type BurnInEffectType,
  type BurnInParamSpec,
  describePluginEffect,
  getPluginRegistry,
  isPluginEffectType,
  pluginIdFromEffectType,
  resolvePluginParam,
  PRO_EFFECT_SPECS,
  PRO_EFFECT_TYPES,
  resolveProEffectParams,
  type ProEffectType,
  type Effect,
  type Project,
} from "@openreel/core";
import { ColorSelector } from "../../../motion/components/primitives";
import { useInstalledPlugins } from "../../../hooks/use-plugin-registry";
import { usePluginManagerStore } from "../../../stores/plugin-manager-store";
import { retryPlugin } from "../../../services/plugin-service";
import { ShaderPreviewBrowser } from "../../shaders/ShaderPreviewBrowser";
import {
  EDITOR_EFFECT_CATEGORIES,
  EDITOR_EFFECT_PREVIEWS,
  type EditorEffectPreviewDef,
} from "../panels/EffectsTransitionsPanel";
import {
  cloneVideoEffectStackWithFreshIds,
  copyVideoEffectStack,
  hasVideoEffectStackClipboard,
  subscribeToVideoEffectStackClipboard,
} from "../../../utils/video-effect-stack-clipboard";
import { lazyWithRetry } from "./lazy-retry";

function shaderEffectNumberValue(
  value: unknown,
  fallback: number | string,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return 0;
}

function effectNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function shaderEffectColorValue(
  value: unknown,
  fallback: number | string,
): string {
  if (typeof value === "string") return value;
  if (typeof fallback === "string") return fallback;
  return "#ffffff";
}

const EffectColorField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}> = ({ label, value, onChange, disabled }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-fg-2 font-normal text-[10px]">
      {label}
    </span>
    <div className="flex max-w-[150px] items-center">
      <ColorSelector
        value={value}
        onChange={onChange}
        label={`Select ${label.toLowerCase()}`}
        disabled={disabled}
      />
    </div>
  </div>
);

const EffectSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}> = ({ label, value, onChange, min, max, step = 1, unit = "", disabled }) => (
  <PropertySlider
    label={label}
    isDisabled={disabled}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    formatValue={(nextValue) =>
      `${step < 1 ? Number(nextValue.toFixed(2)) : Math.round(nextValue)}${unit}`
    }
  />
);

const UltraKeyControls = lazyWithRetry(() =>
  import("./UltraKeyControls").then((m) => ({ default: m.UltraKeyControls })),
);

const PRO_EFFECT_LABELS = Object.fromEntries(
  PRO_EFFECT_TYPES.map((type) => [type, PRO_EFFECT_SPECS[type].label]),
) as Record<ProEffectType, string>;

const BURN_IN_LABELS: Record<BurnInEffectType, string> = {
  "burn-in-timecode": BURN_IN_SPECS["burn-in-timecode"].label,
  "burn-in-name": BURN_IN_SPECS["burn-in-name"].label,
};

/** A text field that commits on Enter or blur, so typing a label is one undo step, not one per keystroke. */
const BurnInTextField: React.FC<{
  spec: Extract<BurnInParamSpec, { kind: "text" }>;
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}> = ({ spec, value, disabled, onCommit }) => {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-2 font-normal text-[10px]">{spec.label}</span>
      <Input
        aria-label={spec.label}
        value={draft}
        disabled={disabled}
        maxLength={spec.maxLength}
        placeholder={spec.placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="h-6 max-w-[150px] text-[10px] md:text-[10px]"
      />
    </div>
  );
};

/**
 * Inspector controls for the Timecode and Clip Name burn-ins, generated from BURN_IN_SPECS and grouped like
 * Premiere's panel (source, layout, text, background). The box options only show while the box is on.
 */
const BurnInControls: React.FC<{
  type: BurnInEffectType;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  disabled: boolean;
}> = ({ type, params, onChange, disabled }) => {
  const values = resolveBurnInParams(type, params);
  const visible = (spec: BurnInParamSpec): boolean => {
    if (spec.key === "hideExtension") return values.nameSource === "file";
    if (spec.key === "boxColor" || spec.key === "boxOpacity" || spec.key === "boxPadding") return values.box === true;
    return true;
  };
  const groups: BurnInParamSpec["group"][] = ["Source", "Layout", "Text", "Background"];
  return (
    <div className="space-y-3" data-testid={`burn-in-controls-${type}`}>
      {groups.map((group) => {
        const specs = BURN_IN_SPECS[type].params.filter((spec) => spec.group === group && visible(spec));
        if (specs.length === 0) return null;
        return (
          <section key={group} aria-label={`${group} options`} className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-fg-muted">{group}</div>
            {specs.map((spec) => {
              const value = values[spec.key];
              switch (spec.kind) {
                case "toggle":
                  return (
                    <div key={spec.key} className="flex items-center justify-between gap-2">
                      <span className="text-fg-2 font-normal text-[10px]">{spec.label}</span>
                      <Switch
                        aria-label={spec.label}
                        checked={value === true}
                        disabled={disabled}
                        onCheckedChange={(checked) => onChange({ [spec.key]: checked })}
                      />
                    </div>
                  );
                case "select":
                  return (
                    <div key={spec.key} className="flex items-center justify-between gap-2">
                      <span className="text-fg-2 font-normal text-[10px]">{spec.label}</span>
                      <Select value={String(value)} disabled={disabled} onValueChange={(next) => onChange({ [spec.key]: next })}>
                        <SelectTrigger aria-label={spec.label} className="h-6 max-w-[150px] text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {spec.options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                case "text":
                  return (
                    <BurnInTextField
                      key={spec.key}
                      spec={spec}
                      value={String(value)}
                      disabled={disabled}
                      onCommit={(next) => onChange({ [spec.key]: next })}
                    />
                  );
                case "color":
                  return (
                    <EffectColorField
                      key={spec.key}
                      disabled={disabled}
                      label={spec.label}
                      value={String(value)}
                      onChange={(next) => onChange({ [spec.key]: next })}
                    />
                  );
                default:
                  return (
                    <EffectSlider
                      key={spec.key}
                      disabled={disabled}
                      label={spec.label}
                      value={Number(value)}
                      onChange={(next) => onChange({ [spec.key]: next })}
                      min={spec.min}
                      max={spec.max}
                      step={spec.step}
                      unit={spec.unit}
                    />
                  );
              }
            })}
          </section>
        );
      })}
    </div>
  );
};

/** Turns the Corner Pin handles on the Program monitor on or off for one effect instance. */
const CornerPinMonitorToggle: React.FC<{ clipId: string; effectId: string }> = ({ clipId, effectId }) => {
  const active = useCornerPinOverlayStore((s) => s.clipId === clipId && s.effectId === effectId);
  React.useEffect(() => () => { const s = useCornerPinOverlayStore.getState(); if (s.clipId === clipId && s.effectId === effectId) s.close(); }, [clipId, effectId]);
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      className="h-[26px] w-full text-[10px]"
      aria-pressed={active}
      onClick={() => (active ? useCornerPinOverlayStore.getState().close() : useCornerPinOverlayStore.getState().open(clipId, effectId))}
    >
      {active ? "Hide corner handles" : "Edit corners on the Program monitor"}
    </Button>
  );
};

// VR Projection's "Fill sequence" button loads with the first VR Projection effect that is inspected.
const VrFillSequenceButton = lazyWithRetry(() => import("./VrFillSequenceButton").then((m) => ({ default: m.VrFillSequenceButton })));

/** Inspector controls for the pro effects library, generated from PRO_EFFECT_SPECS. */
const ProEffectControls: React.FC<{
  type: ProEffectType;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  disabled: boolean;
}> = ({ type, params, onChange, disabled }) => {
  const values = resolveProEffectParams(type, params);
  return (
    <>
      {PRO_EFFECT_SPECS[type].params.map((spec) => {
        if (spec.kind === "toggle") {
          return (
            <div key={spec.key} className="flex items-center justify-between gap-2">
              <span className="text-fg-2 font-normal text-[10px]">{spec.label}</span>
              <Switch
                aria-label={spec.label}
                checked={values[spec.key] === true}
                disabled={disabled}
                onCheckedChange={(checked) => onChange({ [spec.key]: checked })}
              />
            </div>
          );
        }
        if (spec.kind === "select") {
          return (
            <div key={spec.key} className="flex items-center justify-between gap-2">
              <span className="text-fg-2 font-normal text-[10px]">{spec.label}</span>
              <Select
                value={String(values[spec.key])}
                disabled={disabled}
                onValueChange={(value) => onChange({ [spec.key]: value })}
              >
                <SelectTrigger aria-label={spec.label} className="h-6 max-w-[150px] text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {spec.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }
        return (
          <EffectSlider
            key={spec.key}
            disabled={disabled}
            label={spec.label}
            value={Number(values[spec.key])}
            onChange={(v) => onChange({ [spec.key]: v })}
            min={spec.min ?? 0}
            max={spec.max ?? 100}
            step={spec.step}
            unit={spec.unit}
          />
        );
      })}
    </>
  );
};

/**
 * Controls for a third-party plugin effect, generated from its manifest.
 * An effect whose plugin is not installed is a placeholder: its saved
 * parameters stay in the project and are listed read-only until the plugin is
 * installed again.
 */
const PluginEffectControls: React.FC<{
  effect: VideoEffect;
  onChange: (params: Record<string, unknown>) => void;
  disabled: boolean;
}> = ({ effect, onChange, disabled }) => {
  useInstalledPlugins();
  const status = describePluginEffect(effect);
  if (!status) return null;
  if (status.kind === "missing") {
    const shown = Object.entries(effect.params).filter(([key]) => !key.startsWith("__"));
    return (
      <div className="space-y-2" data-testid="plugin-missing-placeholder">
        <p className="text-fg-2 font-normal text-[10px] leading-4">
          The plugin &quot;{status.id}&quot;{status.storedVersion ? ` (v${status.storedVersion})` : ""} is not
          installed, so this effect is not rendered. Its settings are kept and will apply again once you install it.
        </p>
        {shown.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] text-fg-2">
            {shown.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>{key}</dt>
                <dd className="truncate text-fg">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => usePluginManagerStore.getState().setOpen(true)}
        >
          Manage plugins
        </Button>
      </div>
    );
  }
  const { manifest } = status.plugin;
  const health = getPluginRegistry().getHealth(manifest.id);
  return (
    <>
      {status.kind === "version-mismatch" && (
        <p className="text-fg-2 font-normal text-[10px] leading-4" data-testid="plugin-version-note">
          Saved with v{status.storedVersion}; v{manifest.version} is installed.
        </p>
      )}
      {health.state !== "ok" && (
        <p role="status" data-testid="plugin-effect-error" className="whitespace-pre-wrap text-[10px] leading-4 text-fg-2">
          {health.state === "failed"
            ? `${health.tripped ? "Bypassed after repeated failures" : "Last frame failed"}: ${health.error ?? "unknown error"}`
            : `Shader error, using the CPU fallback: ${health.gpuError ?? ""}`}
          {health.tripped && (
            <Button variant="secondary" size="sm" className="ml-2" onClick={() => retryPlugin(manifest.id)}>
              Retry
            </Button>
          )}
        </p>
      )}
      {manifest.parameters.map((def) => {
        const value = resolvePluginParam(def, effect.params[def.key]);
        switch (def.type) {
          case "bool":
            return (
              <div key={def.key} className="flex items-center justify-between gap-2">
                <span className="text-fg-2 font-normal text-[10px]">{def.label}</span>
                <Switch
                  aria-label={def.label}
                  checked={value === true}
                  disabled={disabled}
                  onCheckedChange={(checked) => onChange({ [def.key]: checked })}
                />
              </div>
            );
          case "choice":
            return (
              <div key={def.key} className="flex items-center justify-between gap-2">
                <span className="text-fg-2 font-normal text-[10px]">{def.label}</span>
                <Select value={String(value)} disabled={disabled} onValueChange={(next) => onChange({ [def.key]: next })}>
                  <SelectTrigger aria-label={def.label} className="h-6 max-w-[150px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {def.choices?.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          case "color":
            return (
              <EffectColorField
                key={def.key}
                disabled={disabled}
                label={def.label}
                value={String(value)}
                onChange={(next) => onChange({ [def.key]: next })}
              />
            );
          case "point": {
            const point = value as { x: number; y: number };
            return (
              <React.Fragment key={def.key}>
                {(["x", "y"] as const).map((axis) => (
                  <EffectSlider
                    key={axis}
                    disabled={disabled}
                    label={`${def.label} ${axis.toUpperCase()}`}
                    value={point[axis]}
                    onChange={(next) => onChange({ [def.key]: { ...point, [axis]: next } })}
                    min={0}
                    max={1}
                    step={0.01}
                  />
                ))}
              </React.Fragment>
            );
          }
          default:
            return (
              <EffectSlider
                key={def.key}
                disabled={disabled}
                label={def.label}
                value={Number(value)}
                onChange={(next) => onChange({ [def.key]: next })}
                min={def.min ?? 0}
                max={def.max ?? 1}
                step={def.step}
                unit={def.unit}
              />
            );
        }
      })}
    </>
  );
};

/**
 * Effect Item Component - displays a single effect with controls
 */
const EffectItem: React.FC<{
  clipId: string;
  effect: VideoEffect;
  onUpdate: (effectId: string, params: Record<string, unknown>) => void;
  onToggle: (effectId: string, enabled: boolean) => void;
  onRemove: (effectId: string) => void;
  onDuplicate: (effectId: string) => void;
  onMove: (effectId: string, delta: -1 | 1) => void;
  onDropEffect: (sourceEffectId: string, targetEffectId: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  editingDisabled: boolean;
}> = ({
  clipId,
  effect,
  onUpdate,
  onToggle,
  onRemove,
  onDuplicate,
  onMove,
  onDropEffect,
  canMoveUp,
  canMoveDown,
  editingDisabled,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(true);

  const effectLabels: Record<VideoEffectType, string> = {
    brightness: "Brightness",
    contrast: "Contrast",
    saturation: "Saturation",
    grayscale: "Grayscale",
    sepia: "Sepia",
    invert: "Invert",
    hue: "Hue",
    blur: "Blur",
    sharpen: "Sharpen",
    vignette: "Vignette",
    grain: "Grain",
    temperature: "Temperature",
    tint: "Tint",
    tonal: "Tonal",
    chromaKey: "Chroma Key",
    shadow: "Drop Shadow",
    glow: "Glow",
    "motion-blur": "Motion Blur",
    "radial-blur": "Radial Blur",
    "chromatic-aberration": "Chromatic Aberration",
    ...PRO_EFFECT_LABELS,
    ...BURN_IN_LABELS,
    shader: "Shader",
  };

  const shaderDef =
    effect.type === "shader"
      ? getMotionShaderDef(String(effect.params.shaderId ?? ""))
      : undefined;

  const pluginId = pluginIdFromEffectType(effect.type);
  const headerLabel = pluginId
    ? getPluginRegistry().get(pluginId)?.manifest.name ?? `${pluginId} (plugin missing)`
    : effect.type === "shader"
      ? shaderDef?.name ?? "Shader"
      : effectLabels[effect.type] || effect.type;

  const renderParams = () => {
    if (effect.type === "shader") {
      if (!shaderDef) {
        return (
          <span className="text-fg-2 font-normal text-[10px]">
            Unknown shader
          </span>
        );
      }
      return (
        <>
          {shaderDef.params.map((param) => {
            if (param.type === "color") {
              return (
                <EffectColorField disabled={editingDisabled}
                  key={param.name}
                  label={param.label}
                  value={shaderEffectColorValue(
                    effect.params[param.name],
                    param.default,
                  )}
                  onChange={(v) => onUpdate(effect.id, { [param.name]: v })}
                />
              );
            }
            return (
              <EffectSlider disabled={editingDisabled}
                key={param.name}
                label={param.label}
                value={shaderEffectNumberValue(
                  effect.params[param.name],
                  param.default,
                )}
                onChange={(v) => onUpdate(effect.id, { [param.name]: v })}
                min={param.min}
                max={param.max}
                step={param.step}
              />
            );
          })}
        </>
      );
    }
    if (isPluginEffectType(effect.type)) {
      return (
        <PluginEffectControls
          effect={effect}
          disabled={editingDisabled}
          onChange={(params) => onUpdate(effect.id, params)}
        />
      );
    }
    if (effect.type === "hsl-secondary") {
      return (
        <span className="text-fg-2 font-normal text-[10px]">
          Edit this secondary in the Color tab, HSL Secondary.
        </span>
      );
    }
    if (isBurnInEffectType(effect.type)) {
      return (
        <BurnInControls
          type={effect.type}
          params={effect.params}
          disabled={editingDisabled}
          onChange={(params) => onUpdate(effect.id, params)}
        />
      );
    }
    if (effect.type === "ultra-key") {
      return (
        <React.Suspense fallback={null}>
          <UltraKeyControls
            clipId={clipId}
            effectId={effect.id}
            params={effect.params}
            disabled={editingDisabled}
            onChange={(params) => onUpdate(effect.id, params)}
          />
        </React.Suspense>
      );
    }
    if (isProEffectType(effect.type)) {
      return (
        <>
        {effect.type === "corner-pin" && <CornerPinMonitorToggle clipId={clipId} effectId={effect.id} />}
        {effect.type === "vr-projection" && (
          <React.Suspense fallback={null}>
            <VrFillSequenceButton clipId={clipId} effectId={effect.id} disabled={editingDisabled} onChange={(params) => onUpdate(effect.id, params)} />
          </React.Suspense>
        )}
        <ProEffectControls
          type={effect.type}
          params={effect.params}
          disabled={editingDisabled}
          onChange={(params) => onUpdate(effect.id, params)}
        />
        </>
      );
    }
    switch (effect.type) {
      case "brightness":
        return (
          <EffectSlider disabled={editingDisabled}
            label="Value"
            value={effectNumberValue(effect.params.value, 0)}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "contrast":
        return (
          <EffectSlider disabled={editingDisabled}
            label="Value"
            value={effectNumberValue(effect.params.value, 1) * 100}
            onChange={(v) => onUpdate(effect.id, { value: v / 100 })}
            min={0}
            max={200}
            unit="%"
          />
        );
      case "saturation":
        return (
          <EffectSlider disabled={editingDisabled}
            label="Value"
            value={effectNumberValue(effect.params.value, 1) * 100}
            onChange={(v) => onUpdate(effect.id, { value: v / 100 })}
            min={0}
            max={200}
            unit="%"
          />
        );
      case "grayscale":
      case "sepia":
      case "invert":
        return (
          <EffectSlider disabled={editingDisabled}
            label="Amount"
            value={effectNumberValue(effect.params.amount, 1) * 100}
            onChange={(v) => onUpdate(effect.id, { amount: v / 100 })}
            min={0}
            max={100}
            unit="%"
          />
        );
      case "blur":
        return (
          <EffectSlider disabled={editingDisabled}
            label="Radius"
            value={effectNumberValue(effect.params.radius, 0)}
            onChange={(v) => onUpdate(effect.id, { radius: v })}
            min={0}
            max={100}
            unit="px"
          />
        );
      case "sharpen":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Amount"
              value={effectNumberValue(effect.params.amount, 0)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={200}
              unit="%"
            />
            <EffectSlider disabled={editingDisabled}
              label="Radius"
              value={effectNumberValue(effect.params.radius, 1)}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0.1}
              max={10}
              step={0.1}
            />
          </>
        );
      case "vignette":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Amount"
              value={effectNumberValue(effect.params.amount, 0)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider disabled={editingDisabled}
              label="Midpoint"
              value={effectNumberValue(effect.params.midpoint, 0.5) * 100}
              onChange={(v) => onUpdate(effect.id, { midpoint: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider disabled={editingDisabled}
              label="Feather"
              value={effectNumberValue(effect.params.feather, 0.3) * 100}
              onChange={(v) => onUpdate(effect.id, { feather: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "grain":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Amount"
              value={effectNumberValue(effect.params.amount, 0)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider disabled={editingDisabled}
              label="Size"
              value={effectNumberValue(effect.params.size, 1)}
              onChange={(v) => onUpdate(effect.id, { size: v })}
              min={0.5}
              max={5}
              step={0.1}
            />
          </>
        );
      case "temperature":
        return (
          <EffectSlider disabled={editingDisabled}
            label="Value"
            value={effectNumberValue(effect.params.value, 0)}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "tint":
        return (
          <EffectSlider disabled={editingDisabled}
            label="Value"
            value={effectNumberValue(effect.params.value, 0)}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "shadow":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Offset X"
              value={effectNumberValue(effect.params.offsetX, 5)}
              onChange={(v) => onUpdate(effect.id, { offsetX: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider disabled={editingDisabled}
              label="Offset Y"
              value={effectNumberValue(effect.params.offsetY, 5)}
              onChange={(v) => onUpdate(effect.id, { offsetY: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider disabled={editingDisabled}
              label="Blur"
              value={effectNumberValue(effect.params.blur, 10)}
              onChange={(v) => onUpdate(effect.id, { blur: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider disabled={editingDisabled}
              label="Opacity"
              value={effectNumberValue(effect.params.opacity, 0.8) * 100}
              onChange={(v) => onUpdate(effect.id, { opacity: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "glow":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Radius"
              value={effectNumberValue(effect.params.radius, 10)}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider disabled={editingDisabled}
              label="Intensity"
              value={effectNumberValue(effect.params.intensity, 1) * 100}
              onChange={(v) => onUpdate(effect.id, { intensity: v / 100 })}
              min={0}
              max={300}
              unit="%"
            />
          </>
        );
      case "motion-blur":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Angle"
              value={effectNumberValue(effect.params.angle, 0)}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
            <EffectSlider disabled={editingDisabled}
              label="Distance"
              value={effectNumberValue(effect.params.distance, 20)}
              onChange={(v) => onUpdate(effect.id, { distance: v })}
              min={0}
              max={100}
              unit="px"
            />
          </>
        );
      case "radial-blur":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Amount"
              value={effectNumberValue(effect.params.amount, 20)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider disabled={editingDisabled}
              label="Center X"
              value={effectNumberValue(effect.params.centerX, 50)}
              onChange={(v) => onUpdate(effect.id, { centerX: v })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider disabled={editingDisabled}
              label="Center Y"
              value={effectNumberValue(effect.params.centerY, 50)}
              onChange={(v) => onUpdate(effect.id, { centerY: v })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "chromatic-aberration":
        return (
          <>
            <EffectSlider disabled={editingDisabled}
              label="Amount"
              value={effectNumberValue(effect.params.amount, 5)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={50}
              step={0.5}
              unit="px"
            />
            <EffectSlider disabled={editingDisabled}
              label="Angle"
              value={effectNumberValue(effect.params.angle, 0)}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-effect-id={effect.id}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-openreel-effect-order")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        const sourceEffectId = event.dataTransfer.getData(
          "application/x-openreel-effect-order",
        );
        if (!sourceEffectId) return;
        event.preventDefault();
        onDropEffect(sourceEffectId, effect.id);
      }}
    >
      <Collapsible asChild open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className={cn("min-w-0 rounded-[7px] border shadow-none", "border-transparent bg-bg-2 text-fg", "p-0", !effect.enabled ? "opacity-60" : undefined)}
      >
        <div className="flex items-center gap-0.5 border-b border-border/70 bg-bg-2 px-1.5 py-1.5">
          <Button variant="ghost" size="sm"
            type="button"
            draggable={!editingDisabled}
            disabled={editingDisabled}
            aria-label={`Reorder ${headerLabel}`}
            title="Drag to reorder effect"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(
                "application/x-openreel-effect-order",
                effect.id,
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && canMoveUp) {
                event.preventDefault();
                onMove(effect.id, -1);
              } else if (event.key === "ArrowDown" && canMoveDown) {
                event.preventDefault();
                onMove(effect.id, 1);
              }
            }}
            className="grid h-6 w-4 shrink-0 cursor-grab place-items-center rounded p-0 [&_svg]:size-3 text-fg-3 hover:bg-hover hover:text-fg active:cursor-grabbing"
          >
            <GripVertical size={12} aria-hidden />
          </Button>
          <CollapsibleTrigger asChild>
          <Button variant="ghost" type="button" aria-label={headerLabel.trim() || undefined} title={headerLabel} className="h-6 min-w-0 flex-1 justify-start gap-1 rounded-md px-1.5 text-xs font-semibold text-fg-2 hover:bg-bg-2 [&_svg]:size-3">
            <span className="flex h-3 w-3 shrink-0 items-center justify-center">{<ChevronDown
                size={12}
                className={`transition-transform ${
                  isExpanded ? "" : "-rotate-90"
                } text-fg-3`}
                aria-hidden
              />}</span>
            {(headerLabel) ? <span className="truncate">{headerLabel}</span> : null}
          </Button>
          </CollapsibleTrigger>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(effect.id, -1)} type="button" aria-label={`Move ${headerLabel} up`} title={`Move ${headerLabel} up`} disabled={editingDisabled || !canMoveUp} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-6 w-6 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<ArrowUp size={11} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(effect.id, 1)} type="button" aria-label={`Move ${headerLabel} down`} title={`Move ${headerLabel} down`} disabled={editingDisabled || !canMoveDown} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-6 w-6 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<ArrowDown size={11} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onToggle(effect.id, !effect.enabled)} disabled={editingDisabled} type="button" aria-label={effect.enabled ? "Disable effect" : "Enable effect"} title={effect.enabled ? "Disable effect" : "Enable effect"} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-6 w-6 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {effect.enabled ? (
                <Eye size={12} className="text-fg-2" aria-hidden />
              ) : (
                <EyeOff size={12} className="text-fg-3" aria-hidden />
              )}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onDuplicate(effect.id)} disabled={editingDisabled} type="button" aria-label="Duplicate effect" title="Duplicate effect" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-6 w-6 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<Copy size={12} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onRemove(effect.id)} disabled={editingDisabled} type="button" aria-label="Remove effect" title="Remove effect" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-6 w-6 bg-transparent hover:bg-bg-2 text-fg-3 hover:text-red-400">
            {<RotateCcw size={12} aria-hidden />}
          </Button>
        </div>
        <div inert={!isExpanded} aria-hidden={!isExpanded}>
          <CollapsibleContent><div className="space-y-3 p-3">{renderParams()}<EffectAnimationControls clipId={clipId} effect={effect} disabled={editingDisabled} /></div></CollapsibleContent>
        </div>
      </Card>
      </Collapsible>
    </div>
  );
};

function VisualEffectPreview({
  def,
  onSelect,
}: {
  def: EditorEffectPreviewDef;
  onSelect: (def: EditorEffectPreviewDef) => void;
}): React.ReactElement {
  const effectedStyle = def.previewStyle(0.82);
  return (
    <Button variant="ghost" size="sm"
      type="button"
      aria-label={`Preview and add ${def.label}`}
      onClick={() => onSelect(def)}
      className="group block h-auto w-full min-w-0 whitespace-normal text-[length:inherit] font-normal leading-[inherit] rounded-[9px] border border-border bg-bg-2 p-1.5 text-left transition-colors hover:border-accent/60 hover:bg-bg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="relative block h-[66px] overflow-hidden rounded-[7px] bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)]">
        <span className="absolute inset-0 grid place-items-center text-lg font-black tracking-tight text-white/95">
          Aa
        </span>
        <span
          className="absolute inset-0 grid place-items-center overflow-hidden border-l border-white/45 bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)] text-lg font-black tracking-tight text-white/95"
          style={{
            ...effectedStyle,
            clipPath: "inset(0 0 0 50%)",
          }}
        >
          Aa
        </span>
        <span className="absolute bottom-1 left-1 rounded bg-black/45 px-1 py-0.5 text-[8px] font-semibold uppercase text-white/75">
          Before
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-0.5 text-[8px] font-semibold uppercase text-white/90">
          Effect
        </span>
      </span>
      <span className="mt-1.5 block truncate text-[11px] font-semibold text-fg-2">
        {def.label}
      </span>
      <span className="block truncate text-[9px] text-fg-4">
        {def.category} · {def.description}
      </span>
    </Button>
  );
}

function EffectPickerContent({
  onSelect,
  onSelectShader,
  mediaKind,
}: {
  onSelect: (def: EditorEffectPreviewDef) => void;
  onSelectShader: (shaderId: string) => void;
  mediaKind: string;
}) {
  const [query, setQuery] = React.useState("");
  const tabId = useId();
  const shaderDefs = useMemo(() => getMotionShaderEffectDefs(), []);
  const availableEffects = useMemo(() => EDITOR_EFFECT_PREVIEWS.filter(effect =>
    effect.type === "stabilize" ? mediaKind === "video"
      : effect.type === "lut" ? mediaKind === "video" || mediaKind === "image" : true,
  ), [mediaKind]);
  const visibleEffects = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return availableEffects.filter(effect => terms.every(term =>
      `${effect.label} ${effect.description} ${effect.category}`.toLowerCase().includes(term),
    ));
  }, [availableEffects, query]);

  return <Tabs defaultValue="effects" className="min-w-0">
    <TabsList aria-label="Effect picker categories" layoutId={tabId} className="grid h-8 shrink-0 grid-cols-2 bg-bg-2 p-0.5">
      <TabsTrigger value="effects" className="h-7 text-[11px]">Effects · {availableEffects.length}</TabsTrigger>
      <TabsTrigger value="shaders" className="h-7 text-[11px]">Shaders · {shaderDefs.length}</TabsTrigger>
    </TabsList>
    <TabsContent value="effects" className="mt-2.5 min-w-0 space-y-2.5">
      <label className="relative block shrink-0">
        <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <Input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Search visual effects" aria-label="Search visual effects" autoFocus
          className="h-8 min-w-0 rounded-md bg-bg-2 py-0 pl-8 pr-2.5 text-xs md:text-xs" />
      </label>
      <div className="space-y-3 overflow-y-auto pr-2" style={{ maxHeight: "min(390px, calc(var(--radix-popover-content-available-height) - 110px))" }}>
          {EDITOR_EFFECT_CATEGORIES.map(category => {
            const effects = visibleEffects.filter(effect => effect.category === category);
            if (!effects.length) return null;
            return <section key={category} aria-label={`${category} effects`}>
              <div className="mb-1.5 flex items-center justify-between px-0.5 text-[9px] text-fg-muted">
                <span className="font-bold uppercase tracking-[0.12em]">{category}</span>
                <span className="tabular-nums">{effects.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {effects.map(effect => <VisualEffectPreview key={effect.id ?? effect.type} def={effect} onSelect={onSelect} />)}
              </div>
            </section>;
          })}
          {!visibleEffects.length && <p role="status" className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-fg-muted">No effects match “{query}”.</p>}
      </div>
    </TabsContent>
    <TabsContent value="shaders" className="mt-2.5 min-w-0">
      <ShaderPreviewBrowser defs={shaderDefs} onSelect={onSelectShader} sample="effect" label="Shader effect previews" />
    </TabsContent>
  </Tabs>;
}

function EffectTypeSelector({ onSelect, onSelectShader, disabled, mediaKind }: {
  onSelect: (def: EditorEffectPreviewDef) => Promise<boolean>;
  onSelectShader: (shaderId: string) => Promise<boolean>;
  disabled: boolean;
  mediaKind: string;
}) {
  const [open, setOpen] = React.useState(false);
  const pending = React.useRef(false);
  const navigated = React.useRef(false);
  const choose = async (apply: () => Promise<boolean>, navigation = false) => {
    if (disabled || pending.current) return;
    pending.current = true;
    try {
      if (await apply()) {
        navigated.current = navigation;
        setOpen(false);
      }
    }
    finally { pending.current = false; }
  };
  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <Popover open={open} onOpenChange={next => { if (next) navigated.current = false; setOpen(next); }}>
    <PopoverTrigger asChild>
      <Button variant="outline" type="button" aria-label="Add Effect" disabled={disabled}
        className="h-7 w-full justify-center gap-1.5 rounded-md border-primary/30 bg-primary/10 px-2.5 text-xs text-primary hover:bg-primary/20">
        Add Effect <ChevronDown size={12} aria-hidden />
      </Button>
    </PopoverTrigger>
    <PopoverContent side="bottom" align="end" collisionPadding={16} aria-label="Add video effect"
      onCloseAutoFocus={event => { if (navigated.current) event.preventDefault(); }}
      className="max-h-[min(520px,var(--radix-popover-content-available-height))] w-[430px] max-w-[calc(100vw-32px)] min-w-0 overflow-y-auto rounded-lg bg-bg-1 p-2.5 text-fg">
      <EffectPickerContent mediaKind={mediaKind} onSelect={def => { void choose(() => onSelect(def), def.type === "stabilize"); }}
        onSelectShader={id => { void choose(() => onSelectShader(id)); }} />
    </PopoverContent>
  </Popover>;
}

/**
 * VideoEffectsSection Props
 */
interface VideoEffectsSectionProps {
  clipId: string;
}

/**
 * VideoEffectsSection Component
 *
 * - 1.1: Display sliders for brightness, contrast, saturation
 * - 1.2: Apply video effects within 200ms
 * - 2.1: Blur effect with radius control
 * - 2.2: Sharpen effect with amount and radius
 * - 2.3: Vignette effect with amount, midpoint, feather
 * - 2.4: Grain effect with amount and size
 */
const NO_EFFECTS: readonly Effect[] = [];

function findEffectClip(project: Project, clipId: string) {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find(candidate => candidate.id === clipId);
    if (clip) return clip;
  }
  return project.textClips?.find(clip => clip.id === clipId)
    ?? project.shapeClips?.find(clip => clip.id === clipId)
    ?? project.svgClips?.find(clip => clip.id === clipId)
    ?? project.stickerClips?.find(clip => clip.id === clipId);
}

function displayEffects(effects: readonly Effect[]): VideoEffect[] {
  return effects.map((effect, order) => ({
    ...effect, type: effect.type as VideoEffectType, order,
  }));
}

export const VideoEffectsSection: React.FC<VideoEffectsSectionProps> = React.memo(({ clipId }) => {
  const { projectId, authoredEffects, trackLocked, mediaKind } = useProjectStore(useShallow(state => {
    const clip = findEffectClip(state.project, clipId);
    const track = state.project.timeline.tracks.find(candidate => candidate.id === clip?.trackId);
    const media = clip && "mediaId" in clip
      ? state.project.mediaLibrary.items.find(item => item.id === clip.mediaId) : undefined;
    return {
      projectId: state.project.id,
      authoredEffects: clip?.effects ?? NO_EFFECTS,
      trackLocked: !clip || !track || track.locked,
      mediaKind: clip && "mediaId" in clip ? media?.type ?? track?.type ?? "video" : "graphic",
    };
  }));
  const exporting = useUIStore(state => state.exportState.isExporting);
  const applying = useUIStore(state => state.effectApplicationClipId !== null);
  const processing = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const editingDisabled = trackLocked || exporting || applying || processing;
  const effects = useMemo(() => displayEffects(authoredEffects), [authoredEffects]);
  const hasStackClipboard = useSyncExternalStore(
    subscribeToVideoEffectStackClipboard, hasVideoEffectStackClipboard, () => false,
  );
  const canAct = useCallback((edit = true) => {
    const state = useProjectStore.getState();
    const clip = findEffectClip(state.project, clipId);
    if (state.project.id !== projectId || !clip) return false;
    return !edit || (state.project.timeline.tracks.some(track => track.id === clip.trackId && !track.locked)
      && !useUIStore.getState().exportState.isExporting
      && useUIStore.getState().effectApplicationClipId === null
      && !useTimelineStore.getState().playbackLockedReason);
  }, [clipId, projectId]);
  const currentEffects = useCallback(() =>
    displayEffects(findEffectClip(useProjectStore.getState().project, clipId)?.effects ?? NO_EFFECTS),
  [clipId]);

  const handleAddEffect = useCallback(async (def: EditorEffectPreviewDef) => {
    if (!canAct()) return false;
    try {
      const applied = await applyEditorEffectToClip(clipId, { effectType: def.type, effectParams: def.params });
      if (!applied) toast.error("Effect could not be applied", "Select an unlocked compatible layer and try again.");
      return applied;
    } catch {
      toast.error("Effect could not be applied", "The effect could not be saved on this clip.");
      return false;
    }
  }, [clipId, canAct]);
  const handleAddShaderEffect = useCallback(async (shaderId: string) => {
    const def = getMotionShaderDef(shaderId);
    if (!def || def.category !== "effect" || !canAct()) return false;
    try {
      return !!await useProjectStore.getState().addVideoEffect(clipId, "shader", {
        shaderId, ...defaultMotionShaderParams(def),
      });
    } catch {
      toast.error("Effect could not be applied", "The shader could not be saved on this clip.");
      return false;
    }
  }, [clipId, canAct]);
  const handleUpdateEffect = useCallback((effectId: string, params: Record<string, unknown>) => {
    if (canAct()) void useProjectStore.getState().updateVideoEffect(clipId, effectId, params);
  }, [clipId, canAct]);
  const handleToggleEffect = useCallback((effectId: string, enabled: boolean) => {
    if (canAct()) void useProjectStore.getState().toggleVideoEffect(clipId, effectId, enabled);
  }, [clipId, canAct]);
  const handleRemoveEffect = useCallback((effectId: string) => {
    if (canAct()) void useProjectStore.getState().removeVideoEffect(clipId, effectId);
  }, [clipId, canAct]);
  const handleDuplicateEffect = useCallback((effectId: string) => {
    if (canAct()) void useProjectStore.getState().duplicateVideoEffect(clipId, effectId);
  }, [clipId, canAct]);
  const handleCopyStack = useCallback(() => {
    if (canAct(false)) copyVideoEffectStack(currentEffects());
  }, [canAct, currentEffects]);
  const handlePasteStack = useCallback((mode: "append" | "replace") => {
    if (!canAct()) return;
    const copies = cloneVideoEffectStackWithFreshIds();
    if (copies) void useProjectStore.getState().replaceVideoEffects(clipId,
      mode === "replace" ? copies : [...currentEffects(), ...copies]);
  }, [clipId, canAct, currentEffects]);
  const handleClearStack = useCallback(() => {
    if (canAct() && currentEffects().length) void useProjectStore.getState().replaceVideoEffects(clipId, []);
  }, [clipId, canAct, currentEffects]);
  const handleMoveEffect = useCallback((effectId: string, delta: -1 | 1) => {
    if (!canAct()) return;
    const effects = currentEffects();
    const sourceIndex = effects.findIndex(effect => effect.id === effectId);
    const targetIndex = sourceIndex + delta;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= effects.length) return;
    const nextIds = effects.map(effect => effect.id);
    [nextIds[sourceIndex], nextIds[targetIndex]] = [nextIds[targetIndex]!, nextIds[sourceIndex]!];
    void useProjectStore.getState().reorderVideoEffects(clipId, nextIds);
  }, [clipId, canAct, currentEffects]);
  const handleDropEffect = useCallback((sourceEffectId: string, targetEffectId: string) => {
    if (sourceEffectId === targetEffectId || !canAct()) return;
    const effects = currentEffects();
    const sourceIndex = effects.findIndex(effect => effect.id === sourceEffectId);
    const targetIndex = effects.findIndex(effect => effect.id === targetEffectId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextIds = effects.map(effect => effect.id);
    const [moved] = nextIds.splice(sourceIndex, 1);
    nextIds.splice(targetIndex, 0, moved!);
    void useProjectStore.getState().reorderVideoEffects(clipId, nextIds);
  }, [clipId, canAct, currentEffects]);

  return (
    <div key={`${projectId}:${clipId}`} role="group" aria-label="Visual effect stack" className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        <Button onClick={handleCopyStack} type="button" aria-label="Copy effect stack" disabled={(effects.length === 0)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
          <span className="truncate">{"Copy effect stack"}</span>
        </Button>
        <Button onClick={() => handlePasteStack("append")} type="button" aria-label="Paste effect stack" disabled={editingDisabled || !hasStackClipboard} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
          <span className="truncate">{"Paste effect stack"}</span>
        </Button>
        <Button onClick={() => handlePasteStack("replace")} type="button" aria-label="Paste and replace effects" disabled={editingDisabled || !hasStackClipboard} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
          <span className="truncate">Paste &amp; replace</span>
        </Button>
        <Button onClick={handleClearStack} type="button" aria-label="Clear effect stack" disabled={editingDisabled || effects.length === 0} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
          <span className="truncate">{"Clear effect stack"}</span>
        </Button>
      </div>
      {effects.length === 0 ? (
        <span className="text-fg-2 font-normal block py-2 text-center text-[10px]"
        >
          No effects applied
        </span>
      ) : (
        <div className="space-y-2">
          {effects.map((effect, index) => (
            <EffectItem
              key={effect.id}
              clipId={clipId}
              effect={effect}
              onUpdate={handleUpdateEffect}
              onToggle={handleToggleEffect}
              onRemove={handleRemoveEffect}
              onDuplicate={handleDuplicateEffect}
              onMove={handleMoveEffect}
              onDropEffect={handleDropEffect}
              editingDisabled={editingDisabled}
              canMoveUp={index > 0}
              canMoveDown={index < effects.length - 1}
            />
          ))}
        </div>
      )}
      <EffectPresetsPanel clipId={clipId} hasEffects={effects.length > 0} disabled={editingDisabled} />
      <EffectTypeSelector key={`${projectId}:${clipId}`} disabled={editingDisabled} mediaKind={mediaKind}
        onSelect={handleAddEffect}
        onSelectShader={handleAddShaderEffect}
      />
    </div>
  );
});
