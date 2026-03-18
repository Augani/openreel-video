import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@openreel/ui";
import type { ZImageInput } from "../../../../services/kieai/image-generation";
import { ASPECT_RATIO_OPTIONS_BASIC } from "./shared";

interface Props {
  value: ZImageInput;
  onChange: (v: ZImageInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function ZImageForm({ value, onChange, onSubmit, isLoading }: Props) {
  return (
    <div className="space-y-4">
      <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-400">
        Z-Image is text-to-image — the source image is used as inspiration only, not as a direct reference.
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">Prompt *</label>
        <textarea
          value={value.prompt}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
          placeholder="Describe the image you want to generate…"
          maxLength={1000}
          rows={4}
          className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-primary"
        />
        <p className="text-[10px] text-text-muted text-right">{value.prompt.length}/1000</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">Aspect Ratio</label>
        <Select value={value.aspect_ratio} onValueChange={(v) => onChange({ ...value, aspect_ratio: v as ZImageInput["aspect_ratio"] })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ASPECT_RATIO_OPTIONS_BASIC.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={onSubmit} disabled={isLoading || !value.prompt.trim()} className="w-full">
        {isLoading ? "Generating…" : "Generate with Z-Image"}
      </Button>
    </div>
  );
}
