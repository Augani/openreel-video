import { describe, expect, it } from "vitest";
import { nativeT, setCurrentLocale } from "../src/main/language-state";

describe("nativeT", () => {
  it("translates native dialog copy with the current locale", () => {
    setCurrentLocale("en");
    expect(nativeT("Unsaved changes")).toBe("Unsaved changes");

    setCurrentLocale("zh-CN");
    expect(nativeT("Unsaved changes")).toBe("未保存的更改");
    expect(nativeT("Could not save")).toBe("无法保存");
    expect(nativeT("Open project")).toBe("打开项目");

    setCurrentLocale("en");
  });
});
