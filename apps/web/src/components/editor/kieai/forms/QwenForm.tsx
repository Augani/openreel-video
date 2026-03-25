import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@openreel/ui";
import type { QwenInput } from "../../../../services/kieai/image-generation";

interface Props {
  value: QwenInput;
  onChange: (v: QwenInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function QwenForm({ value, onChange, onSubmit, isLoading }: Props) {
  const strength = value.strength ?? 0.8;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">Prompt *</label>
        <textarea
          value={value.prompt}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
          placeholder="Describe the image you want to generate…"
          maxLength={2000}
          rows={4}
          className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-primary"
        />
        <p className="text-[10px] text-text-muted text-right">{value.prompt.length}/2000</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">
          Strength — {strength.toFixed(1)}
          <span className="ml-2 text-text-muted font-normal">(0 = preserve original, 1 = full remake)</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={strength}
          onChange={(e) => onChange({ ...value, strength: parseFloat(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-text-muted">
          <span>Preserve</span>
          <span>Remake</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Format</label>
          <Select
            value={value.output_format ?? "png"}
            onValueChange={(v) => onChange({ ...value, output_format: v as QwenInput["output_format"] })}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="jpeg">JPEG</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Acceleration</label>
          <Select
            value={value.acceleration ?? "regular"}
            onValueChange={(v) => onChange({ ...value, acceleration: v as QwenInput["acceleration"] })}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (best quality)</SelectItem>
              <SelectItem value="regular">Regular</SelectItem>
              <SelectItem value="high">High (fastest)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">Negative Prompt (optional)</label>
        <textarea
          value={value.negative_prompt ?? ""}
          onChange={(e) => onChange({ ...value, negative_prompt: e.target.value || undefined })}
          placeholder="Describe what you don't want in the result…"
          maxLength={500}
          rows={2}
          className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-primary"
        />
      </div>

      <Button onClick={onSubmit} disabled={isLoading || !value.prompt.trim()} className="w-full">
        {isLoading ? "Generating…" : "Generate with Qwen"}
      </Button>
    </div>
  );
}
