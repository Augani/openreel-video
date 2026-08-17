import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "简体中文" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const SETTINGS_STORAGE_KEY = "openreel-settings";

/**
 * Resolve the language persisted by the settings store without importing the
 * store module (the store itself depends on this module for language changes).
 */
function readPersistedLanguage(): string | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { language?: unknown } };
    const language = parsed.state?.language;
    return typeof language === "string" ? language : null;
  } catch {
    return null;
  }
}

/** Initial language: persisted choice, else the browser language, else English. */
export function detectInitialLanguage(): LanguageCode {
  const persisted = readPersistedLanguage();
  if (persisted === "en" || persisted === "zh") return persisted;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

// English copy doubles as the lookup key, so no "en" resource bundle exists:
// a key missing from the active bundle simply falls back to the English text.
void i18next.use(initReactI18next).init({
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  supportedLngs: ["en", "zh"],
  resources: {},
  // UI copy contains "." and ":" (e.g. "Auto-Save", "1.5x"); do not treat them as separators.
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }, // React already escapes interpolated values
  react: { useSuspense: false },
});

export const i18n = i18next;

/** Translate outside of React components (module scope, stores, helpers). */
export function t(key: string): string {
  return i18next.t(key);
}

/** Load a locale bundle on demand so English-only users never download it. */
export async function ensureLocaleLoaded(language: string): Promise<void> {
  if (!language.startsWith("zh") || i18next.hasResourceBundle("zh", "translation")) {
    return;
  }
  const zh = await import("./locales/zh.json");
  i18next.addResourceBundle("zh", "translation", zh.default, true, true);
}
