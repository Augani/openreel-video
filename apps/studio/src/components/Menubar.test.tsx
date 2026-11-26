import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { initLanguage, languageStore } from "@openreel/i18n";
import { CommandsProvider } from "../commands";
import { Menubar } from "./Menubar";

afterEach(() => {
  localStorage.removeItem("openreel.language");
  cleanup();
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
});

it("shows File/Help and the language menu in Simplified Chinese", async () => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  languageStore.setPreference("zh-CN");
  const app = { goHome() {}, newEffect() {}, newFilter() {}, newTemplate() {}, openPreset() {}, openRecent() {}, openTutorials() {} };

  render(<CommandsProvider app={app}><Menubar view="hub" /></CommandsProvider>);

  expect(screen.getByText("文件")).toBeInTheDocument();
  expect(screen.getByText("帮助")).toBeInTheDocument();
  fireEvent.click(screen.getByText("文件"));
  expect(screen.getByText("新建特效")).toBeInTheDocument();
  fireEvent.click(screen.getByText("语言"));
  expect(screen.getByText("跟随系统")).toBeInTheDocument();
});
