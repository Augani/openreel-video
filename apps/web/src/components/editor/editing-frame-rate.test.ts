import { describe, expect, it } from "vitest";
import { stepEditingFrame } from "./editing-frame-rate";

describe("frame-accurate keyboard seeking", () => {
  it.each([23.976, 24, 25, 29.97, 30, 59.94, 60])("steps one exact frame at %s fps without accumulated drift", (rate) => {
    let time = 0;
    for (let frame = 1; frame <= 100; frame += 1) {
      time = stepEditingFrame(time, 1, rate);
      expect(time).toBeCloseTo(frame / rate, 10);
    }
    expect(stepEditingFrame(time, -1, rate)).toBeCloseTo(99 / rate, 10);
  });

  it("lands on neighboring frame boundaries after a fractional seek", () => {
    expect(stepEditingFrame(1.01, 1, 30)).toBeCloseTo(31 / 30, 10);
    expect(stepEditingFrame(1.01, -1, 30)).toBe(1);
  });

  it("clamps the first frame and normalizes invalid frame rates", () => {
    expect(stepEditingFrame(0, -1, 30)).toBe(0);
    expect(stepEditingFrame(NaN, 1, NaN)).toBe(1 / 30);
  });
});
