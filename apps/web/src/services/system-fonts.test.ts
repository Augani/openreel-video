import { describe, expect, it } from "vitest";
import { normalizeGoogleFamily, pickFontUrl, uniqueFamilies } from "./system-fonts";

describe("system fonts", () => {
  it("dedupes and sorts installed families", () => {
    expect(uniqueFamilies([{ family: "Ubuntu" }, { family: "arial" }, { family: "Ubuntu" }, { family: " " }])).toEqual(["arial", "Ubuntu"]);
  });

  it("title-cases typed Google family names", () => {
    expect(normalizeGoogleFamily("  bebas   neue ")).toBe("Bebas Neue");
  });

  it("prefers the latin subset of a css2 stylesheet", () => {
    const css = `/* cyrillic */\n@font-face {\n  font-family: 'X';\n  src: url(https://fonts.gstatic.com/cyr.woff2) format('woff2');\n}\n/* latin */\n@font-face {\n  font-family: 'X';\n  src: url(https://fonts.gstatic.com/latin.woff2) format('woff2');\n}\n`;
    expect(pickFontUrl(css)).toBe("https://fonts.gstatic.com/latin.woff2");
  });

  it("falls back to the only face when there are no subset comments", () => {
    expect(pickFontUrl("@font-face { src: url(https://fonts.gstatic.com/a.ttf) format('truetype'); }")).toBe("https://fonts.gstatic.com/a.ttf");
    expect(pickFontUrl("body {}")).toBeNull();
  });
});
