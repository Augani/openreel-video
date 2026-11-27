import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { initLanguage, languageStore } from "@openreel/i18n";
import { DroppedFrameIndicator } from "./DroppedFrameIndicator";

const source = {
  getDroppedFrames: () => 0,
  resetDroppedFrames: () => {},
  subscribeDroppedFrames: () => () => {},
};

afterEach(() => {
  localStorage.removeItem("openreel.language");
  cleanup();
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
});

it("translates the dropped-frame indicator menu", async () => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  languageStore.setPreference("zh-CN");
  render(<DroppedFrameIndicator source={source} />);

  const trigger = screen.getByRole("button");
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  });

  expect(await screen.findByRole("menuitemcheckbox", { name: "显示丢帧指示器" })).toBeInTheDocument();
  expect(await screen.findByRole("menuitem", { name: "重置计数" })).toBeInTheDocument();
});
