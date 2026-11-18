import React, { useRef, useState } from "react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { Download, Trash2, Upload } from "@/icons/lucide-compat";
import type { EffectPresetTiming } from "@openreel/core/video/effect-presets";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import {
  applyEffectPresetToClip,
  deleteEffectPreset,
  exportEffectPresetsJson,
  importEffectPresetsJson,
  saveEffectPresetFromClip,
  type EffectPresetOutcome,
} from "../../../services/effect-presets";

const NO_PRESETS: readonly never[] = [];

function report(outcome: EffectPresetOutcome): void {
  if (outcome.ok) toast.success("Effect presets", outcome.message);
  else toast.error("Effect presets", outcome.error);
}

/**
 * Effect preset library: save the clip's effects with their keyframes (relative
 * timing stretches the animation to the target clip, absolute keeps seconds),
 * apply to other clips, and exchange the library as JSON.
 */
export const EffectPresetsPanel: React.FC<{
  clipId: string;
  hasEffects: boolean;
  disabled: boolean;
}> = ({ clipId, hasEffects, disabled }) => {
  const presets = useProjectStore((state) => state.project.effectPresets ?? NO_PRESETS);
  const [name, setName] = useState("");
  const [timing, setTiming] = useState<EffectPresetTiming>("relative");
  const fileInput = useRef<HTMLInputElement>(null);

  const save = async () => {
    const outcome = await saveEffectPresetFromClip(clipId, name, timing);
    report(outcome);
    if (outcome.ok) setName("");
  };

  const exportAll = () => {
    const json = exportEffectPresetsJson();
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "openreel-effect-presets.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    report(await importEffectPresetsJson(await file.text()));
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <details className="rounded-md border border-border bg-bg-1 px-2 py-1.5" aria-label="Effect presets">
      <summary className="cursor-pointer select-none text-[11px] text-fg-2">Effect presets{presets.length ? ` (${presets.length})` : ""}</summary>
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <Input aria-label="Preset name" placeholder="Preset name" value={name} onChange={(event) => setName(event.target.value)} className="h-7 min-w-0 flex-1 text-[11px]" />
          <Select value={timing} onValueChange={(value) => setTiming(value === "absolute" ? "absolute" : "relative")}>
            <SelectTrigger aria-label="Keyframe timing" className="h-7 w-[104px] text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="relative">Relative</SelectItem>
              <SelectItem value="absolute">Absolute</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 w-full text-[11px]" aria-label="Save effects as preset"
          disabled={disabled || !hasEffects || !name.trim()} onClick={() => void save()}>
          Save effects as preset
        </Button>
        {presets.length === 0 ? (
          <p className="text-center text-[10px] text-fg-3">No presets saved</p>
        ) : (
          <ul className="space-y-1">
            {presets.map((preset) => (
              <li key={preset.id} className="flex items-center gap-1" aria-label={`Preset ${preset.name}`}>
                <span className="min-w-0 flex-1 truncate text-[11px]" title={`${preset.effects.length} effects, ${preset.keyframes.length} keyframes, ${preset.timing} timing`}>{preset.name}</span>
                <Button type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" aria-label={`Apply preset ${preset.name}`} disabled={disabled}
                  onClick={() => void applyEffectPresetToClip(clipId, preset.id, "append").then(report)}>Apply</Button>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" aria-label={`Replace effects with preset ${preset.name}`} disabled={disabled}
                  onClick={() => void applyEffectPresetToClip(clipId, preset.id, "replace").then(report)}>Replace</Button>
                <Button type="button" variant="ghost" size="icon-sm" className="h-6 w-6 hover:text-red-400" aria-label={`Delete preset ${preset.name}`}
                  onClick={() => void deleteEffectPreset(preset.id).then(report)}><Trash2 size={12} aria-hidden /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[11px]" aria-label="Export presets as JSON" disabled={presets.length === 0} onClick={exportAll}>
            <Download size={12} aria-hidden />Export
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[11px]" aria-label="Import presets from JSON" onClick={() => fileInput.current?.click()}>
            <Upload size={12} aria-hidden />Import
          </Button>
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Preset file" onChange={(event) => void importFile(event.target.files?.[0])} />
        </div>
      </div>
    </details>
  );
};
