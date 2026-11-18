import { describe, expect, it } from "vitest";
import { estimatePresetBytes, formatEstimatedSize } from "./export-preset-estimate";

describe("export preset size estimate", () => {
  it("adds audio to video bitrate over the duration", () => {
    expect(estimatePresetBytes({ bitrate: 8000, audioSettings: { bitrate: 192 } }, 10)).toBe(Math.ceil((8192 * 1000 * 10) / 8));
  });
  it("is zero without duration or bitrate", () => {
    expect(estimatePresetBytes({ bitrate: 8000 }, 0)).toBe(0);
    expect(estimatePresetBytes({ bitrate: 0 }, 10)).toBe(0);
  });
  it("formats sizes", () => {
    expect(formatEstimatedSize(0)).toBe("");
    expect(formatEstimatedSize(300 * 1024)).toBe("~300 KB");
    expect(formatEstimatedSize(5.25 * 1024 * 1024)).toBe("~5.3 MB");
    expect(formatEstimatedSize(28 * 1024 * 1024)).toBe("~28 MB");
    expect(formatEstimatedSize(1.5 * 1024 ** 3)).toBe("~1.50 GB");
  });
});
