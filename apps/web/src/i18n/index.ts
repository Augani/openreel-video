import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const SUPPORTED_LANGUAGES = {
  en: { label: "English", nativeLabel: "English" },
  "zh-CN": { label: "Chinese (Simplified)", nativeLabel: "简体中文" },
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

const DEFAULT_LANGUAGE: SupportedLanguage = "en";

const savedLanguage = (() => {
  try {
    const raw = localStorage.getItem("openreel-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      const lang = parsed?.state?.language;
      if (lang && lang in SUPPORTED_LANGUAGES) {
        return lang as SupportedLanguage;
      }
    }
  } catch {}
  return null;
})();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: savedLanguage ?? DEFAULT_LANGUAGE,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
  returnEmptyString: false,
});

export default i18n;
