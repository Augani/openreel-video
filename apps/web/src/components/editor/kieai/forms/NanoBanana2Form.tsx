import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { NanoBanana2Input } from "../../../../services/kieai/image-generation";
import { ASPECT_RATIO_OPTIONS_AUTO } from "./shared";
import { useTranslation } from "react-i18next";

interface Props {
  value: NanoBanana2Input;
  onChange: (v: NanoBanana2Input) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function NanoBanana2Form({ value, onChange, onSubmit, isLoading }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <ToolcraftTextAreaControl
        label={t("Prompt")}
        isRequired
        value={value.prompt}
        onChange={(prompt) => onChange({ ...value, prompt })}
        placeholder={t("Describe the image you want to generate...")}
        maxLength={2000}
        rows={4}
        width="100%"
      />

      <div className="grid grid-cols-3 gap-3">
        <Selector
          label={t("Aspect Ratio")}
          value={value.aspect_ratio ?? "1:1"}
          onChange={(aspect_ratio) =>
            onChange({ ...value, aspect_ratio: aspect_ratio as NanoBanana2Input["aspect_ratio"] })
          }
          options={[...ASPECT_RATIO_OPTIONS_AUTO]}
          size="sm"
          width="100%"
        />

        <Selector
          label={t("Resolution")}
          value={value.resolution ?? "2K"}
          onChange={(resolution) =>
            onChange({ ...value, resolution: resolution as NanoBanana2Input["resolution"] })
          }
          options={[
            { value: "1K", label: "1K" },
            { value: "2K", label: "2K" },
            { value: "4K", label: "4K" },
          ]}
          size="sm"
          width="100%"
        />

        <Selector
          label={t("Format")}
          value={value.output_format ?? "png"}
          onChange={(output_format) =>
            onChange({ ...value, output_format: output_format as NanoBanana2Input["output_format"] })
          }
          options={[
            { value: "png", label: t("PNG") },
            { value: "jpg", label: t("JPG") },
          ]}
          size="sm"
          width="100%"
        />
      </div>

      <Button
        label={isLoading ? t("Generating...") : t("Generate with Nano Banana 2")}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
