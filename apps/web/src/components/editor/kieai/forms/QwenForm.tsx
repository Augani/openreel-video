import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { QwenInput } from "../../../../services/kieai/image-generation";
import { useTranslation } from "react-i18next";

interface Props {
  value: QwenInput;
  onChange: (v: QwenInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function QwenForm({ value, onChange, onSubmit, isLoading }: Props) {
  const { t } = useTranslation();
  const strength = value.strength ?? 0.8;

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

      <div className="space-y-1.5">
        <Text type="supporting" color="secondary" weight="bold" display="block">
          {t("Strength — ")}{strength.toFixed(1)}
          <Text type="supporting" color="secondary" className="ml-2">
            {t("(0 = preserve original, 1 = full remake)")}</Text>
        </Text>
        <ToolcraftSliderControl
          label={t("Strength")}
          isLabelHidden
          min={0}
          max={1}
          step={0.05}
          value={strength}
          onChange={(nextStrength: number) =>
            onChange({ ...value, strength: nextStrength })
          }
          valueDisplay="none"
        />
        <div className="flex justify-between">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {t("Preserve")}</Text>
          <Text type="supporting" color="secondary" className="text-[10px]">
            {t("Remake")}</Text>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Selector
          label={t("Format")}
          value={value.output_format ?? "png"}
          onChange={(output_format) =>
            onChange({ ...value, output_format: output_format as QwenInput["output_format"] })
          }
          options={[
            { value: "png", label: t("PNG") },
            { value: "jpeg", label: t("JPEG") },
          ]}
          size="sm"
          width="100%"
        />

        <Selector
          label={t("Acceleration")}
          value={value.acceleration ?? "regular"}
          onChange={(acceleration) =>
            onChange({ ...value, acceleration: acceleration as QwenInput["acceleration"] })
          }
          options={[
            { value: "none", label: t("None (best quality)") },
            { value: "regular", label: t("Regular") },
            { value: "high", label: t("High (fastest)") },
          ]}
          size="sm"
          width="100%"
        />
      </div>

      <ToolcraftTextAreaControl
        label={t("Negative Prompt (optional)")}
        value={value.negative_prompt ?? ""}
        onChange={(negative_prompt) =>
          onChange({ ...value, negative_prompt: negative_prompt || undefined })
        }
        placeholder={t("Describe what you don't want in the result...")}
        maxLength={500}
        rows={2}
        width="100%"
      />

      <Button
        label={isLoading ? t("Generating...") : t("Generate with Qwen")}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
