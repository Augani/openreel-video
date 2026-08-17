import { describe, it, expect, afterEach, vi } from "vitest";
import zhJson from "./locales/zh.json";
import { i18n, t, ensureLocaleLoaded, detectInitialLanguage, SUPPORTED_LANGUAGES } from "./index";
import { useSettingsStore } from "../stores/settings-store";

const zh = zhJson as Record<string, string>;

describe("i18n", () => {
  afterEach(async () => {
    useSettingsStore.getState().setLanguage("en");
    await i18n.changeLanguage("en");
  });

  it("falls back to the English key when no translation exists", () => {
    expect(t("Definitely untranslated UI copy")).toBe("Definitely untranslated UI copy");
  });

  it("keeps keys containing dots and colons intact", () => {
    expect(t("Auto-Save")).toBe("Auto-Save");
    expect(t("1.5x")).toBe("1.5x");
  });

  it("switches language through the settings store", async () => {
    useSettingsStore.getState().setLanguage("zh");
    await vi.waitFor(() => expect(i18n.language).toBe("zh"));
    expect(useSettingsStore.getState().language).toBe("zh");
  });

  it("translates keys present in the zh bundle", async () => {
    await ensureLocaleLoaded("zh");
    const sample = Object.keys(zh)[0];
    if (sample !== undefined) {
      await i18n.changeLanguage("zh");
      expect(i18n.t(sample)).toBe(zh[sample]);
    }
  });

  it("loads the zh bundle only once", async () => {
    await ensureLocaleLoaded("zh");
    expect(i18n.hasResourceBundle("zh", "translation")).toBe(true);
    await ensureLocaleLoaded("zh");
    expect(i18n.hasResourceBundle("zh", "translation")).toBe(true);
  });

  it("offers English and Chinese in the language list", () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(["en", "zh"]);
  });

  it("detects the persisted language from localStorage", () => {
    window.localStorage.setItem(
      "openreel-settings",
      JSON.stringify({ state: { language: "zh" }, version: 2 }),
    );
    expect(detectInitialLanguage()).toBe("zh");
    window.localStorage.removeItem("openreel-settings");
  });

  it("defaults to English without a persisted choice or zh browser locale", () => {
    window.localStorage.removeItem("openreel-settings");
    expect(detectInitialLanguage()).toBe("en");
  });
});

describe("zh locale bundle", () => {
  it("only contains non-empty string values", () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(typeof value, `value for "${key}"`).toBe("string");
      expect((value as string).trim().length, `value for "${key}"`).toBeGreaterThan(0);
    }
  });
});
