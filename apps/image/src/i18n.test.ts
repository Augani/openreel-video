import { afterEach, describe, expect, it } from "vitest";
import i18n, { getPreferredSupportedLanguage } from "./i18n";

describe("image i18n", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
  });

  it("switches settings and inspector copy to Chinese without raw keys", async () => {
    await i18n.changeLanguage("zh-CN");

    const samples = [
      i18n.t("settings:dialog.title"),
      i18n.t("settings:appearance.language"),
      i18n.t("inspector:transform.title"),
      i18n.t("editor:welcome.actions.openProject"),
    ];

    expect(samples).toEqual(["设置", "语言", "变换", "打开项目"]);
    expect(samples.join(" ")).not.toMatch(/\w+:[\w.]+/);
  });

  it("detects a supported browser language preference", () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["zh-TW", "en-US"],
    });

    expect(getPreferredSupportedLanguage()).toBe("zh-CN");
  });
});
