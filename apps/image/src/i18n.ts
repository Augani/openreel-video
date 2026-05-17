import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "./locales/en/common.json";
import editor from "./locales/en/editor.json";
import inspector from "./locales/en/inspector.json";
import settings from "./locales/en/settings.json";
import commonZh from "./locales/zh-CN/common.json";
import editorZh from "./locales/zh-CN/editor.json";
import inspectorZh from "./locales/zh-CN/inspector.json";
import settingsZh from "./locales/zh-CN/settings.json";

export const SUPPORTED_LANGUAGES = ["en", "zh-CN"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

export const IMAGE_LANGUAGE_STORAGE_KEY = "openreel-image-language";
export const IMAGE_LANGUAGE_CHOICE_STORAGE_KEY = "openreel-image-language-choice-made";
export const IMAGE_LANGUAGE_PROMPT_STORAGE_PREFIX = "openreel-image-language-prompt-dismissed";

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)
  );
}

export function getPreferredSupportedLanguage(): SupportedLanguage | null {
  if (typeof navigator === "undefined") return null;

  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];

  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized === "zh-cn" || normalized.startsWith("zh")) {
      return "zh-CN";
    }
    if (normalized.startsWith("en")) {
      return "en";
    }
  }

  return null;
}

export function hasExplicitLanguageChoice(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(IMAGE_LANGUAGE_CHOICE_STORAGE_KEY) === "true";
}

export function markLanguageChoiceMade(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IMAGE_LANGUAGE_CHOICE_STORAGE_KEY, "true");
}

function getStoredLanguage(): SupportedLanguage | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(IMAGE_LANGUAGE_STORAGE_KEY);
  return isSupportedLanguage(stored) ? stored : null;
}

function getInitialLanguage(): SupportedLanguage {
  if (hasExplicitLanguageChoice()) {
    return getStoredLanguage() ?? "en";
  }

  return getPreferredSupportedLanguage() ?? getStoredLanguage() ?? "en";
}

const resources = {
  en: {
    common,
    editor,
    inspector,
    settings,
  },
  "zh-CN": {
    common: commonZh,
    editor: editorZh,
    inspector: inspectorZh,
    settings: settingsZh,
  },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    ns: ["common", "editor", "inspector", "settings"],
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
    },
  });
}

export default i18n;
