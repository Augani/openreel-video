import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@openreel/ui";
import type { SeedreamInput } from "../../../../services/kieai/image-generation";
import { ASPECT_RATIO_OPTIONS } from "./shared";

interface Props {
  value: SeedreamInput;
  onChange: (v: SeedreamInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function SeedreamForm({ value, onChange, onSubmit, isLoading }: Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">Prompt *</label>
        <textarea
          value={value.prompt}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
          placeholder="Describe the image you want to generate…"
          maxLength={3000}
          rows={4}
          className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-primary"
        />
        <p className="text-[10px] text-text-muted text-right">{value.prompt.length}/3000</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Aspect Ratio</label>
          <Select value={value.aspect_ratio} onValueChange={(v) => onChange({ ...value, aspect_ratio: v as SeedreamInput["aspect_ratio"] })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASPECT_RATIO_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Quality</label>
          <Select value={value.quality} onValueChange={(v) => onChange({ ...value, quality: v as SeedreamInput["quality"] })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basic">Basic (2K)</SelectItem>
              <SelectItem value="high">High (4K)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button onClick={onSubmit} disabled={isLoading || !value.prompt.trim()} className="w-full">
        {isLoading ? "Generating…" : "Generate with Seedream"}
      </Button>
    </div>
  );
}
