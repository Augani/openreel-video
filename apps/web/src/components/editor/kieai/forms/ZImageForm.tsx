import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { ZImageInput } from "../../../../services/kieai/image-generation";
import { ASPECT_RATIO_OPTIONS_BASIC } from "./shared";
import { useTranslation } from "react-i18next";

interface Props {
  value: ZImageInput;
  onChange: (v: ZImageInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function ZImageForm({ value, onChange, onSubmit, isLoading }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Card variant="yellow" padding={2} className="border border-yellow-500/30">
        <Text type="supporting" className="text-xs text-yellow-400">
          {t("Z-Image is text-to-image. The source image is used as inspiration only, not as a direct reference.")}</Text>
      </Card>

      <ToolcraftTextAreaControl
        label={t("Prompt")}
        isRequired
        value={value.prompt}
        onChange={(prompt) => onChange({ ...value, prompt })}
        placeholder={t("Describe the image you want to generate...")}
        maxLength={1000}
        rows={4}
        width="100%"
      />

      <Selector
        label={t("Aspect Ratio")}
        value={value.aspect_ratio}
        onChange={(aspect_ratio) =>
          onChange({ ...value, aspect_ratio: aspect_ratio as ZImageInput["aspect_ratio"] })
        }
        options={[...ASPECT_RATIO_OPTIONS_BASIC]}
        size="sm"
        width="100%"
      />

      <Button
        label={isLoading ? t("Generating...") : t("Generate with Z-Image")}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
