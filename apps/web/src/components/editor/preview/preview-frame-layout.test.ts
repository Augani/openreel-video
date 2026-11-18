import { describe, expect, it } from "vitest";
import { previewFrameSize, previewViewportSize } from "./preview-frame-layout";

describe("preview frame zoom layout", () => {
  it("keeps authored Fit geometry and scales both dimensions at 150% and 200%", () => {
    const viewport = { width: 685, height: 360 }, canvas = { width: 1920, height: 1080 };
    expect(previewFrameSize(viewport, canvas, 1, false)).toEqual({ width: 640, height: 360 });
    expect(previewFrameSize(viewport, canvas, 1.5, false)).toEqual({ width: 960, height: 540 });
    expect(previewFrameSize(viewport, canvas, 2, false)).toEqual({ width: 1280, height: 720 });
  });

  it("does not shrink the zoom factor when scrollbars appear", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      offsetWidth: { value: 765 }, clientWidth: { value: 755 },
      offsetHeight: { value: 435 }, clientHeight: { value: 425 },
    });
    const viewport = previewViewportSize(element, { width: 675, height: 350 });
    expect(previewFrameSize(viewport, { width: 1920, height: 1080 }, 1.5, false))
      .toEqual({ width: 960, height: 540 });
  });

});
