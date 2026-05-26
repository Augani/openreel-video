import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@openreel/ui";
import { useTranslation } from "react-i18next";
import type { QwenInput } from "../../../../services/kieai/image-generation";

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
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">{t("kieAi.promptRequired")}</label>
        <textarea
          value={value.prompt}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
          placeholder={t("kieAi.imagePlaceholder")}
          maxLength={2000}
          rows={4}
          className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-primary"
        />
        <p className="text-[10px] text-text-muted text-right">{value.prompt.length}/2000</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">
          {t("kieAi.strengthLabel")} — {strength.toFixed(1)}
          <span className="ml-2 text-text-muted font-normal">{t("kieAi.strengthDescription")}</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={strength}
          onChange={(e) => onChange({ ...value, strength: parseFloat(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-text-muted">
          <span>{t("kieAi.strengthPreserve")}</span>
          <span>{t("kieAi.strengthRemake")}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{t("kieAi.format")}</label>
          <Select
            value={value.output_format ?? "png"}
            onValueChange={(v) => onChange({ ...value, output_format: v as QwenInput["output_format"] })}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="png">{t("kieAi.formatPNG")}</SelectItem>
              <SelectItem value="jpeg">{t("kieAi.formatJPEG")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{t("kieAi.acceleration")}</label>
          <Select
            value={value.acceleration ?? "regular"}
            onValueChange={(v) => onChange({ ...value, acceleration: v as QwenInput["acceleration"] })}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("kieAi.accelerationNone")}</SelectItem>
              <SelectItem value="regular">{t("kieAi.accelerationRegular")}</SelectItem>
              <SelectItem value="high">{t("kieAi.accelerationHigh")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">{t("kieAi.negativePromptOptional")}</label>
        <textarea
          value={value.negative_prompt ?? ""}
          onChange={(e) => onChange({ ...value, negative_prompt: e.target.value || undefined })}
          placeholder={t("kieAi.negativePrompt")}
          maxLength={500}
          rows={2}
          className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-primary"
        />
      </div>

      <Button onClick={onSubmit} disabled={isLoading || !value.prompt.trim()} className="w-full">
        {isLoading ? t("kieAi.generating") : t("kieAi.generateQwen")}
      </Button>
    </div>
  );
}
