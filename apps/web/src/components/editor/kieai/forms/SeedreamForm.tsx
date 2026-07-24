import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
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
      <ToolcraftTextAreaControl
        label="Prompt"
        isRequired
        value={value.prompt}
        onChange={(prompt) => onChange({ ...value, prompt })}
        placeholder="Describe the image you want to generate..."
        maxLength={3000}
        rows={4}
        width="100%"
      />

      <div className="grid grid-cols-2 gap-3">
        <Selector
          label="Aspect Ratio"
          value={value.aspect_ratio}
          onChange={(aspect_ratio) =>
            onChange({ ...value, aspect_ratio: aspect_ratio as SeedreamInput["aspect_ratio"] })
          }
          options={[...ASPECT_RATIO_OPTIONS]}
          size="sm"
          width="100%"
        />

        <Selector
          label="Quality"
          value={value.quality}
          onChange={(quality) =>
            onChange({ ...value, quality: quality as SeedreamInput["quality"] })
          }
          options={[
            { value: "basic", label: "Basic (2K)" },
            { value: "high", label: "High (4K)" },
          ]}
          size="sm"
          width="100%"
        />
      </div>

      <Button
        label={isLoading ? "Generating..." : "Generate with Seedream"}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
