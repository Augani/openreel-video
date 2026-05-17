import { useEffect, useState } from "react";
import { Languages, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  LANGUAGE_LABELS,
  LANGUAGE_PROMPT_STORAGE_PREFIX,
  getPreferredSupportedLanguage,
  hasExplicitLanguageChoice,
  type SupportedLanguage,
} from "../i18n";
import { useSettingsStore } from "../stores/settings-store";

export function LanguagePreferencePrompt() {
  const { t, i18n } = useTranslation();
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const [suggestedLanguage, setSuggestedLanguage] = useState<SupportedLanguage | null>(null);

  useEffect(() => {
    const preferred = getPreferredSupportedLanguage();
    if (!preferred || preferred === language) return;

    const dismissedKey = `${LANGUAGE_PROMPT_STORAGE_PREFIX}:${preferred}`;
    if (!hasExplicitLanguageChoice()) {
      setLanguage(preferred);
      return;
    }

    if (window.localStorage.getItem(dismissedKey) === "true") return;
    setSuggestedLanguage(preferred);
  }, [language, setLanguage]);

  if (!suggestedLanguage) return null;

  const dismiss = () => {
    window.localStorage.setItem(`${LANGUAGE_PROMPT_STORAGE_PREFIX}:${suggestedLanguage}`, "true");
    setSuggestedLanguage(null);
  };

  const accept = () => {
    setLanguage(suggestedLanguage);
    void i18n.changeLanguage(suggestedLanguage);
    setSuggestedLanguage(null);
  };

  return (
    <div className="fixed left-1/2 top-4 z-[10000] -translate-x-1/2 rounded-xl border border-border bg-background-secondary/95 px-4 py-3 shadow-xl backdrop-blur">
      <div className="flex items-center gap-3">
        <Languages size={18} className="text-primary" />
        <p className="text-sm text-text-primary">
          {t("common:languagePrompt.message", {
            language: LANGUAGE_LABELS[suggestedLanguage],
          })}
        </p>
        <button
          onClick={accept}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
        >
          {t("common:languagePrompt.switch")}
        </button>
        <button
          onClick={dismiss}
          className="rounded-md px-2 py-1.5 text-xs text-text-muted hover:bg-background-tertiary hover:text-text-primary"
        >
          {t("common:languagePrompt.dismiss")}
        </button>
        <button
          onClick={dismiss}
          className="rounded-md p-1 text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          aria-label={t("common:buttons.close")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
