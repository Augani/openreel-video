import { useId } from "react";
import {
  Button,
  Card,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import type { ZImageInput } from "../../../../services/kieai/image-generation";
import { ASPECT_RATIO_OPTIONS_BASIC } from "./shared";

interface Props {
  value: ZImageInput;
  onChange: (v: ZImageInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function ZImageForm({ value, onChange, onSubmit, isLoading }: Props) {
  const id = useId();
  return (
    <fieldset disabled={isLoading} className="min-w-0 space-y-4 border-0 p-0">
      <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 border border-border">
        <span className="font-normal text-[12px] leading-5 text-fg-2">
          Z-Image generates from text. Describe any details from the source that
          you want to keep.
        </span>
      </Card>

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
          maxLength={1000}
          rows={4}
          className="resize-y border-border bg-bg-2 text-[12px] leading-5 text-fg placeholder:text-fg-3"
        />
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label
          htmlFor={`${id}-aspect-ratio`}
          className="text-[12px] font-medium text-fg-2"
        >
          Aspect Ratio
        </Label>
        <Select
          value={value.aspect_ratio}
          onValueChange={(aspect_ratio) =>
            onChange({
              ...value,
              aspect_ratio: aspect_ratio as ZImageInput["aspect_ratio"],
            })
          }
          disabled={isLoading}
        >
          <SelectTrigger
            id={`${id}-aspect-ratio`}
            className="h-8 min-w-0 border-border bg-bg-2 text-[12px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...ASPECT_RATIO_OPTIONS_BASIC].map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        onClick={onSubmit}
        type="button"
        aria-label={
          (isLoading ? "Generating..." : "Generate with Z-Image").trim() ||
          undefined
        }
        disabled={isLoading || !value.prompt.trim()}
        className="h-8 w-full bg-accent text-[12px] text-accent-fg hover:bg-accent/90"
      >
        <span className="truncate">
          {isLoading ? "Generating..." : "Generate with Z-Image"}
        </span>
      </Button>
    </fieldset>
  );
}
