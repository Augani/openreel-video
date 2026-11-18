import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES } from "@openreel/core";
import { emojiCodepoints, twemojiUrl } from "./twemoji";

describe("bundled Twemoji artwork", () => {
  it("names files by codepoint, dropping the variation selector", () => {
    expect(emojiCodepoints("😀")).toBe("1f600");
    expect(emojiCodepoints("❤️")).toBe("2764");
    expect(twemojiUrl("🔥")).toMatch(/emoji\/1f525\.svg$/);
  });

  it("ships an SVG for every emoji in the picker", () => {
    const missing = EMOJI_CATEGORIES.flatMap((cat) => cat.emojis)
      .map((item) => emojiCodepoints(item.emoji))
      .filter((cps) => !existsSync(resolve(__dirname, `../../../../public/emoji/${cps}.svg`)));
    expect(missing).toEqual([]);
  });
});
