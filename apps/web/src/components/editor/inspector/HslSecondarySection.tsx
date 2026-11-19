import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Switch, cn } from "@openreel/ui";
import {
  Diamond,
  Eye,
  EyeOff,
  Minus,
  Pipette,
  Plus,
  RotateCcw,
  Trash2,
} from "@/icons/lucide-compat";
import {
  KeyframeEngine,
  PRO_EFFECT_DEFAULTS,
  resolveProEffectParams,
  type Effect,
} from "@openreel/core";
import { effectInstanceKeyframeProperty } from "@openreel/core/video/effect-instance-keyframes";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  useColorMonitorStore,
  type MatteView,
} from "../../../stores/color-monitor-store";
import { PropertySlider } from "./shell/PropertySlider";

const keyframeEngine = new KeyframeEngine();
const NO_EFFECTS: readonly Effect[] = [];
const TYPE = "hsl-secondary";

const MATTE_VIEWS: ReadonlyArray<{ value: MatteView; label: string }> = [
  { value: 0, label: "Off" },
  { value: 1, label: "Color" },
  { value: 2, label: "Gray" },
  { value: 3, label: "B/W" },
];

const MASK_SHAPES = [
  { value: "none", label: "None" },
  { value: "ellipse", label: "Ellipse" },
  { value: "rectangle", label: "Rectangle" },
] as const;

type Params = Record<string, number | boolean | string>;

interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

const HUE: SliderSpec[] = [
  { key: "hueMin", label: "Min", min: 0, max: 360, unit: "°" },
  { key: "hueMax", label: "Max", min: 0, max: 360, unit: "°" },
  { key: "hueSoft", label: "Soft", min: 0, max: 180, unit: "°" },
];
const SAT: SliderSpec[] = [
  { key: "satMin", label: "Min", min: 0, max: 100, unit: "%" },
  { key: "satMax", label: "Max", min: 0, max: 100, unit: "%" },
  { key: "satSoft", label: "Soft", min: 0, max: 100, unit: "%" },
];
const LUM: SliderSpec[] = [
  { key: "lumMin", label: "Min", min: 0, max: 100, unit: "%" },
  { key: "lumMax", label: "Max", min: 0, max: 100, unit: "%" },
  { key: "lumSoft", label: "Soft", min: 0, max: 100, unit: "%" },
];
const REFINE: SliderSpec[] = [
  { key: "denoise", label: "Denoise", min: 0, max: 100, unit: "%" },
  { key: "blur", label: "Blur", min: 0, max: 20, step: 0.5, unit: "px" },
];
const CORRECT: SliderSpec[] = [
  { key: "temperature", label: "Temperature", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "sharpen", label: "Sharpen", min: 0, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
];
const MASK: SliderSpec[] = [
  { key: "maskX", label: "Centre X", min: 0, max: 100, step: 0.5, unit: "%" },
  { key: "maskY", label: "Centre Y", min: 0, max: 100, step: 0.5, unit: "%" },
  { key: "maskW", label: "Width", min: 0, max: 100, step: 0.5, unit: "%" },
  { key: "maskH", label: "Height", min: 0, max: 100, step: 0.5, unit: "%" },
  { key: "maskFeather", label: "Feather", min: 0, max: 200, unit: "px" },
];

const BLOCK = "flex flex-col gap-2 rounded-[7px] border border-border bg-bg-1 p-2";
const BLOCK_TITLE = "text-[10px] font-semibold uppercase tracking-wide text-fg-3";

/** Mini colour wheel: drag the puck towards a hue to push the matte that way. */
const MiniWheel: React.FC<{
  x: number;
  y: number;
  disabled: boolean;
  onCommit: (x: number, y: number) => void;
}> = ({ x, y, disabled, onCommit }) => {
  const [drag, setDrag] = React.useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const shown = drag ?? { x, y };

  const read = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    let nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    let ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const len = Math.hypot(nx, ny);
    if (len > 1) {
      nx /= len;
      ny /= len;
    }
    return { x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100 };
  };

  return (
    <div className="flex items-center gap-3">
      <div
        ref={ref}
        role="slider"
        aria-label="Secondary color wheel"
        aria-valuetext={`x ${shown.x}, y ${shown.y}`}
        aria-valuenow={Math.round(Math.hypot(shown.x, shown.y) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={disabled ? -1 : 0}
        data-testid="secondary-wheel"
        className={cn(
          "relative h-[72px] w-[72px] shrink-0 touch-none rounded-full border border-border",
          disabled ? "opacity-50" : "cursor-crosshair",
        )}
        style={{
          background:
            "radial-gradient(circle, rgba(128,128,128,0.9) 0%, rgba(128,128,128,0) 70%), conic-gradient(from 90deg, #ff0000, #ff00ff, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)",
        }}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag(read(event));
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setDrag(read(event));
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const next = read(event);
          setDrag(null);
          onCommit(next.x, next.y);
        }}
        onDoubleClick={() => !disabled && onCommit(0, 0)}
      >
        <span
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/60 shadow"
          style={{
            left: `${(shown.x * 0.5 + 0.5) * 100}%`,
            top: `${(-shown.y * 0.5 + 0.5) * 100}%`,
          }}
        />
      </div>
      <span className="text-[10px] leading-snug text-fg-3">
        Push the matte towards a hue. Double-click to reset.
      </span>
    </div>
  );
};

export const KeyButton: React.FC<{
  clipId: string;
  effectId: string;
  paramKey: string;
  value: number;
  disabled: boolean;
}> = ({ clipId, effectId, paramKey, value, disabled }) => {
  const property = effectInstanceKeyframeProperty(effectId, paramKey);
  const keyframes = useProjectStore(
    (state) => state.getClip(clipId)?.keyframes,
  );
  const animated = useMemo(
    () => (keyframes ?? []).some((keyframe) => keyframe.property === property),
    [keyframes, property],
  );
  const onClick = () => {
    const state = useProjectStore.getState();
    const clip = state.getClip(clipId);
    if (!clip) return;
    const local = useTimelineStore.getState().playheadPosition - clip.startTime;
    if (local < 0 || local > clip.duration) return;
    const existing = clip.keyframes ?? [];
    const at = existing.find(
      (keyframe) => keyframe.property === property && Math.abs(keyframe.time - local) < 0.01,
    );
    const next = at
      ? existing.map((keyframe) => (keyframe === at ? { ...keyframe, value } : keyframe))
      : [...existing, keyframeEngine.addKeyframe(clipId, property, local, value, "linear")].sort(
          (a, b) => a.time - b.time,
        );
    state.updateClipKeyframes(clipId, next);
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      type="button"
      disabled={disabled}
      aria-label={`Keyframe ${paramKey}`}
      aria-pressed={animated}
      title={animated ? "Animated: add or update a keyframe at the playhead" : "Add a keyframe at the playhead"}
      className="h-6 w-6 shrink-0 self-end"
      onClick={onClick}
    >
      <Diamond className={cn("h-3 w-3", animated ? "fill-accent text-accent" : "text-fg-3")} />
    </Button>
  );
};

const SecondaryCard: React.FC<{
  clipId: string;
  effect: Effect;
  index: number;
  disabled: boolean;
}> = ({ clipId, effect, index, disabled }) => {
  const values = useMemo(
    () => resolveProEffectParams(TYPE, effect.params) as Params,
    [effect.params],
  );
  const monitor = useColorMonitorStore((state) => state.secondary);
  const setView = useColorMonitorStore((state) => state.setSecondaryView);
  const own = monitor.effectId === effect.id;
  const matteView: MatteView = own ? monitor.matteView : 0;
  const eyedropper = own ? monitor.eyedropper : null;
  const locked = disabled || effect.enabled === false;

  const update = useCallback(
    (patch: Record<string, unknown>) => {
      if (disabled) return;
      void useProjectStore.getState().updateVideoEffect(clipId, effect.id, patch);
    },
    [clipId, effect.id, disabled],
  );
  const num = (key: string): number => Number(values[key]);

  const slider = (spec: SliderSpec, keyable = false) => (
    <div key={spec.key} className="flex items-end gap-1">
      <div className="min-w-0 flex-1">
        <PropertySlider
          label={spec.label}
          ariaLabel={`Secondary ${index + 1} ${spec.key}`}
          isDisabled={locked}
          value={num(spec.key)}
          onChange={(v) => update({ [spec.key]: v })}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          defaultValue={Number(PRO_EFFECT_DEFAULTS[TYPE][spec.key] ?? 0)}
          formatValue={(v) => `${spec.step && spec.step < 1 ? Number(v.toFixed(1)) : Math.round(v)}${spec.unit ?? ""}`}
        />
      </div>
      {keyable ? (
        <KeyButton clipId={clipId} effectId={effect.id} paramKey={spec.key} value={num(spec.key)} disabled={locked} />
      ) : null}
    </div>
  );

  const arm = (mode: "set" | "add" | "subtract") => {
    setView({
      clipId,
      effectId: effect.id,
      matteView: own ? monitor.matteView : 0,
      eyedropper: eyedropper === mode ? null : mode,
    });
  };

  return (
    <div
      data-testid={`hsl-secondary-${index}`}
      data-effect-id={effect.id}
      className="flex flex-col gap-2 rounded-[8px] border border-border bg-bg-2 p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-fg">Secondary {index + 1}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="h-6 w-6"
            aria-label={`Reset secondary ${index + 1}`}
            title="Reset to defaults"
            disabled={disabled}
            onClick={() => update({ ...PRO_EFFECT_DEFAULTS[TYPE] })}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Switch
            aria-label={`Enable secondary ${index + 1}`}
            checked={effect.enabled !== false}
            disabled={disabled}
            onCheckedChange={(checked) =>
              void useProjectStore.getState().toggleVideoEffect(clipId, effect.id, checked)
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="h-6 w-6"
            aria-label={`Remove secondary ${index + 1}`}
            title="Remove secondary"
            disabled={disabled}
            onClick={() => {
              if (own) setView({ clipId: null, effectId: null, matteView: 0, eyedropper: null });
              void useProjectStore.getState().removeVideoEffect(clipId, effect.id);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className={BLOCK}>
        <span className={BLOCK_TITLE}>Key</span>
        <div className="flex items-center gap-1">
          {(
            [
              ["set", Pipette, "Pick a colour from the Program monitor"],
              ["add", Plus, "Add a colour to the key"],
              ["subtract", Minus, "Subtract a colour from the key"],
            ] as const
          ).map(([mode, Icon, title]) => (
            <Button
              key={mode}
              type="button"
              variant={eyedropper === mode ? "secondary" : "outline"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={locked}
              aria-pressed={eyedropper === mode}
              aria-label={
                mode === "set"
                  ? `Eyedropper ${index + 1}`
                  : mode === "add"
                    ? `Eyedropper add ${index + 1}`
                    : `Eyedropper subtract ${index + 1}`
              }
              title={title}
              onClick={() => arm(mode)}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            {matteView === 0 ? (
              <Eye className="h-3 w-3 text-fg-3" aria-hidden />
            ) : (
              <EyeOff className="h-3 w-3 text-accent" aria-hidden />
            )}
            <div role="group" aria-label={`Show mask ${index + 1}`} className="flex overflow-hidden rounded-[6px] border border-border">
              {MATTE_VIEWS.map((view) => (
                <button
                  key={view.value}
                  type="button"
                  disabled={locked}
                  aria-pressed={matteView === view.value}
                  aria-label={`Show mask ${view.label} ${index + 1}`}
                  className={cn(
                    "px-1.5 py-1 text-[9px] font-medium transition-colors disabled:opacity-50",
                    matteView === view.value ? "bg-accent text-white" : "bg-bg-1 text-fg-2 hover:bg-bg-3",
                  )}
                  onClick={() =>
                    setView({
                      clipId,
                      effectId: effect.id,
                      matteView: view.value,
                      eyedropper: null,
                    })
                  }
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <span className="text-[9px] leading-snug text-fg-3">
          Pick, then +/- to widen or narrow the key. The matte view is preview only.
        </span>

        <span className="text-[10px] font-medium text-fg-2">Hue</span>
        {HUE.map((spec) => slider(spec))}
        <span className="text-[10px] font-medium text-fg-2">Saturation</span>
        {SAT.map((spec) => slider(spec))}
        <span className="text-[10px] font-medium text-fg-2">Luma</span>
        {LUM.map((spec) => slider(spec))}
        {REFINE.map((spec) => slider(spec))}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-fg-2">Invert matte</span>
          <Switch
            aria-label={`Invert matte ${index + 1}`}
            checked={values.invert === true}
            disabled={locked}
            onCheckedChange={(checked) => update({ invert: checked })}
          />
        </div>
      </div>

      <div className={BLOCK}>
        <span className={BLOCK_TITLE}>Correction (inside the matte)</span>
        {CORRECT.map((spec) => slider(spec, true))}
        <MiniWheel
          x={num("wheelX")}
          y={num("wheelY")}
          disabled={locked}
          onCommit={(x, y) => update({ wheelX: x, wheelY: y })}
        />
      </div>

      <div className={BLOCK}>
        <span className={BLOCK_TITLE}>Limit to shape</span>
        <div role="group" aria-label={`Limit shape ${index + 1}`} className="flex overflow-hidden rounded-[6px] border border-border">
          {MASK_SHAPES.map((shape) => (
            <button
              key={shape.value}
              type="button"
              disabled={locked}
              aria-pressed={values.maskShape === shape.value}
              className={cn(
                "flex-1 px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50",
                values.maskShape === shape.value ? "bg-accent text-white" : "bg-bg-1 text-fg-2 hover:bg-bg-3",
              )}
              onClick={() => update({ maskShape: shape.value })}
            >
              {shape.label}
            </button>
          ))}
        </div>
        {values.maskShape !== "none" ? (
          <>
            {MASK.map((spec) => slider(spec))}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-fg-2">Invert shape</span>
              <Switch
                aria-label={`Invert shape ${index + 1}`}
                checked={values.maskInvert === true}
                disabled={locked}
                onCheckedChange={(checked) => update({ maskInvert: checked })}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

/** Lumetri-style HSL Secondary stack for one clip (each secondary is an hsl-secondary effect). */
export const HslSecondarySection: React.FC<{ clipId: string }> = ({ clipId }) => {
  const { effects, locked } = useProjectStore(
    useShallow((state) => {
      let found: { effects: readonly Effect[]; trackId: string } | undefined;
      for (const track of state.project.timeline.tracks) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
          found = { effects: clip.effects ?? NO_EFFECTS, trackId: track.id };
          break;
        }
      }
      const track = state.project.timeline.tracks.find((candidate) => candidate.id === found?.trackId);
      return { effects: found?.effects ?? NO_EFFECTS, locked: !found || !track || track.locked };
    }),
  );
  const secondaries = useMemo(
    () => effects.filter((effect) => effect.type === TYPE),
    [effects],
  );
  const setView = useColorMonitorStore((state) => state.setSecondaryView);
  const currentEffectId = useColorMonitorStore((state) => state.secondary.effectId);

  // Leaving the clip (or the section) must not leave a matte view armed.
  useEffect(
    () => () => {
      useColorMonitorStore
        .getState()
        .setSecondaryView({ clipId: null, effectId: null, matteView: 0, eyedropper: null });
    },
    [clipId],
  );
  useEffect(() => {
    if (currentEffectId && !secondaries.some((effect) => effect.id === currentEffectId)) {
      setView({ clipId: null, effectId: null, matteView: 0, eyedropper: null });
    }
  }, [currentEffectId, secondaries, setView]);

  const add = async () => {
    if (locked) return;
    await useProjectStore.getState().addVideoEffect(clipId, TYPE as never, {
      ...PRO_EFFECT_DEFAULTS[TYPE],
      saturation: 0,
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="hsl-secondary-section">
      {secondaries.length === 0 ? (
        <p className="text-[10px] leading-snug text-fg-3">
          Key a colour range with the eyedropper, then correct only that range.
        </p>
      ) : null}
      {secondaries.map((effect, index) => (
        <SecondaryCard key={effect.id} clipId={clipId} effect={effect} index={index} disabled={locked} />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-[10px]"
        disabled={locked}
        onClick={() => void add()}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add secondary
      </Button>
    </div>
  );
};
