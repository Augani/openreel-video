import { BlendModeSelectItems } from "./BlendModeSelectItems";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
} from "@openreel/ui";
import {
  evaluateKeyframesAt,
  type Transform,
  type BlendMode,
  type Keyframe,
} from "@openreel/core";
import {
  effectInstanceKeyframeProperty,
  migrateClipEffectKeyframes,
} from "@openreel/core/video/effect-instance-keyframes";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { InspectorSlider } from "./shell/InspectorSlider";
import { InspectorSection } from "./shell/InspectorSection";
import { toast } from "../../../stores/notification-store";
import type { VideoEffectType } from "../../../bridges/effects-bridge";

export function ValueField({
  label,
  value,
  onChange,
  unit = "",
  min,
  max,
  step = 0.1,
  displayPrecision = 3,
  fixedPrecision = false,
  displayText,
  disabled,
  prefix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  displayPrecision?: 0 | 1 | 2 | 3;
  fixedPrecision?: boolean;
  displayText?: string;
  disabled?: boolean;
  prefix?: string;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const originalDraft = useRef(draft);
  const dirty = useRef(false);
  const rounded = value.toFixed(displayPrecision);
  const displayValue = fixedPrecision ? rounded : String(Number(rounded));
  const displayedPrefix = editing && prefix === "+" ? undefined : prefix;
  const commit = (raw: string) => {
    const next = Number.parseFloat(raw);
    if (Number.isFinite(next)) {
      const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
      if (bounded !== value) onChange(bounded);
    }
  };
  return (
    <div
      className="workspace-inspector-value"
      data-prefix={displayedPrefix}
      data-unit={unit || undefined}
    >
      {displayedPrefix && <span aria-hidden="true">{displayedPrefix}</span>}
      <Input
        aria-label={label}
        disabled={disabled}
        type={!editing && displayText ? "text" : "number"}
        role={displayText ? "spinbutton" : undefined}
        aria-valuenow={displayText ? value : undefined}
        aria-valuemin={displayText ? min : undefined}
        aria-valuemax={displayText ? max : undefined}
        inputMode="decimal"
        value={editing ? draft : displayText ?? displayValue}
        style={displayedPrefix && !editing
          ? { width: `${displayValue.length}ch`, flex: "0 0 auto" }
          : undefined}
        title={`${value}${unit ? ` ${unit}` : ""}`}
        min={min}
        max={max}
        step={step}
        onFocus={() => {
          cancelled.current = false;
          dirty.current = false;
          const precise = String(value);
          setDraft(precise);
          originalDraft.current = precise;
          setEditing(true);
        }}
        onBlur={() => {
          if (!cancelled.current && dirty.current) commit(draft);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
        onChange={(e) => {
          dirty.current = e.currentTarget.value !== originalDraft.current;
          setDraft(e.currentTarget.value);
        }}
      />
      {unit && <span>{unit}</span>}
    </div>
  );
}
export const EMPTY_KEYFRAMES: Keyframe[] = [];
export function KeyframeButton({
  properties, keyframes, time, disabled, onChange,
}: {
  properties: Record<string, number>;
  keyframes: Keyframe[];
  time: number;
  disabled: boolean;
  onChange: (keyframes: Keyframe[]) => void;
}) {
  const current = keyframes.filter(
    k => k.property in properties && Math.abs(k.time - time) < 0.01,
  );
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={`workspace-keyframe ${current.length ? "is-set" : ""}`}
      aria-label={`${current.length ? "Remove" : "Add"} ${Object.keys(properties).join(" / ")} keyframe`}
      aria-pressed={current.length > 0}
      disabled={disabled}
      onClick={() => {
        const next = current.length
          ? keyframes.filter(k => !current.includes(k))
          : [...keyframes, ...Object.entries(properties).map(([property, value]) => ({
              id: crypto.randomUUID(), time, property, value, easing: "linear" as const,
            }))].sort((a, b) => a.time - b.time);
        onChange(next);
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill={current.length ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 2l10 10-10 10L2 12z" /></svg>
    </Button>
  );
}
function Row({
  label,
  children,
  keys,
}: {
  label: string;
  children: ReactNode;
  keys?: ReactNode;
}) {
  return (
    <div className="workspace-property-row">
      <span>{label}</span>
      <div>{children}</div>
      {keys ?? <span className="w-6" />}
    </div>
  );
}
export function PrimaryVideoProperties({
  clipId,
  transform: baseTransform,
  onTransformChange,
}: {
  clipId: string;
  transform: Transform;
  onTransformChange: (v: Partial<Transform>) => void;
}) {
  const project = useProjectStore((s) => s.project);
  const store = useProjectStore.getState();
  const clip = project.timeline.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === clipId);
  const queue = useRef(Promise.resolve());
  const playhead = useTimelineStore(s => s.playheadPosition);
  const localTime = Math.max(0, Math.min(clip?.duration ?? 0, playhead - (clip?.startTime ?? 0)));
  const inside = !!clip && playhead >= clip.startTime && playhead <= clip.startTime + clip.duration;
  const keyframes = clip?.keyframes ?? EMPTY_KEYFRAMES;
  const values = useMemo(() => evaluateKeyframesAt(keyframes, localTime), [keyframes, localTime]);
  const transform: Transform = {
    ...baseTransform,
    position: { x: values.get("position.x") ?? baseTransform.position.x, y: values.get("position.y") ?? baseTransform.position.y },
    scale: { x: values.get("scale.x") ?? baseTransform.scale.x, y: values.get("scale.y") ?? baseTransform.scale.y },
    rotation: values.get("rotation") ?? baseTransform.rotation,
    opacity: values.get("opacity") ?? baseTransform.opacity,
  };
  const setKeys = (next: Keyframe[]) => useProjectStore.getState().updateClipKeyframes(clipId, next);
  const setKeyValues = (properties: Record<string, number>) => {
    const latest = useProjectStore.getState().getClip(clipId)?.keyframes ?? EMPTY_KEYFRAMES;
    const pending = new Map(Object.entries(properties));
    const next = latest.map(keyframe => {
      if (!(keyframe.property in properties) || Math.abs(keyframe.time - localTime) >= 0.01) return keyframe;
      pending.delete(keyframe.property);
      return { ...keyframe, value: properties[keyframe.property] };
    });
    for (const [property, value] of pending) next.push({ id: crypto.randomUUID(), property, time: localTime, value, easing: "linear" });
    setKeys(next.sort((a, b) => a.time - b.time));
  };
  const isAnimated = (...properties: string[]) => keyframes.some(key => properties.includes(key.property));
  const updateTransform = (changes: Partial<Transform>, properties: Record<string, number>) => {
    if (isAnimated(...Object.keys(properties))) {
      if (inside) setKeyValues(properties);
    } else onTransformChange(changes);
  };
  /**
   * Keyframe id of a color correction. Keyframes belong to the effect instance
   * (fx:<id>:value); the type-keyed id is only used while no instance exists.
   */
  const colorProperty = (type: VideoEffectType): string => {
    const instance = store.getVideoEffects(clipId).find(e => e.type === type);
    if (!instance) return `effect.${type}`;
    const own = effectInstanceKeyframeProperty(instance.id, "value");
    // Un-migrated type-keyed animation (written this session) keeps driving the value until it is migrated.
    return !isAnimated(own) && isAnimated(`effect.${type}`) ? `effect.${type}` : own;
  };
  /** Keyframe button writes: creates the instance first when the clip has none, then migrates onto it. */
  const setColorKeys = (type: VideoEffectType, value: number, next: Keyframe[]) => {
    if (store.getVideoEffects(clipId).some(e => e.type === type)) {
      setKeys(next);
      return;
    }
    queue.current = queue.current.then(async () => {
      const state = useProjectStore.getState();
      state.actionHistory.beginGroup(`Animate ${type}`);
      try {
        const created = await state.addVideoEffect(clipId, type, { value });
        if (!created) throw new Error("Color adjustment failed.");
        const effects = useProjectStore.getState().getVideoEffects(clipId);
        useProjectStore.getState().updateClipKeyframes(clipId, migrateClipEffectKeyframes({ effects, keyframes: next }).keyframes);
      } finally {
        state.actionHistory.endGroup();
      }
    }).catch(() => { toast.error("Could not animate color", "Try the keyframe again."); });
  };
  const changeEffect = (type: VideoEffectType, value: number) => {
    const existing = store.getVideoEffects(clipId).find(e => e.type === type);
    const property = colorProperty(type);
    if (isAnimated(property) && existing?.enabled !== false) {
      if (inside) setKeyValues({ [property]: value });
      return;
    }
    queue.current = queue.current.then(async () => {
      const state = useProjectStore.getState();
      if (state.project.id !== project.id) throw new Error("The project changed.");
      const effect = state.getVideoEffects(clipId).find(e => e.type === type);
      const reenable = effect?.enabled === false;
      if (reenable) state.actionHistory.beginGroup(`Enable and adjust ${type}`);
      try {
        if (isAnimated(property)) {
          if (!inside) return;
          setKeyValues({ [property]: value });
        } else {
          const updated = effect
            ? await state.updateVideoEffect(clipId, effect.id, { value })
            : await state.addVideoEffect(clipId, type, { value });
          if (!updated) throw new Error("Color adjustment failed.");
        }
        if (reenable && !(await useProjectStore.getState().toggleVideoEffect(clipId, effect.id, true)))
          throw new Error("Color adjustment could not be enabled.");
      } finally {
        if (reenable) state.actionHistory.endGroup();
      }
    }).catch(() => { toast.error("Could not adjust color", "Try the adjustment again."); });
  };
  const effectValue = (type: VideoEffectType, fallback: number) => {
    const effect = store.getVideoEffects(clipId).find(e => e.type === type);
    return effect?.enabled === false ? fallback : values.get(colorProperty(type)) ?? Number(effect?.params.value ?? fallback);
  };
  const position = transform.position;
  return (
    <>
      <InspectorSection title="Transform" sectionId="transform" defaultOpen>
        <div className="workspace-primary-properties">
          <Row
            label="Position"
            keys={
              <KeyframeButton
                keyframes={keyframes}
                time={localTime}
                disabled={!inside}
                onChange={setKeys}
                properties={{
                  "position.x": position.x,
                  "position.y": position.y,
                }}
              />
            }
          >
            <div className="workspace-position-values">
              <ValueField
                prefix="X"
                label="Position X"
                disabled={!inside && isAnimated("position.x")}
                value={position.x}
                displayPrecision={1}
                fixedPrecision
                onChange={(x) =>
                  updateTransform({ position: { ...baseTransform.position, x } }, { "position.x": x })
                }
              />
              <ValueField
                prefix="Y"
                label="Position Y"
                disabled={!inside && isAnimated("position.y")}
                value={position.y}
                displayPrecision={1}
                fixedPrecision
                onChange={(y) =>
                  updateTransform({ position: { ...baseTransform.position, y } }, { "position.y": y })
                }
              />
            </div>
          </Row>
          <Row
            label="Scale"
            keys={
              <KeyframeButton
                keyframes={keyframes}
                time={localTime}
                disabled={!inside}
                onChange={setKeys}
                properties={{
                  "scale.x": transform.scale.x,
                  "scale.y": transform.scale.y,
                }}
              />
            }
          >
            <ValueField
              label="Scale"
              disabled={!inside && isAnimated("scale.x", "scale.y")}
              value={transform.scale.x * 100}
              min={0}
              max={10000}
              unit="%"
              onChange={(scale) =>
                updateTransform({ scale: { x: scale / 100, y: scale / 100 } }, { "scale.x": scale / 100, "scale.y": scale / 100 })
              }
            />
          </Row>
          <Row
            label="Rotation"
            keys={
              <KeyframeButton
                keyframes={keyframes}
                time={localTime}
                disabled={!inside}
                onChange={setKeys}
                properties={{ rotation: transform.rotation }}
              />
            }
          >
            <ValueField
              label="Rotation"
              disabled={!inside && isAnimated("rotation")}
              value={transform.rotation}
              displayPrecision={1}
              fixedPrecision
              unit="°"
              onChange={(rotation) => updateTransform({ rotation }, { rotation })}
            />
          </Row>
          <Row
            label="Opacity"
            keys={
              <KeyframeButton
                keyframes={keyframes}
                time={localTime}
                disabled={!inside}
                onChange={setKeys}
                properties={{ opacity: transform.opacity }}
              />
            }
          >
            <InspectorSlider
              historyKey={`${clipId}:opacity`}
              className="workspace-opacity-slider"
              aria-label="Opacity"
              disabled={!inside && isAnimated("opacity")}
              value={[transform.opacity * 100]}
              onValueChange={([v]) => updateTransform({ opacity: v / 100 }, { opacity: v / 100 })}
              min={0}
              max={100}
            />
            <ValueField
              label="Opacity value"
              disabled={!inside && isAnimated("opacity")}
              value={transform.opacity * 100}
              min={0}
              max={100}
              step={1}
              onChange={(v) => updateTransform({ opacity: v / 100 }, { opacity: v / 100 })}
            />
          </Row>
          <Row label="Blend">
            <Select
              value={clip?.blendMode ?? "normal"}
              onValueChange={(v) => {
                void store.updateClipBlendMode(clipId, v as BlendMode);
              }}
            >
              <SelectTrigger aria-label="Blend mode" icon={<span aria-hidden="true">▾</span>}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <BlendModeSelectItems />
              </SelectContent>
            </Select>
          </Row>
        </div>
      </InspectorSection>
      <InspectorSection
        title="Color correction"
        sectionId="primary-color"
        defaultOpen
      >
        <div className="workspace-primary-properties">
          {(
            [
              // Exposure and Contrast live in the Color tab's Basic Correction (tone) now, so the
              // two UIs cannot fight over the same look. Saturation and Temperature stay here.
              ["Saturation", "saturation", 0, 2, 0.01, 1, 100],
              ["Temperature", "temperature", -100, 100, 1, 0, 1],
            ] as const
          ).map(([label, type, min, max, step, fallback, multiplier]) => {
            const value = effectValue(type, fallback);
            const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
            const rangeStyle = {
              "--color-range-start": `${Math.min(50, percent)}%`,
              "--color-range-end": `${Math.max(50, percent)}%`,
            } as CSSProperties;
            return (
              <Row
                key={type}
                label={label}
                keys={
                  <KeyframeButton
                    keyframes={keyframes}
                    time={localTime}
                    disabled={!inside}
                    onChange={(next) => setColorKeys(type, value, next)}
                    properties={{ [colorProperty(type)]: value }}
                  />
                }
              >
                <InspectorSlider
                  historyKey={`${clipId}:${type}`}
                  className="workspace-centered-color-slider"
                  style={rangeStyle}
                  aria-label={label}
                  disabled={!inside && isAnimated(colorProperty(type))}
                  value={[value]}
                  min={min}
                  max={max}
                  step={step}
                  onValueChange={([v]) => changeEffect(type, v)}
                />
                <ValueField
                  label={`${label} value`}
                  disabled={!inside && isAnimated(colorProperty(type))}
                  displayPrecision={3}
                  value={value * multiplier}
                  min={min * multiplier}
                  max={max * multiplier}
                  step={step * multiplier}
                  onChange={(v) => changeEffect(type, v / multiplier)}
                />
              </Row>
            );
          })}
        </div>
      </InspectorSection>
    </>
  );
}
