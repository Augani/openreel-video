import { describe, it, expect } from "vitest";
import {
  previewQualityScale,
  computePreviewResolution,
  PREVIEW_MAX_DIMENSION,
} from "./preview-resolution";

describe("previewQualityScale", () => {
  it("returns fixed multipliers for explicit levels", () => {
    expect(previewQualityScale("full", 1920, 1080)).toBe(1);
    expect(previewQualityScale("half", 1920, 1080)).toBe(0.5);
    expect(previewQualityScale("quarter", 1920, 1080)).toBe(0.25);
  });

  it("auto stays full for <=1440p sources", () => {
    expect(previewQualityScale("auto", 1920, 1080)).toBe(1);
    expect(previewQualityScale("auto", 2560, 1440)).toBe(1);
  });

  it("auto drops to half for 4K+ sources", () => {
    expect(previewQualityScale("auto", 3840, 2160)).toBe(0.5);
    expect(previewQualityScale("auto", 2160, 3840)).toBe(0.5);
  });

  it("composes with computePreviewResolution to halve a 1080p render target", () => {
    const scale = previewQualityScale("half", 1920, 1080);
    const res = computePreviewResolution(
      1920,
      1080,
      PREVIEW_MAX_DIMENSION * scale,
    );
    expect(res.width).toBe(960);
    expect(res.height).toBe(540);
  });

  it("full quality preserves existing 1920 cap behaviour", () => {
    const scale = previewQualityScale("full", 3840, 2160);
    const res = computePreviewResolution(
      3840,
      2160,
      PREVIEW_MAX_DIMENSION * scale,
    );
    expect(res.width).toBe(1920);
    expect(res.height).toBe(1080);
  });
});
