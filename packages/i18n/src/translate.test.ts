import { describe, expect, it } from "vitest";
import { translate } from "./translate";

describe("translate", () => {
  it("translates known keys", () => {
    expect(translate("zh-CN", "New project…")).toBe("新建项目…");
  });

  it("falls back to English", () => {
    expect(translate("zh-CN", "Not in dictionary")).toBe("Not in dictionary");
  });

  it("interpolates", () => {
    expect(translate("zh-CN", "Mute {name}", { name: "Intro" })).toBe("静音 Intro");
  });

  it("leaves unknown placeholders", () => {
    expect(translate("zh-CN", "Mute {name}", {})).toBe("静音 {name}");
  });

  it("does not re-interpolate brace text in values", () => {
    expect(translate("zh-CN", "Mute {name}", { name: "{x}" })).toBe("静音 {x}");
  });

  it("returns English with interpolation", () => {
    expect(translate("en", "Mute {name}", { name: "Intro" })).toBe("Mute Intro");
  });

  it.each(["constructor", "toString", "__proto__"])(
    "does not resolve the inherited member %s as a translation",
    (key) => {
      expect(translate("zh-CN", key)).toBe(key);
      expect(translate("zh-CN", key, { name: "Intro" })).toBe(key);
    },
  );
});
