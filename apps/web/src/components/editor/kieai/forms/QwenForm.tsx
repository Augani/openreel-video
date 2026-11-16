import { useId } from "react";
import {
  Button,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
} from "@openreel/ui";
import type { QwenInput } from "../../../../services/kieai/image-generation";

interface Props {
  value: QwenInput;
  onChange: (v: QwenInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function QwenForm({ value, onChange, onSubmit, isLoading }: Props) {
  const id = useId();
  const strength = value.strength ?? 0.8;

  return (
    <fieldset disabled={isLoading} className="min-w-0 space-y-4 border-0 p-0">
      <div className="space-y-1.5">
        <Label
          htmlFor={`${id}-prompt`}
          className="text-[12px] font-medium text-fg-2"
        >
          Prompt
        </Label>
        <Textarea
          id={`${id}-prompt`}
          value={value.prompt}
          onChange={(event) =>
            onChange({ ...value, prompt: event.target.value })
          }
          required
          disabled={isLoading}
          placeholder="Describe the image you want to generate..."
          maxLength={2000}
          rows={4}
          className="resize-y border-border bg-bg-2 text-[12px] leading-5 text-fg placeholder:text-fg-3"
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-[12px] leading-5 text-fg-2 font-bold block">
          Strength — {strength.toFixed(2)}
          <span className="text-[12px] leading-5 text-fg-2 font-normal ml-2">
            (0 = preserve original, 1 = full remake)
          </span>
        </span>
        <Slider
          aria-label="Strength"
          aria-valuetext={strength.toFixed(2)}
          min={0}
          max={1}
          step={0.05}
          value={[strength]}
          disabled={isLoading}
          onValueChange={([next]) => {
            if (next !== undefined) onChange({ ...value, strength: next });
          }}
          className="workspace-property-slider"
        />
        <div className="flex justify-between">
          <span className="text-fg-2 font-normal text-[10px]">Preserve</span>
          <span className="text-fg-2 font-normal text-[10px]">Remake</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label
            htmlFor={`${id}-format`}
            className="text-[12px] font-medium text-fg-2"
          >
            Format
          </Label>
          <Select
            value={value.output_format ?? "png"}
            onValueChange={(output_format) =>
              onChange({
                ...value,
                output_format: output_format as QwenInput["output_format"],
              })
            }
            disabled={isLoading}
          >
            <SelectTrigger
              id={`${id}-format`}
              className="h-8 min-w-0 border-border bg-bg-2 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: "png", label: "PNG" },
                { value: "jpeg", label: "JPEG" },
              ].map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label
            htmlFor={`${id}-acceleration`}
            className="text-[12px] font-medium text-fg-2"
          >
            Acceleration
          </Label>
          <Select
            value={value.acceleration ?? "regular"}
            onValueChange={(acceleration) =>
              onChange({
                ...value,
                acceleration: acceleration as QwenInput["acceleration"],
              })
            }
            disabled={isLoading}
          >
            <SelectTrigger
              id={`${id}-acceleration`}
              className="h-8 min-w-0 border-border bg-bg-2 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: "none", label: "None (best quality)" },
                { value: "regular", label: "Regular" },
                { value: "high", label: "High (fastest)" },
              ].map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor={`${id}-negative_prompt`}
          className="text-[12px] font-medium text-fg-2"
        >
          Negative Prompt (optional)
        </Label>
        <Textarea
          id={`${id}-negative_prompt`}
          value={value.negative_prompt ?? ""}
          onChange={(event) =>
            onChange({
              ...value,
              negative_prompt: event.target.value || undefined,
            })
          }
          disabled={isLoading}
          placeholder="Describe what you don't want in the result..."
          maxLength={500}
          rows={2}
          className="resize-y border-border bg-bg-2 text-[12px] leading-5 text-fg placeholder:text-fg-3"
        />
      </div>

      <Button
        onClick={onSubmit}
        type="button"
        aria-label={
          (isLoading ? "Generating..." : "Generate with Qwen").trim() ||
          undefined
        }
        disabled={isLoading || !value.prompt.trim()}
        className="h-8 w-full bg-accent text-[12px] text-accent-fg hover:bg-accent/90"
      >
        <span className="truncate">
          {isLoading ? "Generating..." : "Generate with Qwen"}
        </span>
      </Button>
    </fieldset>
  );
}
