import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { ContextMenuContent } from "@openreel/ui";
import { initLanguage, languageStore } from "@openreel/i18n";
import { LabelPickerItems } from "./ProjectPanelMenus";
import { openContextMenu } from "../../../test/open-context-menu";

afterEach(() => {
  localStorage.removeItem("openreel.language");
  cleanup();
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
});

it("translates media label menu entries", async () => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  languageStore.setPreference("zh-CN");
  openContextMenu(
    <ContextMenuContent>
      <LabelPickerItems kind="context" onPick={() => {}} onInherit={() => {}} />
    </ContextMenuContent>,
  );

  expect(await screen.findByRole("menuitem", { name: /无/ })).toBeInTheDocument();
  expect(await screen.findByRole("menuitem", { name: /从素材继承/ })).toBeInTheDocument();
});
