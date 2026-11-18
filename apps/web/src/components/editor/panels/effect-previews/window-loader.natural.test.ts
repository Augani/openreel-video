import { describe, expect, it } from "vitest";
import { containSize, previewSizeForDevice } from "./window-loader";

describe("natural (uncropped) overlay frames", () => {
  it("keeps the footage aspect inside the card size, for any orientation", () => {
    const card = { width: 384, height: 216 };
    expect(containSize(card, 1920, 1080)).toEqual({ width: 384, height: 216 });
    // 9:16 footage: as tall as the card, 9/16 as wide, never the cover crop a 16:9 card would take.
    expect(containSize(card, 1080, 1920)).toEqual({ width: 122, height: 216 });
    expect(containSize(card, 1000, 1000)).toEqual({ width: 216, height: 216 });
    // Unknown dimensions fall back to the card.
    expect(containSize(card, 0, 0)).toEqual(card);
  });

  it("decodes the overlay cards wider than the effect cards so a thin bar stays visible", () => {
    const effects = previewSizeForDevice(2);
    const overlays = previewSizeForDevice(2, 1.5);
    expect(overlays.width).toBeGreaterThan(effects.width);
    expect(overlays.width / overlays.height).toBeCloseTo(16 / 9, 2);
  });
});
