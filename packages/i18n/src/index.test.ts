import { beforeEach, describe, expect, it } from "vitest";
import { LANGUAGE_STORAGE_KEY, initLanguage, languageStore, resolveLocale } from "./index";
import { zhCN } from "./zh-CN";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  initLanguage({ storage: memoryStorage(), systemLanguages: ["en-US"] });
});

describe("resolveLocale", () => {
  it("maps zh* system languages to zh-CN and everything else to en", () => {
    expect(resolveLocale("system", ["zh-CN", "en-US"])).toBe("zh-CN");
    expect(resolveLocale("system", ["zh-Hans"])).toBe("zh-CN");
    expect(resolveLocale("system", ["en-US"])).toBe("en");
    expect(resolveLocale("system", [])).toBe("en");
  });

  it("honours an explicit preference over the system", () => {
    expect(resolveLocale("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
  });
});

describe("languageStore", () => {
  it("persists, notifies and exposes the resolved locale", () => {
    const storage = memoryStorage();
    initLanguage({ storage, systemLanguages: ["en-US"] });
    const seen: string[] = [];
    const stop = languageStore.subscribe(() => seen.push(languageStore.getLocale()));

    languageStore.setPreference("zh-CN");

    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
    expect(languageStore.getSnapshot()).toEqual({ preference: "zh-CN", locale: "zh-CN" });
    expect(seen).toEqual(["zh-CN"]);
    stop();
  });

  it("lets a saved preference outrank a forced test locale", () => {
    initLanguage({
      storage: memoryStorage({ [LANGUAGE_STORAGE_KEY]: "zh-CN" }),
      systemLanguages: ["en-US"],
      forcedLocale: "en",
    });
    expect(languageStore.getLocale()).toBe("zh-CN");
  });

  it("treats a saved system preference as an explicit choice over a forced test locale", () => {
    initLanguage({
      storage: memoryStorage({ [LANGUAGE_STORAGE_KEY]: "system" }),
      systemLanguages: ["zh-CN"],
      forcedLocale: "en",
    });
    expect(languageStore.getSnapshot()).toEqual({ preference: "system", locale: "zh-CN" });
  });

  it("uses a forced test locale when nothing is saved", () => {
    initLanguage({
      storage: memoryStorage(),
      systemLanguages: ["en-US"],
      forcedLocale: "zh-CN",
    });
    expect(languageStore.getSnapshot()).toEqual({ preference: "system", locale: "zh-CN" });
  });
});

describe("zh-CN dictionary", () => {
  it("has a non-empty string for every value", () => {
    const entries = Object.entries(zhCN);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(typeof value, key).toBe("string");
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });
});
