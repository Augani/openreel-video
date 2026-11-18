import { describe, expect, it } from "vitest";
import { templatePreviewFrame } from "./GraphicTemplateThumb";

describe("template thumbnail frame follows the sequence", () => {
  it("keeps the 16:9 square-pixel default without a sequence", () => {
    expect(templatePreviewFrame(undefined)).toEqual({ width: 320, height: 180, pixelAspect: 1 });
  });

  it("uses the stored aspect and the sequence pixel aspect", () => {
    expect(templatePreviewFrame({ width: 720, height: 480, pixelAspectRatio: 10 / 11 })).toEqual({
      width: 320,
      height: 213,
      pixelAspect: 10 / 11,
    });
    expect(templatePreviewFrame({ width: 1440, height: 1080, pixelAspectRatio: 4 / 3 }).pixelAspect).toBeCloseTo(4 / 3, 9);
  });

  it("treats an out-of-range PAR as square", () => {
    expect(templatePreviewFrame({ width: 1920, height: 1080, pixelAspectRatio: 9 }).pixelAspect).toBe(1);
  });
});
