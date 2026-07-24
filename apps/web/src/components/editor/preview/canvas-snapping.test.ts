import { describe, expect, it } from "vitest";
import { snapCanvasPosition } from "./canvas-snapping";

describe("snapCanvasPosition", () => {
  const candidates = [
    { value: 0.1, guide: 0 },
    { value: 0.5, guide: 0.5 },
    { value: 0.9, guide: 1 },
  ];

  it("snaps independently to the nearest edge or center guide", () => {
    expect(
      snapCanvasPosition({
        x: 0.49,
        y: 0.89,
        xCandidates: candidates,
        yCandidates: candidates,
        thresholdX: 0.02,
        thresholdY: 0.02,
      }),
    ).toEqual({ x: 0.5, y: 0.9, guideX: 0.5, guideY: 1 });
  });

  it("leaves positions alone outside the threshold or when bypassed", () => {
    expect(
      snapCanvasPosition({
        x: 0.3,
        y: 0.7,
        xCandidates: candidates,
        yCandidates: candidates,
        thresholdX: 0.02,
        thresholdY: 0.02,
      }),
    ).toEqual({ x: 0.3, y: 0.7, guideX: null, guideY: null });
    expect(
      snapCanvasPosition({
        x: 0.49,
        y: 0.49,
        xCandidates: candidates,
        yCandidates: candidates,
        thresholdX: 0.02,
        thresholdY: 0.02,
        enabled: false,
      }),
    ).toEqual({ x: 0.49, y: 0.49, guideX: null, guideY: null });
  });
});
