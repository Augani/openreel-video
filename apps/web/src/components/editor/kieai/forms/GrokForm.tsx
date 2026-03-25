import { Button } from "@openreel/ui";
import type { GrokInput } from "../../../../services/kieai/image-generation";

interface Props {
  value: GrokInput;
  onChange: (v: GrokInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function GrokForm({ value, onChange, onSubmit, isLoading }: Props) {
  return (
    <div className="space-y-4">
      <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-400">
        Grok Imagine uses the source image as a reference for style and composition. An optional prompt can guide the transformation.
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">Prompt (optional)</label>
        <textarea
          value={value.prompt ?? ""}
          onChange={(e) => onChange({ ...value, prompt: e.target.value || undefined })}
          placeholder="Optional: describe what you want to change or emphasize…"
          maxLength={1000}
          rows={3}
          className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-primary"
        />
        <p className="text-[10px] text-text-muted text-right">{(value.prompt ?? "").length}/1000</p>
      </div>

      <Button onClick={onSubmit} disabled={isLoading} className="w-full">
        {isLoading ? "Generating…" : "Generate with Grok Imagine"}
      </Button>
    </div>
  );
}
