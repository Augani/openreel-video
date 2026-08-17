import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { GrokInput } from "../../../../services/kieai/image-generation";
import { useTranslation } from "react-i18next";

interface Props {
  value: GrokInput;
  onChange: (v: GrokInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function GrokForm({ value, onChange, onSubmit, isLoading }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Card variant="blue" padding={2} className="border border-blue-500/30">
        <Text type="supporting" className="text-xs text-blue-400">
          {t("Grok Imagine uses the source image as a reference for style and composition. An optional prompt can guide the transformation.")}</Text>
      </Card>

      <ToolcraftTextAreaControl
        label={t("Prompt (optional)")}
        value={value.prompt ?? ""}
        onChange={(prompt) => onChange({ ...value, prompt: prompt || undefined })}
        placeholder={t("Optional: describe what you want to change or emphasize...")}
        maxLength={1000}
        rows={3}
        width="100%"
      />

      <Button
        label={isLoading ? t("Generating...") : t("Generate with Grok Imagine")}
        onClick={onSubmit}
        isDisabled={isLoading}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
