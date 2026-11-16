import { memo, useEffect, useRef, useState } from "react";
import {
  REPAIR_EFFECT_DEFINITIONS,
  getRepairMeter,
  sanitizeRepairParams,
  type RepairEffectType,
} from "@openreel/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from "@openreel/ui";

const formatValue = (value: number, step: number, unit: string) => {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
};

/** Live gain-reduction readout for DeEss / Gate (the worklet publishes it ~15x per second). */
export const GainReductionMeter = memo(function GainReductionMeter({ effectId, active }: { effectId: string; active: boolean }) {
  const [reduction, setReduction] = useState(0);
  const frame = useRef(0);
  useEffect(() => {
    if (!active) {
      setReduction(0);
      return;
    }
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 66) {
        last = now;
        setReduction((prev) => {
          const next = getRepairMeter(effectId);
          return Math.abs(next - prev) < 0.05 ? prev : next;
        });
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [effectId, active]);
  const width = Math.min(100, (reduction / 24) * 100);
  return (
    <div className="flex items-center gap-2 text-[10px] text-fg-muted" data-testid={`gr-meter-${effectId}`}>
      <span className="w-[46px] shrink-0">Reduction</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-bg-3">
        <div className="h-full rounded bg-accent transition-[width] duration-75" style={{ width: `${width}%` }} />
      </div>
      <span className="w-[42px] shrink-0 text-right font-mono" data-testid={`gr-value-${effectId}`}>
        -{reduction.toFixed(1)} dB
      </span>
    </div>
  );
});

interface RepairEffectEditorProps {
  type: RepairEffectType;
  effectId: string;
  params: Record<string, number | string | boolean | unknown>;
  /** Called while a slider moves (live preview); optional. */
  onPreview?: (params: Record<string, number>) => void;
  /** Called when an edit is final (slider released, switch flipped, preset chosen). */
  onCommit: (params: Record<string, number>) => void;
  /** Meter only runs while the effect is audible. */
  active?: boolean;
}

/** Parameters, presets and meter of one repair effect; shared by clip inspector and track/bus racks. */
export const RepairEffectEditor = memo(function RepairEffectEditor({
  type,
  effectId,
  params,
  onPreview,
  onCommit,
  active = true,
}: RepairEffectEditorProps) {
  const definition = REPAIR_EFFECT_DEFINITIONS[type];
  const [draft, setDraft] = useState<Record<string, number>>(() => sanitizeRepairParams(type, params as Record<string, unknown>));
  useEffect(() => {
    setDraft(sanitizeRepairParams(type, params as Record<string, unknown>));
  }, [type, params]);

  const set = (key: string, value: number, commit: boolean) => {
    const next = sanitizeRepairParams(type, { ...draft, [key]: value });
    setDraft(next);
    if (commit) onCommit(next);
    else onPreview?.(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid={`repair-params-${effectId}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-fg">{definition.label}</span>
        <Select
          value=""
          onValueChange={(id) => {
            const preset = definition.presets.find((entry) => entry.id === id);
            if (preset) {
              const next = sanitizeRepairParams(type, { ...draft, ...preset.params });
              setDraft(next);
              onCommit(next);
            }
          }}
        >
          <SelectTrigger className="h-6 min-w-0 flex-1 text-[11px]" aria-label={`${definition.label} presets`} data-testid={`repair-presets-${effectId}`}>
            <SelectValue placeholder="Presets" />
          </SelectTrigger>
          <SelectContent>
            {definition.presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {definition.caveat && <p className="text-[10px] leading-snug text-fg-muted">{definition.caveat}</p>}
      {definition.params.map((spec) => {
        const value = draft[spec.key] ?? spec.default;
        if (spec.toggle) {
          return (
            <div key={spec.key} className="flex items-center justify-between gap-2 text-xs text-fg-muted">
              <span>{spec.label}</span>
              <Switch
                checked={value >= 0.5}
                onCheckedChange={(on) => set(spec.key, on ? 1 : 0, true)}
                aria-label={`${definition.label} ${spec.label}`}
              />
            </div>
          );
        }
        return (
          <div key={spec.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
              <span className="min-w-0 truncate">{spec.label}</span>
              <span className="shrink-0 font-mono">{formatValue(value, spec.step, spec.unit)}</span>
            </div>
            <Slider
              aria-label={`${definition.label} ${spec.label}`}
              aria-valuetext={formatValue(value, spec.step, spec.unit)}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={[value]}
              onValueChange={([next]) => set(spec.key, next, false)}
              onValueCommit={([next]) => set(spec.key, next, true)}
              className="cursor-pointer"
            />
          </div>
        );
      })}
      {definition.hasMeter && <GainReductionMeter effectId={effectId} active={active} />}
    </div>
  );
});
