import { describe, expect, it } from "vitest";
import { formatFrameTimecode, parseFrameTimecode } from "./frame-timecode";
describe("frame timecode", () => {
  it("displays actual frames at 24 and 60 fps rather than hundredths of a second", () => {
    expect(formatFrameTimecode(1.5, 24)).toBe("00:00:01:12");
    expect(formatFrameTimecode(1.5, 60)).toBe("00:00:01:30");
    expect(formatFrameTimecode(3601, 30)).toBe("01:00:01:00");
  });
  it.each([23.976, 24, 29.97, 30, 59.94, 60, 240])("round trips fractional project rates at %s fps", (rate) => {
    for (const time of [0, 1.5, 61.123, 3605.65]) expect(Math.abs(parseFrameTimecode(formatFrameTimecode(time, rate), rate)! - time)).toBeLessThanOrEqual(0.51 / rate);
  });
  it("accepts seconds and minute-second input and snaps to frame boundaries", () => {
    expect(parseFrameTimecode("12.5", 24)).toBe(12.5);
    expect(parseFrameTimecode("1:30", 30)).toBe(90);
    expect(parseFrameTimecode("01:02:12", 24)).toBe(62.5);
    expect(parseFrameTimecode("0.04", 24)).toBe(1 / 24);
  });
  it.each(["", "oops", "-1", "00:00:60:00", "00:00:00:30", "00:99:00:00", "Infinity"])("rejects invalid timecode %s", (value) => expect(parseFrameTimecode(value, 30)).toBeNull());
});
