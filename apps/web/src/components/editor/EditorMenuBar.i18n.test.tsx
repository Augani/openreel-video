import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { initLanguage, languageStore } from "@openreel/i18n";
import { useProjectStore } from "../../stores/project-store";
import { EditorMenuBar } from "./EditorMenuBar";

afterEach(() => {
  localStorage.removeItem("openreel.language");
  cleanup();
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
});

it("renders the top-level menus and items in Simplified Chinese", async () => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  useProjectStore.getState().createNewProject("i18n");
  languageStore.setPreference("zh-CN");
  render(<EditorMenuBar onExport={() => {}} onCompress={() => {}} />);

  for (const label of ["文件", "编辑", "片段", "序列", "效果", "视图", "窗口", "帮助"]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }

  const file = screen.getByText("文件");
  await act(async () => {
    file.focus();
    fireEvent.keyDown(file, { key: "ArrowDown" });
  });
  expect(await screen.findByRole("menuitem", { name: /新建项目…/ })).toBeInTheDocument();
});
