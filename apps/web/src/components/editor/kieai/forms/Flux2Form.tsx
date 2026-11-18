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
} from "@openreel/ui";
import type { Flux2Input } from "../../../../services/kieai/image-generation";
import { ASPECT_RATIO_OPTIONS } from "./shared";

interface Props {
  value: Flux2Input;
  onChange: (v: Flux2Input) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function Flux2Form({ value, onChange, onSubmit, isLoading }: Props) {
  const id = useId();
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                aspect_ratio: aspect_ratio as Flux2Input["aspect_ratio"],
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
              {[...ASPECT_RATIO_OPTIONS].map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label
            htmlFor={`${id}-resolution`}
            className="text-[12px] font-medium text-fg-2"
          >
            Resolution
          </Label>
          <Select
            value={value.resolution}
            onValueChange={(resolution) =>
              onChange({
                ...value,
                resolution: resolution as Flux2Input["resolution"],
              })
            }
            disabled={isLoading}
          >
            <SelectTrigger
              id={`${id}-resolution`}
              className="h-8 min-w-0 border-border bg-bg-2 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: "1K", label: "1K" },
                { value: "2K", label: "2K" },
              ].map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        onClick={onSubmit}
        type="button"
        aria-label={
          (isLoading ? "Generating..." : "Generate with Flux 2").trim() ||
          undefined
        }
        disabled={isLoading || !value.prompt.trim()}
        className="h-8 w-full bg-accent text-[12px] text-accent-fg hover:bg-accent/90"
      >
        <span className="truncate">
          {isLoading ? "Generating..." : "Generate with Flux 2"}
        </span>
      </Button>
    </fieldset>
  );
}
