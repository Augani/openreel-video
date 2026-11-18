import { describe, expect, it } from "vitest";
import {
  framesToSeconds,
  framesToTimecode,
  resolveFrameRate,
  secondsToFrames,
  timecodeToFrames,
} from "./timecode";

interface Case {
  label: string;
  fps: number;
  drop: boolean;
  /** frame -> timecode pairs */
  known: [number, string][];
}

const cases: Case[] = [
  { label: "23.976", fps: 23.976, drop: false, known: [[0, "00:00:00:00"], [23, "00:00:00:23"], [24, "00:00:01:00"], [86400, "01:00:00:00"]] },
  { label: "24", fps: 24, drop: false, known: [[24, "00:00:01:00"], [86400, "01:00:00:00"]] },
  { label: "25", fps: 25, drop: false, known: [[25, "00:00:01:00"], [90000, "01:00:00:00"]] },
  { label: "29.97 NDF", fps: 29.97, drop: false, known: [[1800, "00:01:00:00"], [108000, "01:00:00:00"]] },
  {
    label: "29.97 DF",
    fps: 29.97,
    drop: true,
    known: [[1799, "00:00:59;29"], [1800, "00:01:00;02"], [17981, "00:09:59;29"], [17982, "00:10:00;00"], [107892, "01:00:00;00"]],
  },
  { label: "30", fps: 30, drop: false, known: [[30, "00:00:01:00"], [108000, "01:00:00:00"]] },
  { label: "50", fps: 50, drop: false, known: [[50, "00:00:01:00"], [180000, "01:00:00:00"]] },
  { label: "59.94 NDF", fps: 59.94, drop: false, known: [[60, "00:00:01:00"], [216000, "01:00:00:00"]] },
  {
    label: "59.94 DF",
    fps: 59.94,
    drop: true,
    known: [[3599, "00:00:59;59"], [3600, "00:01:00;04"], [35964, "00:10:00;00"], [215784, "01:00:00;00"]],
  },
  { label: "60", fps: 60, drop: false, known: [[60, "00:00:01:00"], [216000, "01:00:00:00"]] },
];

describe("timecode", () => {
  describe.each(cases)("$label", ({ fps, drop, known }) => {
    const rate = resolveFrameRate(fps, { dropFrame: drop });

    it("matches known timecodes", () => {
      for (const [frame, tc] of known) {
        expect(framesToTimecode(frame, rate), `frame ${frame}`).toBe(tc);
        expect(timecodeToFrames(tc, rate), tc).toBe(frame);
      }
    });

    it("round-trips every frame across ~25 minutes", () => {
      const limit = rate.timebase * 60 * 25;
      for (let frame = 0; frame <= limit; frame += 1) {
        expect(timecodeToFrames(framesToTimecode(frame, rate), rate)).toBe(frame);
        if (frame > 20000 && frame % 97 !== 0) frame += 96; // dense early, sparse later
      }
    });

    it("never emits dropped labels and seconds round-trip frame-accurately", () => {
      for (let frame = 0; frame < 5000; frame += 1) {
        expect(secondsToFrames(framesToSeconds(frame, rate), rate)).toBe(frame);
        if (rate.dropFrame) {
          const tc = framesToTimecode(frame, rate);
          const m = /^\d\d:(\d\d):(\d\d);(\d+)$/.exec(tc)!;
          const dropped = Math.round(rate.timebase / 15);
          if (m[2] === "00" && Number(m[1]) % 10 !== 0) expect(Number(m[3])).toBeGreaterThanOrEqual(dropped);
        }
      }
    });
  });

  it("maps NTSC rates to exact rationals", () => {
    expect(resolveFrameRate(23.976)).toMatchObject({ timebase: 24, ntsc: true, num: 24000, den: 1001 });
    expect(resolveFrameRate(29.97)).toMatchObject({ timebase: 30, ntsc: true, num: 30000, den: 1001 });
    expect(resolveFrameRate(59.94)).toMatchObject({ timebase: 60, ntsc: true, num: 60000, den: 1001 });
    expect(resolveFrameRate(30)).toMatchObject({ ntsc: false, num: 30, den: 1 });
  });

  it("ignores drop-frame on rates that cannot drop", () => {
    expect(resolveFrameRate(25, { dropFrame: true }).dropFrame).toBe(false);
    expect(resolveFrameRate(24, { dropFrame: true }).dropFrame).toBe(false);
  });

  it("rejects dropped-frame labels and malformed input", () => {
    const df = resolveFrameRate(29.97, { dropFrame: true });
    expect(() => timecodeToFrames("00:01:00;00", df)).toThrow();
    expect(() => timecodeToFrames("nope", df)).toThrow();
    expect(() => timecodeToFrames("00:00:00:30", resolveFrameRate(30))).toThrow();
  });
});
