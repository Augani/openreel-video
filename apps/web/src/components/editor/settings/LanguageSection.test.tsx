import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { initLanguage, languageStore } from "@openreel/i18n";
import { LanguageSection } from "./LanguageSection";

afterEach(() => {
  localStorage.removeItem("openreel.language");
  cleanup();
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
});

it("switches the app language and re-renders itself in Chinese", async () => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  render(<LanguageSection />);

  const select = screen.getByRole("combobox", { name: "Language" });
  fireEvent.keyDown(select, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "简体中文" }));

  expect(languageStore.getPreference()).toBe("zh-CN");
  expect(screen.getByText("语言")).toBeInTheDocument();
});
