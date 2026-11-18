import React, { useEffect, useRef, useState } from "react";
import { ColorPicker, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from "@openreel/ui";
import { Diamond } from "lucide-react";
import {
  groupParameters,
  isKeyframableParameter,
  sampleParamKeyframes,
  type GraphicInstance,
  type GraphicParamValue,
  type GraphicParameter,
} from "@openreel/core";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  clearParamKeyframesCommand,
  removeParamKeyframeCommand,
  setParamKeyframeCommand,
} from "../../../services/linked-comp-commands";
import { FONT_CATEGORIES, useCustomFonts } from "../inspector/font-options";
import { ensureFontFamily } from "../../../services/project-fonts";
import { setGraphicValue } from "../../../services/graphic-commands";

const builtInFonts = Object.values(FONT_CATEGORIES).flat();

/** Text that commits once (blur / Enter), so typing never floods undo history. */
const CommitText: React.FC<{ value: string; label: string; onCommit: (value: string) => void; multiline?: boolean }> = ({ value, label, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
        }
      }}
      className="h-7 text-xs"
    />
  );
};

const CommitNumber: React.FC<{ value: number; label: string; step?: number; onCommit: (value: number) => void }> = ({ value, label, step, onCommit }) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next !== value) onCommit(next);
    else setDraft(String(value));
  };
  return (
    <Input
      aria-label={label}
      type="number"
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="h-7 w-20 text-xs"
    />
  );
};

/**
 * ColorPicker reports every keystroke / drag step. Keep the draft local and commit
 * once the user pauses (or leaves), so one colour change is one undo step.
 */
const ColorControl: React.FC<{ label: string; value: string; onCommit: (value: string) => void }> = ({ label, value, onCommit }) => {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft: value, value, onCommit });
  latest.current = { draft, value, onCommit };
  useEffect(() => setDraft(value), [value]);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { draft: pending, value: committed, onCommit: commit } = latest.current;
    if (pending !== committed) commit(pending);
  };
  useEffect(() => () => {
    if (timer.current) flush();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ColorPicker
      label={label}
      value={draft}
      showAlpha
      showValue
      onChange={(next) => {
        latest.current = { ...latest.current, draft: next };
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 450);
      }}
    />
  );
};

const SliderControl: React.FC<{ parameter: GraphicParameter; value: number; onCommit: (value: number) => void }> = ({ parameter, value, onCommit }) => {
  const [live, setLive] = useState(value);
  useEffect(() => setLive(value), [value]);
  const min = parameter.min ?? 0;
  const max = parameter.max ?? 100;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Slider
        aria-label={parameter.label}
        min={min}
        max={max}
        step={parameter.step ?? 1}
        value={[live]}
        onValueChange={(next) => setLive(next[0] ?? live)}
        onValueCommit={(next) => onCommit(next[0] ?? live)}
        className="flex-1 min-w-0"
      />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-fg-muted">
        {Number.isInteger(live) ? live : live.toFixed(2)}
      </span>
    </div>
  );
};

interface ControlProps {
  instance: GraphicInstance;
  parameter: GraphicParameter;
  value: GraphicParamValue;
}

/** Keyframe controls of a linked composition's number control: add / remove at the playhead, stop animating. */
const KeyframeControls: React.FC<{ instance: GraphicInstance; parameter: GraphicParameter; value: number }> = ({ instance, parameter, value }) => {
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const keys = instance.paramKeyframes?.[parameter.id] ?? [];
  const local = playhead - instance.startTime;
  const inside = local >= -1e-6 && local <= instance.duration + 1e-6;
  const here = keys.find((key) => Math.abs(key.time - local) < 1e-3);
  return (
    <div className="flex items-center gap-1" data-testid={`keyframe-controls-${parameter.id}`}>
      <button
        type="button"
        aria-label={here ? `Remove ${parameter.label} keyframe` : `Add ${parameter.label} keyframe at playhead`}
        aria-pressed={Boolean(here)}
        disabled={!inside}
        title={inside ? (here ? "Remove the keyframe at the playhead" : "Add a keyframe at the playhead") : "Move the playhead over the composition to keyframe it"}
        onClick={() => {
          if (here) void removeParamKeyframeCommand(instance.id, parameter.id, here.id);
          else void setParamKeyframeCommand(instance.id, parameter.id, { time: local, value }, `Keyframe ${parameter.label}`);
        }}
        className={`flex h-6 w-6 items-center justify-center rounded border border-border/60 disabled:opacity-40 ${here ? "bg-primary/20 text-primary" : "text-fg-muted hover:text-fg"}`}
      >
        <Diamond size={11} aria-hidden fill={here ? "currentColor" : "none"} />
      </button>
      {keys.length > 0 && (
        <button
          type="button"
          aria-label={`Stop animating ${parameter.label}`}
          title="Remove every keyframe and keep the current value"
          onClick={() => { void clearParamKeyframesCommand(instance.id, parameter.id); }}
          className="rounded px-1 text-[10px] text-fg-muted hover:text-fg"
        >
          {keys.length} key{keys.length === 1 ? "" : "s"} ×
        </button>
      )}
    </div>
  );
};

const GraphicControl: React.FC<ControlProps> = ({ instance, parameter, value }) => {
  const customFonts = useCustomFonts();
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const keyed = Boolean(instance.linkedCompositionId) && isKeyframableParameter(parameter) && (instance.paramKeyframes?.[parameter.id]?.length ?? 0) > 0;
  // An animated control shows its value at the playhead, and editing it keys that time.
  const shown = keyed && typeof value === "number"
    ? sampleParamKeyframes(instance.paramKeyframes?.[parameter.id], playhead - instance.startTime, value)
    : value;
  const set = (next: unknown) => {
    if (keyed && typeof next === "number") {
      void setParamKeyframeCommand(instance.id, parameter.id, { time: playhead - instance.startTime, value: next }, `Keyframe ${parameter.label}`);
      return;
    }
    void setGraphicValue(instance.id, parameter.id, next);
  };
  value = shown;
  switch (parameter.type) {
    case "text":
      return <CommitText label={parameter.label} value={String(value)} onCommit={set} />;
    case "color":
      return (
        <ColorControl label={parameter.label} value={String(value)} onCommit={set} />
      );
    case "font": {
      const fonts = [...new Set([String(value), ...(parameter.options ?? []), ...builtInFonts, ...customFonts])];
      return (
        <Select
          value={String(value)}
          onValueChange={(font) => {
            void ensureFontFamily(font, 700).finally(() => set(font));
          }}
        >
          <SelectTrigger aria-label={parameter.label} className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fonts.map((font) => (
              <SelectItem key={font} value={font}>
                {font}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "checkbox":
      return <Switch aria-label={parameter.label} checked={value === true} onCheckedChange={set} />;
    case "number":
      return <CommitNumber label={parameter.label} value={Number(value)} step={parameter.step} onCommit={set} />;
    case "slider":
      return <SliderControl parameter={parameter} value={Number(value)} onCommit={set} />;
    case "position": {
      const point = typeof value === "object" ? value : { x: 0, y: 0 };
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-muted">X</span>
          <CommitNumber label={`${parameter.label} X`} value={point.x} onCommit={(x) => set({ x, y: point.y })} />
          <span className="text-[11px] text-fg-muted">Y</span>
          <CommitNumber label={`${parameter.label} Y`} value={point.y} onCommit={(y) => set({ x: point.x, y })} />
        </div>
      );
    }
  }
};

/**
 * The controls an author exposed for a template instance, grouped. Nothing else
 * of the template is editable here: that is the point of exposing controls.
 */
export const GraphicParameterControls: React.FC<{ instance: GraphicInstance }> = ({ instance }) => {
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const groups = groupParameters(instance.template.parameters);
  if (instance.template.parameters.length === 0) {
    return <p className="text-xs text-fg-muted px-1">This template has no exposed controls. Open Essential Graphics &gt; Edit to expose some.</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="graphic-controls">
      {groups.map(({ group, parameters }) => (
        <section key={group ?? "_"} aria-label={group ?? "Controls"} className="flex flex-col gap-2">
          {group && <h4 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{group}</h4>}
          {parameters.map((parameter) => {
            const value = instance.values[parameter.id] ?? parameter.defaultValue;
            const inline = parameter.type === "checkbox";
            return (
              <div
                key={parameter.id}
                data-graphic-control={parameter.id}
                className={inline ? "flex items-center justify-between gap-2" : "flex flex-col gap-1"}
              >
                <label className="text-xs text-fg-muted truncate" title={parameter.label}>
                  {parameter.label}
                </label>
                <GraphicControl instance={instance} parameter={parameter} value={value} />
                {instance.linkedCompositionId && isKeyframableParameter(parameter) && (
                  <KeyframeControls
                    instance={instance}
                    parameter={parameter}
                    value={sampleParamKeyframes(instance.paramKeyframes?.[parameter.id], playhead - instance.startTime, Number(value))}
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
};
