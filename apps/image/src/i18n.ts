import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "./locales/en/common.json";
import editor from "./locales/en/editor.json";
import inspector from "./locales/en/inspector.json";
import settings from "./locales/en/settings.json";

const resources = {
  en: {
    common,
    editor,
    inspector,
    settings,
  },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "en",
    fallbackLng: "en",
    ns: ["common", "editor", "inspector", "settings"],
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
    },
  });
}

export default i18n;
