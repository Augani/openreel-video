import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@openreel/ui";
import { useTranslation } from "react-i18next";
import type { Flux2Input } from "../../../../services/kieai/image-generation";
import { ASPECT_RATIO_OPTIONS } from "./shared";

interface Props {
  value: Flux2Input;
  onChange: (v: Flux2Input) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function Flux2Form({ value, onChange, onSubmit, isLoading }: Props) {
  const { t } = useTranslation();
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{t("kieAi.aspectRatio")}</label>
          <Select value={value.aspect_ratio} onValueChange={(v) => onChange({ ...value, aspect_ratio: v as Flux2Input["aspect_ratio"] })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASPECT_RATIO_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{t("kieAi.resolution")}</label>
          <Select value={value.resolution} onValueChange={(v) => onChange({ ...value, resolution: v as Flux2Input["resolution"] })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1K">{t("kieAi.resolution1K")}</SelectItem>
              <SelectItem value="2K">{t("kieAi.resolution2K")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button onClick={onSubmit} disabled={isLoading || !value.prompt.trim()} className="w-full">
        {isLoading ? t("kieAi.generating") : t("kieAi.generateFlux")}
      </Button>
    </div>
  );
}
