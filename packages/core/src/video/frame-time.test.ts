import { describe, expect, it } from "vitest";
import { exportRenderTime, frameIndexAt, frameSampleTime, frameStartTime } from "./frame-time";

describe("frame time", () => {
  it("maps a playhead inside a frame to the start of that frame", () => {
    expect(frameSampleTime(60.5 / 30, 30)).toBeCloseTo(2, 9);
    expect(frameSampleTime(60.99 / 30, 30)).toBeCloseTo(2, 9);
    expect(frameIndexAt(60.5 / 30, 30)).toBe(60);
  });

  it("keeps exact frame boundaries, including ones that are not exactly representable", () => {
    for (let frame = 0; frame < 4000; frame += 7) {
      expect(frameIndexAt(frame / 30, 30)).toBe(frame);
      expect(frameIndexAt(frame / 29.97, 29.97)).toBe(frame);
      expect(frameIndexAt(frame / 23.976, 23.976)).toBe(frame);
      expect(frameSampleTime(frame / 30, 30)).toBeCloseTo(frame / 30, 9);
    }
  });

  it("is the instant the export loop renders for a frame", () => {
    // The export renders frame N at N / fps; sampling any playhead of that frame returns exactly that instant.
    for (const fps of [24, 25, 30, 60]) {
      for (const frame of [0, 1, 59, 60, 61, 1234]) {
        const exportTime = frameStartTime(frame, fps);
        for (const offset of [0, 0.25, 0.5, 0.999]) {
          expect(frameSampleTime((frame + offset) / fps, fps)).toBe(exportTime);
        }
      }
    }
  });

  it("leaves times before zero and unusable frame rates alone", () => {
    expect(frameIndexAt(-1, 30)).toBe(0);
    expect(frameSampleTime(-0.5, 30)).toBe(-0.5);
    expect(frameSampleTime(1.234, 0)).toBe(1.234);
    expect(frameSampleTime(Number.NaN, 30)).toBeNaN();
  });

  it("export frames at another rate show the sequence frame on screen, like the preview at that playhead", () => {
    // 24 fps sequence at a 30 fps export: export frame 2 is at 0.0667 s, which is on sequence frame 1.
    expect(exportRenderTime(2, 30, 24)).toBeCloseTo(1 / 24, 9);
    for (const [project, out] of [[24, 30], [30, 24], [25, 29.97], [23.976, 24], [30, 60], [60, 30]]) {
      for (let frame = 0; frame < 300; frame++) {
        const t = exportRenderTime(frame, out, project);
        expect(t).toBe(frameSampleTime(frame / out, project));
        expect(t).toBeLessThanOrEqual(frame / out + 1e-9);
        expect(frame / out - t).toBeLessThan(1 / project + 1e-6);
      }
    }
  });

  it("treats the rounded and exact NTSC rates as the same sequence cadence", () => {
    const exact = 30000 / 1001;
    expect(exportRenderTime(120, exact, 29.97)).toBe(120 / exact);
    expect(exportRenderTime(120, 29.97, exact)).toBe(120 / 29.97);
  });

  it("is untouched at the sequence rate", () => {
    expect(exportRenderTime(61, 30, 30, 0.01)).toBe(0.01 + 61 / 30);
    expect(exportRenderTime(5, 30, 30.0000001)).toBe(5 / 30);
    expect(exportRenderTime(5, 30, 0)).toBe(5 / 30);
  });
});
