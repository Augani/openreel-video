import React, { useCallback, useEffect } from "react";
import { Button, cn } from "@openreel/ui";
import { Pipette, RotateCcw } from "@/icons/lucide-compat";
import { PRO_EFFECT_DEFAULTS, PRO_EFFECT_SPECS, resolveProEffectParams } from "@openreel/core";
import { PropertySlider } from "./shell/PropertySlider";
import { KeyButton } from "./HslSecondarySection";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";

const TYPE = "ultra-key";
const SPEC = PRO_EFFECT_SPECS[TYPE];

/** Premiere's Setting menu: starting points for the matte generation sliders. */
const SETTINGS: ReadonlyArray<{ id: string; label: string; patch: Record<string, number> }> = [
  { id: "default", label: "Default", patch: { transparency: 45, highlight: 10, shadow: 50, tolerance: 50, pedestal: 0 } },
  { id: "relaxed", label: "Relaxed", patch: { transparency: 30, highlight: 20, shadow: 60, tolerance: 35, pedestal: 0 } },
  { id: "aggressive", label: "Aggressive", patch: { transparency: 65, highlight: 5, shadow: 35, tolerance: 70, pedestal: 10 } },
];

const OUTPUTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "composite", label: "Composite" },
  { value: "alpha", label: "Alpha" },
  { value: "color", label: "Color" },
];

const GROUPS: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  { title: "Matte generation", keys: ["transparency", "highlight", "shadow", "tolerance", "pedestal"] },
  { title: "Matte cleanup", keys: ["choke", "soften", "contrast", "midPoint"] },
  { title: "Spill suppression", keys: ["desaturate", "range", "spill", "luma"] },
  { title: "Color correction", keys: ["saturation", "hue", "luminance"] },
];

const hex2 = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

/**
 * Ultra Key inspector: key colour with a Program monitor eyedropper, the four Premiere parameter groups (every
 * slider keyframable) and the output view. All values are stored in the effect's params like any pro effect.
 */
export const UltraKeyControls: React.FC<{
  clipId: string;
  effectId: string;
  params: Record<string, unknown>;
  disabled: boolean;
  onChange: (params: Record<string, unknown>) => void;
}> = ({ clipId, effectId, params, disabled, onChange }) => {
  const values = resolveProEffectParams(TYPE, params);
  const picker = useColorMonitorStore((state) => state.keyPicker);
  const setPicker = useColorMonitorStore((state) => state.setKeyPicker);
  const armed = picker?.effectId === effectId;

  // Leaving the effect (or the clip) must not leave the picker armed.
  useEffect(
    () => () => {
      const current = useColorMonitorStore.getState().keyPicker;
      if (current?.effectId === effectId) useColorMonitorStore.getState().setKeyPicker(null);
    },
    [effectId],
  );

  const keyR = Number(values.keyR);
  const keyG = Number(values.keyG);
  const keyB = Number(values.keyB);
  const hex = `#${hex2(keyR)}${hex2(keyG)}${hex2(keyB)}`;
  const output = String(values.output);

  const setHex = useCallback(
    (next: string) => {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(next);
      if (!m) return;
      onChange({ keyR: parseInt(m[1], 16), keyG: parseInt(m[2], 16), keyB: parseInt(m[3], 16) });
    },
    [onChange],
  );

  const slider = (key: string) => {
    const spec = SPEC.params.find((param) => param.key === key);
    if (!spec) return null;
    const value = Number(values[key]);
    return (
      <div key={key} className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <PropertySlider
            label={spec.label}
            ariaLabel={`Ultra Key ${spec.label}`}
            isDisabled={disabled}
            value={value}
            onChange={(v) => onChange({ [key]: v })}
            min={spec.min ?? 0}
            max={spec.max ?? 100}
            step={spec.step ?? 1}
            defaultValue={Number(PRO_EFFECT_DEFAULTS[TYPE][key] ?? 0)}
            formatValue={(v) => `${Math.round(v)}${spec.unit ?? ""}`}
          />
        </div>
        {spec.keyframable ? (
          <KeyButton clipId={clipId} effectId={effectId} paramKey={key} value={value} disabled={disabled} />
        ) : null}
      </div>
    );
  };

  const segmented = (
    label: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    current: string,
    onPick: (value: string) => void,
  ) => (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-[6px] border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={current === option.value}
          className={cn(
            "flex-1 px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50",
            current === option.value ? "bg-accent text-white" : "bg-bg-1 text-fg-2 hover:bg-bg-3",
          )}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2" data-testid="ultra-key-controls" data-effect-id={effectId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-normal text-fg-2">Key color</span>
        <div className="flex items-center gap-1">
          <input
            type="color"
            aria-label="Key color"
            data-testid="ultra-key-swatch"
            value={hex}
            disabled={disabled}
            onChange={(event) => setHex(event.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0 disabled:opacity-50"
          />
          <Button
            type="button"
            variant={armed ? "secondary" : "outline"}
            size="icon-sm"
            className="h-6 w-6"
            disabled={disabled}
            aria-pressed={armed}
            aria-label="Pick key color from the Program monitor"
            title="Pick the key color from the Program monitor (Esc cancels)"
            onClick={() => setPicker(armed ? null : { clipId, effectId })}
          >
            <Pipette className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            disabled={disabled}
            aria-label="Reset Ultra Key"
            title="Reset to defaults"
            onClick={() => onChange({ ...PRO_EFFECT_DEFAULTS[TYPE] })}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {armed ? (
        <p role="status" className="text-[10px] leading-snug text-accent">
          Click the screen colour on the Program monitor. Esc cancels.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-normal text-fg-2">Setting</span>
        <div className="w-[170px]">
          {segmented(
            "Ultra Key setting",
            SETTINGS.map((s) => ({ value: s.id, label: s.label })),
            "",
            (id) => {
              const setting = SETTINGS.find((s) => s.id === id);
              if (setting) onChange(setting.patch);
            },
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-normal text-fg-2">Output</span>
        <div className="w-[170px]">
          {segmented("Ultra Key output", OUTPUTS, output, (value) => onChange({ output: value }))}
        </div>
      </div>
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5 border-t border-border pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">{group.title}</span>
          {group.keys.map(slider)}
        </div>
      ))}
    </div>
  );
};
