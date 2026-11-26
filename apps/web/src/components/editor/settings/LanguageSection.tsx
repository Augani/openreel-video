import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import type { LanguagePreference } from "@openreel/i18n";
import { useLanguage, useT } from "@openreel/i18n/react";

const CHOICES: ReadonlyArray<{ value: LanguagePreference; label: string }> = [
  { value: "system", label: "Follow system" },
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];

export function LanguageSection() {
  const t = useT();
  const { preference, setPreference } = useLanguage();

  return (
    <section className="space-y-3" aria-labelledby="language-settings-heading">
      <div>
        <h3 id="language-settings-heading" className="text-sm font-medium">
          {t("Language")}
        </h3>
        <p className="mt-1 text-xs leading-5 text-fg-2">
          {t("Menu language. Other parts of the app stay in English until translated.")}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-fg-2">{t("Menu language")}</span>
        <Select
          value={preference}
          onValueChange={(value) => setPreference(value as LanguagePreference)}
        >
          <SelectTrigger
            aria-label={t("Language")}
            className="h-8 w-full rounded-md bg-bg-2 px-2 text-xs sm:w-[180px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.value === "system" ? t(choice.label) : t(choice.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
