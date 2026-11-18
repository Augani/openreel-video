import { describe, it, expect } from "vitest";
import { pickOnnxThreads } from "./whisper-threads";

describe("pickOnnxThreads", () => {
  it("stays single-threaded without cross-origin isolation or on web", () => {
    expect(pickOnnxThreads(false, 16)).toBe(1);
    expect(pickOnnxThreads(true, 16)).toBe(1);
    expect(pickOnnxThreads(false, 16, true)).toBe(1);
  });
  it("on isolated desktop leaves one core free, caps at 8 and survives NaN cores", () => {
    expect(pickOnnxThreads(true, 4, true)).toBe(3);
    expect(pickOnnxThreads(true, 16, true)).toBe(8);
    expect(pickOnnxThreads(true, Number.NaN, true)).toBe(1);
  });
});
