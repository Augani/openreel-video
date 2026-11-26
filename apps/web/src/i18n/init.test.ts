import { expect, it, vi } from "vitest";
import { initLanguage, languageStore } from "@openreel/i18n";
import { pushLanguageToDesktop } from "./init";

it("pushes preference and resolved locale to the desktop bridge", () => {
  const set = vi.fn().mockResolvedValue({ ok: true });
  window.openreel = { platform: "desktop", language: { set } } as never;

  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  languageStore.setPreference("zh-CN");
  pushLanguageToDesktop();

  expect(set).toHaveBeenCalledWith({ preference: "zh-CN", locale: "zh-CN" });
  delete (window as { openreel?: unknown }).openreel;
});
