import { memo, useCallback, useState } from "react";
import {
  AUDIO_RACK_EFFECT_DEFINITIONS,
  AUDIO_RACK_EFFECT_TYPES,
  MAX_RACK_EFFECTS,
  createRackEffect,
  effectLatencySamples,
  getRealtimeAudioGraph,
  isRepairEffectType,
  sanitizeRackEffectParams,
  type AudioRack,
  type AudioRackEffect,
  type AudioRackEffectType,
} from "@openreel/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  cn,
} from "@openreel/ui";
import { ChevronDown, ChevronUp, Plus, Power, X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { GainReductionMeter, RepairEffectEditor } from "../audio-repair/RepairEffectEditor";
import { EqCurve } from "../audio-repair/EqCurve";

interface AudioRackSectionProps {
  /** Track id, bus id, or "master" for the master bus. */
  target: string;
  label: string;
  rack: AudioRack | undefined;
}

/** Push a draft rack to the live graph without touching project history. */
function previewRack(target: string, rack: AudioRack): void {
  try {
    const graph = getRealtimeAudioGraph();
    if (target === "master") graph.setMasterRack(rack);
    else if (useProjectStore.getState().project.timeline.audioBuses?.some((b) => b.id === target)) graph.setBusRack(target, rack);
    else graph.setTrackRack(target, rack);
  } catch {
    /* audio unavailable */
  }
}

const formatValue = (value: number, step: number, unit: string) => {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
};

const LATENCY_RATE = 48000;
const formatLatency = (ms: number): string => `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;

const RackEffectParams = memo(function RackEffectParams({
  target,
  rack,
  effect,
  onCommit,
}: {
  target: string;
  rack: AudioRack;
  effect: AudioRackEffect;
  onCommit: (effect: AudioRackEffect) => void;
}) {
  const definition = AUDIO_RACK_EFFECT_DEFINITIONS[effect.type];
  const [draft, setDraft] = useState<Record<string, number | string | boolean>>(
    effect.params,
  );
  if (definition.repair && isRepairEffectType(effect.type)) {
    const apply = (params: Record<string, number>, commit: boolean) => {
      const next = { ...effect, params };
      if (commit) onCommit(next);
      else previewRack(target, { ...rack, effects: rack.effects.map((e) => (e.id === effect.id ? next : e)) });
    };
    return (
      <div data-testid={`rack-params-${effect.id}`}>
        <RepairEffectEditor
          type={effect.type}
          effectId={effect.id}
          params={effect.params}
          active={!effect.bypassed}
          onPreview={(params) => apply(params, false)}
          onCommit={(params) => apply(params, true)}
        />
      </div>
    );
  }
  const update = (key: string, value: number, commit: boolean) => {
    const params = sanitizeRackEffectParams(effect.type, { ...draft, [key]: value });
    setDraft(params);
    const next = { ...effect, params };
    if (commit) {
      onCommit(next);
    } else {
      previewRack(target, {
        ...rack,
        effects: rack.effects.map((e) => (e.id === effect.id ? next : e)),
      });
    }
  };
  return (
    <div className="flex flex-col gap-3" data-testid={`rack-params-${effect.id}`}>
      <span className="text-xs font-semibold text-fg">{definition.label}</span>
      {effect.type === "eq" && <EqCurve params={draft} />}
      {(effect.type === "compressor" || effect.type === "limiter") && (
        <GainReductionMeter effectId={effect.id} active={!effect.bypassed} />
      )}
      {definition.params.map((spec) => {
        const value = Number(draft[spec.key] ?? spec.default);
        return (
          <div key={spec.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>{spec.label}</span>
              <span className="font-mono">{formatValue(value, spec.step, spec.unit)}</span>
            </div>
            <Slider
              aria-label={`${definition.label} ${spec.label}`}
              aria-valuetext={formatValue(value, spec.step, spec.unit)}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={[value]}
              onValueChange={([next]) => update(spec.key, next, false)}
              onValueCommit={([next]) => update(spec.key, next, true)}
              className="cursor-pointer"
            />
          </div>
        );
      })}
    </div>
  );
});

/**
 * Premiere-style effect rack: up to five ordered slots with per-slot bypass,
 * a parameter popover, reorder and remove. Every edit dispatches one
 * `audioRack/set` action (one undo step); slider drags preview live in the
 * audio graph and commit on release.
 */
export const AudioRackSection = memo(function AudioRackSection({
  target,
  label,
  rack,
}: AudioRackSectionProps) {
  const setAudioRack = useProjectStore((state) => state.setAudioRack);
  const effects = rack?.effects ?? [];
  const full = effects.length >= MAX_RACK_EFFECTS;

  const commit = useCallback(
    (nextEffects: AudioRackEffect[]) => {
      void setAudioRack(target, { ...(rack ?? {}), effects: nextEffects });
    },
    [rack, setAudioRack, target],
  );

  const add = (type: AudioRackEffectType) => {
    if (full) return;
    commit([...effects, createRackEffect(type)]);
  };
  const toggle = (id: string) =>
    commit(effects.map((e) => (e.id === id ? { ...e, bypassed: !e.bypassed } : e)));
  const remove = (id: string) => commit(effects.filter((e) => e.id !== id));
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= effects.length) return;
    const next = [...effects];
    [next[index], next[to]] = [next[to], next[index]];
    commit(next);
  };

  const rackLatencyMs =
    (effects.reduce((sum, e) => (e.bypassed ? sum : sum + effectLatencySamples(e.type, e.params, LATENCY_RATE)), 0) / LATENCY_RATE) * 1000;
  return (
    <div
      className="flex w-full flex-col gap-1"
      role="group"
      aria-label={`${label} effect rack`}
      data-testid={`audio-rack-${target}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          Effects {effects.length}/{MAX_RACK_EFFECTS}
        </span>
        {rackLatencyMs > 0 && (
          <span
            className="shrink-0 text-[9px] tabular-nums text-fg-muted"
            title={`This rack adds ${rackLatencyMs.toFixed(1)} ms of latency. It is compensated automatically so the audio stays in sync with the picture and with the other tracks.`}
            data-testid={`rack-latency-${target}`}
          >
            {formatLatency(rackLatencyMs)}
          </span>
        )}
      </div>
      {effects.map((effect, index) => {
        const definition = AUDIO_RACK_EFFECT_DEFINITIONS[effect.type];
        const latencyMs = (effectLatencySamples(effect.type, effect.params, LATENCY_RATE) / LATENCY_RATE) * 1000;
        return (
          <div
            key={effect.id}
            className={cn(
              "flex items-center gap-0.5 rounded border border-border bg-bg-1 px-0.5",
              effect.bypassed && "opacity-60",
            )}
            data-testid={`rack-slot-${target}-${index}`}
            data-effect-type={effect.type}
            data-bypassed={effect.bypassed}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                "size-5 shrink-0",
                effect.bypassed ? "text-fg-muted" : "text-accent",
              )}
              aria-label={`${effect.bypassed ? "Enable" : "Bypass"} ${definition.label} on ${label}`}
              aria-pressed={!effect.bypassed}
              onClick={() => toggle(effect.id)}
            >
              <Power size={11} aria-hidden />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-5 min-w-0 flex-1 justify-start truncate px-1 text-[11px] font-normal"
                  aria-label={`Edit ${definition.label} parameters on ${label}`}
                  title={latencyMs > 0 ? `${definition.label} adds ${latencyMs.toFixed(1)} ms of latency (compensated)` : undefined}
                >
                  <span className="truncate">{definition.label}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-64">
                {latencyMs > 0 && (
                  <p className="mb-2 text-[11px] text-fg-muted" data-testid={`rack-latency-${target}-${index}`}>
                    Latency {latencyMs.toFixed(1)} ms, compensated automatically
                  </p>
                )}
                <RackEffectParams
                  target={target}
                  rack={rack ?? { effects }}
                  effect={effect}
                  onCommit={(next) =>
                    commit(effects.map((e) => (e.id === next.id ? next : e)))
                  }
                />
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-4 shrink-0"
              aria-label={`Move ${definition.label} up on ${label}`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ChevronUp size={10} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-4 shrink-0"
              aria-label={`Move ${definition.label} down on ${label}`}
              disabled={index === effects.length - 1}
              onClick={() => move(index, 1)}
            >
              <ChevronDown size={10} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-4 shrink-0 text-fg-muted hover:text-status-error"
              aria-label={`Remove ${definition.label} from ${label}`}
              onClick={() => remove(effect.id)}
            >
              <X size={10} aria-hidden />
            </Button>
          </div>
        );
      })}
      {!full && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 w-full gap-1 px-1 text-[11px]"
              aria-label={`Add effect to ${label}`}
            >
              <Plus size={11} aria-hidden />
              Add effect
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {AUDIO_RACK_EFFECT_TYPES.map((type) => (
              <DropdownMenuItem key={type} onSelect={() => add(type)}>
                {AUDIO_RACK_EFFECT_DEFINITIONS[type].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});
