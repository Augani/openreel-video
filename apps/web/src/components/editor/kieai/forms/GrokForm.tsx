import { useId } from "react";
import { Button, Card, Label, Textarea } from "@openreel/ui";
import type { GrokInput } from "../../../../services/kieai/image-generation";

interface Props {
  value: GrokInput;
  onChange: (v: GrokInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function GrokForm({ value, onChange, onSubmit, isLoading }: Props) {
  const id = useId();
  return (
    <fieldset disabled={isLoading} className="min-w-0 space-y-4 border-0 p-0">
      <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 border border-border">
        <span className="font-normal text-[12px] leading-5 text-fg-2">
          Grok Imagine uses the source image as a reference for style and
          composition. An optional prompt can guide the transformation.
        </span>
      </Card>

      <div className="space-y-1.5">
        <Label
          htmlFor={`${id}-prompt`}
          className="text-[12px] font-medium text-fg-2"
        >
          Prompt (optional)
        </Label>
        <Textarea
          id={`${id}-prompt`}
          value={value.prompt ?? ""}
          onChange={(event) =>
            onChange({ ...value, prompt: event.target.value || undefined })
          }
          disabled={isLoading}
          placeholder="Optional: describe what you want to change or emphasize..."
          maxLength={1000}
          rows={3}
          className="resize-y border-border bg-bg-2 text-[12px] leading-5 text-fg placeholder:text-fg-3"
        />
      </div>

      <Button
        onClick={onSubmit}
        type="button"
        aria-label={
          (isLoading ? "Generating..." : "Generate with Grok Imagine").trim() ||
          undefined
        }
        disabled={isLoading}
        className="h-8 w-full bg-accent text-[12px] text-accent-fg hover:bg-accent/90"
      >
        <span className="truncate">
          {isLoading ? "Generating..." : "Generate with Grok Imagine"}
        </span>
      </Button>
    </fieldset>
  );
}
