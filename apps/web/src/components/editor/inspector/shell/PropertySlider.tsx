import React, { useState } from "react";
import { Button, Input, cn } from "@openreel/ui";
import { useProjectStore } from "../../../../stores/project-store";
import { useInspectorSelection } from "./InspectorSelection";
import { InspectorSlider } from "./InspectorSlider";
import { useNumericDraft } from "./useNumericDraft";

interface PropertySliderProps {
  label?: string;
  ariaLabel?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
  parseValue?: (value: string) => number | null;
  defaultValue?: number;
  showValueLabel?: boolean;
  isDisabled?: boolean;
  description?: string;
  className?: string;
}

function formatSliderValue(value: number, step: number): string {
  const places = step.toString().toLowerCase().split("e-");
  const decimals = places.length > 1 ? Number(places[1]) : (places[0].split(".")[1]?.length ?? 0);
  return step < 1
    ? value.toFixed(Math.min(Math.max(decimals, 1), 3)).replace(/(\.\d*?[1-9])0+$|\.0+$/u, "$1")
    : String(Math.round(value));
}

function snapSliderValue(value: number, min: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Number((min + Math.round((value - min) / step) * step).toPrecision(12));
}

function parseSliderValue(raw: string, min: number, max: number): number | null {
  const match = raw.trim().replaceAll("−", "-").match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return raw.includes("%") && min >= 0 && max <= 1 ? min + (max - min) * parsed / 100 : parsed;
}

function SliderValueInput({ value, onChange, min, max, step, format, parse, onReset, label, onClose }: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  parse?: (value: string) => number | null;
  onReset?: () => void;
  label: string;
  onClose: () => void;
}) {
  const input = useNumericDraft({
    value, onChange, min, max, step, format, live: false,
    parse: parse ?? (raw => parseSliderValue(raw, min, max)),
    normalize: next => snapSliderValue(next, min, step),
  });
  return <Input {...input}
    autoFocus
    aria-label={`${label} value`}
    onDoubleClick={onReset}
    onFocus={event => { input.onFocus?.(event); event.currentTarget.select(); }}
    onBlur={event => { try { input.onBlur?.(event); } finally { onClose(); } }}
    className="h-5 w-full min-w-[4ch] rounded border border-border bg-background-tertiary px-1 py-0 text-right font-mono text-[11px] leading-5 text-text-primary outline-none focus:border-primary md:text-[11px]"
  />;
}

export const PropertySlider: React.FC<PropertySliderProps> = ({
  label,
  ariaLabel,
  value,
  onChange,
  min,
  max,
  step = 1,
  formatValue,
  parseValue,
  defaultValue,
  showValueLabel = true,
  isDisabled = false,
  description,
  className,
}) => {
  const projectId = useProjectStore(state => state.project.id);
  const selectedItems = useInspectorSelection();
  const accessibleLabel = ariaLabel ?? label ?? "Slider";
  const scope = `${projectId}:${selectedItems.map(item => `${item.type}:${item.id}`).join("|")}:${accessibleLabel}`;
  const [editingScope, setEditingScope] = useState<string | null>(null);
  const normalized = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const format = (next: number) => formatValue?.(next) ?? formatSliderValue(next, step);
  const display = format(normalized);
  const commit = (next: number) => {
    const bounded = Math.min(max, Math.max(min, snapSliderValue(next, min, step)));
    if (Number.isFinite(bounded) && bounded !== normalized) onChange(bounded);
  };
  return (
    <div className={cn("min-w-0", className)}>
      <div className="min-w-0 space-y-1.5">
        {(label || showValueLabel) && <div className="flex min-w-0 items-center justify-between gap-3">
          {label ? <span className="min-w-0 truncate text-[11px] font-medium text-text-secondary">{label}</span> : <span aria-hidden className="min-w-0" />}
          {showValueLabel && <span className="inline-grid h-5 min-w-[4ch] shrink-0 place-items-center">
            {editingScope === scope && !isDisabled ? <SliderValueInput key={scope}
              value={normalized} onChange={onChange} min={min} max={max} step={step} format={format} parse={parseValue} label={accessibleLabel}
              onReset={typeof defaultValue === "number" ? () => { commit(defaultValue); setEditingScope(null); } : undefined}
              onClose={() => setEditingScope(null)}
            /> : <Button variant="ghost" size="sm" type="button"
              aria-label={`Edit ${accessibleLabel} value`} disabled={isDisabled} title="Click to edit"
              onClick={() => setEditingScope(scope)}
              onDoubleClick={typeof defaultValue === "number" ? () => { commit(defaultValue); setEditingScope(null); } : undefined}
              className="h-5 min-w-[4ch] cursor-text justify-end rounded border border-transparent px-1 py-0 text-right font-mono text-[11px] font-normal leading-5 tabular-nums text-text-muted transition-colors hover:border-border hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >{display}</Button>}
          </span>}
        </div>}
        <InspectorSlider historyKey={scope} value={[normalized]} onValueChange={([next]) => commit(next)}
          min={min} max={max} step={step} disabled={isDisabled} aria-label={accessibleLabel} aria-valuetext={display} className="h-2"
        />
      </div>
      {description && <p className="mt-1 text-[11px] text-fg-muted">{description}</p>}
    </div>
  );
};
