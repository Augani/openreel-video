import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { messages, type SupportedLanguage, type TranslationKey } from "./messages";
export type { SupportedLanguage, TranslationKey } from "./messages";

type TranslationParams = Record<string, string | number>;

interface I18nContextValue {
  language: SupportedLanguage;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  formatDate: (value: number, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeLanguage(language: string): SupportedLanguage {
  return language === "zh-CN" ? "zh-CN" : "en";
}

export const I18nProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const settingsLanguage = useSettingsStore((state) => state.language);
  const [language, setLanguage] = useState<SupportedLanguage>(
    normalizeLanguage(settingsLanguage),
  );

  useEffect(() => {
    setLanguage(normalizeLanguage(settingsLanguage));
  }, [settingsLanguage]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = messages[language];
    const fallback = messages.en;

    return {
      language,
      t: (key, params) => {
        const entry = dictionary[key] ?? fallback[key];
        if (typeof entry === "function") {
          return entry((params ?? {}) as never);
        }
        return entry;
      },
      formatDate: (value, options) =>
        new Intl.DateTimeFormat(language, options).format(new Date(value)),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
