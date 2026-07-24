import { describe, expect, it } from "vitest";
import {
  trackOpticalFlowPath,
  trackOpticalFlowStep,
  type OpticalFlowFrame,
} from "./motion-optical-flow";

function makeFrame(
  width: number,
  height: number,
  blockX: number,
  blockY: number,
  half: number,
): OpticalFlowFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const bright =
        Math.abs(x - blockX) <= half && Math.abs(y - blockY) <= half ? 250 : 25;
      data[index] = bright;
      data[index + 1] = bright;
      data[index + 2] = bright;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("motion optical flow", () => {
  it("finds the block shift between two frames", () => {
    const previous = makeFrame(40, 40, 18, 18, 3);
    const next = makeFrame(40, 40, 22, 20, 3);

    const result = trackOpticalFlowStep(
      previous,
      next,
      { x: 18, y: 18 },
      { blockRadius: 3, searchRadius: 8 },
    );

    expect(result.x).toBe(22);
    expect(result.y).toBe(20);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("tracks a feature across a frame sequence", () => {
    const frames = [
      makeFrame(40, 40, 10, 20, 3),
      makeFrame(40, 40, 13, 20, 3),
      makeFrame(40, 40, 16, 21, 3),
    ];

    const path = trackOpticalFlowPath(
      frames,
      { x: 10, y: 20 },
      { blockRadius: 3, searchRadius: 6 },
    );

    expect(path).toHaveLength(3);
    expect(path[0]).toMatchObject({ x: 10, y: 20 });
    expect(path[2].x).toBe(16);
    expect(path[2].y).toBe(21);
  });

  it("reports zero confidence and holds position when no signal is present", () => {
    const flat = makeFrame(20, 20, -10, -10, 0);
    const result = trackOpticalFlowStep(flat, flat, { x: 10, y: 10 });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
  });
});
