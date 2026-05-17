import { afterEach, describe, expect, it } from "vitest";
import i18n, { getPreferredSupportedLanguage } from "./i18n";

describe("i18n", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
  });

  it("switches core UI namespaces to Chinese without raw keys", async () => {
    await i18n.changeLanguage("zh-CN");

    const samples = [
      i18n.t("settings:dialog.title"),
      i18n.t("welcome:screen.openEditor"),
      i18n.t("welcome:recovery.recoverProject"),
      i18n.t("editor:app.initializingEditor"),
      i18n.t("editor:toolbar.tooltips.backToHome"),
      i18n.t("editor:timeline.actions.addTrack"),
      i18n.t("editor:keyboardShortcuts.shortcuts.playback.playPause.name"),
      i18n.t("editor:assetsPanel.title"),
      i18n.t("editor:assetsPanel.actions.addToTimeline"),
      i18n.t("editor:inspector.empty.noSelection"),
      i18n.t("editor:tour.spotlight.steps.welcome.title"),
    ];

    expect(samples).toEqual([
      "设置",
      "打开编辑器",
      "恢复项目",
      "正在初始化编辑器...",
      "返回首页",
      "添加轨道",
      "播放/暂停",
      "资产",
      "添加到时间线",
      "未选择内容",
      "欢迎使用 OpenReel",
    ]);
    expect(samples.join(" ")).not.toMatch(/\w+:[\w.]+/);
  });

  it("detects a supported browser language preference", () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["zh-Hans-CN", "en-US"],
    });

    expect(getPreferredSupportedLanguage()).toBe("zh-CN");
  });
});
