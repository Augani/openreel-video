import { describe, expect, it } from "vitest";
import { TitleEngine } from "./title-engine";

describe("TitleEngine defaults", () => {
  it("creates white titles with a dark edge for light-footage contrast", () => {
    const clip = new TitleEngine().createTextClip({
      trackId: "text-track",
      startTime: 0,
      duration: 5,
      text: "New Title",
    });

    expect(clip.style.color).toBe("#ffffff");
    expect(clip.style.strokeColor).toBe("#111827");
    expect(clip.style.strokeWidth).toBe(2);
  });
});
