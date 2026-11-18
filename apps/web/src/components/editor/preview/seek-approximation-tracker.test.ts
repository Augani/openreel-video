import { describe, expect, it } from "vitest";
import { PresentedFrameTracker } from "./seek-approximation";

describe("PresentedFrameTracker", () => {
  it("blocks an approximation for the time whose exact frame is shown", () => {
    const t = new PresentedFrameTracker();
    expect(t.allowsApproximation(3)).toBe(true);
    t.markExact(3);
    expect(t.allowsApproximation(3)).toBe(false);
    expect(t.allowsApproximation(5)).toBe(true);
  });

  it("allows an approximation back to an earlier exact time once an approximation replaced it", () => {
    const t = new PresentedFrameTracker();
    t.markExact(3);
    t.markApproximate();
    expect(t.allowsApproximation(3)).toBe(true);
  });
});
