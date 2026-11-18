import { describe, expect, it } from "vitest";
import { getCaptionWrapWidth } from "./title-engine";
import { DEFAULT_TEXT_TRANSFORM } from "./types";

const clip = (metadata?: Record<string, unknown>) => ({ metadata, transform: DEFAULT_TEXT_TRANSFORM });

describe("getCaptionWrapWidth", () => {
  it("wraps template text at the ratio it opted into, so a long quote stays inside the frame", () => {
    expect(getCaptionWrapWidth(clip({ wrapWidthRatio: 0.84 }), 1920)).toBeCloseTo(1920 * 0.84 - 20);
  });

  it("keeps captions at 90% and leaves plain text unwrapped", () => {
    expect(getCaptionWrapWidth(clip({ captionSource: "x" }), 1000)).toBeCloseTo(880);
    expect(getCaptionWrapWidth(clip(), 1000)).toBeUndefined();
    expect(getCaptionWrapWidth(clip({ wrapWidthRatio: 0 }), 1000)).toBeUndefined();
  });
});
